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
import { dispatchAnimBeat } from './battleBeats.js';
import { unitBeats } from './battleBeats/units.js';
import { inputBeats, ARROW_Z } from './battleBeats/input.js';
import { syncBeats } from './battleBeats/sync.js';
import { cardBeats, PILE_POSITIONS, CARD_BURN_MS } from './battleBeats/cards.js';
import { DisplayModel } from '../../bridge/displayModel.js';
import { CardObject } from '../objects/CardObject.js';
import { UnitObject } from '../objects/UnitObject.js';
import { BubbleLayer } from '../objects/BubbleLayer.js';
import { ZonePileObject } from '../objects/ZonePileObject.js';
import { CapacityBeadsObject } from '../objects/CapacityBeadsObject.js';
import { CardGalleryObject } from '../objects/CardGalleryObject.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { TargetingArrowObject } from '../objects/TargetingArrowObject.js';
import { ScreenShake, DamageVignette, lowHpVignetteLevel } from '../objects/screenImpactFX.js';
import { createBurstFacade } from '../fx/gpu/burstFx.js';
import { createParticlePool } from '../fx/gpu/particlePool.js';
import { createBurnLink } from '../fx/gpu/burnSparks.js';
import { createResourceDrainFx } from '../fx/gpu/resourceDrainFx.js';
import { LayoutEngine, HAND_FAN_MECHANICS } from '../layout/LayoutEngine.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { bakeBoldText } from '../objects/textBakers.js';
import { StageAnimator, gsapTween } from '../animator/StageAnimator.js';
import { HandSprings } from '../animator/HandSprings.js';
import { Picker } from '../picker/Picker.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { createStagePickerKit } from '../stagePickerKit.js';
import { installPanelHost } from '../panelHost.js';
import { PANEL_BUILDERS } from '../panels/index.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { bakeButtonFace } from '../richtext/buttonFace.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { sharedUnitArtCache, playerSwordVariant, PLAYER_SWORD_TIERS } from '../art/unitArt.js';
import { getScene, slotTransform } from '../scenes/index.js';
import { createVolumetricMoonlight } from '../scenes/volumetricMoon.js';
import { runScript } from '../fx/script.js';
import { AuraHost } from '../fx/aura.js';
import { createChantSceneFx } from '../fx/chantSceneFx.js';
import { Cast } from '../fx/cast.js';
import { createProjectileTracker } from '../fx/spells/projectileTrack.js';
import { cardReactMode } from '../fx/cardBodyFx.js';
import { getScript } from '../fx/scripts/index.js';
import { createNotifyHub } from '../fx/notify.js';
import { warmCharBurn } from '../fx/charBurn.js';
// 卡面世界尺寸：权威定义在 objects/cardMetrics.js（休息阶段面板共用同一尺寸源）；
// 此处再导出以保持既有引用（测试 / ZonePileObject 取参）不破。
import { CARD_WIDTH, CARD_HEIGHT } from '../objects/cardMetrics.js';
export { CARD_WIDTH, CARD_HEIGHT };

const PICK_SCALE = 0.62; // 选卡覆盖层的卡缩放（比手牌略大，便于点选）
const PICK_HINT_SCALE = 0.19; // 目标提示行的逻辑像素→世界单位（fontPx 17 ≈ 屏上 24px）

const BUTTON_SIZE = { w: 15, h: 6 };
// 按钮纵列：主按钮（结束回合/确认）在上，换卡按钮在下（右下自由区，避让人群与手牌扇）
export const BUTTON_POSITIONS = {
  main: { x: 74, y: -20 },
  swap: { x: 74, y: -28 },
};
// 手牌悬浮/瞄准提拉目标：整牌（含 liftScale 放大）拉入屏内 + 2 单位余量。
// 由卡高与放大系数推导（旧固定值 -46.5 是 27 高卡时代遗留，卡面 ×1.3 后下缘重新出屏）
const HAND_LIFT_Y = UI_CAMERA_LOOK_AT_Y - WORLD_HEIGHT / 2
  + (CARD_HEIGHT * HAND_FAN_MECHANICS.liftScale) / 2 + 2;
// 玩家状态栏摆放位：与地图舞台共享的契约，定义见 PlayerStatusObject.js
export { PLAYER_STATUS_POS };

// 角色头顶的对话/思索泡泡：锚点抬到头顶之上（单位立牌高 ~26 世界单位，原点在脚底）
const BUBBLE_HEAD_DY = 30;
// 手牌满被挡下时骑士的自语（思索泡泡而非飘字）
const HAND_FULL_LINE = '我无法掌控更多手牌了！';

export class BattleStage {
  /**
   * @param {object} options
   *   bridge: createBridge 产物
   *   stageManager: StageManager
   *   bus: UI 事件出口（tooltip/card-hover），缺省 bridge.frontendBus
   *   bakeFace(cardProjection) / bakeLabel(text)：烘焙函数，缺省浏览器 canvas 实现（可注入 fake）
   *   tween: StageAnimator 的 tween 工厂（缺省 gsap，测试注入手动版）
   */
  constructor({ bridge, stageManager, bus = null, bakeFace = null, bakeLabel = null, tween = undefined, scene = 'dungeon', sceneSeed = 'dev', displayModel = null, roomOverride = null }) {
    // ====== 装配：渲染与场景（双 scene / PCG 场景 / 雾 / 体积月光 composer / 素材缓存与烘焙） ======
    this.bridge = bridge;
    this.name = 'battle';
    this.scene = new THREE.Scene();   // 3D 世界 pass：场景/单位/粒子（与地板正确深度交互）
    this.uiScene = new THREE.Scene(); // UI pass：卡牌/按钮/图标/资源点（清深度后渲染，不被地板 z-test 裁掉）
    this._bus = bus || bridge.frontendBus;
    // roomOverride：Boss 把房间改成自己的主题房（敌人 def roomOverride，经 runController 收集传入）
    this._sceneDef = getScene(scene, sceneSeed, roomOverride);
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
      this._composer = createVolumetricMoonlight({ light: this._scene3D.moonlight, march: stageManager.getRenderQuality?.() });
      this.composeScene = ({ scene, camera }) => this._composer.render(renderer, scene, camera);
      this.composeResize = (w, h) => this._composer.resize(w, h);
      this.composeResize(stageManager.viewSize.width || 2, stageManager.viewSize.height || 2);
    }
    // 烧毁覆写的着色器在**入场黑幕期**编好（Boss 房才有转段焚化）：延到用的那一拍
    // 现场重编译，实测在转段爆发那一帧冻住主线程 715ms（演出中段「跃变」的元凶）。
    if (this._sceneDef?.id === 'pcg:boss') {
      warmCharBurn({ renderer, scene: this.scene, camera: stageManager.camera });
    }
    this._tintScratch = new THREE.Color();

    // ====== 装配：布局与动画底座（LayoutEngine / StageAnimator / HandSprings / Picker） ======
    this.layout = new LayoutEngine();
    // 手牌扇形几何：minX/maxX 为卡中心硬区间——左让状态栏面板（UI 底板右缘 ≈ -44.9），
    // 右让牌库图标（x = 80）；baseY 压低让下缘可越出屏底（-65），与重叠、
    // 外倾共同压缩满 10 张所需空间。机制参数（挤开/提拉放大/z 抬升）见 LayoutEngine。
    this.layout.registerContainer('hand', {
      minX: -40.5, maxX: 58.5,        // 横界：满手外缘不压牌库图标（中心 9 不变）
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

    // ====== 装配：显示状态与视图登记（DisplayModel / _views / _units / 快照 / 输入态字段） ======
    // 显示状态权威 = run 级 DisplayModel（与共享 sequencer 对等，跨场景存活）；
    // BattleStage 只是它的战斗视图。此处未注入则自建（单场测试/headless 用）。
    this.model = displayModel ?? new DisplayModel();
    this.model.beginBattle(); // 战斗边界：卡牌面按场清空（模型本身跨场存活）
    this._views = new Map();  // uniqueID -> CardObject（模型卡条目的 three 视图）
    this._units = new Map();   // uniqueID -> UnitObject
    this._swordArtRank = -1;   // 大剑立绘 latch（PLAYER_SWORD_TIERS 下标）：场内只升不降——
                               // 斩转化在 pending 区的瞬间读数暂缺，不闪图；跨战斗随舞台实例重置
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
    this._shiftDown = false;    // Shift 键盘态镜像（生效走 CardObject 通用件；单测直调 setShiftDown）
    this._dragging = null;     // 免目标卡（targetMode 'none'）旧式拖拽 { id }
    this._aiming = null;       // 选目标卡（targetMode 'enemy'/'ally'）瞄准中 { id, mode }：卡留手牌，箭头指指针
    this._dragTargetId = null; // 拖牌/瞄准指定的高亮目标（存活敌人）
    // 区域查看器（点牌库图标开）：卡牌画廊——渲染/拾取/悬浮/tooltip 与战斗同一套栈
    // 战斗内「选卡牌集」覆盖层（request.picker === 'overlay'）：手牌来源接管既有实例，
    // 其它区来源按投影新建；见 _openPick/_closePick
    this._pick = null;
    this._viewer = new CardGalleryObject({
      cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT,
      bakeFace: this._bakeFace, picker: this.picker,
    });

    // ====== 装配：粒子与全屏演出（GPU 池 v2 + 飘字组件 / 震荡 / 渐晕 / fx 剧本池 / aura / cast / notify） ======
    // GPU 粒子池 v2（PARTICLE_SYSTEM_V2）：世界空间实例（燃烧火星等常驻联动，经
    // createBurnLink 接 aura recipes 的 gpuEmit）+ UI 空间实例（资源消耗汇聚特效）。
    // 非 WebGPU 后端返回 null——燃烧联动与汇聚特效静默跳过
    this.particles2World = createParticlePool(stageManager._renderer, { space: 'world', name: 'particles2World' });
    if (this.particles2World) this.scene.add(this.particles2World.points);
    this._burnLink = createBurnLink(this.particles2World); // null-safe（池缺位 → null）
    this.particles2Ui = createParticlePool(stageManager._renderer, { space: 'ui', name: 'particles2Ui' });
    if (this.particles2Ui) this.uiScene.add(this.particles2Ui.points);
    // this.particles = 组合门面（fx/gpu/burstFx.js）：一次性爆发 spawn 落 GPU 池 burst
    // （懒登记 uber 类型）；伤害数字等文本/贴图粒子与剧本 emitter 由 floatFx 承接
    // （同容器名 points/sprites/spritesUI，场景挂载与既有调用点零改动）
    this.particles = createBurstFacade(this.particles2World, () => this._sm.camera);
    this.scene.add(this.particles.sprites);     // 世界内贴图粒子层（3D 场景演出）
    this.uiScene.add(this.particles.spritesUI); // 读数文本粒子层（前景，恒定屏幕尺寸）
    this._drainFx = null; // _resources 就位后创建（见下）

    // 受击全屏演出（non-blocking FX，同粒子律不占队列节拍）：
    // 震荡是相机导演的一路**叠加偏移通道**（与运镜可合成：转段推镜途中受击照样震，
    // 不会把在途镜头钉住，也不会用过期基位把相机拷回——旧模型的转段跃变病灶）；
    // 渐晕是友军受击专属的视角边缘压暗压红覆盖面（uiScene 顶层）
    this.shake = new ScreenShake({ director: stageManager.cameraDirector });
    this._vignette = new DamageVignette();
    this.uiScene.add(this._vignette.object);

    // 天斩断裂标记（heavenCleave 施术拍挂上 → 死亡节拍消费即摘；舞台拆台清空）
    this._cleaveSplit = new Set();

    // 在途 fx 协程剧本（伤害命中等节拍本体）：dispose 时统一 kill（结构化取消，
    // 防舞台拆除后残段继续改对象）；promise 必达，节拍 finish 链不会断
    this._fxScripts = new Set();
    // 舞台寿命钩子（fx Phase 5）：剧本的**常驻**效果（场景覆写/余烬/烧痕）挂这里——
    // runScript 的 onKill 在正常收尾也会触发，挂它会误收常驻演出；dispose 统一回调
    this._fxDisposeHooks = new Set();
    // 单位常驻 aura（fx/aura.js）：uniqueID → AuraHost。由显示状态 diff 驱动
    // （_syncUnits 里对账），观战端经同一份 state sync 自动一致
    this._unitAuras = new Map();
    // 命名寻址注册表（fx/cast.js）：剧本/相机经名字拿句柄。战斗内登记
    // unit:<uniqueID> 与 role:player；anchor/light 由场景层登记（Phase 3+）
    this._cast = new Cast();
    // 咏唱场景演出（fx/chantSceneFx.js）：激活咏唱把战场推向体系氛围（火系 =
    // 暖调+余烬+息旋涡壳；体修 = 贴身气流粒子环绕）。快照对账驱动（isActivated），
    // 观战端同源一致
    this._chantSceneFx = createChantSceneFx({
      scene: this.scene,
      particles: this.particles,
      worldPool: this.particles2World,
      cast: this._cast,
      composer: this._composer ?? null,
      units: this._units,
      playerId: () => this._snapshot?.player?.uniqueID ?? null,
      enemyIds: () => (this._snapshot?.enemies ?? []).map((e) => e.uniqueID),
    });
    // 投射物抵达追踪（fx/spells/projectileTrack.js）：施术拍登记、伤害拍 await
    // 真实抵达（CPU 权威，取代 impactDelayMs 猜测）
    this._projectiles = createProjectileTracker();
    // PCG 道具被动响应（fx/notify.js）：带 behaviors 的场景件登记为 prop:<name>，
    // 重击等事件经 notify 单向分发（fire-and-forget，不进节拍、不读回值）
    this._notifyHub = createNotifyHub({ cast: this._cast });
    this.notify = this._notifyHub.notify;
    for (const n of this._scene3D?.notifiables ?? []) {
      this._cast.register(`prop:${n.name}`, n);
    }
    // 场景交互世界接线：燃烧世界接世界粒子池（sceneFire 类型 + 提案清零尾钩子）
    if (this._scene3D?.combust) this._scene3D.combust.bindPool(this.particles2World);
    // 场景布光登记（Boss 剧本光照覆写寻址用）：light:hemi / light:dir<i> / light:point<i>
    // + light:root（lighting 门面本体）+ light:mood（氛围乘子句柄——强度唯一落笔点是
    // lighting.update，剧本调光强必须推 mood，直推 light.intensity 会被每帧覆盖）。
    // 灯位语义由 lighting.js 预设决定，这里只按类型枚举
    {
      const lg = this._scene3D?.lighting;
      if (lg?.group) {
        this._cast.register('light:root', lg);
        if (lg.mood) this._cast.register('light:mood', lg.mood);
        let di = 0, pi = 0;
        for (const l of lg.group.children) {
          if (l.isHemisphereLight) this._cast.register('light:hemi', l);
          else if (l.isDirectionalLight) this._cast.register(`light:dir${di++}`, l);
          else if (l.isPointLight) this._cast.register(`light:point${pi++}`, l);
        }
      }
    }

    // Boss 演出光池（light:fx0 / light:fx1）：**入场即挂在场景里、强度 0**。
    // 为什么必须是池：演出中途 new PointLight + add = 前向渲染器重编译全部受光材质
    // （PCG 房实测 1.2s 主线程长任务，画面冻住、收尾弹栈的机位硬切全部被吞进冻结里
    // ——09-24「卡达斯转段相机跃变」的根因）。剧本一律 `cast.get('light:fxN')` 借灯，
    // 只推强度/换色/挪位（重挂到单位不改变场景灯数，不触发重编译）。
    this._fxLightPool = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40, 1.8);
      l.name = `fxPool${i}`;
      this.scene.add(l);
      this._fxLightPool.push(l);
      this._cast.register(`light:fx${i}`, l);
    }

    // 角色对话/思索泡泡层（UI 空间：恒定屏幕尺寸、清晰、压在 3D 场景之上）
    // ====== 装配：泡泡层与帧循环（onTick：弹簧/场景/粒子/特效收敛/billboard 朝向/状态栏） ======
    this._bubbles = new BubbleLayer();
    this.uiScene.add(this._bubbles);

    this._unsubTick = stageManager.onTick((dt) => {
      this.springs.update(dt); // 手牌/咏唱静息姿态软收敛（先于演出，本帧姿态到位）
      this._scene3D?.update(dt, this.particles, this._sm.camera.position);
      this.particles.update(dt);
      this.particles2World?.update(dt); // 粒子池 v2（世界：燃烧火星 custom 类型）
      this.particles2Ui?.update(dt); // 粒子池 v2（UI 空间：资源汇聚特效）
      this._drainFx?.update(dt); // 汇聚锚点跟随卡牌（飞展示位期间粒子始终钉徽章）
      this._updateBurning(dt);
      for (const view of this._views.values()) view.updateFx(dt); // 卡面特效层（脉冲回程/盖纱呼吸/流光轨道）
      // 选卡覆盖层的临时候选（instantiate 模式）不在 _views 里——选中高亮是 C0 档
      // （setVisualState 只设目标值，收敛在 updateFx），漏泵则点了没反应（实报病灶）
      if (this._pick) for (const e of this._pick.temp.values()) e.object.updateFx?.(dt);
      // 常驻 HUD 按钮同为 C0 shader 档（setVisualState 只设目标值，收敛在 updateFx）——
      // 帧泵不补这一口，终局/模态的压暗目标永远停在 0（夜测 r3路4 probe 实锤：败北现场
      // _dimT=1 而 _dim=0、updateFx 每秒被泵 0 次——r2 的奖励侧"压暗"实为全屏背板读数）
      for (const btn of Object.values(this._buttons)) btn?.updateFx?.(dt);
      this._pickerKit.update(dt);  // 特写 + 全屏选卡/选遗物的候选卡 fx（选中高亮收敛靠它）
      this._chantSceneFx.update(dt); // 咏唱场景演出包络（暖调/余烬/火流环绕逐帧派生）
      this._panel?.update(dt);       // 模态面板卡阵的 fx（奖励三选一 hover 高亮收敛）
      for (const unit of this._units.values()) {
        unit.update(dt);
        let fwd = this._sm.camera.localToWorld(new THREE.Vector3(0, 0, 1));
        fwd.sub(this._sm.camera.position).normalize();
        unit.faceCamera(fwd); // 立牌形 billboard：斜视下立牌 yaw 朝向相机
        // 立牌光照交互：火把光衰+闪烁+纵深压暗的假采样染色（闪红窗口内不覆盖）
        if (this._scene3D) unit.applyLightTint(this._scene3D.sampleStandeeTint(unit.position, this._tintScratch));
      }
      this._followBubbles();      // 泡泡跟随锚点（单位浮动/受击位移时也跟得上）
      this._bubbles.update(dt);   // 角色自语/对话泡泡（自带冒出→停留→放缩消失时序）
      this._statusBar.update(dt); // 两排资源点 + 双血环的帧过渡
      this._viewer.update(dt);    // 查看器悬浮抬升包络（关闭态为空操作）
      // 低血常驻渐晕：按显示快照血量每帧推（状态驱动，回升即退）+ 受击脉冲释放
      this._vignette.lowHp(lowHpVignetteLevel(this._snapshot?.player));
      this._vignette.update(dt);
      this.shake.update(dt);      // 震荡只登记偏移通道，落笔在导演的 commit（渲染前）
    });

    // ====== 装配：舞台 UI 对象（牌堆 / 容量珠 / 按钮 / 面板宿主 / 选卡套件 / 箭头 / 状态栏 / 顶栏 / 汇聚特效） ======
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

    // 手牌容量指示条（批次 13，用户定；2026-09-30 序列化改版）：手牌扇**上方**一排——
    // [空咏唱容量]+组隙+[手牌序占用（与手牌卡一一对应）]+组隙+[空手牌容量]；迷你卡 =
    // 细紫竖线小槽。数据=投影 handCapacity.slots。
    // 摆位铁律：旧版摆在扇内 y=-56.5 被 26×35 的卡面永久盖住（"永远看不见"病灶）——卡顶缘
    // ≈ baseY+半高 = -33.75，取 y=-30 落在扇形上缘与战线（-20）之间的空带；x=9 = 扇形中心
    // （minX/maxX 中点）。z=20：压过静息手牌（10+n·0.5 ≤ 15）、低于悬浮/瞄准牌（30.5+）——
    // 与状态栏 z=24 同惯例（悬浮牌可临时盖住，静息永不盖）。
    this._capacityBeads = new CapacityBeadsObject();
    this._capacityBeads.position.set(9, -30, 20);
    this.uiScene.add(this._capacityBeads);

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
    this._btnData = {};   // 每个按钮最近一次的数据（悬停态变化时据此重烘）
    this._btnHover = {};  // 每个按钮的悬停态（直接挂舞台的按钮需要自己喂）
    // 弃牌模式（D3 一键全弃：点弃牌按钮进入 = 全选所有手牌，
    // 主按钮变「弃掉全部N张」作确认步（兼误触防护）；阶梯费照旧付一次。
    // 旧制为逐张多选，已随 D3 废除——诅咒/状态卡的卡手设计由此重新长牙）
    this._dumpMode = false;
    this._dumpSel = new Set();
    // ---- 战后奖励面板宿主----
    // 战斗结束后**不换舞台**：奖励 overlay 直接画在战斗舞台的 uiScene 上，背景仍是战斗房间；
    // 领取/跳过之后由 runController 在**切幕中点**把舞台换成塔楼层——这样"战斗房 → 塔楼"的
    // 场景切换被黑幕盖住（此前是战斗一结束就瞬切塔楼，奖励面板浮在塔楼前，节拍对不上）。
    this._panel = null;      // PanelObject（modal 形态：全屏背板 + 居中内容）
    this._snap = null;       // 当前快照（存在即"面板模态中"：吞掉一切指针）
    this._onIntent = null;   // 面板意图上行出口（runController 注入，与 MapStage 同契约）
    this._runSequencer = null;  // run 级动画队列（runController 后置注入：得卡演出指令化）
    this._grantBusy = false;    // 「择卡得卡」演出进行中：吞掉面板动作（见 _onPanelAction）
    // 全屏选卡界面（战后奖励的 Boss 删卡机会入口）：三舞台共用套件 stagePickerKit.js。
    // 战斗内的获得演出由 bridge 节拍驱动；**战后奖励期**的 run 级入账（Boss 掉落遗物）
    // 特写也走这里——reward 阶段活动舞台是战斗舞台（见 runController 的 panelStage 路由）。
    // ⚠ 必须在 `_bakeFace` 就位之后建（卡面烘焙是按值传的；旧实现漏传它 → 候选卡面隐身）。
    this._pickerKit = createStagePickerKit({
      uiScene: this.uiScene,
      getPicker: () => this.picker,
      bakeFace: this._bakeFace,
      bus: () => this._bus,
      onIntent: (a) => this._onIntent?.(a),
      getSequencer: () => this._runSequencer,
      getAnchor: () => this._deckAnchor(),
    });
    // 「结束回合」的**已点过**标记：动画积压期也允许点结束回合
    // （后端其实是同步结算完的，只是在放动画），点完立刻上灰，直到**下一回合开始**的
    // 快照落定才解锁——避免"动画没放完就点不动按钮，只能干等"。
    // 用户定 这枚标记同时是**手牌交互锁**——点击之后到下一回合快照落定之前，
    // 整手压灰、打牌/换卡全部关闭（后端早已推进到下一回合的 WAIT，不锁就能"抢着"打出
    // 下一回合的牌：结算没错，但画面还在放上一回合的动画，纯误操作）。
    this._endTurnRequested = false;
    this._endTurnLockKey = null; // 点击那一快照的回合 key（'player:N'）；解锁只认**新的玩家回合**

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
    // 资源消耗汇聚特效（fx/gpu/resourceDrainFx.js；池缺位时 null，调用点静默跳过）
    this._drainFx = createResourceDrainFx(this.particles2Ui, {
      manaPos: () => this._resources.mana.getWorldPosition(new THREE.Vector3()),
      apPos: () => this._resources.ap.getWorldPosition(new THREE.Vector3()),
    });
    this._applyAvatar(); // 立绘缓存可能已就绪（预取/上一场预热；未就绪则订阅回调 _applyUnitArt 补挂）

    // ====== 装配：总线订阅与键盘（frontendBus 全量节拍 / 素材回调 / Shift 监听，dispose 统一摘除） ======
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

  }

  // ========== reconcile：显示状态快照 → 场景对象 ==========

  // 焚烧帧驱动（onTick / 测试手动泵）：推进所有燃烧中的卡至燃尽
  _updateBurning(dt) {
    for (const object of this._burning) object.updateBurn(dt);
  }

  /** 得卡演出的收编锚点：牌库图标（飞行落点 z 取 40，与造牌入库的飞行约定一致）。 */
  _deckAnchor() { return { x: PILE_POSITIONS.deck.x, y: PILE_POSITIONS.deck.y, z: 40 }; }

  /** 快照下行：kind 变化才重建 PanelObject；未登记的 kind 收起面板。 */
  setPanel(snap) {
    const entry = snap && PANEL_BUILDERS[snap.kind];
    if (!entry) { this._removePanel(); return; }
    if (!this._panel || this._panel.kind !== snap.kind) {
      this._removePanel();
      this._panel = new PanelObject({
        form: entry.form,
        onIntent: (a, info) => this._onPanelAction(a, info),
        bakeFace: this._bakeFace,
      });
      this.uiScene.add(this._panel);
    }
    this._snap = snap;
    this._panel.attachPicker(this.picker);
    this._panel.setWidgets(snap.kind, entry.build(snap));
    // 模态吞点击是既定语义（拖牌/瞄准/战场点击全被面板截获）——常驻 HUD 按钮
    // （结束回合/弃牌）的视觉要同步压暗，否则全亮可点样式误导（夜测路4b 实报：
    // 奖励期点「结束回合」无任何反馈）。终局后无新 sync 覆盖，压暗保持到舞台拆除。
    for (const btn of Object.values(this._buttons)) btn?.setVisualState?.('disabled');
  }

  get panel() { return this._panel; }
  /** 面板按钮可用性查询（与 MapStage 同名：测试/宿主可读）。 */
  _buttonActionsOf(id) { return this._panel?._buttonActions?.get(id) ?? null; }

  _removePanel() {
    // 面板收起 = 全屏选卡界面也不该留在屏幕上；**只 close 不 dispose**（实例复用，
    // 与塔楼层/房间层同律）——真正释放交给 dispose() 里的 kit.dispose()。
    this._pickerKit?.cardPicker?.close();
    if (!this._panel) return;
    this.uiScene.remove(this._panel);
    this._panel.dispose();
    this._panel = null;
    this._snap = null;
  }

  _setDumpMode(on) {
    if (this._dumpMode === on || !this._snapshot) return;
    this._dumpMode = on;
    // D3 一键全弃：进模式即全选当前手牌——主按钮的「弃掉全部N张」
    // 是确认步（误触防护）；窗口中途手牌变动由快照对账摘除（见 syncSnapshot）。
    // 只选自由牌（激活咏唱不可弃）；迷你卡照常入选——迷你只管手牌
    // 计数（计 0 张容量），与弃牌无关（同日用户裁定解耦）
    if (on) for (const c of this._snapshot.hand ?? []) {
      if (!c.isActivated) this._dumpSel.add(c.uniqueID);
    }
    else this._dumpSel.clear();
    this._syncButtons(this._snapshot); // 激活态上按钮面
    this._layoutAndTrack();            // 手牌高亮态
    this._applyFlexGlows();            // 灵活卡金光（弃牌模式专属提示）
  }

  // 立牌纹理补挂：缓存命中才设置，未命中等共享缓存订阅回调统一补
  _applyUnitArtTo(obj) {
    const img = this._unitArt?.get(obj._defId, obj.side, obj.artVariant);
    if (img && !obj.hasArt) obj.setArt(img);
  }

  /** 换形态立绘（fx 剧本用：Boss 转阶段等）。变体没登记对应素材时静默保留本图。 */
  setUnitArtVariant(obj, variant) {
    if (!obj?.setArtVariant(variant)) return false;
    this._applyUnitArtTo(obj);
    return obj.hasArt;
  }

  /**
   * 大剑体系立绘对账：牌堆（手牌+牌库+焚毁）里斩链最高链位 →
   * 骑士带剑立绘档。斩只能由大剑遗物洗入/局内转化产生，故「牌堆有斩卡」即体系在场。
   * 场内只升不降（_swordArtRank latch）：斩转化在 pending 区的瞬间投影只剩 uniqueID
   * 没有 defId，直读会闪回低档；转化单向升阶，latch 语义与内容一致。
   */
  _syncPlayerSwordArt(proj) {
    const obj = this._units.get(proj.player?.uniqueID);
    if (!obj) return;
    const ids = [];
    for (const c of proj.hand ?? []) ids.push(c.defId);
    for (const c of proj.zones?.deck ?? []) ids.push(c.defId);
    for (const c of proj.zones?.burnt ?? []) ids.push(c.defId);
    const v = playerSwordVariant(ids);
    if (v !== null) {
      const rank = PLAYER_SWORD_TIERS.indexOf(v);
      if (rank > this._swordArtRank) this._swordArtRank = rank;
    }
    const use = this._swordArtRank >= 0 ? PLAYER_SWORD_TIERS[this._swordArtRank] : null;
    if ((obj.artVariant ?? null) !== use) this.setUnitArtVariant(obj, use);
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
      // 模态遮罩（池/牌库来源的发现类选卡）：压暗战场与手牌、只留候选阵与确认键——
      // 没有它时「候选直铺战场 + 打出的卡悬在中央发灰」读作界面坏了（2026-10-01 实报）。
      // 深度分层：手牌(~15)/按钮(0)/held 展示卡(60→临时压到 26) 在遮罩(28) 之下被压暗；
      // 候选(30) 与 HUD 确认键（_openPick 临时抬到 35）在其上。
      const bd = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD_HEIGHT * 1.2 * (16 / 9), WORLD_HEIGHT * 1.2),
        new THREE.MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
      );
      bd.name = 'pickBackdrop';
      bd.position.set(0, UI_CAMERA_LOOK_AT_Y, 28);
      this.uiScene.add(bd);
      pick.backdrop = bd;
      // 结算中的发动卡停在 held 展示位（z=60，盖过候选阵 z=30）——压到遮罩下
      // 同暗，关层时还原（用户 2026-10-02：「打出的卡牌在选卡发现层次上」）。
      // 此时到位于静息（到达补间已完、弹簧已 release），直写 z 无驱动方争抢。
      pick.lowered = [];
      for (const [cid, view] of this._views) {
        if (this.model.getZone(cid) === 'held' && view?.position) {
          pick.lowered.push([view, view.position.z]);
          view.position.z = 26;
        }
      }
      this._btnZ = { main: this._buttons.main.position.z, swap: this._buttons.swap.position.z };
      this._buttons.main.position.z = 35;
      this._buttons.swap.position.z = 35;
      const anchors = this._pickAnchors(ids.length);
      // 标题口径（2026-10-02 用户定：去冗余——不再写卡名+效果复述，一行道出数量）：
      // 「选择 N 张卡牌」（min=max）/「选择 N 到 M 张卡牌」（区间）。request.reason 被
      // 此口径取代——逐卡手写文案（「攻杀控火术：发现一张控火术」）是 UI 文字冗余。
      if (typeof document !== 'undefined' && anchors.length) {
        const lo = pick.min, hi = pick.max;
        const title = lo === hi ? `选择 ${lo} 张卡牌` : `选择 ${lo} 到 ${hi} 张卡牌`;
        const t = bakeBoldText(title, { fontPx: 17, tint: '#e8eefb' });
        const hint = new THREE.Mesh(
          new THREE.PlaneGeometry(t.width * PICK_HINT_SCALE, t.height * PICK_HINT_SCALE),
          new THREE.MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false, fog: false }),
        );
        hint.name = 'pickHint';
        const top = anchors[0];
        hint.position.set(0, top.y + CARD_HEIGHT * (top.scale ?? PICK_SCALE) * 0.5 + 6.5, 31);
        this.uiScene.add(hint);
        pick.hint = hint;
      }
      ids.forEach((uid, i) => {
        const cardProj = this._findCardProj(uid);
        if (!cardProj) return;
        const pickerId = `pick:${uid}`;
        const obj = new CardObject({
          uniqueID: pickerId, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
        });
        obj.setCard(cardProj);
        obj.setVisualState('normal');
        const a = anchors[i];
        obj.position.set(a.x, a.y, 30);
        obj.scale.set(a.scale ?? PICK_SCALE, a.scale ?? PICK_SCALE, 1);
        obj.visible = true;
        this.uiScene.add(obj);
        this.picker.addPickable(pickerId, obj, { kind: 'card', cardObject: obj, space: 'ui' });
        pick.temp.set(pickerId, { object: obj, uniqueID: uid, baseY: a.y, baseScale: a.scale ?? PICK_SCALE });
      });
    } else if (typeof document !== 'undefined') {
      // 手牌多选覆盖层（候选 = 手牌扇自身，无候选阵）：提示悬在手牌扇上方——
      // z 40 盖过悬浮抬升的手牌（静息 ≤15 / 抬升 ≤36），不与 instantiate 分支共用锚点
      const lo = pick.min, hi = pick.max;
      const title = lo === hi ? `选择 ${lo} 张卡牌` : `选择 ${lo} 到 ${hi} 张卡牌`;
      const t = bakeBoldText(title, { fontPx: 17, tint: '#e8eefb' });
      const hint = new THREE.Mesh(
        new THREE.PlaneGeometry(t.width * PICK_HINT_SCALE, t.height * PICK_HINT_SCALE),
        new THREE.MeshBasicMaterial({ map: t.texture, transparent: true, depthWrite: false, depthTest: false, fog: false }),
      );
      hint.name = 'pickHint';
      // y：候选网格最顶行上缘（yTop≈8 + 半卡高≈7）再留空——低会与卡阵叠字（glm 实测）
      hint.position.set(0, 30, 40);
      hint.renderOrder = 50;
      this.uiScene.add(hint);
      pick.hint = hint;
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
    if (this._pick.backdrop) {
      this.uiScene.remove(this._pick.backdrop);
      this._pick.backdrop.geometry.dispose();
      this._pick.backdrop.material.dispose();
    }
    if (this._pick.hint) {
      this.uiScene.remove(this._pick.hint);
      this._pick.hint.geometry.dispose();
      this._pick.hint.material.map?.dispose();
      this._pick.hint.material.dispose();
    }
    if (this._btnZ) {   // HUD 确认键归位（遮罩期临时抬高）
      this._buttons.main.position.z = this._btnZ.main;
      this._buttons.swap.position.z = this._btnZ.swap;
      this._btnZ = null;
    }
    if (this._pick.lowered) {   // held 展示卡归位（遮罩期临时压下）
      for (const [view, z] of this._pick.lowered) view.position.z = z;
    }
    this._pick = null;
  }

  /** 覆盖层网格锚点（卡牌空间，整体居中）。列数与缩放随张数自适应：
   *  张数多时（牌库来源常见 15~30 张）自动变多列、缩得更小，避免超出取景框。
   *  ⚠ 锚点必须带 z（=30，候选层深度，在遮罩 28 之上）与 rotation（=0）——手牌模式
   *  覆盖层的弹簧目标也吃这份锚点，而 HandSprings 驱动 x/y/z/scale/rotation 五通道：
   *  缺 z 或 rotation 会把 position.z / rotation.z 写成 undefined → 矩阵 NaN →
   *  射线拾取全灭（万变拳 S 阶实测病根；手牌多选覆盖层的历史潜伏 bug）。 */
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
      return { x: (c - (inRow - 1) / 2) * stepX, y: yTop - r * stepY, z: 30, rotation: 0, scale };
    });
  }

  /** 按 uniqueID 找投影里的卡视图（跨区查找：手牌/牌库/焚毁区；定义池候选回退到
   *  pendingInput.poolCards——source 'pool' 的发现类选卡，视图由投影层用一次性
   *  runtime 现烘，候选不在任何区） */
  _findCardProj(uniqueID) {
    const zones = this._snapshot?.zones ?? {};
    for (const list of Object.values(zones)) {
      const hit = (list ?? []).find(c => c.uniqueID === uniqueID);
      if (hit) return hit;
    }
    return (this._snapshot?.hand ?? []).find(c => c.uniqueID === uniqueID)
      ?? this._snapshot?.pendingInput?.poolCards?.[uniqueID]
      ?? null;
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
          // 守卫（onStage.has）已保证 id ∈ orderedHand（onStage 由它构建且不再变更）——
          // 旧三元式的 orderedChant 支不可达（且该名全库无定义，可达即抛错），已删。
          const idx = orderedHand.indexOf(id);
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
      } else if (this._dumpMode && zone === 'hand') {
        // 弃牌模式（D3 一键全弃）：进模式即全选 → 整手高亮；对账摘除的（已离手）回常态
        view.setVisualState(this._dumpSel.has(id) ? 'highlighted' : 'normal');
      } else if (this._endTurnRequested && zone === 'hand') {
        // 回合过渡锁（点了结束回合、下一回合快照未落）：整手压灰——锁定期打牌/换卡全关
        // （放在结算期分支之后：应答输入的候选高亮不受锁影响）
        view.setVisualState('disabled');
      } else if (zone === 'hand' && !pending) {
        view.setVisualState(this.bridge.intents.canPlayCard(id) ? 'normal' : 'disabled');
      } else {
        view.setVisualState('normal');
      }
    }
    // 选卡覆盖层的临时候选（instantiate 模式不在 _views）：选中态 = C0 高亮 + **放大
    // 抬升**（高亮单独太弱——均亮只 +11/255，像素差分实测读不出「哪张被选了」）；
    // 基准（baseY/baseScale）在 _openPick 建卡时记账，取消选中回基准
    if (this._pick) {
      for (const e of this._pick.temp.values()) {
        const sel = this._pick.selection.includes(e.uniqueID);
        e.object.setVisualState(sel ? 'highlighted' : 'normal');
        // gsapTween 口径：目标 = 物体根，scale 键是等比缩放、y 走 position（传子对象会被
        // 当成根再取 .position → undefined，补间静默失效——上面实测病灶）
        this._tweenFactory(e.object, {
          y: e.baseY + (sel ? 2.4 : 0),
          scale: e.baseScale * (sel ? 1.16 : 1.0),
        }, { durationMs: 160, ease: 'power2.out' });
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
    // 分发已表驱动（battleBeats.js 的 ANIM_BEATS）：加新演出去表里登记 + 宿主实现
    // _xxxBeat 方法，不在此插 if 分支；未登记类型走通用脉冲兜底。
    return dispatchAnimBeat(this, type, payload, finish);
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

  // 通用剧本节拍（fx 架构 ANIM_SCRIPT 闸口）：core 只报「剧本 id + 标量参数」，
  // 内容全在 fx/scripts/ 注册表。阻塞节拍——剧本跑完才 finish；未知 id 静默回落收拍
  // （观战端/旧档遇到新剧本 id 不炸队列，铁律同 hitFx 注册表）。
  _scriptBeat(payload, finish) {
    const fn = getScript(payload?.script);
    if (!fn) {
      console.warn(`[fx/scripts] 未知剧本（静默收拍）：${payload?.script}`);
      return finish();
    }
    const h = runScript(async (ctx) => {
      await fn({
        ctx,
        args: payload ?? {},
        ...this.fxServices(),
        scene: this.scene, uiScene: this.uiScene, // blocks.js 基础块组 deps 袋用
      });
    }, { animator: this.animator });
    this._fxScripts.add(h);
    h.promise.then(() => {
      this._fxScripts.delete(h);
      finish();
    });
  }

  // fx 服务门面：本舞台剧本 deps 袋的单一事实源——cutscene 'fx' step / 房间机器 /
  // _scriptBeat（展开补 ctx/args/scene/uiScene）共用同一袋。stage 不共存，
  // runController 按活舞台取。onStageDispose/runScript：常驻效果锚舞台寿命
  // （onKill 会误收；节拍收尾不杀）。
  fxServices() {
    return {
      cast: this._cast,
      particles: this.particles,
      shake: this.shake,
      vignette: this._vignette,
      camera: this._sm.cameraDirector,
      notify: this.notify,
      onStageDispose: (fn) => this.onFxDispose(fn),
      runScript: (body) => this._fxRunScript(body),
      unitById: (id) => this._units.get(id) ?? null,
      setArtVariant: (unit, v) => this.setUnitArtVariant(unit, v),
    };
  }

  /** 登记舞台寿命钩子（剧本常驻效果的收尾）；返回注销函数。dispose 统一回调。 */
  onFxDispose(fn) { this._fxDisposeHooks.add(fn); return () => this._fxDisposeHooks.delete(fn); }

  // 舞台寿命剧本：常驻渐升/常驻演出的锚——与节拍同池追踪（dispose 统一 kill），
  // 但寿命独立：节拍剧本收尾不会连带杀它（ctx.spawn 会，pyroP2 曾因此冻结渐升）。
  _fxRunScript(body) {
    const h = runScript(body, { animator: this.animator });
    this._fxScripts.add(h);
    h.promise.then(() => this._fxScripts.delete(h));
    return h;
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
  /**
   * 让某单位冒一个**对话/思索泡泡**（通用接口：位置 + 文本 + 持续时间 + 类型）。
   * 位置由单位锚定（头顶自动跟随），文本纯文本（自动折行，不做富文本）。
   * @param uniqueID 单位 uniqueID
   * @param data { text, kind:'speech'|'thought', duration, tint, dy }
   */
  say(uniqueID, { text = '', kind = 'speech', duration = 2.6, tint = null, dy = BUBBLE_HEAD_DY } = {}) {
    const unit = this._units.get(uniqueID);
    if (!unit) return null;
    const p = this._unitToUI(unit, 0, dy);
    return this._bubbles.say(uniqueID, { x: p.x, y: p.y, text, kind, duration, tint });
  }

  /** 已经开了泡泡的单位 id 列表（调试/测试）。 */
  get bubbleKeys() { return this._bubbles.keys; }

  /** 泡泡锚点跟随：单位在浮动/受击位移/入场时，泡泡始终挂在它头顶。 */
  _followBubbles() {
    for (const key of this._bubbles.keys) {
      const unit = this._units.get(key);
      if (!unit || unit.visible === false) continue;
      const p = this._unitToUI(unit, 0, BUBBLE_HEAD_DY);
      this._bubbles.moveTo(key, p.x, p.y);
    }
  }

  /** 手牌被上限挡下：整手牌红色脉冲 + 骑士头顶**思索泡泡**自语。 */
  _handPressureHint(text = HAND_FULL_LINE) {
    for (const view of this._views.values()) view.fx?.pulse?.({ color: 0xff3b30, durationMs: 520, scale: 1.03 });
    const proj = this._snapshot;
    if (!proj?.player) return;
    this.say(proj.player.uniqueID, { text, kind: 'thought', duration: 2.8, tint: 0xe8ecfa });
  }

  _pulseCard(id, color) {
    this._views.get(id)?.fx.pulse({ color }); // 特效层时间线，回程由每帧 updateFx 推进
  }

  // 牌库图标脉冲（库中卡冷却节拍的落点）。⚠ 反馈必须在 UI 空间：粒子层挂在世界场景，
  // 往 UI 坐标（80,-55）打粒子肉眼不可见——0.7.13「斩弃回牌库无特效」的真凶。
  // 故反馈 = 图标染色闪光（ZonePileObject.pulse）+ 缩放弹跳（动画器注册名 pile:deck）。
  _pulseDeckPile(color) {
    const pile = this._piles?.deck;
    if (!pile) return;
    pile.pulse(color);
    const s0 = pile.scale.x || 1;
    this.animator.animate('pile:deck', { scale: s0 * 1.3 }, {
      durationMs: 140,
      onComplete: () => this.animator.animate('pile:deck', { scale: s0 }, { durationMs: 200 }),
    });
  }

  /**
   * 卡牌**反应**节拍（公共动画：受益/副作用发动，core 原语 cardKit.reactFx）：
   * C0 体系 shader 配方（火脉/锻打淬火/气血/加固……，mode 由卡投影的体系×极性解析）
   * + 小放缩脉冲。shader 包络在 fx 层自续衰减，本节拍攻击+保持段落定即放行。
   * 手牌的缩放归弹簧层所有：先让 animator 接管放大（弹簧让位），播完交还弹簧
   * ——从放大位平滑弹回锚点，天然带一点回弹；展示/结算位的卡自己补间回原位。
   */
  _cardReactBeat(payload, finish) {
    const id = payload?.card?.uniqueID ?? payload?.uniqueID ?? null;
    const view = id != null ? this._views.get(id) : null;
    if (!view) return finish();
    const mode = cardReactMode(view._cardData, payload?.kind);
    view.fx.react({ mode, intensity: Math.min(1.4, 0.75 + (payload?.magnitude ?? 1) * 0.12) });
    const s0 = view.scale.x || 1;
    this.animator.animate(id, { scale: s0 * 1.12 }, {
      durationMs: 110,
      onComplete: () => {
        if (this.model.getZone(id) === 'hand') { finish(); return; } // 交还弹簧层（自动弹回）
        this.animator.animate(id, { scale: s0 }, { durationMs: 110, onComplete: finish });
      },
    });
  }

  /**
   * 咏唱**激活**节拍（数据驱动的卡体点亮演出）：发动点亮的咏唱卡在展示位播完自身
   * 演出后才回扇形。动画种类由卡自己决定（presenter 载荷 anim 描述符；core 在
   * def.activated.anim 缺省时给 { kind: 'pulse' }——"一般会实现为放缩"），数值
   * 缺省由本层补全（演出参数是表现层调参位，卡只声明它想覆盖的部分）。
   * 播完交回调用方放行回手（回扇形的位移与缩放回稳由入场跟踪/弹簧完成，
   * 同 _cardReactBeat 的交还惯例）。
   */
  _chantActivateBeat(id, anim, done) {
    const view = id != null ? this._views.get(id) : null;
    if (!view) { done(); return; }
    const kind = anim?.kind ?? 'pulse';
    if (kind !== 'pulse') { done(); return; } // 未知种类：未来扩展位，静默打节拍
    const upMs = anim.upMs ?? 150;
    const holdMs = anim.holdMs ?? 140;
    const s0 = view.scale.x || 1;
    view.fx.pulse({ // 卡面闪光与激活边缘流光同色系（点亮一体感）
      color: anim.color ?? 0xffe9a0, durationMs: upMs + holdMs + 200, scale: 1.5,
    });
    this.animator.animate(id, { scale: s0 * (anim.scale ?? 1.4) }, {
      durationMs: upMs,
      ease: 'back.out(1.8)',
      onComplete: () => {
        this.animator.animate(id, {}, { // 峰值停留（纯延迟 tween）
          delayMs: holdMs,
          onComplete: () => {
            if (this.model.getZone(id) === 'hand') { done(); return; } // 弹簧收养弹回
            this.animator.animate(id, { scale: s0 }, { durationMs: 140, onComplete: done });
          },
        });
      },
    });
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

  _bakeButtonFace(data) {
    // 浏览器：圆角风格化按钮（10px/wu ↔ 15x6 世界，与牌面同约定）；
    // 单测注入的 fake bakeLabel 直接透传
    if (typeof document === 'undefined') return this._bakeLabel(data.label);
    return bakeButtonFace(data, { width: BUTTON_SIZE.w * 10, height: BUTTON_SIZE.h * 10, scale: 3 });
  }

  // 悬停差分：指针压着的卡（手牌/咏唱/查看器画廊）喂通用 Shift 详情（setShiftHover，
  // 卡内与全局键态合成——2026-10-07 起详情面是 CardObject 级通用件，picker 等所有
  // owner 同款）。切换即差分（无全量重烘）。
  _refreshShiftFace() {
    const obj = this._overCardId != null
      ? (this._views.get(this._overCardId)
        ?? this._pick?.temp?.get(this._overCardId)?.object   // 选卡覆盖层候选（发现/万变拳——不在 _views）
        ?? (this._viewer.opened ? this._viewer.cardObj(this._overCardId) : null)
        ?? null)
      : null;
    if (this._altObj === obj) return;
    this._altObj?.setShiftHover(false);
    this._altObj = obj;
    this._altObj?.setShiftHover(true);
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
    // 面板（奖励三选一 overlay）与全屏选卡界面的候选卡不在卡组、未经预热，
    // 首拍常为无图占位——一并重烘（实报"选卡空白卡，手牌却有图"）
    this._panel?.rebakeCards?.();
    this._pickerKit?.rebakeCards?.();
  }

  // 渲染端支持的最大各向异性（假 renderer/无 WebGL 环境回退 1）
  _smMaxAnisotropy() {
    return this._sm?._renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  }

  dispose() {
    this._removePanel();
    this._pickerKit.dispose();   // 全屏选卡界面（_removePanel 只 close，真正释放在这里）
    this._disposed = true; // 幽灵守卫先行（退订前到达的排队事件也不再处理）
    for (const h of this._fxScripts) h.kill(); // 在途演出协程统一取消（结构化取消，promise 必达）
    this._fxScripts.clear();
    for (const auras of this._unitAuras.values()) auras.dispose(); // 常驻 aura 全瞬收
    this._unitAuras.clear();
    for (const fn of this._fxDisposeHooks) { try { fn(); } catch (_) {} } // 剧本常驻效果收尾
    this._fxDisposeHooks.clear();
    this._notifyHub.dispose();     // 道具在途行为补间收尾（先于 cast 清空）
    this._chantSceneFx.dispose();  // 咏唱场景演出收尾（mood/uTint 还原，发射器/环绕件收）
    this._cast.clear(); // 命名寻址随舞台销毁（下一场 beginBattle 重建）
    this._closeViewer();
    this._composer?.dispose();
    this._composer = null;
    this.particles2World?.dispose(); // 粒子池 v2（世界）
    this.particles2World = null;
    this.particles2Ui?.dispose(); // 粒子池 v2（UI 空间）
    this.particles2Ui = null;
    this._drainFx?.dispose(); // 汇聚特效跟随条目清空（池已 dispose，锚点随之失效）
    this._drainFx = null;
    this.composeScene = null;
    this.composeResize = null;
    this._unsubTick?.();
    this._unsubs.forEach(off => off?.());
    this._unsubs = [];
    this.springs.clear();
    this._arrow.dispose();
    this._bubbles.dispose();
    this._statusBar.dispose(); // 含晶粒排/金币/盾徽（随父级销毁）
    this._capacityBeads.dispose();
    this._topBar.dispose();
    this.shake.dispose();      // 撤掉震荡那路偏移通道（残留会把下一舞台的相机推歪）
    this._vignette.dispose();
    this._cleaveSplit.clear();
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

// 演出族方法（battleBeats/）以原型混入装配：节拍表经 stage._xxxBeat 分发到这里，
// this = BattleStage 实例（与类内方法同权访问宿主状态）。
Object.assign(BattleStage.prototype, unitBeats, cardBeats, inputBeats, syncBeats);

// 共享面板宿主（pickerKit 转发族 + 面板动作分流骨架）见 panelHost.js；本舞台只留
// setPanel/_removePanel（模态压暗 HUD、只 close cardPicker 是本地分叉）。
// 选卡来源只放 Boss 删卡机会一路（战后奖励的 cardRemoval；候选与意图由 kit 来源表给）。
installPanelHost(BattleStage, {
  localActions: {
    openUpgradePicker(a) { this.openUpgradePicker(a.source); },
  },
  allowSource: (s) => s === 'bossRemove',
});
