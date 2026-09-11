// UnitObject（STAGE_DESIGN §3）：场景内的一个单位（玩家/敌人/队友）——2.5D 立牌。
// 结构：Group（位置/缩放由 BattleStage 按战线轴槽位设置，animator 补间作用于整组）
//   ├─ billboard: 立牌形 billboard 子组（faceCamera 逐帧 yaw 转向相机，立面保持垂直地面）
//   │   ├─ standee: 立牌子组（呼吸/受击等仿射只作用在这里）
//   │   │   └─ body: PlaneGeometry，**底部锚定**（position.y = h/2），纹理=抠图 PNG，
//   │   │            无图回退 side 配色色块
//   │   ├─ hpBar:   底槽 + 填充条（左锚定）+ 数字文本（"20/60"）
//   │   │   ├─ shieldGroup: 护盾层（shield>0 时可见）——蓝色保护框包裹血条
//   │   │   │  + 左侧盾徽数值 chip（数值变更时放缩跳动，牌库脉冲同语言）
//   │   │   └─ fxRows: 血条上方左对齐效果行（矢量图标 + 特征色名称 + 层数，
//   │   │      buff 层数绿 / debuff 层数红；行网格带 userData.token
//   │   │      （{ type:'effect', payload:{ effectId, name } }，与卡面热区同构），
//   │   │      Picker 二级查询返回 token 命中 → tooltip 协议与卡面热区同构）
//   │   └─ fxAnchor: 头侧效果图标锚点（overlay 后续批次，先留位）
//   └─ ring:    目标标注金环（平贴地板）
// 极简状态机（idle 呼吸 / hurt 抖动红闪 / dead 倒地）由 update(dt) + BattleStage 节拍驱动。
// 文本签名不变不重烘。
// 状态绘制（hpBar 全家 + 护盾层）一律 depthTest:false + 显式 renderOrder(60+)：
// 场景可遮蔽立牌（合理）但不可遮蔽状态（用户定）；卡牌 UI 是独立 pass 天然在其上。

import * as THREE from 'three';

const SIDE_COLORS = Object.freeze({
  player: 0x4a6fa5,
  enemy: 0xa54a4a,
  ally: 0x4aa56e,
});
const HP_FILL_COLORS = Object.freeze({
  player: 0x4ade80,
  ally: 0x4ade80,
  enemy: 0xe85a5a,
});

const HP_BAR_WIDTH = 12;
const HP_BAR_HEIGHT = 1.5;
const SHIELD_FRAME_PAD = 0.45;  // 保护框相对血条的外扩
const SHIELD_FRAME_COLOR = 0x5aa8ff;
const SHIELD_POP_DUR = 0.28;    // 数值变更放缩跳动时长（牌库脉冲同语言）
// 效果行（血条上方）：行距、背板横向外扩、背板颜色
const FX_ROW_GAP = 0.4;
const FX_ROW_PAD = 0.55;
const FX_ROW_BG = 0x0a0c14;
const FX_ICON_PX = 24;    // 效果图标烘焙逻辑边长（px；ppw=10 → 2.4wu，行高 2.8wu 内）
const FX_ICON_GAP = 0.35; // 图标与名称文本的间距（wu）
// 状态绘制（HP 条/护盾框/盾徽/数字）的 renderOrder 基值：场景(0)之上、粒子(70/71)之下；
// 卡牌等 UI 是独立 uiScene pass（清深度后渲染），天然在其上方
const STATUS_RENDER_ORDER = 60;
// 状态件"浮在场景上方"：关深度测试（不被柱子/地板/立牌遮挡），不写深度
// （不污染体积光 RT 深度），renderOrder 显式排层（depthTest 关闭后只能靠 painter 序）
function statusify(mesh, order) {
  mesh.renderOrder = STATUS_RENDER_ORDER + order;
  mesh.material.depthTest = false;
  mesh.material.depthWrite = false;
  return mesh;
}

export class UnitObject extends THREE.Group {
  /**
   * @param {object} options
   *   uniqueID, side: 'player'|'enemy'|'ally'
   *   standeeHeight: 立牌世界高度（scale=1 时，含体型系数，缺省 22）
   *   bakeLabel: (text) => { texture, width, height }   文本烘焙（缺省 1x1 占位）
   *   pixelsPerWorld: 烘焙像素 → 世界单位换算（默认 10，与牌面同约定）
   *   textureAnisotropy: 意图图标条烘焙的各向异性过滤强度（BattleStage 注入；缺省 0）
   */
  constructor(options) {
    super();
    const { uniqueID, side, standeeHeight = 22, bakeLabel = null, pixelsPerWorld = 10,
      textureAnisotropy = 0 } = options;
    this.uniqueID = uniqueID;
    this.side = side;
    this._bakeLabel = bakeLabel || defaultBakeLabel;
    this._ppw = pixelsPerWorld;
    this._anisotropy = textureAnisotropy;
    this._standeeHeight = standeeHeight;
    this._groundRadius = standeeHeight * 0.32; // 金环横向半径（setArt 后随牌面加宽）
    this._hasArt = false;
    this._shield = undefined; // undefined=尚未 setUnit（首帧不播跳动）

    // billboard 子组：standee/hpBar/fxAnchor 全部挂进来，faceCamera 逐帧水平转向相机
    // （立牌形/圆柱 billboard，只 yaw——斜视下立牌不转正会被透视压斜；
    // 立面保持垂直地面，球面 pitch 后仰已弃；金环贴地不参与）
    this._billboard = new THREE.Group();
    this._billboard.name = 'billboard';
    this._billboard.rotation.order = 'YXZ';
    this.add(this._billboard);

    // 立牌（底部锚定）：仿射动效只作用在 standee 子组
    this._standee = new THREE.Group();
    this._standee.name = 'standee';
    this._billboard.add(this._standee);
    const w0 = standeeHeight * 0.72;
    this._body = new THREE.Mesh(
      new THREE.PlaneGeometry(w0, standeeHeight),
      // 二值 mask（alphaTest discard），不做 semi-transparency：
      // 全透明像素也写深度会污染深度缓冲（体积光 RT 深度被立牌矩形截断、后方物体被误挡）
      new THREE.MeshBasicMaterial({ color: SIDE_COLORS[side] ?? 0x888888, alphaTest: 0.5, fog: false }),
    );
    this._body.name = 'body';
    this._body.position.y = standeeHeight / 2;
    // 立牌投影（用户定）：alphaTest 剪影在月光下拉出单位形地面影；
    // three 深度材质支持 map+alphaTest，透明区不会投出矩形假影
    this._body.castShadow = true;
    this._standee.add(this._body);

    // HP 条：底槽 + 左锚定填充 + 数字文本，叠在脚踝前方（脚底=地板，旧稿"站台下方"
    // 在真 3D 地板下会被地面裁掉，故上移叠腿前，z 微抬避免与立牌 z-fight）
    this._hpBar = new THREE.Group();
    this._hpBar.name = 'hpBar';
    this._hpBar.position.set(0, 3.4, 0.6);
    this._billboard.add(this._hpBar);
    this._hpBg = statusify(new THREE.Mesh(
      new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x14161e, transparent: true, opacity: 0.85, fog: false }),
    ), 1);
    this._hpBar.add(this._hpBg);
    this._hpFill = statusify(new THREE.Mesh(
      new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT - 0.4),
      new THREE.MeshBasicMaterial({ color: HP_FILL_COLORS[side] ?? 0x4ade80, fog: false }),
    ), 2);
    this._hpFill.position.z = 0.05;
    this._hpBar.add(this._hpFill);
    // 文本用真 alpha 混合而非 alphaTest 二值 mask：canvas 烘焙的 AA alpha 渐变被
    // 二值化丢弃会产生阶梯锯齿；状态层本就 depthTest/Write 关闭 + 显式 renderOrder
    // （painter 序确定），混合是安全的。standee 立牌在世界内吃深度，仍用 alphaTest
    this._labelMaterial = new THREE.MeshBasicMaterial({ transparent: true, fog: false });
    this._label = statusify(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._labelMaterial), 3);
    this._label.position.z = 0.05;
    this._hpBar.add(this._label);

    // ---- 护盾层（shield>0 可见）----
    // ① 蓝色保护框：微蓝背板 + 四细条边框包裹血条；② 左侧盾徽数值 chip
    this._shieldGroup = new THREE.Group();
    this._shieldGroup.name = 'shieldGroup';
    this._shieldGroup.visible = false;
    this._hpBar.add(this._shieldGroup);
    const fw = HP_BAR_WIDTH + SHIELD_FRAME_PAD * 2;
    const fh = HP_BAR_HEIGHT + SHIELD_FRAME_PAD * 2;
    const ft = 0.32; // 边框厚度
    this._shieldFrame = [];
    const frameMat = () => new THREE.MeshBasicMaterial({
      color: SHIELD_FRAME_COLOR, transparent: true, opacity: 0.95, depthWrite: false, fog: false,
    });
    const backfill = statusify(new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      new THREE.MeshBasicMaterial({ color: SHIELD_FRAME_COLOR, transparent: true, opacity: 0.16, depthWrite: false, fog: false }),
    ), 0);
    backfill.position.z = -0.02;
    this._shieldGroup.add(backfill);
    this._shieldFrame.push(backfill);
    const bars = [
      { w: fw, h: ft, x: 0, y: fh / 2 - ft / 2 },   // 上
      { w: fw, h: ft, x: 0, y: -(fh / 2 - ft / 2) }, // 下
      { w: ft, h: fh, x: -(fw / 2 - ft / 2), y: 0 }, // 左
      { w: ft, h: fh, x: fw / 2 - ft / 2, y: 0 },    // 右
    ];
    for (const b of bars) {
      const bar = statusify(new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), frameMat()), 2);
      bar.position.set(b.x, b.y, 0.03);
      this._shieldGroup.add(bar);
      this._shieldFrame.push(bar);
    }
    // 盾徽数值 chip（放缩跳动作用于整 chip，与牌库脉冲同语言）
    this._shieldChip = new THREE.Group();
    this._shieldChip.name = 'shieldChip';
    this._shieldChip.position.set(-(HP_BAR_WIDTH / 2 + 1.7), 0, 0.1);
    this._shieldGroup.add(this._shieldChip);
    this._shieldIconMaterial = new THREE.MeshBasicMaterial({ transparent: true, fog: false });
    this._shieldIconMaterial.map = shieldIconTexture();
    const icon = statusify(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), this._shieldIconMaterial), 3);
    this._shieldChip.add(icon);
    this._shieldLabelMaterial = new THREE.MeshBasicMaterial({ transparent: true, fog: false });
    this._shieldLabel = statusify(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._shieldLabelMaterial), 4);
    this._shieldChip.add(this._shieldLabel);
    this._shieldPopT = 0;

    // 效果行（血条上方左对齐纵列）：投影 effects 签名驱动重建
    this._fxRows = [];
    this._fxSig = null;

    // 效果图标锚点（overlay 后续批次）
    this.fxAnchor = new THREE.Object3D();
    this.fxAnchor.position.set(standeeHeight * 0.4, standeeHeight * 0.8, 0);
    this._billboard.add(this.fxAnchor);

    // 意图图标条（敌方专属）：头顶预告下一手——五基础意图（剑/盾/升/降/?）
    // 两两组合横排，仅攻击附 N×M 数字。呼吸浮动由 update 驱动（与 idle 呼吸
    // 同语言，死亡即停）。图标条带 userData.token（type:'intention'，与效果行/
    // 卡面热区同构的通用挂钩）——悬浮走 tooltip:* 协议释义；隐藏态由 Picker 的
    // 命中链可见性守卫兜底（raycast 不查 visible，守卫统一在拾取层）。
    this._intentionMaterial = new THREE.MeshBasicMaterial({ transparent: true, fog: false });
    this._intention = statusify(new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1), this._intentionMaterial), 7);
    this._intention.name = 'intention';
    this._intention.position.set(0, standeeHeight + INTENTION_LIFT + INTENTION_STRIP_H / 2, 0.4);
    this._intention.visible = false;
    this._billboard.add(this._intention);
    this._intentionSig = null;
    this._name = '';
    this._intentionT = Math.random() * Math.PI * 2;

    this._breathT = Math.random() * Math.PI * 2; // 相位随机，避免全场同步呼吸
    this._dead = false;
    this._signature = null;
    this._lightTint = new THREE.Color(0xffffff); // 场景灯光染色（sampleStandeeTint 逐帧供给）
    this._flashT = 0;                            // 受击闪红剩余窗口（染色不覆盖闪红）
  }

  /** 立牌纹理挂载（异步到图后调用）：替换占位色块，按图片纵横比重排平面。 */
  setArt(img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    const texture = new THREE.Texture(img);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    const old = this._body.material.map;
    this._body.material.map = texture;
    this._body.material.color.set(0xffffff);
    this._body.material.needsUpdate = true;
    old?.dispose?.();
    this._body.geometry.dispose();
    this._body.geometry = new THREE.PlaneGeometry(this._standeeHeight * aspect, this._standeeHeight);
    this._groundRadius = this._standeeHeight * aspect * 0.5;
    this._hasArt = true;
  }

  get hasArt() { return this._hasArt; }

  /** 死亡演出访问口：billboard（倾倒轴）/ body（焚毁载体）。 */
  get billboard() { return this._billboard; }
  get body() { return this._body; }

  /** 死亡演出前置：隐藏血条/护盾/效果行等状态绘制——尸体不再读数，焚毁只剩立牌。 */
  hideStatus() { this._hpBar.visible = false; }

  /** 单位投影更新：签名变化才重烘文本/重排血条。 */
  setUnit(projection) {
    this._name = projection.name ?? this._name; // 意图 tooltip 标题用
    const sig = JSON.stringify({
      hp: projection.hp, max: projection.maxHp,
      sh: projection.shield, dead: projection.isDead, ef: projection.effects,
    });
    this._syncIntention(projection.intention, projection.isDead);
    if (sig === this._signature) return false;
    this._signature = sig;
    this._dead = projection.isDead;

    // 数字文本：HP 比。效果有独立效果行（血条上方 fxRows），不再附文本后缀
    const text = `${projection.hp}/${projection.maxHp}`;
    const { texture, width, height } = this._bakeLabel(text);
    const old = this._labelMaterial.map;
    this._labelMaterial.map = texture;
    this._labelMaterial.needsUpdate = true;
    old?.dispose?.();
    const w = width / this._ppw;
    const h = height / this._ppw;
    this._label.geometry.dispose();
    this._label.geometry = new THREE.PlaneGeometry(w, h);
    this._label.position.y = Math.max(
      -(HP_BAR_HEIGHT / 2 + h / 2 + 0.5),
      h / 2 - 3.1, // 钳住不沉进地板（hpBar 在脚底上方 3.4，标签底至少离地 0.3）
    );

    // 护盾层：>0 可见；数值变更重烘 chip 文本 + 放缩跳动。
    // 破碎碎粒不在此检测——自然消失（回合开始清零）与被打破（伤害吸收）在此无法区分，
    // 碎粒由 BattleStage 的伤害节拍按 shieldAbsorbed 驱动；此处只负责随 sync 显隐
    const prev = this._shield;
    const sh = projection.shield ?? 0;
    this._shield = sh;
    this._shieldGroup.visible = sh > 0 && !projection.isDead;
    if (prev !== undefined && sh !== prev && sh > 0) this._shieldPopT = SHIELD_POP_DUR;
    if (sh > 0 && sh !== this._shieldBaked) {
      this._rebakeShieldLabel(sh);
      this._shieldBaked = sh; // 值不变不重烘（hp 变化也会过签名）
    }

    // 效果行（血条上方左对齐纵列）：签名驱动整列重建
    this._syncEffectRows(projection.effects ?? []);

    // 填充条：左锚定按比例缩短
    const ratio = projection.maxHp > 0 ? Math.max(0, projection.hp / projection.maxHp) : 0;
    this._hpFill.scale.x = Math.max(ratio, 0.001);
    this._hpFill.position.x = -HP_BAR_WIDTH / 2 + (HP_BAR_WIDTH * ratio) / 2;
    this._hpFill.material.color.set(
      projection.isDead ? 0x444444 : (HP_FILL_COLORS[this.side] ?? 0x4ade80));
    if (!this._hasArt) {
      this._body.material.color.set(
        projection.isDead ? 0x333333 : (SIDE_COLORS[this.side] ?? 0x888888));
    }
    return true;
  }

  /**
   * 意图图标条同步：{ kinds: ['attack'|'defend'|'buff'|'debuff'|'summon'|'stun'], hits?, damage? }，
   * kinds 最多两两组合（battle.md 意图分类）。仅攻击附数字文本（hits>1 显
   * 「N×M」，否则只显伤害值），其余种类纯图标；{ kinds:['unknown'] } 显「?」。
   * 签名驱动重烘，死亡/空意图即隐。
   * 可见图标条挂 userData.token（type:'intention'，payload 携带意图投影数据 +
   * 单位名）——Picker 悬浮二级查询走 tooltip 协议释义；隐藏态无需摘 token
   * （Picker 可见性守卫拦截）。
   */
  _syncIntention(intention, isDead) {
    const sig = intention && !isDead ? JSON.stringify(intention) : null;
    if (sig === this._intentionSig) return;
    this._intentionSig = sig;
    if (!sig) {
      this._intention.visible = false;
      return;
    }
    const { texture, width, height } = bakeIntentionStrip(intention, this._ppw, this._anisotropy);
    const old = this._intentionMaterial.map;
    this._intentionMaterial.map = texture;
    this._intentionMaterial.needsUpdate = true;
    old?.dispose?.();
    const w = width / this._ppw;
    const h = height / this._ppw;
    this._intention.geometry.dispose();
    this._intention.geometry = new THREE.PlaneGeometry(w, h);
    this._intention.visible = true;
    this._intention.userData.token = {
      type: 'intention',
      payload: { intention, unitName: this._name },
    };
  }

  /** 死亡演出前置：意图即隐（尸体不预告）——倒地节拍开头调用。 */
  hideIntention() {
    this._intentionSig = null;
    this._intention.visible = false;
  }

  /** 盾徽数值重烘：文本变才动（setUnit 签名已过滤）；左锚定接在盾徽右侧。 */
  _rebakeShieldLabel(sh) {
    const { texture, width, height } = this._bakeLabel(`${sh}`);
    const old = this._shieldLabelMaterial.map;
    this._shieldLabelMaterial.map = texture;
    this._shieldLabelMaterial.needsUpdate = true;
    old?.dispose?.();
    const w = width / this._ppw;
    const h = height / this._ppw;
    this._shieldLabel.geometry.dispose();
    this._shieldLabel.geometry = new THREE.PlaneGeometry(w, h);
    this._shieldLabel.position.set(1.1 + 0.35 + w / 2, 0, 0); // 盾徽右缘 + 间隙 + 半宽（左锚定）
  }

  /**
   * 效果行重建（签名驱动）：血条上方左对齐纵列，每行 = 暗背板 + 矢量图标网格 +
   * 烘焙文本（特征色名称 + 层数，buff 层数绿 / debuff 层数红）。
   * 图标不走文本烘焙——emoji 位图彩字经 mip 缩小采样发糊，改程序化矢量绘制
   * （bakeEffectGlyph，与意图条同语言）。
   * 行网格带 userData.token（{ type:'effect', payload:{ effectId, name } }，与卡面
   * hitRegion 同构；effectId 供 tooltip 按 id 反查，name 为未注册效果的兜底显示）
   * ——Picker 二级查询返回 token 命中，tooltip 走既有 tooltip:* 协议。
   */
  _syncEffectRows(effects) {
    const sig = JSON.stringify(effects);
    if (sig === this._fxSig) return;
    this._fxSig = sig;
    this._clearEffectRows();
    let y = HP_BAR_HEIGHT / 2 + FX_ROW_GAP; // 第一行背板底缘
    for (const e of effects) {
      const label = this._bakeLabel(effectRowMarkup(e));
      const icon = bakeEffectGlyph(e, this._ppw, this._anisotropy);
      const tw = label.width / this._ppw;
      const th = label.height / this._ppw;
      const iw = icon.width / this._ppw;
      const ih = icon.height / this._ppw;
      const bw = FX_ROW_PAD + iw + FX_ICON_GAP + tw + FX_ROW_PAD;
      const bh = Math.max(th, ih) + 0.5;
      const row = new THREE.Group();
      row.name = `fx:${e.effectId}`;
      const pick = { type: 'effect', payload: { effectId: e.effectId, name: e.name } };
      const bg = statusify(new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshBasicMaterial({ color: FX_ROW_BG, transparent: true, opacity: 0.62, depthWrite: false, fog: false }),
      ), 5);
      bg.userData.token = pick;
      const iconMesh = statusify(new THREE.Mesh(
        new THREE.PlaneGeometry(iw, ih),
        new THREE.MeshBasicMaterial({ map: icon.texture, transparent: true, fog: false }),
      ), 6);
      iconMesh.position.set(-bw / 2 + FX_ROW_PAD + iw / 2, 0, 0.02);
      iconMesh.userData.token = pick;
      const textMesh = statusify(new THREE.Mesh(
        new THREE.PlaneGeometry(tw, th),
        new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, fog: false }), // 真 alpha 混合保 AA（同主标签）
      ), 6);
      textMesh.position.set(-bw / 2 + FX_ROW_PAD + iw + FX_ICON_GAP + tw / 2, 0, 0.02);
      textMesh.userData.token = pick;
      row.add(bg, iconMesh, textMesh);
      // 左对齐：背板左缘对齐血条左缘；行自下而上堆叠（第一个效果最贴近血条）
      row.position.set(-HP_BAR_WIDTH / 2 + bw / 2, y + bh / 2, 0.1);
      this._hpBar.add(row);
      this._fxRows.push(row);
      y += bh + FX_ROW_GAP;
    }
  }

  _clearEffectRows() {
    for (const row of this._fxRows) {
      for (const mesh of row.children) {
        mesh.geometry.dispose();
        mesh.material.map?.dispose?.();
        mesh.material.dispose();
      }
      this._hpBar.remove(row);
    }
    this._fxRows = [];
  }

  /**
   * 立牌形（圆柱）billboard：只转 yaw 让牌面水平朝向相机，立面保持与地面垂直
   * （球面 billboard 的 pitch 后仰视觉上像"纸片倒下"，已弃——用户定）。
   * 相机静止时每帧结果相同，代价可忽略；金环贴地不参与。
   * @param {THREE.Vector3|{x,y,z}} camDir 相机方向向量
   */
  faceCamera(camDir) {
    this._billboard.rotation.y = Math.atan2(camDir.x, camDir.z);
  }

  /** 帧驱动：idle 呼吸（仅 scaleY 微振，死亡即停）+ 意图标签浮动 + 闪红窗口衰减 + 盾徽数值跳动衰减。 */
  update(dt) {
    if (this._flashT > 0) this._flashT -= dt;
    if (this._shieldPopT > 0) {
      this._shieldPopT -= dt;
      const k = Math.max(this._shieldPopT, 0) / SHIELD_POP_DUR; // 1→0 线性衰减
      const s = 1 + 0.45 * k;
      this._shieldChip.scale.set(s, s, 1);
    }
    if (this._intention.visible) {
      this._intentionT += dt * 2.0;
      const base = this._standeeHeight + INTENTION_LIFT + INTENTION_STRIP_H / 2;
      this._intention.position.y = base + 0.35 * Math.sin(this._intentionT);
    }
    if (this._dead) return;
    this._breathT += dt * 2.2;
    this._standee.scale.y = 1 + 0.02 * Math.sin(this._breathT);
  }

  /** 场景灯光染色（有立牌图才生效；闪红窗口内只记录不覆盖）。 */
  applyLightTint(color) {
    this._lightTint.copy(color);
    if (this._hasArt && this._flashT <= 0) this._body.material.color.copy(color);
  }

  flash(color = 0xff4444) {
    this._flashT = 0.28;
    this._body.material.color.set(color);
  }

  restoreColor() {
    this._flashT = 0;
    if (this._hasArt) this._body.material.color.copy(this._lightTint);
    else this._body.material.color.set(SIDE_COLORS[this.side] ?? 0x888888);
  }

  /** 目标标注高亮（拖牌指定目标时）：地面金环（平贴地板）。 */
  setHighlight(on) {
    if (on === !!this._ring) return;
    if (on) {
      this._ring = new THREE.Mesh(
        new THREE.CircleGeometry(1, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffd34c, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }),
      );
      const rx = this._groundRadius;
      this._ring.rotation.x = -Math.PI / 2;
      this._ring.position.y = 0.25;
      this._ring.scale.set(rx * 1.3, this._standeeHeight * 0.14, 1);
      this.add(this._ring);
    } else {
      this.remove(this._ring);
      this._ring.geometry.dispose();
      this._ring.material.dispose();
      this._ring = null;
    }
  }

  get highlighted() { return !!this._ring; }

  dispose() {
    this.setHighlight(false);
    this._clearEffectRows();
    this._body.geometry.dispose();
    this._body.material.map?.dispose?.();
    this._body.material.dispose();
    this._hpBg.geometry.dispose();
    this._hpBg.material.dispose();
    this._hpFill.geometry.dispose();
    this._hpFill.material.dispose();
    this._label.geometry.dispose();
    this._labelMaterial.map?.dispose?.();
    this._labelMaterial.dispose();
    for (const piece of this._shieldFrame) {
      piece.geometry.dispose();
      piece.material.dispose();
    }
    this._shieldIconMaterial.dispose(); // 图标纹理全局共享，不销毁
    this._shieldLabel.geometry.dispose();
    this._shieldLabelMaterial.map?.dispose?.();
    this._shieldLabelMaterial.dispose();
    this._intention.geometry.dispose();
    this._intentionMaterial.map?.dispose?.();
    this._intentionMaterial.dispose();
  }
}

// 盾徽纹理：全局共享一份（多单位复用），canvas 程序化绘制——圆顶尖底盾形 +
// 浅蓝描边 + 左上高光弧；非浏览器（单测）退化 1x1 占位。
// 画布 2× 超采样（坐标语言保持旧基准）：盾徽挂血条左端，屏上仅 ~20px 高，
// 直接 64px 光栅在斜视角下抗不住缩小采样。
let _shieldIconTexture = null;
function shieldIconTexture() {
  if (_shieldIconTexture) return _shieldIconTexture;
  if (typeof document === 'undefined') {
    _shieldIconTexture = new THREE.Texture({ width: 1, height: 1 });
    _shieldIconTexture.needsUpdate = true;
    return _shieldIconTexture;
  }
  const S = 2;
  const c = document.createElement('canvas');
  c.width = 64 * S;
  c.height = 70 * S;
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  // 盾形：圆顶 + 两侧弧收 + 尖底
  ctx.beginPath();
  ctx.moveTo(32, 5);
  ctx.quadraticCurveTo(46, 9, 56, 14);
  ctx.quadraticCurveTo(58, 44, 32, 66);
  ctx.quadraticCurveTo(6, 44, 8, 14);
  ctx.quadraticCurveTo(18, 9, 32, 5);
  ctx.closePath();
  ctx.fillStyle = '#3d7bd6';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#d6e8ff';
  ctx.stroke();
  // 左上高光弧（涂鸦感一笔）
  ctx.beginPath();
  ctx.moveTo(18, 16);
  ctx.quadraticCurveTo(26, 11, 36, 11);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(235,244,255,0.85)';
  ctx.lineCap = 'round';
  ctx.stroke();
  _shieldIconTexture = new THREE.Texture(c);
  _shieldIconTexture.needsUpdate = true;
  _shieldIconTexture.colorSpace = THREE.SRGBColorSpace;
  return _shieldIconTexture;
}

// ---- 意图图标条烘焙 ----
// 基础意图两两组合：攻（剑 + N×M 数字）/防（盾）/增强（升双箭头，绿）/
// 削弱（降双箭头，紫）/召唤（四芒星）/晕眩（螺旋，不行动）/未知（?）。
// 全程序化矢量绘制——emoji 位图字在缩小
// 采样下发糊且跨平台风格不可控，弃用；数字与 bakeBoldText 同语言（白粗体深描边）。
const INTENTION_STRIP_H = 6.8;   // 图标条世界高（wu）——放大一倍便于阅读（用户定）
const INTENTION_GAP = 0.55;      // 图标/数字间距（wu）
const INTENTION_LIFT = 0.9;      // 图标条底缘离头顶间隙（wu）：中心位 = 头顶 + 间隙 + 半高

function bakeIntentionStrip(intention, ppw, anisotropy = 0) {
  if (typeof document === 'undefined') return defaultBakeLabel();
  const kinds = (intention?.kinds?.length ? intention.kinds : ['unknown']).slice(0, 2);
  const H = INTENTION_STRIP_H * ppw; // 逻辑像素高
  const gap = INTENTION_GAP * ppw;
  const fontPx = H * 0.6; // 数字字号 = 图标高的 60%（图标不变，2026-08 用户定缩 25%）
  const attackText = kinds.includes('attack') && intention.damage != null
    ? `${intention.hits > 1 ? `${intention.hits}×` : ''}${intention.damage}`
    : null;
  // 先量宽再开正式画布（canvas 定宽后改尺寸会重置绘制状态）
  const mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `bold ${fontPx}px sans-serif`;
  const textW = attackText ? mctx.measureText(attackText).width : 0;
  const W = kinds.length * H + (kinds.length - 1) * gap + (attackText ? gap + textW : 0);

  const S = 4; // 超采样
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(W * S));
  canvas.height = Math.max(1, Math.ceil(H * S));
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  let x = 0;
  for (const k of kinds) {
    drawIntentionGlyph(ctx, k, x, 0, H);
    x += H + gap;
  }
  if (attackText) {
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, fontPx * 0.18);
    ctx.strokeStyle = 'rgba(5, 7, 12, 0.9)';
    ctx.strokeText(attackText, x, H * 0.55);
    ctx.fillStyle = '#ffe3e3';
    ctx.fillText(attackText, x, H * 0.55);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { texture, width: W, height: H };
}

// 单个意图图标（(x,y) 左上角，s 边长；线条语言：深描边 + 特征色）
function drawIntentionGlyph(ctx, kind, x, y, s) {
  switch (kind) {
    case 'attack': {
      // 剑：浅钢刃 + 暖护手（尖朝上，与状态面板剑图标同语言）
      const cx = x + s / 2;
      const bw = s * 0.14;
      const bladeTop = y + s * 0.04;
      const guardY = y + s * 0.72;
      const grad = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
      grad.addColorStop(0, '#9aa0ac');
      grad.addColorStop(0.5, '#dfe3ea');
      grad.addColorStop(1, '#878d99');
      ctx.beginPath();
      ctx.moveTo(cx, bladeTop);
      ctx.lineTo(cx + bw, bladeTop + s * 0.3);
      ctx.lineTo(cx + bw * 0.7, guardY);
      ctx.lineTo(cx - bw * 0.7, guardY);
      ctx.lineTo(cx - bw, bladeTop + s * 0.3);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, s * 0.035);
      ctx.strokeStyle = 'rgba(10, 12, 18, 0.75)';
      ctx.stroke();
      ctx.fillStyle = '#c9a13b';
      ctx.fillRect(cx - s * 0.17, guardY, s * 0.34, s * 0.1);
      ctx.fillStyle = '#a03434';
      ctx.fillRect(cx - s * 0.055, guardY + s * 0.1, s * 0.11, s * 0.18);
      break;
    }
    case 'defend': {
      // 盾（蓝渐变纹章盾，与盾徽/状态面板盾图标同语言）
      const w = s * 0.78;
      const x0 = x + (s - w) / 2;
      const y0 = y + s * 0.06;
      const h = s * 0.88;
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.1, y0 + h * 0.08);
      ctx.quadraticCurveTo(x0 + w / 2, y0 + h * 0.14, x0 + w * 0.9, y0 + h * 0.08);
      ctx.quadraticCurveTo(x0 + w * 0.94, y0 + h * 0.55, x0 + w / 2, y0 + h);
      ctx.quadraticCurveTo(x0 + w * 0.06, y0 + h * 0.55, x0 + w * 0.1, y0 + h * 0.08);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
      grad.addColorStop(0, '#6fb0e8');
      grad.addColorStop(0.6, '#4a8ed8');
      grad.addColorStop(1, '#2f6cb4');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = Math.max(1.4, s * 0.04);
      ctx.strokeStyle = 'rgba(10, 26, 48, 0.85)';
      ctx.stroke();
      break;
    }
    case 'buff': {
      // 增强：绿色升双箭头（雪佛龙 ×2）
      drawChevron(ctx, x, y, s, 0.16, '#5ecb6e', false);
      drawChevron(ctx, x, y, s, 0.52, '#5ecb6e', false);
      break;
    }
    case 'debuff': {
      // 削弱：紫色降双箭头
      drawChevron(ctx, x, y, s, 0.84, '#b26ee8', true);
      drawChevron(ctx, x, y, s, 0.48, '#b26ee8', true);
      break;
    }
    case 'summon': {
      // 召唤：青绿四芒星光（中心亮核，援助入场的通用符号）
      const cx = x + s / 2;
      const cy = y + s * 0.52;
      const R = s * 0.42;
      const r = s * 0.13;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 2;
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        const a2 = a + Math.PI / 4;
        ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#4cc9c0';
      ctx.fill();
      ctx.lineWidth = Math.max(1.4, s * 0.04);
      ctx.strokeStyle = 'rgba(8, 26, 24, 0.85)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = '#eafffb';
      ctx.fill();
      break;
    }
    case 'stun': {
      // 晕眩：灰黄螺旋（渐收的圈线——不动之相；被晕单位/发呆拍共用）
      const cx = x + s / 2;
      const cy = y + s * 0.52;
      const turns = 2.6;
      const steps = 42;
      for (const pass of [
        { w: Math.max(2.2, s * 0.085), color: 'rgba(10, 12, 18, 0.8)' },   // 深描边
        { w: Math.max(1.2, s * 0.05), color: '#d9c46a' },                  // 灰黄主线
      ]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const ang = t * turns * Math.PI * 2 - Math.PI / 2;
          const r = s * (0.42 - 0.34 * t);
          const px = cx + Math.cos(ang) * r;
          const py = cy + Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.lineWidth = pass.w;
        ctx.lineCap = 'round';
        ctx.strokeStyle = pass.color;
        ctx.stroke();
      }
      break;
    }
    default: {
      // 未知：白粗体 ?
      ctx.font = `bold ${s * 0.8}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, s * 0.09);
      ctx.strokeStyle = 'rgba(5, 7, 12, 0.9)';
      ctx.strokeText('?', x + s / 2, y + s * 0.55);
      ctx.fillStyle = '#e8ecf4';
      ctx.fillText('?', x + s / 2, y + s * 0.55);
    }
  }
}

// 双箭头单元：yAnchor 为箭头顶点行基线比例，down=true 朝下
function drawChevron(ctx, x, y, s, yAnchor, color, down) {
  const cx = x + s / 2;
  const cy = y + s * yAnchor;
  const half = s * 0.3;
  const thick = s * 0.11;
  const dir = down ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - dir * thick);
  ctx.lineTo(cx, cy + dir * (thick * 0.4));
  ctx.lineTo(cx + half, cy - dir * thick);
  ctx.lineTo(cx + half, cy - dir * thick + dir * thick * 1.4);
  ctx.lineTo(cx, cy + dir * (thick * 0.4) + dir * thick * 1.4);
  ctx.lineTo(cx - half, cy - dir * thick + dir * thick * 1.4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, s * 0.03);
  ctx.strokeStyle = 'rgba(10, 12, 18, 0.7)';
  ctx.stroke();
}

// 效果行 markup：特征色名称 + 层数（buff 绿 / debuff 红）。
// 颜色走 richtext 颜色名语法（/red{...}），效果定义的 color 字段即颜色名。
// 图标不进 markup——emoji 位图彩字在缩小采样下发糊，由 bakeEffectGlyph 画矢量图标
function effectRowMarkup(e) {
  const name = e.color ? `/${e.color}{${e.name}}` : `${e.name}`;
  const stackColor = e.type === 'debuff' ? 'red' : 'green';
  return `${name} /${stackColor}{ ${e.stacks}}`;
}

function defaultBakeLabel() {
  const texture = new THREE.Texture({ width: 1, height: 1 });
  texture.needsUpdate = true;
  return { texture, width: 1, height: 1 };
}

// ---- 效果行矢量图标 ----
// 意图条同语言：全程序化矢量绘制（深描边 + 特征色），emoji 位图彩字在
// billboard 的 mip 缩小采样下发糊且跨平台风格不可控，弃用。
// 24px 逻辑 × scale4 超采样烘焙，ppw 换算世界尺寸（2.4wu，行高 2.8wu 内）。
const FX_ICON_SCALE = 4;

function bakeEffectGlyph(effect, ppw, anisotropy = 0) {
  if (typeof document === 'undefined') return defaultBakeLabel(); // node 测试退化
  const canvas = document.createElement('canvas');
  canvas.width = FX_ICON_PX * FX_ICON_SCALE;
  canvas.height = FX_ICON_PX * FX_ICON_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(FX_ICON_SCALE, FX_ICON_SCALE);
  drawEffectGlyph(ctx, effect, 0, 0, FX_ICON_PX);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return { texture, width: FX_ICON_PX, height: FX_ICON_PX };
}

// 效果图标分派：按 effectId 取专属字形；未知效果回落「名称首字徽记」
function drawEffectGlyph(ctx, effect, x, y, s) {
  const painter = EFFECT_GLYPH_PAINTERS[effect?.effectId];
  if (painter) {
    painter(ctx, x, y, s);
    return;
  }
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16, 20, 32, 0.9)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, s * 0.06);
  ctx.strokeStyle = effect?.type === 'debuff' ? '#c86a8a' : '#6aa57a';
  ctx.stroke();
  ctx.font = `bold ${s * 0.44}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8ecf4';
  ctx.fillText((effect?.name ?? '?').slice(0, 1), cx, cy + s * 0.02);
}

const EFFECT_GLYPH_PAINTERS = {
  burn: drawFlameGlyph,
  block: (ctx, x, y, s) => drawIntentionGlyph(ctx, 'defend', x, y, s), // 格挡=盾，与防御意图同语言
  stall: drawHourglassGlyph,
  naqi: drawSpiralGlyph,
  thorns: drawThornRingGlyph,
  focus: drawBoltGlyph,
  weaken: drawDowntrendGlyph,
  regen: drawHeartGlyph,
};

// 燃烧：红橙渐变外焰 + 黄内焰（泪滴焰形）
function drawFlameGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s * 0.64;
  flamePath(ctx, cx, cy, s * 0.28, s * 0.06);
  const grad = ctx.createLinearGradient(0, y + s * 0.06, 0, cy + s * 0.28);
  grad.addColorStop(0, '#ffb84a');
  grad.addColorStop(0.55, '#ff6a3d');
  grad.addColorStop(1, '#d8341f');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, s * 0.05);
  ctx.strokeStyle = 'rgba(60, 14, 8, 0.8)';
  ctx.stroke();
  flamePath(ctx, cx, cy + s * 0.03, s * 0.15, s * 0.02);
  ctx.fillStyle = '#ffe08a';
  ctx.fill();
}

// 泪滴焰形：底部半圆 + 两侧贝塞尔收至顶尖（lean 为顶尖相对圆心的横偏）
function flamePath(ctx, cx, cy, r, lean) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI);
  ctx.bezierCurveTo(cx - r, cy - r * 1.5, cx + lean - r * 0.9, cy - r * 1.9, cx + lean, cy - r * 2.1);
  ctx.bezierCurveTo(cx + lean + r * 0.9, cy - r * 1.9, cx + r, cy - r * 1.5, cx + r, cy);
  ctx.closePath();
}

// 滞气：沙漏（停滞的时间）——灰蓝玻璃框 + 琥珀沙
function drawHourglassGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  const top = y + s * 0.16;
  const bot = y + s * 0.84;
  const half = s * 0.26;
  const mid = (top + bot) / 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, top);
  ctx.lineTo(cx + half, top);
  ctx.lineTo(cx + half * 0.12, mid);
  ctx.lineTo(cx + half, bot);
  ctx.lineTo(cx - half, bot);
  ctx.lineTo(cx - half * 0.12, mid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(150, 190, 230, 0.22)';
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, s * 0.05);
  ctx.strokeStyle = '#9aa8c0';
  ctx.stroke();
  ctx.fillStyle = '#e8c86a';
  ctx.beginPath(); // 上沙（将尽）
  ctx.moveTo(cx - half * 0.55, top + (bot - top) * 0.24);
  ctx.lineTo(cx + half * 0.55, top + (bot - top) * 0.24);
  ctx.lineTo(cx, mid - s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // 下沙堆
  ctx.moveTo(cx - half * 0.8, bot - s * 0.04);
  ctx.lineTo(cx + half * 0.8, bot - s * 0.04);
  ctx.quadraticCurveTo(cx, bot - s * 0.24, cx - half * 0.8, bot - s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7e8aa4'; // 上下帽
  ctx.fillRect(cx - half - s * 0.05, top - s * 0.09, (half + s * 0.05) * 2, s * 0.07);
  ctx.fillRect(cx - half - s * 0.05, bot + s * 0.02, (half + s * 0.05) * 2, s * 0.07);
}

// 纳气：向心螺旋（气流入罐）+ 中心气点
function drawSpiralGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = -Math.PI / 2 + t * 2.4 * Math.PI * 2;
    const r = s * 0.05 + t * s * 0.33;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineWidth = Math.max(1.6, s * 0.09);
  ctx.strokeStyle = '#6fb0e8';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.05, s * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = '#dfe9f7';
  ctx.fill();
}

// 荆棘：绿环外张尖刺 + 浅芯
function drawThornRingGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r0 = s * 0.26;
  const spike = s * 0.2;
  ctx.beginPath();
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const a1 = a - (Math.PI / N) * 0.5;
    const a2 = a + (Math.PI / N) * 0.5;
    ctx.moveTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r0 + spike), cy + Math.sin(a) * (r0 + spike));
    ctx.lineTo(cx + Math.cos(a2) * r0, cy + Math.sin(a2) * r0);
  }
  const grad = ctx.createLinearGradient(x, y, x + s, y + s);
  grad.addColorStop(0, '#5ecb6e');
  grad.addColorStop(1, '#2f7a44');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = 'rgba(10, 26, 16, 0.75)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r0 * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#a8e6b4';
  ctx.fill();
  ctx.stroke();
}

// 蓄势：金色闪电
function drawBoltGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.1, y + s * 0.04);
  ctx.lineTo(cx - s * 0.26, y + s * 0.55);
  ctx.lineTo(cx - s * 0.02, y + s * 0.55);
  ctx.lineTo(cx - s * 0.12, y + s * 0.96);
  ctx.lineTo(cx + s * 0.28, y + s * 0.42);
  ctx.lineTo(cx + s * 0.04, y + s * 0.42);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y, 0, y + s);
  grad.addColorStop(0, '#ffe07a');
  grad.addColorStop(1, '#e8a83c');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, s * 0.05);
  ctx.strokeStyle = 'rgba(56, 36, 6, 0.8)';
  ctx.stroke();
}

// 虚弱：紫色下行折线 + 箭头（「势衰」）
function drawDowntrendGlyph(ctx, x, y, s) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.14, y + s * 0.26);
  ctx.lineTo(x + s * 0.4, y + s * 0.5);
  ctx.lineTo(x + s * 0.56, y + s * 0.38);
  ctx.lineTo(x + s * 0.8, y + s * 0.64);
  ctx.lineWidth = Math.max(1.6, s * 0.1);
  ctx.strokeStyle = '#b26ee8';
  ctx.stroke();
  // 箭头：沿末段方向（(0.56,0.38)→(0.8,0.64)）
  const px = x + s * 0.8;
  const py = y + s * 0.64;
  const len = Math.hypot(0.24, 0.26);
  const ux = 0.24 / len;
  const uy = 0.26 / len;
  const w = s * 0.16;
  ctx.beginPath();
  ctx.moveTo(px + ux * w, py + uy * w);
  ctx.lineTo(px - uy * w * 0.6, py + ux * w * 0.6);
  ctx.lineTo(px + uy * w * 0.6, py - ux * w * 0.6);
  ctx.closePath();
  ctx.fillStyle = '#b26ee8';
  ctx.fill();
}

// 再生：绿心（愈合）
function drawHeartGlyph(ctx, x, y, s) {
  const cx = x + s / 2;
  ctx.beginPath();
  ctx.moveTo(cx, y + s * 0.84);
  ctx.bezierCurveTo(cx - s * 0.46, y + s * 0.52, cx - s * 0.38, y + s * 0.12, cx, y + s * 0.34);
  ctx.bezierCurveTo(cx + s * 0.38, y + s * 0.12, cx + s * 0.46, y + s * 0.52, cx, y + s * 0.84);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y + s * 0.1, 0, y + s * 0.85);
  grad.addColorStop(0, '#8ae696');
  grad.addColorStop(1, '#3aa45a');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, s * 0.05);
  ctx.strokeStyle = 'rgba(10, 30, 16, 0.8)';
  ctx.stroke();
  ctx.beginPath(); // 高光
  ctx.arc(cx - s * 0.13, y + s * 0.34, s * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fill();
}
