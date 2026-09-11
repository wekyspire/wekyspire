// BattleStage：单场战斗的场景组装（§4 各基座模块的黏合层）。
// 职责：
//   1. reconcile：显示状态快照 → 建/销/更新 CardObject、UnitObject、ZonePileObject、按钮。
//      快照只在 ANIM_STATE_SYNC 节拍应用（见下）；STATE_DIRTY 不再直接驱动场景
//   2. 视觉模型（继承老版 animationSequencer + 两套状态设计的精髓）：
//      **后端状态与前端显示状态分离，显示状态只在 ANIM_STATE_SYNC 节拍推进**——
//      sync 是专有动画指令（tags:['state']），与动画节拍的相对入队位置表达时序：
//      效果类先动画后 sync（演完再变数字）、入场类先 sync 后动画（先转移再播）、
//      离场类先飞行动画后 sync（飞进坟堆数字才+1）。
//      **全局唯一卡牌**：一张卡任何时候恰有一个视觉实体，发动展示用卡本体，无替身无瞬移；
//      离场飞行是阻塞节拍（播完才回 finish），节拍次序全部由 sequencer 编排——
//      sequencer 是 command queue（多指令可并发 running，tags/waitTags 定阻塞），
//      参与时序的 non-trivial 动画都由它编排，fire-and-forget 小特效（粒子/脉冲）才旁路。
//   3. 输入：Picker hover（tooltip/手牌撑开）+ 双模式出牌 + 结算期输入（点选候选卡 → respond）
//      + 区域图标点击（开/关查看器）。出牌交互按投影 targetMode 分流：
//      'enemy'（需选目标）= 杀戮尖塔式瞄准——卡留手牌高亮+撑开，曲线箭头追随指针，
//      松手在存活敌人身上才打出（否则取消）；'none'（免目标）= 旧拖拽——卡随指针走，
//      拖过 PLAY_LINE_Y 松手=打出。
// 不做：日志、tooltip 渲染（Shell/调试页消费 bus 事件）、rest 阶段。
//
// 布局（世界坐标，z=0 平面屏幕高≈100，y 向上，相机抬眼高斜视，16:9 世界宽≈177.8）：
//   手牌 y=-40 居中扇形（压低给战场让位；咏唱卡激活态住手牌扇形，边缘流光表达）；
//   单位脚底锚定场景水平地板（scene.battleLine y=FLOOR_Y，slotTransform 换算）；
//   按钮纵列（主/换卡）x=74 y=-4/-12；牌库图标 (80,-55)；出牌线 y=-20；
//   背景 = 程序化 3D 场景（dungeon3D）。

import * as THREE from 'three';
import { EventNames } from '../../bridge/events.js';
import { DisplayModel } from '../../bridge/displayModel.js';
import { CardObject } from '../objects/CardObject.js';
import { UnitObject } from '../objects/UnitObject.js';
import { ZonePileObject } from '../objects/ZonePileObject.js';
import { CardGalleryObject } from '../objects/CardGalleryObject.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { TargetingArrowObject } from '../objects/TargetingArrowObject.js';
import { ScreenShake, DamageVignette, damageSeverity } from '../objects/screenImpactFX.js';
import { ParticleSystem } from '../particles/ParticleSystem.js';
import { LayoutEngine, HAND_FAN_MECHANICS } from '../layout/LayoutEngine.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { StageAnimator, gsapTween } from '../animator/StageAnimator.js';
import { HandSprings } from '../animator/HandSprings.js';
import { Picker } from '../picker/Picker.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { bakeButtonFace } from '../richtext/buttonFace.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { unitHeightFactor, STANDEE_BASE_HEIGHT, sharedUnitArtCache } from '../art/unitArt.js';
import { getScene, slotTransform } from '../scenes/index.js';
import { createVolumetricMoonlight } from '../scenes/volumetricMoon.js';
// 卡面世界尺寸：权威定义在 objects/cardMetrics.js（休息阶段面板共用同一尺寸源）；
// 此处再导出以保持既有引用（测试 / ZonePileObject 取参）不破。
import { CARD_WIDTH, CARD_HEIGHT } from '../objects/cardMetrics.js';
export { CARD_WIDTH, CARD_HEIGHT };

export const PLAY_LINE_Y = -20;
const PICK_SCALE = 0.62; // 选卡覆盖层的卡缩放（比手牌略大，便于点选）
const ARROW_Z = 45; // 瞄准箭头所在平面：高于手牌扇（静息 z≤15，悬浮抬升后 ≤36），viewer（z=80）打开时 aiming 不可达

const BUTTON_SIZE = { w: 15, h: 6 };
// 按钮纵列：主按钮（结束回合/确认）在上，换卡按钮在下（右下自由区，避让人群与手牌扇）
export const BUTTON_POSITIONS = {
  main: { x: 74, y: -4 },
  swap: { x: 74, y: -12 },
};
const PILE_POSITIONS = {
  deck: { x: 80, y: -55 },      // 牌库图标（手牌右侧下；扇形手牌卡中心右界 64，避让开）
};                               // FIFO 单循环区：无弃牌堆，离场非消耗卡一律飞回牌库
// 手牌悬浮/瞄准提拉目标：整牌（含 liftScale 放大）拉入屏内 + 2 单位余量。
// 由卡高与放大系数推导（旧固定值 -46.5 是 27 高卡时代遗留，卡面 ×1.3 后下缘重新出屏）
const HAND_LIFT_Y = UI_CAMERA_LOOK_AT_Y - WORLD_HEIGHT / 2
  + (CARD_HEIGHT * HAND_FAN_MECHANICS.liftScale) / 2 + 2;
// 焚毁燃烧总时长（ms）：离场节拍阻塞至此——发动 → 效果 → 燃烧殆尽 → 状态同步
const CARD_BURN_MS = 750;
// 玩家状态栏摆放位：与地图舞台共享的契约，定义见 PlayerStatusObject.js
export { PLAYER_STATUS_POS };

export class BattleStage {
  /**
   * @param {object} options
   *   bridge: createBridge 产物
   *   stageManager: StageManager
   *   bus: UI 事件出口（tooltip/card-hover），缺省 bridge.frontendBus
   *   bakeFace(cardProjection) / bakeLabel(text)：烘焙函数，缺省浏览器 canvas 实现（可注入 fake）
   *   tween: StageAnimator 的 tween 工厂（缺省 gsap，测试注入手动版）
   */
  constructor({ bridge, stageManager, bus = null, bakeFace = null, bakeLabel = null, tween = undefined, scene = 'dungeon', sceneSeed = 'dev', displayModel = null }) {
    this.bridge = bridge;
    this.name = 'battle';
    this.scene = new THREE.Scene();   // 3D 世界 pass：场景/单位/粒子（与地板正确深度交互）
    this.uiScene = new THREE.Scene(); // UI pass：卡牌/按钮/图标/资源点（清深度后渲染，不被地板 z-test 裁掉）
    this._bus = bus || bridge.frontendBus;
    this._sceneDef = getScene(scene, sceneSeed);
    // 素材缓存 = 应用级共享单例（跨场/跨舞台复用已解码图，预取也进同一份）：
    // node 单测注入 fake bakeFace 时不走卡图链路，缓存保持 null
    this._artCache = (!bakeFace && typeof document !== 'undefined')
      ? sharedCardArtCache
      : null;
    // 立牌缓存同理：异步到图后补挂纹理（订阅挂在构造尾部的 _unsubs）
    this._unitArt = (typeof document !== 'undefined')
      ? sharedUnitArtCache
      : null;
    this._bakeFace = bakeFace || makeCardFaceBaker({ cardArt: this._artCache, unitArt: this._unitArt });
    // 小字号文本（HP/效果行/资源点）：烘焙 scale 3 供更干净的 mipmap 链，
    // 并开各向异性过滤（效果行随 billboard 与俯视相机成斜角，aniso 防斜向模糊/闪烁）
    this._bakeLabel = bakeLabel || ((text) => {
      const out = renderRichTextBlock(text, { maxWidth: 220, scale: 3, style: { fontSize: 16, lineHeight: 20 } });
      out.texture.anisotropy = Math.min(8, this._smMaxAnisotropy());
      return out;
    });
    // 单位 billboard 文本（HP 数值/效果行/盾徽 chip）专用大字号烘焙：敌排在
    // z≈-50 视距下屏幕像素密度仅 ~9px/wu，22px 字号屏上仅 ~20px 高——纹理密度
    // 已是屏上 4 倍（scale4），瓶颈不在分辨率而在小字号的 mip 缩小采样发灰：
    // 深描边（bakeBoldText 同语言，宽 = 20% 字号）保对比度。玩家状态栏/顶栏
    // 走 16px 通用烘焙（近景视距，不加描边）。
    this._bakeUnitLabel = bakeLabel || ((text) => {
      const out = renderRichTextBlock(text, {
        maxWidth: 320, scale: 4, style: { fontSize: 22, lineHeight: 28 },
        textStroke: { width: 4.4, color: 'rgba(5, 7, 12, 0.9)' },
      });
      out.texture.anisotropy = Math.min(8, this._smMaxAnisotropy());
      return out;
    });

    // 程序化 3D 场景（低多边形 + 灯光 + 氛围粒子锚点），node 单测同样可建
    this._scene3D = this._sceneDef.build3D ? this._sceneDef.build3D() : null;
    if (this._scene3D) {
      this.scene.add(this._scene3D.group);
      // 雾：远景没入永夜蓝黑但保留墙/窗剪影（相机 (0,30,235) 斜视；立牌材质 fog:false 不受影响）。
      // 前后排布局后场景纵深拉长（敌排 z≈-50、远墙 z=-80），雾距拉近让远排沉进暗部强化纵深。
      // PCG 房型配方可自带雾处方（火把章没有体积光 wash 抵消雾，需远推）——有则用之。
      const fogDef = this._scene3D.recipe?.fog;
      this.scene.fog = fogDef
        ? new THREE.Fog(fogDef.color, fogDef.near, fogDef.far)
        : new THREE.Fog(0x060a14, 165, 310);
    }
    // 体积月光 composer（ray marching，场景带投影月光且 renderer 支持 RT 时接管世界 pass；
    // 单测假 renderer 无 setRenderTarget → null，StageManager 回退直接渲染）
    const renderer = stageManager._renderer;
    if (this._scene3D?.moonlight && renderer && typeof renderer.setRenderTarget === 'function') {
      this._composer = createVolumetricMoonlight({ light: this._scene3D.moonlight });
      this.composeScene = ({ scene, camera }) => this._composer.render(renderer, scene, camera);
      this.composeResize = (w, h) => this._composer.resize(w, h);
      this.composeResize(stageManager.viewSize.width || 2, stageManager.viewSize.height || 2);
    }
    this._tintScratch = new THREE.Color();

    this.layout = new LayoutEngine();
    // 手牌扇形几何：minX/maxX 为卡中心硬区间——左让状态栏面板（UI 底板右缘 ≈ -44.9），
    // 右让牌库图标（x = 80）；baseY 压低让下缘可越出屏底（-65），与重叠、
    // 外倾共同压缩满 10 张所需空间。机制参数（挤开/提拉放大/z 抬升）见 LayoutEngine。
    this.layout.registerContainer('hand', {
      minX: -40.5, maxX: 58.5,        // 横界 2026-08 缩 10%：满手外缘不再压牌库图标（中心 9 不变）
      baseY: -51.3,                   // 随卡高放大（保持已验收的下潜比例 ≈9% 卡高）
      minStep: 13.5, maxStep: 27.3,   // 步长随卡宽 ×1.3：重叠率与旧版一致（≈52% 可见）
      radius: 95,
      // 总弧角（度）：≤4 张恒 5°（近乎放平），第 4 张起线性增至满手 52°
      arcDegMin: 5, arcGrowFrom: 4, arcDegFull: 52,
      liftY: HAND_LIFT_Y,              // 悬浮提拉：整牌入屏（见常量推导，随卡高自适应）
    });
    // 咏唱无槽区：咏唱卡住手牌扇形（激活态 = isActivated 边缘流光），与普通卡同布局。
    this.layout.setNamedAnchor('deck', PILE_POSITIONS.deck);

    this.animator = new StageAnimator({ layoutEngine: this.layout, tween });
    // 手牌/咏唱静息姿态的弹簧跟随层：布局锚点只当目标，逐帧软收敛（见 HandSprings）
    this.springs = new HandSprings({ animator: this.animator });
    // FX tween（overlay 脉冲等不进注册表、不阻塞队列的小动画）：与 animator 同源可注入
    this._tweenFactory = tween ?? gsapTween;
    this.picker = new Picker({ stageManager, bus: this._bus });
    this._sm = stageManager;

    // 显示状态权威 = run 级 DisplayModel（与共享 sequencer 对等，跨场景存活）；
    // BattleStage 只是它的战斗视图。此处未注入则自建（单场测试/headless 用）。
    this.model = displayModel ?? new DisplayModel();
    this.model.beginBattle(); // 战斗边界：卡牌面按场清空（模型本身跨场存活）
    this._views = new Map();  // uniqueID -> CardObject（模型卡条目的 three 视图）
    this._units = new Map();   // uniqueID -> UnitObject
    this._snapshot = null;     // 显示状态快照：只在 ANIM_STATE_SYNC 节拍推进（两套状态设计——
                               // 后端状态即时变，显示状态随队列节拍变，时序由 sync 指令位置表达）
    this._snapshotSeq = 0;     // 已应用快照的显示时刻序号（bridge 投影 seq）：显示状态只进不退
    this._displayCard = null;          // 正在做发动展示的卡 { id }（全局唯一卡牌：展示用本体，无替身）
    this._burning = new Set();         // 焚烧中的卡视图（onTick 驱动 updateBurn 至燃尽；已出注册表）
    this._disposed = false;            // 幽灵守卫：dispose 后本舞台不再处理任何总线事件
    this._entering = new Set();        // 入场飞行中的卡（sync 建档，_layoutAndTrack 起飞后清除）
    this._hoveredCardId = null;
    this._overCardId = null;    // 指针当前压着的卡（整卡或卡面 token 皆算；Shift 详情触发面）
    this._altObj = null;        // 当前处于 Shift 详情态的卡视图（至多一张）
    this._shiftDown = false;    // Shift 键盘态（window 监听驱动；单测直接调 setShiftDown）
    this._dragging = null;     // 免目标卡（targetMode 'none'）旧式拖拽 { id }
    this._aiming = null;       // 选目标卡（targetMode 'enemy'）瞄准中 { id }：卡留手牌，箭头指指针
    this._dragTargetId = null; // 拖牌/瞄准指定的高亮目标（存活敌人）
    this._inputSelection = [];
    // 区域查看器（点牌库图标开）：卡牌画廊——渲染/拾取/悬浮/tooltip 与战斗同一套栈
    // 战斗内「选卡牌集」覆盖层（request.picker === 'overlay'）：手牌来源接管既有实例，
    // 其它区来源按投影新建；见 _openPick/_closePick
    this._pick = null;
    this._viewer = new CardGalleryObject({
      cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT,
      bakeFace: this._bakeFace, picker: this.picker,
    });

    // 粒子系统（受伤/治疗等演出）与卡牌持续特效（咏唱流光），由 StageManager 帧回调驱动
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.points);
    this.scene.add(this.particles.sprites); // 世界内贴图粒子层（3D 场景演出）
    this.uiScene.add(this.particles.spritesUI); // 读数文本粒子层（前景，恒定屏幕尺寸）

    // 受击全屏演出（non-blocking FX，同粒子律不占队列节拍）：
    // 震荡对双相机施加位移 = 世界 pass 与 UI pass 一起晃（真·全屏）；
    // 渐晕是友军受击专属的视角边缘压暗压红覆盖面（uiScene 顶层）
    this.shake = new ScreenShake({ cameras: [stageManager.camera, stageManager.uiCamera] });
    this._vignette = new DamageVignette();
    this.uiScene.add(this._vignette.object);

    this._unsubTick = stageManager.onTick((dt) => {
      this.springs.update(dt); // 手牌/咏唱静息姿态软收敛（先于演出，本帧姿态到位）
      this._scene3D?.update(dt, this.particles, this._sm.camera.position);
      this.particles.update(dt);
      this._updateBurning(dt);
      for (const view of this._views.values()) view.updateFx(dt); // 卡面特效层（脉冲回程/盖纱呼吸/流光轨道）
      for (const unit of this._units.values()) {
        unit.update(dt);
        let fwd = this._sm.camera.localToWorld(new THREE.Vector3(0, 0, 1));
        fwd.sub(this._sm.camera.position).normalize();
        unit.faceCamera(fwd); // 立牌形 billboard：斜视下立牌 yaw 朝向相机
        // 立牌光照交互：火把光衰+闪烁+纵深压暗的假采样染色（闪红窗口内不覆盖）
        if (this._scene3D) unit.applyLightTint(this._scene3D.sampleStandeeTint(unit.position, this._tintScratch));
      }
      this._statusBar.update(dt); // 两排资源点 + 双血环的帧过渡
      this._viewer.update(dt);    // 查看器悬浮抬升包络（关闭态为空操作）
      this._vignette.update(dt);  // 友军受击渐晕释放
      this.shake.update(dt);      // 相机位移最后落位：本帧逻辑读基位，渲染带偏移
    });

    // 区域图标（牌库）：点击开查看器，计数经 reconcile 同步
    this._piles = {
      deck: new ZonePileObject({ zoneKey: 'deck', label: '牌库', color: '#5aa2e8' }),
    };
    for (const [key, pile] of Object.entries(this._piles)) {
      pile.position.set(PILE_POSITIONS[key].x, PILE_POSITIONS[key].y, 5);
      this.uiScene.add(pile);
      this.picker.addPickable(`pile:${key}`, pile, { kind: 'pile', space: 'ui' });
      this.animator.register(`pile:${key}`, pile);
    }

    this._buttons = {};
    for (const [key, pos] of Object.entries(BUTTON_POSITIONS)) {
      const btn = new CardObject({
        uniqueID: `btn:${key}`, cardWidth: BUTTON_SIZE.w, cardHeight: BUTTON_SIZE.h,
        bakeFace: this._bakeButtonFace.bind(this),
      });
      btn.position.set(pos.x, pos.y, 0);
      btn.setCard({ label: '—', enabled: false });
      this.uiScene.add(btn);
      this.picker.addPickable(`btn:${key}`, btn, { kind: 'button', space: 'ui' });
      this._buttons[key] = btn;
    }
    this._buttonSigs = {};
    this._swapMode = false; // 换卡模式：点换卡按钮进入，手牌高亮，点一张手牌换出

    // 选目标瞄准箭头（杀戮尖塔式）：UI pass 覆盖层，指针追随物，不进队列/注册表
    this._arrow = new TargetingArrowObject();
    this._arrow.position.z = ARROW_Z;
    this.uiScene.add(this._arrow);

    // 玩家状态栏（左下角，概念图语言）：骑士徽章 + 魏启晶粒 + AP 金币；
    // _resources 引用不变（reconcile/tick/测试均照旧），只是父级从 uiScene 换成状态栏
    this._statusBar = new PlayerStatusObject({ bakeLabel: this._bakeLabel, unitArt: this._unitArt });
    this._statusBar.position.set(PLAYER_STATUS_POS.x, PLAYER_STATUS_POS.y, PLAYER_STATUS_POS.z);
    this.uiScene.add(this._statusBar);
    // 顶端居中资源行（金币数值 + 遗物槽；与地图层同物同位，runController 喂值）
    this._topBar = new TopResourceBarObject({ bakeLabel: this._bakeLabel, picker: this.picker });
    this.uiScene.add(this._topBar);
    this._resources = { ap: this._statusBar.apCoin, mana: this._statusBar.manaCrystal };
    this._applyAvatar(); // 立绘缓存可能已就绪（预取/上一场预热；未就绪则订阅回调 _applyUnitArt 补挂）

    // mitt 的 on() 不返回退订函数——必须自持 handler 引用走 off()。
    // （旧写法把 on() 返回值当 off 用，实际是 undefined：'*' 监听跨场泄漏，
    //   幽灵舞台继续处理节拍并污染共享 DisplayModel → 下一场"白卡"）
    const onBus = (bus, type, handler) => {
      bus.on(type, handler);
      return () => bus.off(type, handler);
    };
    this._unsubs = [
      onBus(bridge.frontendBus, '*', (type, payload) => this._direct(type, payload)),
      onBus(this._bus, EventNames.CARD_HOVER, ({ uniqueID }) => this._setHoveredCard(uniqueID)),
      onBus(this._bus, EventNames.CARD_LEAVE, () => this._setHoveredCard(null)),
      // 共享素材缓存的加载完成订阅（到图补挂/重烘）：与总线退订同律，dispose 一并摘除
      this._artCache?.addOnLoad(() => this._rebakeCardFaces()),
      this._unitArt?.addOnLoad(() => {
        this._applyUnitArt();
        this._rebakeCardFaces(); // 魏启水晶等舞台素材到图后，卡面开销徽章补真图
      }),
    ];

    // Shift 键盘态（详情卡面切换）：window 级监听，dispose 摘除；node 无 window 由单测直调
    if (typeof window !== 'undefined') {
      this._onShiftKeyDown = (e) => { if (e.key === 'Shift') this.setShiftDown(true); };
      this._onShiftKeyUp = (e) => { if (e.key === 'Shift') this.setShiftDown(false); };
      this._onWinBlur = () => this.setShiftDown(false); // 失焦复位（防 Shift 卡在按下态）
      window.addEventListener('keydown', this._onShiftKeyDown);
      window.addEventListener('keyup', this._onShiftKeyUp);
      window.addEventListener('blur', this._onWinBlur);
    }
  }

  // ========== reconcile：显示状态快照 → 场景对象 ==========

  // 显示状态只在 ANIM_STATE_SYNC 节拍推进：应用快照 + reconcile，立即 finish。
  // 快照带显示时刻序号（bridge 投影重算序号），应用记录单调推进——
  // 早于已应用时刻的历史快照直接丢弃（见 applyProjection 的说明）
  _applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.seq != null && snapshot.seq < this._snapshotSeq) return;
    if (snapshot.seq != null) this._snapshotSeq = snapshot.seq;
    this._snapshot = snapshot;
    this.reconcile();
  }

  /** 直接应用投影快照（不经动画队列）：幕间黑幕预载用——黑幕后即建好单位/卡牌
   *  视图（预取已热的素材同步命中），揭幕所见即成品。预载把显示状态推到"现在"，
   *  此后队列重放的更早 sync 节拍（如 battleStart 在起手抽牌前捕获的空手牌快照）
   *  被单调守卫丢弃；同刻/更新的快照重放幂等无副作用。 */
  applyProjection(snapshot) {
    this._applySnapshot(snapshot);
  }

  reconcile() {
    const proj = this._snapshot;
    if (!proj) return;
    this._closeViewer(); // 状态已变，查看器内容失效
    const overlayReq = proj.pendingInput?.request?.picker === 'overlay' ? proj.pendingInput.request : null;
    if (overlayReq) this._openPick(overlayReq);   // 幂等（同一 request 不重建）
    else this._closePick();
    this._syncUnits(proj);
    this._syncCardZones(proj);
    this._syncCardContents(proj);
    this._syncButtons(proj);
    this._resources.ap.setValue(proj.player.actionPoints, proj.player.maxActionPoints);
    this._resources.mana.setValue(proj.player.mana, proj.player.maxMana);
    // 状态栏血量：角色取投影玩家；瑞米区取投影盟友（当前内容只有 remi；血量走
    // 盟友实时值，攻/盾横幅暂走状态栏展示常量——行为定义未暴露面板数值）
    this._statusBar.setPlayerHp(proj.player.hp, proj.player.maxHp);
    this._statusBar.setPlayerShield(proj.player.shield);
    const remi = proj.allies.find(a => a.defId === 'remi');
    this._statusBar.setRemi(remi ? { present: true, hp: remi.hp } : { present: false });
    this._piles.deck.setCount(proj.counts.deck);
    this._layoutAndTrack();
    this._updatePendingPips(); // 悬浮卡可能已离场/资源已变，重算高亮
    this._refreshShiftFace();  // 详情态目标可能已离场（差分自动还原）
  }

  _syncUnits(proj) {
    const seen = new Set();
    // count = 整排数量（含已阵亡者）：槽位按数量均分，倒下不挪位（见 scenes/index.js）
    const place = (unitProj, side, index, count = 1) => {
      seen.add(unitProj.uniqueID);
      let obj = this._units.get(unitProj.uniqueID);
      if (!obj) {
        obj = new UnitObject({
          uniqueID: unitProj.uniqueID, side,
          standeeHeight: STANDEE_BASE_HEIGHT * unitHeightFactor(unitProj.defId, side),
          bakeLabel: this._bakeUnitLabel,
          textureAnisotropy: Math.min(8, this._smMaxAnisotropy()),
        });
        obj._defId = unitProj.defId;
        this._units.set(unitProj.uniqueID, obj);
        this.scene.add(obj);
        this.animator.register(unitProj.uniqueID, obj);
        this.picker.addPickable(unitProj.uniqueID, obj, { kind: 'unit' });
        this._applyUnitArtTo(obj);
      }
      // 战线轴槽位：位置/缩放/z 由 scene 定义换算（假透视：近大远小、近处压远处）。
      // 死亡单位不重放 scale——否则 reconcile 会把死亡收殓补间踩回去
      const tr = slotTransform(this._sceneDef, side, index, count);
      obj.position.set(tr.x, tr.y, tr.z);
      obj._baseScale = tr.scale;
      if (!unitProj.isDead) obj.scale.set(tr.scale, tr.scale, 1);
      // 失明（银行机恶魔词条）：敌人意图不可见 → 清空意图条（玩家只能靠猜）
      obj.setUnit(proj.blind && side === 'enemy' ? { ...unitProj, intention: null } : unitProj);
    };
    place(proj.player, 'player', 0, 1);
    proj.allies.forEach((a, i) => place(a, 'ally', i, proj.allies.length));
    proj.enemies.forEach((e, i) => place(e, 'enemy', i, proj.enemies.length));
    for (const [id, obj] of this._units) {
      if (!seen.has(id)) {
        this.picker.removePickable(id);
        this.animator.unregister(id);
        this.scene.remove(obj);
        obj.dispose();
        this._units.delete(id);
      }
    }
  }

  /**
   * 尸体稳态收殓：把「快照已判死、视图却仍站着」的单位直接落到死后稳态（隐藏）。
   * 正常路径不受影响（死亡演出播毕已隐藏，本方法幂等跳过）。
   * 用途：**中途接入/跳段的播放端**——死亡演出节拍不在队列里，只剩快照的 isDead，
   * 不补的话尸体会带着 0/xx 血条一直站着（观战端重放/接入已见，2026-09）。
   * 与「动画不可序列化 → 读档/恢复落到稳态」同一口径，故实现在 Stage 而非某个页面。
   * @returns 本次收殓的尸体数
   */
  settleCorpses() {
    const snap = this._snapshot;
    if (!snap) return 0;
    let n = 0;
    const all = [...(snap.enemies ?? []), ...(snap.allies ?? [])];
    for (const u of all) {
      if (!u?.isDead) continue;
      const view = this._units.get(u.uniqueID);
      if (!view || view.visible === false) continue;
      view.hideIntention?.();
      view.hideStatus?.();
      view.visible = false; // 稳态 = 焚毁演出终态（整体退场；reconcile 不重置 visible）
      n++;
    }
    return n;
  }

  // 全 zone 对账（持久模型）：新卡建条目+建视图（各一次），zone 按快照刷新。
  // burnt zone 不参与——焚毁节拍销毁视图/出册后不再重生（未来"焚毁区捞回"机制
  // 到来时由其专属节拍重建）。快照各 zone 与 held 都没有的注册卡 = 上游丢节拍的
  // 绊线（warn + 收尸），正常流程不应触达。
  _syncCardZones(proj) {
    const lists = {
      hand: proj.hand.map(c => c.uniqueID),
      deck: proj.zones.deck.map(c => c.uniqueID),
    };
    const present = new Set();
    for (const [zone, ids] of Object.entries(lists)) {
      for (const id of ids) {
        present.add(id);
        this._setCardZone(id, zone);
      }
    }
    // 结算区（pending，发动中的卡）：模型标 'held'（展示位停留，不回手牌锚点）——
    // 纯标签直写（同 _skillDisplay 的 held 分支），不走 _setCardZone 的隐形停车分支
    for (const id of proj.pending ?? []) {
      present.add(id);
      if (this.model.getZone(id) !== 'held') {
        this.model.setZone(id, 'held');
        this.springs.release(id); // 离手即摘弹簧目标：不被拉回手牌锚点
        this.picker.removePickable(id);
      }
    }
    for (const id of this.model.cards.keys()) {
      if (present.has(id) || this.model.getZone(id) === 'held') continue;
      console.warn('[stage] 注册卡不在任何显示 zone（上游丢节拍？）', id, this.model.getZone(id));
      this._destroyView(id);
      this.model.removeCard(id);
    }
  }

  // zone 迁移：模型推进（状态权威）+ 视图随动。进牌库 = 隐形停车 +
  // 摘除拾取；进手牌的显形与烘面在 _syncCardContents（惰性）。
  _setCardZone(id, zone) {
    // 'held'（展示毕待离场）是 hand 的显示位精化：sync 对账不得解除停留，
    // 解除只属于离场节拍（届时写入真正的去向 zone）或咏唱回手节拍
    // （ANIM_CHANT_TOGGLED——卡结算后回手牌，非离场）——否则折返跟踪复活
    if (this.model.getZone(id) === 'held' && zone === 'hand') return;
    const change = this.model.setZone(id, zone);
    const view = this._ensureView(id);
    if (!change) return;
    if (zone !== 'hand') {
      // 离手即摘弹簧目标（同 _skillDisplay 的 held 分支）：目标表只在 sync 节拍
      // 重算，不即刻摘除的话空窗期 idle 卡会被拉回手牌锚点（回归病灶）
      this.springs.release(id);
      view.visible = false;
      this.picker.removePickable(id);
    } else if (change.from !== 'held') {
      // 入场（牌库 → 手牌）：标记待飞——锚点在 _layoutAndTrack 算出后起飞
      this._entering.add(id);
    }
  }

  // 视图惰性建：停在牌库 pile 锚点（scale 0.5、隐形）——抽牌"从牌库长开飞入"
  // 的入场视觉由其后的跟踪补间天然给出；牌库中的卡永不烘面（省 canvas）。
  _ensureView(id) {
    let view = this._views.get(id);
    if (view) return view;
    view = new CardObject({ uniqueID: id, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace });
    const anchor = this.layout.getNamedAnchor('deck');
    view.position.set(anchor.x, anchor.y, 0);
    view.scale.set(0.5, 0.5, 1);
    view.visible = false;
    this._views.set(id, view);
    this.uiScene.add(view);
    this.animator.register(id, view);
    return view;
  }

  // 视图终结（焚毁 / 绊线收尸）：出视图表 + 摘拾取 + 注销 + 销毁
  _destroyView(id) {
    const view = this._views.get(id);
    if (!view) return;
    this._views.delete(id);
    this.picker.removePickable(id);
    this.animator.unregister(id);
    this.springs.release(id); // 弃管即刻化：不等弹簧 update 的惰性清理
    this.uiScene.remove(view);
    view.dispose();
  }

  // 在场卡（手牌）内容同步：显形 + 惰性烘面 + 拾取注册 + 激活流光 + 威力脉冲 + 冷却盖纱
  _syncCardContents(proj) {
    const present = new Map();
    for (const c of proj.hand) present.set(c.uniqueID, { card: c, zone: 'hand' });

    for (const [id, { card, zone }] of present) {
      const entry = this.model.get(id);
      if (!entry) continue; // _syncCardZones 先行保证了存在；缺席即绊线已 warn
      const view = this._views.get(id);
      view.visible = true;
      this.picker.addPickable(id, view, { kind: 'card', cardObject: view, space: 'ui' });
      const sig = JSON.stringify([card.defId, card.name, card.power, card.text, card.textAlt, card.isActivated, card.cost]);
      if (entry.faceSig !== sig) {
        entry.faceSig = sig;
        // defId 变化 = 转化/进阶（如斩→裂石斩）：走专属金色演出（手牌内的转化路径，
        // 展示位/持有位的转化另走 ANIM_CARD_TRANSFORMED 节拍）
        const defChanged = entry.prevDefId != null && entry.prevDefId !== card.defId;
        view.setCard(card);
        if (defChanged) this._transformFx(id);
        // 威力提升 → 金色脉冲（non-blocking，不进动画队列）
        else if (entry.prevPower != null && (card.power ?? 0) > entry.prevPower) {
          this._pulseCard(id, 0xffd34c);
        }
      }
      entry.prevDefId = card.defId;
      entry.prevPower = card.power ?? 0;
      // 咏唱激活态 → 边缘流光（双态开关：手牌中的 isActivated 卡，幂等）
      view.setActiveGlow(zone === 'hand' && !!card.isActivated);
      // 冷却态盖纱（特效层持久指示）：充能未满=冷却中青纱；冷却被衰败推深（超定义基准）=衰败红纱
      const max = card.charges?.max ?? Infinity;
      const cooling = card.remainingUses < max;
      const decayed = cooling && card.currentCooldown > (card.charges?.cooldownTurns ?? 0);
      view.fx.setCooling(decayed ? 'decayed' : (cooling ? 'cooling' : null));
    }
  }

  // 离场节拍：播放该卡的离场演出（弃/回库=飞行停车；焚毁=原地燃烧殆尽）并
  // **阻塞本节拍**（onDone 才回 finish）——"发动 → 效果 → 离场"的次序由
  // sequencer 队列编排（sync 节拍在离场之后，牌库数字因此飞进才+1）。
  // zone 在节拍时点即推进（显示状态由节拍权威）；落点取自节拍载荷（toZone），
  // 不读投影——显示状态此时尚未同步，投影里卡还在原地。
  _departureBeat(id, type, payload, finish) {
    const view = id != null ? this._views.get(id) : null;
    if (!view) { // 无载体（未来机制/异常）：脉冲落点图标打节拍
      if (type === EventNames.ANIM_CARD_BURNT) return finish();
      return this._pulsePile('deck', finish);
    }
    this.picker.removePickable(id);
    if (type === EventNames.ANIM_CARD_BURNT) {
      return this._burnOut(id, view, finish);
    }
    // 回手牌（宾语转化归位/牌库抽卡）：交还手牌跟踪层——_entering 标记待飞，
    // 锚点算出后从当前位（中央展示位）补间飞回扇形（咏唱回手 ANIM_CHANT_TOGGLED
    // 同款 held→hand 放行路径：sync 对账的 held 守卫不解除停留，须由本节拍直写）
    if (type === EventNames.ANIM_CARD_MOVED && payload?.toZone === 'hand') {
      this.model.setZone(id, 'hand');
      this._entering.add(id);
      return finish();
    }
    // FIFO 单循环区：非焚毁离场（打出/弃置/换牌/解除咏唱/迁移）一律回牌库底
    this.model.setZone(id, 'deck'); // 状态在节拍时点推进（模型权威）
    this._flyOut(id, view, { ...PILE_POSITIONS.deck, z: 40, scale: 0.5 }, finish);
  }

  // 焚毁离场：原地燃烧殆尽（着色器自底向上吞蚀 + 前沿余烬 + 火起颤动），
  // 燃尽后牌面已全 discard（不可见）——瞬移落位牌库图标处即销毁收尾，无飞行动画。
  // 焚毁 = 对象终结（唯一销毁路径）：模型出册 + 视图销毁（burnt 不回流，id 不会
  // 重生；未来"焚毁区捞回"机制须自行重建）。
  // 节拍阻塞至燃尽完成，sequencer 队列次序因此是：发动 → 效果 → 燃烧殆尽 → 状态同步。
  _burnOut(id, view, finish) {
    this.model.removeCard(id);
    this._views.delete(id);
    this._burning.add(view);
    view.startBurn({
      durationMs: CARD_BURN_MS,
      onBurnt: () => {
        this._burning.delete(view);
        view.position.set(PILE_POSITIONS.deck.x, PILE_POSITIONS.deck.y, 40); // 不可见瞬移
        this.animator.unregister(id);
        this.uiScene.remove(view);
        view.dispose();
        finish?.();
      },
    });
  }

  // 焚烧帧驱动（onTick / 测试手动泵）：推进所有燃烧中的卡至燃尽
  _updateBurning(dt) {
    for (const object of this._burning) object.updateBurn(dt);
  }

  // 造牌入库演出：卡面在屏幕中心附近生成（放缩长开）→ 弧线飞入牌库 → 落位销毁；
  // 牌库计数由紧随其后的 sync 节拍跳增（离场类次序：anim → sync）。
  // 造出的卡不在任何显示区（deck 无视觉对象），牌面由 presenter 附带的 cardView 提供。
  // 非入库造牌（toZone 'hand' 等）视觉走状态差分（既有入场类次序），只脉冲图标打节拍。
  _addCardBeat(payload, finish) {
    const view = payload?.cardView;
    if (!view || payload?.toZone !== 'deck') return this._pulsePile('deck', finish);
    const object = new CardObject({
      uniqueID: `spawn:${payload.card.uniqueID}`,
      cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
    });
    object.setCard(view);
    // 高 z 起始（70 > 展示位 60 > 手牌扇 10~40 > 区域图标 5）：生成卡永远盖在
    // 结算中的发动卡（held 于展示位）之上——否则看不到蓄力向牌库加了什么卡；
    // 飞行途中线性降回 40 落位，符合"从高处递进牌库"的空间感
    object.position.set(0, -12, 70);
    object.scale.set(0.05, 0.05, 1);
    object.faceMesh.material.opacity = 0;
    this.uiScene.add(object);
    this._tweenFactory(object, { scale: 1 }, {
      durationMs: 200,
      ease: 'back.out(2)',
      onComplete: () => {
        this._pulsePile('deck');
        // 瞬态对象不在 animator 注册表：直接驱动飞行（同一 _cardFlight 语言）
        const proxyId = `spawn:${payload.card.uniqueID}`;
        this._views.set(proxyId, object); // 借注册表项驱动 _cardFlight，飞完即摘除
        this._cardFlight(proxyId, { ...PILE_POSITIONS.deck, z: 40, scale: 0.5 }, {
          fade: 'out',
          tilt: 0.14,
          ease: 'power1.in',
          durationMs: 340,
          onDone: () => {
            this._views.delete(proxyId);
            this.uiScene.remove(object);
            object.dispose();
            finish();
          },
        });
      },
    });
    // 生成淡入与弹性放缩并行（材质不透明度 0→1）
    this._tweenFactory(object.faceMesh.material, { opacity: 1 }, { durationMs: 200 });
  }

  // 卡牌飞行（区域间移动的统一演出语言）：
  //   * 轨迹 = 二次贝塞尔弧线（控制点在航线中点上方，弧高随距离自适应钳制）
  //   * 姿态 = rotation.z 沿 sin(πt) 倾转（中段峰值、两端归零）+ 落地转正
  //   * 淡入/淡出 = 材质不透明度前/后半程渐变（fade: 'in' | 'out' | null）
  //   * 落地硬化：onComplete 显式写终态——同步注入式 tween（无 onUpdate 采样）
  //     也能正确落位，测试因此确定
  // 注册表内的卡走 animator.animateCustom（状态机感知：飞行中布局跟踪让位）；
  // 瞬态对象（造牌 spawn）未注册则直接用 tween 工厂驱动同一 onUpdate 协议。
  _cardFlight(id, to, { arc = null, tilt = 0, fade = null, durationMs = 340, ease, delayMs = 0, onDone } = {}) {
    const view = this._views.get(id);
    if (!view) { onDone?.(); return; }
    const from = {
      x: view.position.x, y: view.position.y, z: view.position.z,
      scale: view.scale.x, rot: view.rotation.z,
    };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const arcH = arc ?? THREE.MathUtils.clamp(dist * 0.25, 6, 18);
    const ctrl = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + arcH };
    const toScale = to.scale ?? from.scale;
    const toRot = to.rotation ?? 0;
    const toZ = to.z ?? from.z;
    const mat = view.faceMesh.material;
    const sample = (t) => {
      const u = 1 - t;
      view.position.set(
        u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
        from.z + (toZ - from.z) * t,
      );
      const s = from.scale + (toScale - from.scale) * t;
      view.scale.set(s, s, 1);
      view.rotation.z = from.rot + (toRot - from.rot) * t + Math.sin(Math.PI * t) * tilt;
      if (fade === 'in') mat.opacity = Math.min(t / 0.6, 1);
      else if (fade === 'out') mat.opacity = Math.min((1 - t) / 0.5, 1);
    };
    const settle = () => {
      view.position.set(to.x, to.y, toZ);
      view.scale.set(toScale, toScale, 1);
      view.rotation.z = toRot;
      mat.opacity = 1;
      if (fade === 'out') view.visible = false;
      onDone?.();
    };
    const opts = {
      durationMs, ease, delayMs,
      onUpdate: sample,
      onComplete: settle,
    };
    if (this.animator.has(id)) {
      this.animator.animateCustom(id, opts);
    } else {
      this._tweenFactory({ t: 0 }, { t: 1 }, opts);
    }
    if (fade === 'in') {
      view.visible = true;
      mat.opacity = 0; // 起步即零透明：级联延迟期间不闪现
      sample(0);
    }
  }

  // 离场飞行本体：弧线飞往落点（弃/回库）+ 后半程淡出 + 轻微逆旋 → 停车（隐形）→ finish。
  // 持久对象模型下没有销毁、没有 inFlight 交接：sequencer 串行保证后续 sync
  // 应用时飞行必已落地；卡再被抽回时同一视图从停车状态直接显形归位（对象身份
  // 跨 zone 稳定，"入手消失"类 id 跟踪问题在结构上不再可能）。
  _flyOut(id, view, to, finish) {
    this._cardFlight(id, to, {
      fade: 'out',
      tilt: -0.10,
      ease: 'power1.in',
      durationMs: 340,
      onDone: finish,
    });
  }

  _syncButtons(proj) {
    const pending = proj.pendingInput?.request ?? null;

    // 主按钮：结束回合；结算期退化为确认/选择提示
    let label = '结束回合';
    let enabled = proj.waitingPlayerInput && !pending;
    if (this._pick) {
      const n = this._pick.selection.length;
      const { min, max } = this._pick;
      const need = min === max ? `${min}` : `${min}~${max}`;
      label = `确认(${n}/${need})`;
      enabled = n >= min && n <= max;   // 到 min 即可提交（「至多 N」的上限由收集侧封顶）
    } else if (pending?.kind === 'confirm') { label = '确认'; enabled = true; }
    else if (pending?.kind?.startsWith('select')) {
      if ((pending.count ?? 1) > 1) { label = `确认(${this._inputSelection.length}/${pending.count})`; enabled = this._inputSelection.length === pending.count; }
      else { label = '选择目标'; enabled = false; }
    }
    this._setButtonState('main', { label, enabled });

    // 换卡模式只在自由行动窗存活：窗口关闭（结算输入/回合外）自动退出
    if (!proj.waitingPlayerInput || pending) this._swapMode = false;
    const cost = proj.swapCost;
    const canSwap = proj.waitingPlayerInput && !pending && proj.hand.length > 0
      && proj.player.actionPoints >= cost;
    this._setButtonState('swap', {
      label: '换卡', sublabel: `⚡${cost}`, enabled: canSwap, active: this._swapMode,
    });
  }

  // 按钮数据签名去抖：内容不变不重烘（牌面烘焙有 canvas 成本）
  _setButtonState(key, data) {
    const sig = JSON.stringify(data);
    if (this._buttonSigs[key] === sig) return;
    this._buttonSigs[key] = sig;
    const btn = this._buttons[key];
    btn.setCard(data);
    btn.setVisualState(data.enabled ? 'normal' : 'disabled');
  }

  _setSwapMode(on) {
    if (this._swapMode === on || !this._snapshot) return;
    this._swapMode = on;
    this._syncButtons(this._snapshot); // 激活态上按钮面
    this._layoutAndTrack();            // 手牌高亮态
  }

  // 立牌纹理补挂：缓存命中才设置，未命中等共享缓存订阅回调统一补
  _applyUnitArtTo(obj) {
    const img = this._unitArt?.get(obj._defId, obj.side);
    if (img && !obj.hasArt) obj.setArt(img);
  }

  _applyUnitArt() {
    for (const obj of this._units.values()) this._applyUnitArtTo(obj);
    this._applyAvatar();
  }

  // 状态栏头像补挂：骑士用专用徽章头像（knight_avatar.png，概念图圆形肖像）；
  // 瑞米用专用圆像（remi_avatar.png，素材已预翻转）。缓存未命中等 onLoad 统一补
  _applyAvatar() {
    const knight = this._unitArt?.getFile('knight_avatar.png');
    if (knight) this._statusBar.setAvatar(knight, { crop: 'full', mirror: true }); // 近方肖像整图入圆，朝向对齐概念图
    const remi = this._unitArt?.getFile('remi_avatar.png');
    if (remi) this._statusBar.setRemiAvatar(remi);
  }

  /** 状态栏对外入口（run 编排器同步金币/瑞米；AP/魏启走 reconcile） */
  get statusBar() { return this._statusBar; }
  get topBar() { return this._topBar; }

  /**
   * 战场就绪信号（幕间黑幕预载用）：共享缓存在途加载（含预取尚未落定的）全部
   * 落定 + 至少渲染两帧（首帧渲染触发着色器编译与纹理上传——揭幕后不再有编译
   * 卡顿），带超时兜底。前提：调用前已 applyProjection 建好视图（否则缓存无在途
   * 加载，本信号空转立即兑现）。node/假 renderer 环境（无 document/rAF）立即兑现。
   * @param {object} options  timeoutMs: 超时兜底（默认 2500）
   */
  whenReady({ timeoutMs = 2500 } = {}) {
    const arts = Promise.all([
      this._unitArt?.whenIdle() ?? Promise.resolve(),
      this._artCache?.whenIdle() ?? Promise.resolve(),
    ]);
    const frames = (typeof requestAnimationFrame === 'function')
      ? new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      : Promise.resolve();
    return Promise.race([
      Promise.all([arts, frames]),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  // ---- 战斗内选卡牌集覆盖层 ----
  // 'hand' 来源：候选在场景里已有唯一 CardObject（_views）→ **接管**（只改布局目标，
  //   不渲染副本，关闭即还原手牌布局；弹簧/生命周期纪律不受影响）。
  // 其它来源（deck/burnt…）：候选在场景里没有对象 → 按投影**新建**、关闭即销毁
  //   （与牌库查看器 CardGalleryObject 同口径，id 加 'pick:' 前缀隔离）。
  _openPick(request) {
    if (this._pick && this._pick.request === request) return; // 幂等：同一请求刷新即跳过重建
    this._closePick();
    const ids = request.candidates ?? [];
    const pick = {
      request,
      ids,
      mode: request.source === 'hand' ? 'hand' : 'instantiate',
      min: request.min ?? request.count ?? 1,
      max: request.max ?? request.count ?? 1,
      selection: [],
      temp: new Map(), // pickerId -> { object, uniqueID }
    };
    this._pick = pick;
    if (pick.mode === 'instantiate') {
      const anchors = this._pickAnchors(ids.length);
      ids.forEach((uid, i) => {
        const cardProj = this._findCardProj(uid);
        if (!cardProj) return;
        const pickerId = `pick:${uid}`;
        const obj = new CardObject({
          uniqueID: pickerId, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
        });
        obj.setCard(cardProj);
        const a = anchors[i];
        obj.position.set(a.x, a.y, 30);
        obj.scale.set(a.scale ?? PICK_SCALE, a.scale ?? PICK_SCALE, 1);
        obj.visible = true;
        this.uiScene.add(obj);
        this.picker.addPickable(pickerId, obj, { kind: 'card', cardObject: obj, space: 'ui' });
        pick.temp.set(pickerId, { object: obj, uniqueID: uid });
      });
    }
    this._layoutAndTrack();
  }

  _closePick() {
    if (!this._pick) return;
    for (const [pickerId, entry] of this._pick.temp) {
      this.picker.removePickable(pickerId);
      this.uiScene.remove(entry.object);
      entry.object.dispose();
    }
    this._pick = null;
  }

  /** 覆盖层网格锚点（卡牌空间，整体居中）。列数与缩放随张数自适应：
   *  张数多时（牌库来源常见 15~30 张）自动变多列、缩得更小，避免超出取景框。 */
  _pickAnchors(count) {
    const scale = count > 18 ? 0.42 : (count > 10 ? 0.52 : PICK_SCALE);
    const cols = Math.min(count > 10 ? 8 : 5, Math.max(1, count));
    const rows = Math.ceil(count / cols);
    const stepX = CARD_WIDTH * scale * 1.12;
    const stepY = CARD_HEIGHT * scale * 1.18;
    const yTop = ((rows - 1) * stepY) / 2;
    return Array.from({ length: count }, (_, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, count - r * cols);
      return { x: (c - (inRow - 1) / 2) * stepX, y: yTop - r * stepY, scale };
    });
  }

  /** 按 uniqueID 找投影里的卡视图（跨区查找：手牌/牌库/焚毁区） */
  _findCardProj(uniqueID) {
    const zones = this._snapshot?.zones ?? {};
    for (const list of Object.values(zones)) {
      const hit = (list ?? []).find(c => c.uniqueID === uniqueID);
      if (hit) return hit;
    }
    return (this._snapshot?.hand ?? []).find(c => c.uniqueID === uniqueID) ?? null;
  }

  _layoutAndTrack() {
    // 保持显示状态快照中的手牌顺序（视图表插入序≠手牌序）
    const proj = this._snapshot;
    if (!proj) return;
    const orderedHand = proj.hand.map(c => c.uniqueID).filter(id => this._views.has(id));
    const onStage = new Set(orderedHand);
    // 瞄准中的卡视作"被撑开"对象：位置不变但抬升放大、两侧排开（瞄准时不响应 hover 切换）
    const spreadId = this._pick ? null : (this._aiming?.id ?? this._hoveredCardId);
    this.layout.layoutHand('hand', orderedHand, spreadId);
    // 静息姿态交弹簧层逐帧软收敛（目标表整表替换，让位/收养规则见 HandSprings）
    const targets = new Map();
    for (const id of onStage) {
      const a = this.layout.getAnchor(id);
      if (a && this.model.getZone(id) !== 'held') targets.set(id, a);
    }
    // 选卡覆盖层（手牌来源）：把候选的目标锚点换成网格位——同一批 CardObject 直接
    // "飞"进界面，不渲染副本；关闭时 targets 自然回到手牌扇形
    if (this._pick?.mode === 'hand') {
      const anchors = this._pickAnchors(this._pick.ids.length);
      this._pick.ids.forEach((uid, i) => {
        if (!anchors[i]) return;
        targets.set(uid, anchors[i]);
        const view = this._views.get(uid);
        if (view) view.scale.set(anchors[i].scale ?? PICK_SCALE, anchors[i].scale ?? PICK_SCALE, 1);
      });
    }
    this.springs.setTargets(targets);
    for (const [id, view] of this._views) {
      const zone = this.model.getZone(id);
      // 入场飞行（牌库/坟堆 → 手牌/咏唱）：弧线飞入 + 淡入 + 倾转落座；
      // 起手多张按手牌序级联（delayMs 递增）。飞行中状态为 ANIMATING（弹簧让位），
      // 落定后弹簧从落点零速收养，自然滑入扇形锚点
      if (this._entering.has(id) && onStage.has(id)) {
        this._entering.delete(id);
        const anchor = this.layout.getAnchor(id);
        if (anchor) {
          const idx = orderedHand.includes(id) ? orderedHand.indexOf(id) : orderedChant.indexOf(id);
          this._cardFlight(id, anchor, {
            fade: 'in',
            tilt: (idx % 2 === 0 ? 1 : -1) * 0.12,
            durationMs: 420,
            ease: 'power2.out',
            delayMs: Math.min(idx, 5) * 45,
          });
          continue; // 飞行期间不做视觉态管理（淡入中的卡不该被压灰）
        }
      }
      if (!onStage.has(id)) continue; // 牌库/坟堆/停留位：无视觉态管理
      // 视觉态优先级：瞄准中（高亮）> 结算期选卡（候选高亮/其余压灰）> 换卡模式（可换手牌高亮）
      // > 手牌可发动性（不可发动淡灰白）> normal
      const pending = proj.pendingInput?.request;
      if (this._pick) {
        // 覆盖层：候选可点（选中态高亮），非候选压灰；其余视觉态一律让位
        const isCandidate = this._pick.ids.includes(id);
        view.setVisualState(this._pick.selection.includes(id) ? 'highlighted'
          : (isCandidate ? 'normal' : 'disabled'));
      } else if (this._aiming?.id === id) {
        view.setVisualState('highlighted');
      } else if (pending?.candidates) {
        view.setVisualState(pending.candidates.includes(id) ? 'highlighted' : 'disabled');
      } else if (this._swapMode && zone === 'hand') {
        view.setVisualState(this.bridge.intents.canSwapCard(id) ? 'highlighted' : 'disabled');
      } else if (zone === 'hand' && !pending) {
        view.setVisualState(this.bridge.intents.canPlayCard(id) ? 'normal' : 'disabled');
      } else {
        view.setVisualState('normal');
      }
    }
  }

  // ========== 视觉导演：ANIM_* → 补间 → finish ==========
  // 节拍卫生：任何分支抛异常都强制 finish（一个坏节拍不得冻结显示链——
  // 否则后续 sync 停摆，症状就是"卡牌消失/幽灵动画"类 glich）

  _direct(type, payload) {
    if (this._disposed || !type.startsWith('anim:')) return; // 幽灵守卫：dispose 后不再处理任何节拍
    const finish = () => {
      this.bridge.frontendBus.emit(EventNames.ANIMATION_INSTRUCTION_FINISHED, { id: payload?._animId });
    };
    try {
      this._dispatchAnim(type, payload, finish);
    } catch (err) {
      console.error(`[stage] 动画节拍 '${type}' 执行异常，强制 finish 保队列`, err);
      finish();
    }
  }

  _dispatchAnim(type, payload, finish) {
    // 状态同步节拍：显示状态在此推进（应用快照 + reconcile），立即 finish
    if (type === EventNames.ANIM_STATE_SYNC) {
      this._applySnapshot(payload?.snapshot);
      return finish();
    }

    // 卡牌离场节拍（弃/焚/迁移）：播放该卡的离场飞行并阻塞本节拍——
    // 离场时序完全由 sequencer 编排（sync 节拍排在离场之后，牌库数字飞进才+1）
    if (type === EventNames.ANIM_CARD_DISCARDED || type === EventNames.ANIM_CARD_BURNT
      || type === EventNames.ANIM_CARD_MOVED) {
      const id = payload?.card?.uniqueID ?? payload?.skill?.uniqueID ?? payload?.uniqueID ?? null;
      return this._departureBeat(id, type, payload, finish);
    }
    // 入手抽牌：视觉由状态差分完成（新卡从牌库长开+跟踪飞入），这里只脉冲区域图标打节拍；
    // 造牌入库（toZone 'deck'）则走 _addCardBeat：卡面生成 → 飞入牌库 → 计数随其后 sync 跳增
    if (type === EventNames.ANIM_CARD_DRAWN) {
      // 因手牌上限没抽到牌（core 在载荷里分开记了 blockedByHandLimit 与 deckEmpty）：
      // 给一次明确的视觉反馈——整手牌红色脉冲 + 骑士头顶提示文字（用户 2026-09-11 报）
      if (payload?.blockedByHandLimit) this._handPressureHint();
      return this._pulsePile('deck', finish);
    }
    if (type === EventNames.ANIM_CARD_ADDED) {
      return this._addCardBeat(payload, finish);
    }
    if (type === EventNames.ANIM_CARD_SWAPPED) {
      return this._pulsePile('deck', finish);
    }
    // 结算宾语展示（转化前半）：从原位飞到中央展示位（高于发动展示位，避免叠卡）
    if (type === EventNames.ANIM_CARD_SHOWCASE) {
      return this._showcaseBeat(payload, finish);
    }
    // 转化闪变（后半）：换脸 + 金色迸发 + 尺寸脉冲——宾语变化的生效反馈主体
    if (type === EventNames.ANIM_CARD_TRANSFORMED) {
      return this._transformBeat(payload, finish);
    }
    if (type === EventNames.ANIM_SKILL_USED) return this._skillDisplay(payload, finish);
    // 咏唱双态翻转（发动点亮 / 关停·离手熄灭）：激活表达由边缘流光（状态差分）承担；
    // 独有职责 = 解除 held 停留位（卡结算后回手牌——sync 对账的 held 守卫不解禁，
    // 结算期选牌（强制换）路径卡会停在展示位，须由本专属节拍放行回扇形）
    if (type === EventNames.ANIM_CHANT_TOGGLED) {
      const id = payload?.skill?.uniqueID ?? null;
      if (id != null && this.model.getZone(id) === 'held' && this._views.has(id)) {
        this.model.setZone(id, 'hand');
        this._entering.add(id); // 从展示位飞回扇形锚点
      }
      return finish();
    }
    // 冷却推进/反向（payload.delta 带方向）：正向=绿、衰败=暗红（与 named 术语「衰败」同色）。
    // 立即 finish——non-blocking，不占队列节拍
    if (type === EventNames.ANIM_COOLDOWN_TICK) {
      const delta = payload?.delta ?? 1;
      this._pulseCard(payload?.skill?.uniqueID, delta < 0 ? 0xc87070 : 0x66ff99);
      return finish();
    }

    const target = this._findAnimTarget(payload);
    if (type === EventNames.ANIM_DAMAGE && target) return this._damageHit(target, payload, finish);
    if (type === EventNames.ANIM_UNIT_DEATH && target) return this._unitDeathBeat(target, finish);
    if (type === EventNames.ANIM_UNIT_SPAWN && target) return this._unitSpawnBeat(target, finish);
    // 治疗/护盾/效果：目标脉冲 + 对应色粒子（双色主次爆发，亮度经系统内抖动分层）；
    // 治疗追加 +N 绿色文本粒子（无重力上飘）
    if (target && (type === EventNames.ANIM_HEAL || type === EventNames.ANIM_SHIELD || type === EventNames.ANIM_EFFECT)) {
      const fx = {
        [EventNames.ANIM_HEAL]: { color: 0x66ff9e, accent: 0xd0ffe0, gravity: 18 },
        [EventNames.ANIM_SHIELD]: { color: 0x8fc3ff, accent: 0xeaf4ff, gravity: -8 },
        [EventNames.ANIM_EFFECT]: { color: 0xffd34c, accent: 0xffedb0, gravity: -6 },
      }[type];
      this.particles.spawn(target.position.x, target.position.y, { count: 16, color: fx.color, speed: 10, ttl: 0.6, size: 1.4, gravity: fx.gravity, z: target.position.z ?? 0 });
      this.particles.spawn(target.position.x, target.position.y, { count: 8, color: fx.accent, speed: 16, ttl: 0.45, size: 1.0, gravity: fx.gravity, z: target.position.z ?? 0 });
      if (type === EventNames.ANIM_HEAL && (payload?.healed ?? 0) > 0) {
        const p = this._unitToUI(target, (Math.random() - 0.5) * 3, 4);
        this.particles.spawnText(
          p.x, p.y,
          `+${payload.healed}`,
          {
            fontSize: Math.min(30 + payload.healed * 2, 72), color: '#4ade80',
            vx: (Math.random() - 0.5) * 6, vy: 14,
            gravity: 0, drag: 1.2, ttl: 1.0, scalePop: 0.4,
            space: 'ui',
          },
        );
      }
    }
    if (!target) { finish(); return; }
    // 通用脉冲：放大→平滑回程→finish（不硬切 scale）。单位带槽位 baseScale（假透视），
    // 脉冲围绕 baseScale 起伏；还在桌上的卡重回跟踪（补间回锚点，含悬浮 scale）
    const targetId = target.uniqueID;
    const bs = target._baseScale ?? 1;
    this.animator.animate(targetId, { scale: bs * 1.15 }, {
      durationMs: 150,
        onComplete: () => {
          const zone = this.model.getZone(targetId);
          if (zone === 'hand') {
            finish(); // 弹簧层自动收养（动画已落定回 idle），从脉冲位滑回锚点
          } else {
            this.animator.animate(targetId, { scale: bs }, { durationMs: 120, onComplete: finish });
          }
        },
    });
  }

  // 发动展示（全局唯一卡牌：展示用本体，无替身无瞬移）：
  // 卡本体从当前位置（手牌/松手点）飞到中央放大 → 停留 → 节拍 finish。
  // 收尾分两路：已有离场节拍在排队（正常打出/焚毁）或卡已进结算区（pending，
  // 结算期输入挂起、离场节拍尚未产生）→ 停留展示位等收（不回手牌——它已不是手牌）；
  // 否则（咏唱回手等）→ 回锚点跟踪
  _skillDisplay(payload, finish) {
    const id = payload?.skill?.uniqueID;
    const view = id != null ? this._views.get(id) : null;
    if (!view) { finish(); return; } // 非手牌来源（未来机制）：无展示载体，直接打节拍
    this._displayCard = { id };
    this.animator.animate(id, { x: 0, y: -2, z: 60, scale: 1.15 }, {
      durationMs: 180,
      onComplete: () => {
        this.animator.animate(id, {}, { // 停留节拍（纯延迟 tween）
          delayMs: 380,
          onComplete: () => {
            this._displayCard = null;
            finish(); // 发动节拍结束；离场由后续 ANIM_CARD_* 节拍驱动
            if (this._views.has(id)) {
              if (this._hasDepartureBeatQueued(id) || (this._snapshot?.pending ?? []).includes(id)) {
                this.model.setZone(id, 'held'); // 停留位等收（离场节拍在排队 / 结算区卡：正在结算不回手）
                this.springs.release(id); // 离手即摘弹簧目标：空窗期 idle 卡不得被拉回手牌（回归病灶）
              }
              // else：弹簧自动收养——从展示位零速接管，平滑滑回扇形锚点
            }
          },
        });
      },
    });
  }

  // 队列中是否已有该卡的离场节拍（弃/焚/迁移）——读队列编排计划，不读后端状态
  _hasDepartureBeatQueued(id) {
    return !!this.bridge.sequencer.findPending(ins => {
      const { event, payload } = ins.meta ?? {};
      if (event !== EventNames.ANIM_CARD_DISCARDED && event !== EventNames.ANIM_CARD_BURNT
        && event !== EventNames.ANIM_CARD_MOVED) return false;
      const pid = payload?.card?.uniqueID ?? payload?.skill?.uniqueID ?? payload?.uniqueID;
      return pid === id;
    });
  }

  // 结算宾语展示（转化前半）：从原位（牌库图标/手牌扇形）飞到中央展示位——
  // 高于发动展示位（y 4 > -2），同屏不叠卡。牌库来源视图常隐形且从未烘面：
  // 先以 bridge 代投影的 cardView 换脸再显形起飞（cardAdded 同款协议）。
  _showcaseBeat(payload, finish) {
    const id = payload?.card?.uniqueID ?? null;
    const view = id != null ? this._views.get(id) : null;
    if (!view) return finish(); // 无载体（异常/未来机制）：直接打节拍
    if (payload?.cardView) view.setCard(payload.cardView);
    view.visible = true;
    this.animator.animate(id, { x: 0, y: 4, z: 50, scale: 1.0 }, {
      durationMs: 240,
      onComplete: finish,
    });
  }

  // 转化闪变（宾语变化生效反馈主体）：卡面换绑 cardView + 金色迸发 + 尺寸脉冲。
  // held/deck 来源卡不经 _syncCardContents（只扫手牌），换脸只能由本节拍承担。
  /** 卡牌转化/进阶的共用演出（金色粒子迸发 + 尺寸脉冲）。
   *  两个入口：结算树的 ANIM_CARD_TRANSFORMED 节拍（_transformBeat，卡在展示/持有位），
   *  以及手牌内被转化的对账路径（_syncCardContents 发现 defId 变化）。 */
  _transformFx(id, onDone = null) {
    const view = this._views.get(id);
    if (!view) { onDone?.(); return; }
    const p = view.position;
    this.particles.spawn(p.x, p.y, { count: 22, color: 0xffd76a, speed: 12, ttl: 0.7, size: 1.6, z: p.z ?? 0 });
    this.particles.spawn(p.x, p.y, { count: 10, color: 0xfff3c0, speed: 18, ttl: 0.5, size: 1.1, z: p.z ?? 0 });
    const s0 = view.scale.x || 1;
    this.animator.animate(id, { scale: s0 * 1.25 }, {
      durationMs: 150,
      onComplete: () => this.animator.animate(id, { scale: s0 }, { durationMs: 150, onComplete: onDone ?? undefined }),
    });
  }

  _transformBeat(payload, finish) {
    const id = payload?.card?.uniqueID ?? null;
    const view = id != null ? this._views.get(id) : null;
    if (!view) return finish();
    if (payload?.cardView) view.setCard(payload.cardView);
    this._transformFx(id, finish);
  }

  // 单位世界坐标（含偏移）→ UI 世界坐标：伤害/治疗读数文本走 uiScene 前景层
  // （恒定屏幕尺寸、不被场景遮挡）。桥接路径：世界相机投影到屏幕像素 →
  // UI 相机反投影到 z=70 平面（spawnText 缺省 z=70，恰落在该平面上，无深度差）。
  // 单测 StageManager 无视口尺寸（viewWidth=0）时退化为世界坐标直用，保数值有限。
  _unitToUI(unit, dx = 0, dy = 0) {
    const sm = this._sm;
    const wx = unit.position.x + dx;
    const wy = unit.position.y + dy;
    if (!sm.viewSize.width) return { x: wx, y: wy };
    const px = sm.worldToScreen(wx, wy, unit.position.z, sm.camera);
    return sm.screenToWorld(px.x, px.y, 70, sm.uiCamera);
  }

  // 受伤演出：按伤害落点分流——
  //   生命值受伤（dealt>0）：闪红 + 红色火花 + 伤害数字 + 短促击退（节拍阻塞）；
  //   护盾吸收（absorbed>0）：蓝色火花 + 灰色吸收数字（较小、偏移开）；
  //     吸穿护盾的最后一击（显示盾量 - 吸收 ≤ 0）追加破碎粒子——破碎只由伤害驱动，
  //     自然消失（回合开始清零）只是保护框随 sync 静默隐去；
  //   无生命值伤害不翻红不击退（用户定），节拍短停即收。
  // HP/盾量数字的显示状态变化在本节拍后的 sync 才应用——先演后变
  _damageHit(unit, payload, finish) {
    const dealt = payload?.dealt ?? 0;
    const absorbed = payload?.shieldAbsorbed ?? 0;

    // 全屏受击演出：震荡烈度 = 生命值伤害 + 护盾吸收 ×0.2（护盾受击严重度低）；
    // 收击方是友军（主角/盟友）追加视角边缘压暗压红渐晕。均为 non-blocking FX，
    // 与闪红/粒子/读数并行，不占队列节拍
    const severity = damageSeverity(dealt, absorbed);
    if (severity > 0) {
      this.shake.impulse(severity);
      if (unit.side !== 'enemy') this._vignette.pulse(severity);
    }

    if (absorbed > 0) {
      // 点粒子是真 3D：z 必须取单位实际深度（缺省 z=70 是旧 2D 特效层，斜相机下投影错位）
      this.particles.spawn(unit.position.x, unit.position.y + 2, {
        count: 20, color: 0x9ccfff, speed: 18, ttl: 0.6, size: 1.5, z: unit.position.z,
      });
      const p = this._unitToUI(unit, 2.5 + (Math.random() - 0.5) * 2, 3);
      this.particles.spawnText(
        p.x, p.y,
        `-${absorbed}`,
        {
          fontSize: Math.min(26 + absorbed * 1.6, 48), color: '#8fb3d9',
          vx: (Math.random() - 0.5) * 8, vy: 16 + Math.random() * 6,
          gravity: -50, ttl: 0.85, scalePop: 0.3,
          space: 'ui',
        },
      );
      if (this._displayShieldOf(unit.uniqueID) - absorbed <= 0) this._shieldBreakFx(unit);
    }

    if (dealt > 0) {
      unit.flash?.(0xff2222);
      // 受击火花双色爆发：主簇暖红橙 + 高速亮黄白迸溅（系统内亮度抖动再分层）
      this.particles.spawn(unit.position.x, unit.position.y + 2, {
        count: 24, color: 0xff6a3d, speed: 22, size: 1.6, z: unit.position.z,
      });
      this.particles.spawn(unit.position.x, unit.position.y + 2, {
        count: 10, color: 0xffd9a0, speed: 30, ttl: 0.4, size: 1.1, z: unit.position.z,
      });
      // 伤害数字：UI 前景层读数（恒定屏幕尺寸、不被场景遮挡），从受伤源向上迸射、受重力下坠
      const p = this._unitToUI(unit, (Math.random() - 0.5) * 3, 4 + Math.random() * 1.5);
      this.particles.spawnText(
        p.x, p.y,
        `-${dealt}`,
        {
          fontSize: Math.min(34 + dealt * 2.4, 96), color: '#ff4d4d',
          vx: (Math.random() - 0.5) * 10, vy: 22 + Math.random() * 8,
          gravity: -65, ttl: Math.min(0.85 + dealt * 0.02, 1.3), scalePop: 0.5,
          space: 'ui',
        },
      );
      const id = unit.uniqueID;
      const x0 = unit.position.x;
      // 击退幅度随伤害缩放（与震荡同语言）：轻伤轻晃、重伤踉跄
      const knock = 1.1 + Math.min(dealt, 20) * 0.055;
      this.animator.animate(id, { x: x0 + knock }, {
        durationMs: 80,
        ease: 'power1.in',
        onComplete: () => {
          this.animator.animate(id, { x: x0 }, {
            durationMs: 220,
            onComplete: () => {
              unit.restoreColor?.();
              finish();
            },
          });
        },
      });
      return;
    }
    // 全吸收：无击退链，短停一拍让吸收数字可读后收节拍
    this.animator.animate(unit.uniqueID, {}, { delayMs: 220, onComplete: finish });
  }

  // 单位入场演出（召唤，用户定 2026-08）：与死亡倾倒同轴的语言反演——
  // billboard「以脚为轴」从平躺立起（squash-stretch：立起过程中纵向压扁再弹开，
  // 果冻感）→ 立定瞬间落地扬尘（与死亡落尘同粒子语言）→ 两次衰减摇晃站稳
  // （sin 包络 × (1-t)，绕脚底前后微倾）→ 归位 finish。
  // 前置 sync 已把视图建到槽位（入场类次序：sync 先 anim 后），此处只动
  // billboard 局部姿态——place() 的 position/scale 不受干扰，演出后无残留。
  _unitSpawnBeat(unit, finish) {
    const billboard = unit.billboard;
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    const TIP = THREE.MathUtils.degToRad(78); // 起始倾角：近平躺（与死亡的 82° 呼应）

    // ① 立起（~0.38s，power3.out：起得急、临直立减速——「挣起来」的发力感）
    this.animator.animateCustom(unit.uniqueID, {
      durationMs: 380,
      ease: 'power3.out',
      onUpdate: (t) => {
        billboard.rotation.x = -TIP * (1 - t);
        // 果冻展开：前 40% 纵向压扁（贴地铺开），后 60% 弹回全高
        const squash = t < 0.4 ? 0.55 + t : 1 - 0.28 * Math.sin(Math.PI * (t - 0.4) / 0.6);
        billboard.scale.y = squash;
      },
      onComplete: () => {
        billboard.rotation.x = 0;
        billboard.scale.y = 1;
        // 落地扬尘：近处低速大颗粒 + 外围溅尘（死亡落尘同语言）
        this.particles.spawn(px, py + 0.8, { count: 16, color: 0xb59a72, speed: 9, ttl: 0.7, gravity: -6, size: 2.2, z: pz });
        this.particles.spawn(px, py + 0.5, { count: 10, color: 0x857358, speed: 15, ttl: 0.45, gravity: -12, size: 1.4, z: pz });
        // ② 摇晃站稳（~0.75s）：两次前后摆（sin 两周期 × 指数衰减），摆幅 ≈4.5°
        this.animator.animateCustom(unit.uniqueID, {
          durationMs: 750,
          ease: 'none',
          onUpdate: (t) => {
            const decay = Math.exp(-3.2 * t);
            billboard.rotation.x = THREE.MathUtils.degToRad(4.5) * Math.sin(t * Math.PI * 4) * decay;
          },
          onComplete: () => {
            billboard.rotation.x = 0;
            finish();
          },
        });
      },
    });
  }

  // 单位死亡演出（用户定 2026-08）：立牌「以脚为轴」向后倾倒（重力加速）→
  // 落地扬尘 + 一次阻尼回弹 → 焚毁（焦黑化 + alphaTest 侵蚀淡出 + 余烬升腾）→
  // 整体隐藏收殓。节拍阻塞至收殓，其后的 sync 才应用 isDead 面色（先演后变）。
  // 倾倒作用于 billboard 的 X 轴（YXZ 序下与 faceCamera 的 yaw 正交组合，逐帧
  // yaw 不吃掉倾倒角），旋转轴过脚底——立牌物理感的根源；牌面立面底部锚定，
  // 绕原点转即天然「栽倒」而非「缩没」。
  _unitDeathBeat(unit, finish) {
    const id = unit.uniqueID;
    const billboard = unit.billboard;
    unit.hideIntention(); // 意图即隐：尸体不再预告下一手
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    // TIP 略欠 90°：完全放平会透视成一条线，82° 平躺仍留一线牌面可读
    const TIP = THREE.MathUtils.degToRad(82);

    // ① 倒下（~0.47s，power2.in 重力加速：越落越快）
    this.animator.animateCustom(id, {
      durationMs: 470,
      ease: 'power2.in',
      onUpdate: (t) => { billboard.rotation.x = -TIP * t; },
      onComplete: () => {
        // 落地扬尘：近处低速大颗粒 + 外围溅尘（加色混合下土色即微光尘雾）
        this.particles.spawn(px, py + 0.8, { count: 18, color: 0xb59a72, speed: 9, ttl: 0.7, gravity: -6, size: 2.2, z: pz });
        this.particles.spawn(px, py + 0.5, { count: 12, color: 0x857358, speed: 16, ttl: 0.45, gravity: -12, size: 1.4, z: pz });
        // ② 回弹（~0.22s）：阻尼单次反弹，sin 包络 × (1-t) 衰减，峰值离地约 2°
        this.animator.animateCustom(id, {
          durationMs: 220,
          onUpdate: (t) => {
            const lift = THREE.MathUtils.degToRad(4) * Math.sin(Math.PI * t) * (1 - t);
            billboard.rotation.x = -(TIP - lift);
          },
          onComplete: () => this._unitBurnAway(unit, finish),
        });
      },
    });
  }

  // ③ 焚毁：状态绘制先隐（尸体不再读数），立牌焦黑化 + alphaTest 侵蚀淡出
  // （opacity 压低 alpha 后 0.5 阈值逐像素 discard，边缘呈烧蚀状）+ 余烬/烟升腾；
  // 播毕整体隐藏——place() 不重置 visible，尸体自此退场（后续 sync 幂等保持隐藏）。
  _unitBurnAway(unit, finish) {
    const bodyMat = unit.body.material;
    unit.hideStatus();
    unit.body.castShadow = false; // 深度材质不认 opacity：不关影，影子会在淡出期赖在地板上
    bodyMat.transparent = true;
    bodyMat.needsUpdate = true;
    const startColor = bodyMat.color.clone();
    const charColor = new THREE.Color(0x1a0f0a);
    const px = unit.position.x;
    const py = unit.position.y;
    const pz = unit.position.z;
    this.particles.spawn(px, py + 1, { count: 26, color: 0xffa040, speed: 8, ttl: 0.6, gravity: 14, size: 1.1, z: pz - 2 });
    this.particles.spawn(px, py + 1, { count: 12, color: 0x6b655e, speed: 4, ttl: 0.9, gravity: 6, size: 2.2, z: pz - 2 });
    this.animator.animateCustom(unit.uniqueID, {
      durationMs: 430,
      ease: 'power1.in',
      onUpdate: (t) => {
        bodyMat.opacity = 1 - t;
        bodyMat.color.copy(startColor).lerp(charColor, Math.min(1, t * 1.3)); // 先焦后散
      },
      onComplete: () => {
        unit.visible = false;
        finish();
      },
    });
  }

  // 显示状态（上一 sync 快照）里某单位的盾量——判断本击是否吸穿护盾的依据
  _displayShieldOf(unitId) {
    const p = this._snapshot;
    if (!p) return 0;
    if (p.player?.uniqueID === unitId) return p.player.shield ?? 0;
    return [...(p.allies ?? []), ...(p.enemies ?? [])]
      .find(u => u.uniqueID === unitId)?.shield ?? 0;
  }

  // 牌面脉冲（non-blocking FX）：overlay 发光片从放大缩回原位后隐藏，不进注册表、不占队列
  /** 手牌压力提示（抽不下 / 咏唱发动被挡）：整手牌红脉冲 + 骑士头顶文字。 */
  _handPressureHint(text = '我掌控不了更多手牌了！') {
    for (const view of this._views.values()) view.fx?.pulse?.({ color: 0xff3b30, durationMs: 520, scale: 1.03 });
    const proj = this._snapshot;
    const unit = proj ? this._units.get(proj.player.uniqueID) : null;
    if (!unit) return;
    const p = this._unitToUI(unit, 0, 12);
    this.particles.spawnText(p.x, p.y, text, {
      fontSize: 30, color: '#ff8a80', fontWeight: 'bold',
      vx: (Math.random() - 0.5) * 3, vy: 10, gravity: 0, drag: 1.1, ttl: 1.4, scalePop: 0.35, space: 'ui',
    });
  }

  _pulseCard(id, color) {
    this._views.get(id)?.fx.pulse({ color }); // 特效层时间线，回程由每帧 updateFx 推进
  }

  // 护盾破碎演出：蓝白碎粒自血条处迸射——只在伤害节拍里被驱动（吸收击穿护盾的
  // 最后一击），保护框本身随后续 sync 静默隐去；自然消失（回合清零）无碎粒。
  // 碎粒是真 3D（传单位实际 z）
  _shieldBreakFx(unit) {
    const s = unit._baseScale ?? 1;
    const y = unit.position.y + 3.4 * s; // hpBar 在脚底上方 3.4（local）
    const z = unit.position.z;
    this.particles.spawn(unit.position.x, y, {
      count: 30, color: 0x9ccfff, speed: 16, ttl: 0.75, gravity: -30, size: 1.5, z,
    });
    this.particles.spawn(unit.position.x, y, {
      count: 12, color: 0xeaf4ff, speed: 10, ttl: 0.55, gravity: -20, size: 1.0, z,
    });
  }

  _pulsePile(zone, onComplete) {
    const pile = this._piles[zone];
    if (!pile) { onComplete(); return; }
    this.animator.animate(`pile:${zone}`, { scale: 1.15 }, {
      durationMs: 120,
      onComplete: () => {
        this.animator.animate(`pile:${zone}`, { scale: 1.0 }, { durationMs: 120, onComplete });
      },
    });
  }

  _findAnimTarget(payload) {
    if (!payload) return null;
    if (payload.kind === 'mana' || payload.kind === 'actionPoint') {
      return this._units.get(this._snapshot?.player.uniqueID) ?? null;
    }
    const id = payload.target?.uniqueID ?? payload.unit?.uniqueID
      ?? payload.skill?.uniqueID ?? payload.card?.uniqueID
      ?? payload.cards?.[0]?.uniqueID ?? payload.uniqueID ?? null;
    return this._units.get(id) ?? this._views.get(id) ?? null;
  }

  // ========== 区域查看器（点牌库图标开）：战斗同栈的卡牌画廊 ==========
  // 渲染（CardObject 同烘焙）、拾取（token→tooltip / 整卡→hover）与手牌同协议；
  // 点卡（或卡面 token）保持打开读卡，点其余任意处关闭。

  _openViewer(zone) {
    this._closeViewer();
    const proj = this._snapshot;
    if (!proj) return;
    const list = proj.zones[zone] ?? [];
    // 顺序语义：牌库顶 = 数组首（展示最左）、牌库底（最新回库）= 最右
    const subtitle = list.length === 0 ? '空空如也' : '最左为牌库顶';
    this._viewer.open(list, {
      zone,
      title: `牌库 · ${list.length} 张`,
      subtitle,
    });
    this.uiScene.add(this._viewer);
  }

  _closeViewer() {
    if (!this._viewer.opened) return;
    this._overCardId = null; // 画廊卡不再可达：详情态随模态层一并还原
    this._refreshShiftFace();
    this._viewer.close();
    this.uiScene.remove(this._viewer);
    this._setHoveredCard(null); // 悬浮态随模态层一并清零（画廊卡 id 不进 _hoveredCardId，此处兜底）
  }

  // ========== 指针输入（调用方传屏幕像素坐标） ==========

  handlePointerMove(x, y) {
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    // 查看器模态：悬浮照常走 Picker（卡面 token → tooltip:*、整卡 → hover 抬升，
    // 与手牌同链路），但屏蔽瞄准/拖拽等战斗交互
    if (this._viewer.opened) {
      const hit = this.picker.hover(x, y);
      // 卡面 token（富文本/S 标）视作仍在悬浮所属卡：画廊抬升不中断（与手牌同语义）
      this._viewer.setHovered(this._viewer.ownsHit(hit) ? hit.id : null);
      this._setOverCard(hit);
      return;
    }
    // 瞄准模式：卡留手牌不动，箭头从卡牌延伸到指针；掠过存活敌人 → 高亮 + 箭头变色
    if (this._aiming) {
      const obj = this._views.get(this._aiming.id);
      if (!obj) { this._cancelAiming(); return; } // 卡在瞄准中离场（异常路径）：收尾
      const world = this._worldAt(x, y, ARROW_Z);
      this._arrow.update(obj.position, world);
      const hit = this.picker.pick(x, y, { kinds: ['unit'] });
      const targetId = this._targetableEnemyId(hit);
      this._setDragTarget(targetId);
      this._arrow.setTargetValid(!!targetId);
      return;
    }
    if (this._dragging) {
      const world = this._worldAt(x, y, 30); // 与拖拽卡同深（z=30），防透视视差
      const obj = this._views.get(this._dragging.id);
      if (obj) obj.position.set(world.x, world.y, 30);
      this._dragging.moved = true;
      // 拖牌掠过存活敌人 → 目标标注高亮（排除拖拽中的卡自身遮挡）
      const hit = this.picker.pick(x, y, { kinds: ['unit'], excludeIds: [this._dragging.id] });
      this._setDragTarget(this._targetableEnemyId(hit));
      return;
    }
    const hit = this.picker.hover(x, y);
    this._setOverCard(hit);
  }

  handlePointerDown(x, y) {
    if (this._viewer.opened) return; // 查看器内无按压语义（抬起时统一判定开/关）
    if (this._pick) return;          // 选卡覆盖层：点按语义在抬起时统一处理（不瞄准/不拖拽）
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    const hit = this.picker.pick(x, y);
    const proj = this._snapshot;
    // 点了「因手牌压力发动不了」的咏唱卡：灰卡本身没说原因，这里补一次明确反馈
    if (hit.kind === 'card') {
      const clicked = proj?.hand.find(c => c.uniqueID === hit.id);
      if (clicked?.blocked === 'chantPressure') {
        this._handPressureHint('手牌太多，咏唱发动不了！');
        return;
      }
    }
    // 换卡模式下点手牌是"点按换出"，不进入拖拽
    if (hit.kind === 'card' && !proj?.pendingInput && !this._swapMode) {
      // 前端拒绝以显示态为准：渲染为灰（disabled）的卡不可发起交互——显示态落后
      // 于后端（动画积压期）时，玩家看到什么就是什么，不可能"抢先"后端出牌
      const displayPlayable = this._views.get(hit.id)?.visualState !== 'disabled';
      if (displayPlayable && this.bridge.intents.canPlayCard(hit.id)) {
        // 按投影 targetMode 分流：选目标卡进瞄准（卡留手牌），免目标卡旧式拖拽（卡随指针）
        const targetMode = proj?.hand.find(c => c.uniqueID === hit.id)?.targetMode ?? 'none';
        if (targetMode === 'enemy') {
          this._aiming = { id: hit.id };
          this._arrow.show(this._views.get(hit.id).position);
          this._arrow.setTargetValid(false);
          this._layoutAndTrack(); // 瞄准卡高亮 + 撑开两侧
        } else {
          this._dragging = { id: hit.id, moved: false };
          this.animator.enterDragging(hit.id);
        }
      }
      // 咏唱卡无特殊点按语义：双态开关统一走出牌（拖拽过线 = 发动/免费解除）
    }
  }

  handlePointerUp(x, y) {
    this.scene.updateMatrixWorld(true);
    this.uiScene.updateMatrixWorld(true);
    if (this._viewer.opened) {
      // 点卡（或卡面 token）= 读卡，保持打开；点背板/其余任意处关闭
      if (!this._viewer.ownsHit(this.picker.pick(x, y))) this._closeViewer();
      return;
    }
    const proj = this._snapshot;
    const pending = proj?.pendingInput?.request ?? null;

    // 选卡覆盖层：点候选 = 切换选中（不打出、不瞄准）；上限封顶 max
    if (this._pick && this._pick.request === pending) {
      const hitPick = this.picker.pick(x, y);
      const uid = hitPick?.kind !== 'card' ? null
        : (this._pick.mode === 'hand' ? hitPick.id : this._pick.temp.get(hitPick.id)?.uniqueID);
      if (uid && this._pick.ids.includes(uid)) {
        const sel = this._pick.selection;
        const i = sel.indexOf(uid);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length < this._pick.max) sel.push(uid);
        this.reconcile();   // 同一 request 幂等 → 只刷新选中态与按钮
        return;
      }
    }

    // 瞄准松手：指针在存活敌人身上 → 指定目标打出；否则取消（卡本就在锚点，只清状态）。
    // 提交前再验显示态：瞄准中途节拍推进可能已把卡压灰（如结算期），灰卡不打
    if (this._aiming) {
      const { id } = this._aiming;
      const hit = this.picker.pick(x, y, { kinds: ['unit'] });
      const targetId = this._targetableEnemyId(hit);
      this._cancelAiming();
      if (targetId && this._views.get(id)?.visualState !== 'disabled') {
        this.bridge.intents.playCard(id, targetId);
      }
      return;
    }

    if (this._dragging) {
      const { id } = this._dragging;
      this._dragging = null;
      this._setDragTarget(null);
      const world = this._worldAt(x, y, 30); // 出牌线判定与拖拽同深
      // 松手点在存活敌人身上 → 指定目标打出；否则过出牌线 → 默认目标打出。
      // 显示态门：拖拽中途被节拍压灰的卡不提交（回原位），防"认知先于动画节拍"的误操作
      const hit = this.picker.pick(x, y, { kinds: ['unit'], excludeIds: [id] });
      const targetId = this._targetableEnemyId(hit);
      const displayPlayable = this._views.get(id)?.visualState !== 'disabled';
      const played = displayPlayable && (targetId || world.y > PLAY_LINE_Y)
        && this.bridge.intents.playCard(id, targetId);
      if (!played) this.animator.enterIdle(id); // 弹簧收养：从松手位平滑滑回锚点
      return;
    }

    const hit = this.picker.pick(x, y);
    if (hit.kind === 'pile') {
      this._openViewer(hit.id.slice(5)); // 'pile:deck' → 'deck'
      return;
    }
    if (hit.kind === 'button' && hit.id === 'btn:swap') {
      // 换卡按钮：模式开关（再点一次取消）；可用性以按钮面当前状态为准
      if (this._swapMode) this._setSwapMode(false);
      else if (this._buttons.swap.cardData?.enabled) this._setSwapMode(true);
      return;
    }
    if (hit.kind === 'card' && this._swapMode) {
      // 换卡模式点手牌：换出（弃 1 抽 1）；不可换的卡（显示灰/咏唱/费用不足）保持模式
      if (this._views.get(hit.id)?.visualState !== 'disabled' && this.bridge.intents.canSwapCard(hit.id)) {
        this.bridge.intents.swapCard(hit.id);
        this._setSwapMode(false);
      }
      return;
    }
    if (hit.kind === 'button' && hit.id === 'btn:main') {
      // 显示态门：按钮面为灰（非等待输入/结算期未就绪）时不分发任何意图——
      // 灰按钮必须真的点不动，杜绝"显示灰但后端已可结算"的抢先操作
      if (!this._buttons.main.cardData?.enabled) return;
      if (this._pick) this.bridge.interaction.respond([...this._pick.selection]);
      else if (pending?.kind === 'confirm') this.bridge.interaction.respond(true);
      else if (pending?.kind?.startsWith('select') && (pending.count ?? 1) > 1) this.bridge.interaction.respond([...this._inputSelection]);
      else this.bridge.intents.endTurn();
      this._inputSelection = [];
      return;
    }
    if (hit.kind === 'card' && pending?.kind?.startsWith('select')) {
      if (!pending.candidates || pending.candidates.includes(hit.id)) {
        if ((pending.count ?? 1) === 1) {
          this.bridge.interaction.respond([hit.id]);
        } else {
          const i = this._inputSelection.indexOf(hit.id);
          if (i >= 0) this._inputSelection.splice(i, 1);
          else if (this._inputSelection.length < pending.count) this._inputSelection.push(hit.id);
          this.reconcile(); // 刷新按钮计数
        }
      }
    }
  }

  _worldAt(x, y, planeZ = 0) {
    // 射线与指定 z 平面求交（拖拽出牌用 planeZ=30 与卡面同深，避免透视视差）；
    // 卡牌在 UI pass → 必须用 uiCamera 反投影，否则世界相机的斜视会把落点算歪
    return this.picker._sm.screenToWorld(x, y, planeZ, this.picker._sm.uiCamera);
  }

  // 瞄准收尾：清状态 + 藏箭头 + 重排手牌（去高亮/收撑开）。卡全程未离锚点，无需归位
  _cancelAiming() {
    this._aiming = null;
    this._arrow.hide();
    this._setDragTarget(null);
    this._layoutAndTrack();
    this._updatePendingPips();
  }

  // 拖牌目标：pick 命中存活敌人才作数（尸体/友方/玩家不算；按显示状态快照判定）
  _targetableEnemyId(hit) {
    if (hit?.kind !== 'unit') return null;
    const alive = (this._snapshot?.enemies ?? []).some(e => e.uniqueID === hit.id && !e.isDead);
    return alive ? hit.id : null;
  }

  // 目标标注：最多一个单位高亮，随拖拽移动切换/清除
  _setDragTarget(uniqueID) {
    if (this._dragTargetId === uniqueID) return;
    this._dragTargetId = uniqueID;
    for (const [id, unit] of this._units) unit.setHighlight(id === uniqueID);
  }

  _bakeButtonFace(data) {
    // 浏览器：圆角风格化按钮（10px/wu ↔ 15x6 世界，与牌面同约定）；
    // 单测注入的 fake bakeLabel 直接透传
    if (typeof document === 'undefined') return this._bakeLabel(data.label);
    return bakeButtonFace(data, { width: BUTTON_SIZE.w * 10, height: BUTTON_SIZE.h * 10, scale: 3 });
  }

  _setHoveredCard(uniqueID) {
    if (this._viewer.hasCard(uniqueID)) return; // 查看器卡悬浮由画廊自管，不进手牌撑开/资源点链路
    if (this._hoveredCardId === uniqueID) return;
    this._hoveredCardId = uniqueID;
    this._layoutAndTrack(); // 弹簧层软收敛到新目标，无 kill/重启的顿挫
    this._updatePendingPips();
  }

  // ========== Shift 详情卡面（应用描述 ↔ 未应用描述临时切换） ==========

  /** Shift 键态入口（window 监听 / 单测直调）：驱动压着卡的详情面切换。 */
  setShiftDown(on) {
    on = !!on;
    if (on === this._shiftDown) return;
    this._shiftDown = on;
    this._refreshShiftFace();
  }

  // 指针压卡跟踪：整卡或卡面 token 都算"压着"——详情态悬到 S 方标（token）上也不得闪切回
  _setOverCard(hit) {
    const id = (hit?.kind === 'card' || hit?.kind === 'token') ? hit.id : null;
    if (this._overCardId === id) return;
    this._overCardId = id;
    this._refreshShiftFace();
  }

  // 差分应用：按住 Shift 时指针压着的卡（手牌/咏唱/查看器画廊）切未应用描述渲染，
  // 松开或移开即还原。至多一张卡处于详情态，切换即差分（无全量重烘）。
  _refreshShiftFace() {
    let obj = null;
    if (this._shiftDown && this._overCardId != null) {
      obj = this._views.get(this._overCardId)
        ?? (this._viewer.opened ? this._viewer.cardObj(this._overCardId) : null)
        ?? null;
    }
    if (this._altObj === obj) return;
    this._altObj?.setAltMode(false);
    this._altObj = obj;
    this._altObj?.setAltMode(true);
  }

  // 悬浮/瞄准手牌 → 按其 cost 驱动资源徽章交互态：可负担 = highlighted
  // （呼吸 glow + 升腾粒子），不满足 = insufficient（数值暗红，覆盖高亮）；
  // 咏唱卡费用已付，零开销 = normal。拖拽/瞄准中 hover 保持（picker 不重算），
  // 出牌/离场后由 reconcile 清除。
  _updatePendingPips() {
    let ap = 0;
    let mana = 0;
    const pendingId = this._aiming?.id ?? this._hoveredCardId;
    if (pendingId != null) {
      const card = (this._snapshot?.hand ?? []).find(c => c.uniqueID === pendingId);
      if (card?.cost) {
        // X 费预览：高亮全部现有资源（支付时全耗）
        ap = card.cost.actionPoint === 'X' ? this._resources.ap.current : (card.cost.actionPoint ?? 0);
        mana = card.cost.mana === 'X' ? this._resources.mana.current : (card.cost.mana ?? 0);
      }
    }
    this._resources.ap.setHoverCost(ap, this._resources.ap.current);
    this._resources.mana.setHoverCost(mana, this._resources.mana.current);
  }

  // 卡图异步加载完成后：重烘全部在场景牌面（纹理与 hit map 成对替换）
  _rebakeCardFaces() {
    for (const view of this._views.values()) {
      if (view.cardData) view.setCard(view.cardData);
    }
    this._viewer.rebake(); // 查看器内的卡同享到图重烘（关闭态为空操作）
  }

  // 渲染端支持的最大各向异性（假 renderer/无 WebGL 环境回退 1）
  _smMaxAnisotropy() {
    return this._sm?._renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  }

  dispose() {
    this._disposed = true; // 幽灵守卫先行（退订前到达的排队事件也不再处理）
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onShiftKeyDown);
      window.removeEventListener('keyup', this._onShiftKeyUp);
      window.removeEventListener('blur', this._onWinBlur);
    }
    this._closeViewer();
    this._composer?.dispose();
    this._composer = null;
    this.composeScene = null;
    this.composeResize = null;
    this._unsubTick?.();
    this._unsubs.forEach(off => off?.());
    this._unsubs = [];
    this.springs.clear();
    this._arrow.dispose();
    this._statusBar.dispose(); // 含晶粒排/金币/盾徽（随父级销毁）
    this._topBar.dispose();
    this.shake.dispose();      // 相机精确回基位（防偏移泄漏给下一舞台）
    this._vignette.dispose();
    // 视图全销毁；模型跨场存活（下一场 beginBattle 重置），不在此清理
    for (const view of this._views.values()) {
      this.uiScene.remove(view);
      view.dispose();
    }
    this._views.clear();
    for (const view of this._burning) {
      this.uiScene.remove(view);
      view.dispose();
    }
    this._burning.clear();
  }
}
