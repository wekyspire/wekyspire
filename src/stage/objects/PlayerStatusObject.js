// PlayerStatusObject：左下角玩家状态栏（战斗/地图共享）。布局：
//   ┌ 角色区（骑士徽章，概念图语言） ────┬────────────────────┐
//   │ 圆形头像 + 绿色环形血条            │  魏启水晶 + 大号数字 │
//   │ （心形+数字挂头像内左下；          │  AP 金币徽章 3/3    │
//   │  盾环随护盾显隐；右下角悬挂蓝盾    │                     │
//   │  护盾徽章，0 盾淡出）              │                     │
//   ├ 瑞米区（概念图新稿）              ┴────────────────────┤
//   │ 小圆头像（金环装饰）叠骑士左下；心形+当前血量挂头像内；  │
//   │ 右侧暗灰横幅：剑+攻击数 / 盾+每回合赋盾数               │
//   └───────────────────────────────────────────────────────┘
// 金币数值与遗物槽已拆至页面顶端居中的 TopResourceBarObject（本栏不再显示）。
// 骑士护盾 = 盾形徽章数字（ShieldBadgeObject）+ 蓝色盾环（均仅护盾存在时显示）。
// 血条走 RingGaugeObject（环绕头像、低量红脉冲、11点缺口 + 共边指针 + 尾端渐变）；
// 魏启水晶满/空与 AP 金币面用美术贴图（mana_crystal_*.png / ap_coin.png）；
// 盾徽与红心仍为程序化占位，美术资源到位后整体换贴图。
// 舞台只摆面板位置；数值经 setStatus/setPlayerHp/setPlayerShield/setRemi 注入，
// 帧过渡统一走 update(dt)。

import * as THREE from 'three';
import { RingGaugeObject } from './RingGaugeObject.js';
import { ShieldBadgeObject } from './ShieldBadgeObject.js';
import { ApCoinObject } from './ApCoinObject.js';
import { ManaCrystalObject } from './ManaCrystalObject.js';
import { bakeBoldText } from './textBakers.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

// ---- 尺寸与摆放 ----
// BASE_LAYOUT 是设计基准值；STATUS_SCALE 一处系数整体放大面板。内嵌的烘焙控件
// （资源点、血环数字、文本行）经 _ppw = 12/SCALE 透传，物理尺寸同步放大，
// 「面板变大」永远只调这一个数。
// 当前 1.8 = 旧 1.2 × 1.5：撤掉瑞米区后整体放大回填空出的左下空间（1920×1080 实测）；
// 瑞米区回归后维持 1.8（瑞米区占骑士头像下方空带，不挤右列）。
const STATUS_SCALE = 1.8;

// 状态层法则（与 UnitObject 的 statusify 同律）：整面板统一关深度测试/写入、
// 全件透明材质、renderOrder 归零（构造尾部 traverse 一把梭）——面板对内对外的
// 层级只认 uiCamera 正交 z 的 painter 序：件与件之间靠局部 z 错层（骑士
// 头像/血环栈 0.45~1.26——血环组 z=0.6，RingGauge 内件自带 +0.62/+0.66；
// 瑞米区整组抬 0.6、件 1.3~1.8 盖过血环栈；盾徽 z=2 全组最高，数字再 +0.5），面板
// 对外靠组 z 抬进手牌之上的层级（见 PLAYER_STATUS_POS 注释）。旧 per-part
// renderOrder（瑞米 10/11、盾徽 40/41）已废弃——renderOrder>0 会把部件钉在
// renderOrder-0 的悬浮手牌之上，破坏「面板压静息手牌、让位悬浮牌」的层级契约。
function statusifyPanel(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.renderOrder = 0;
    const m = o.material;
    if (!m) return;
    m.transparent = true;
    m.depthTest = false;
    m.depthWrite = false;
  });
}

const BASE_LAYOUT = Object.freeze({
  PANEL_W: 36,
  PANEL_H: 18.6,
  AVATAR_X: -11.6,       // 头像列中心（肖像放大后仍收在面板左半内）
  AVATAR_Y: 3.7,
  AVATAR_R: 4.55,        // 骑士肖像半径（新概念图：有限宽度内尽量大）
  GAUGE_T: 0.9,          // 主血环厚（绿）
  BORDER_T: 0.62,        // 盾环（蓝）厚
  BORDER_GAP: 0.22,      // 蓝环与血环外缘的间隙（内含白色发丝环）
  HEART_SIZE: 1.67,      // 心形边长（×1.2 基准=2.0 旧硬编码值；随面板缩放）
  SHIELD_W: 2.67,        // 盾徽宽（×1.2 基准=3.2 旧缺省值；悬挂尺寸随面板缩放）
  SHIELD_H: 3.08,        // 盾徽高（×1.2 基准=3.7）
  ROW_MANA_Y: 8.0,       // 魏启水晶行（概念图：水晶+大号浅蓝数字，AP 之上）
  ROW_AP_Y: 1.8,         // AP 金币行（行 y = 金币圆心）
  ROW_X: -5.4,           // 右列左锚点（局部坐标）
  COIN_R: 3.6,           // AP 金币半径（币面图案：旧 2.4 放大 50%；数字面片挂币心居中）
  CRYSTAL_H: 4.7,        // 魏启水晶图标高
  NUM_H: 5.6,            // 资源数字面片高（旧 2.8 放大一倍：魏启/AP 的当前/上限数字同为特大号）
  // 瑞米区（概念图新稿：比例按概念图量得——头像 ≈ 骑士六成、圆缘轻搭骑士外环）
  REMI_AVATAR_X: -14.2,  // 瑞米头像中心（骑士中心左下偏移，前层遮搭骑士外环下缘）
  REMI_AVATAR_Y: -3.1,
  REMI_AVATAR_R: 2.68,   // 瑞米肖像半径（≈ 骑士 AVATAR_R × 0.59）
  REMI_RING_T: 0.32,     // 金环厚（纯装饰：瑞米血量走心形数字，不走血环）
  REMI_HEART_SIZE: 1.05, // 瑞米心形边长（随骑士心形同语言缩小）
  REMI_BANNER_W: 9.6,    // 攻/盾横幅（概念图暗灰笔刷条：剑+数 / 盾+数）
  REMI_BANNER_H: 3.0,
  REMI_BANNER_X: 7.9,    // 横幅中心（相对瑞米组原点=头像中心）：头像右缘外一线
                         // = R 2.68 + 间隙 0.4 + 半宽 4.8；负值会把横幅推出面板左界
  REMI_BANNER_Y: -3.6,
});
export const PLAYER_STATUS_LAYOUT = Object.freeze(
  Object.fromEntries(Object.entries(BASE_LAYOUT).map(([k, v]) => [k, v * STATUS_SCALE])),
);

// 左下角贴边摆放：由 UI 正交视界推导（不再手写坐标魔法数）。
// uiCamera 视界垂直方向 = LOOK_AT_Y ± WORLD_HEIGHT/2，水平 ±halfW（项目固定 16:9）。
const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
const UI_BOTTOM = UI_CAMERA_LOOK_AT_Y - WORLD_HEIGHT / 2;
const EDGE_PAD = 0.8; // 贴边留一线缝
// uiScene 正交 z 层级表（世界单位，painter 序即层级）：咏唱槽 4+ / 静息手牌
// 10+n·0.5（n≤10 → ≤15）/ 状态栏 24（本面板，件内再 +0~2.5）/ 悬浮·瞄准牌
// 静息位 +20（liftZBoost）≈ 30.5+ / 瞄准箭头 45 / 牌库查看器 80 / 渐晕·冲击 490+。
// 状态栏卡在静息手牌与悬浮牌之间：任何非悬浮手牌盖不过面板，而悬浮（提拉
// z+20）/瞄准中的牌仍在面板之上——「面板在 non-hovered 手牌之上」由 z 层级
// 差天然实现（用户定）。
export const PLAYER_STATUS_POS = Object.freeze({
  x: -(HALF_UI_W - EDGE_PAD - PLAYER_STATUS_LAYOUT.PANEL_W / 2),
  y: UI_BOTTOM + EDGE_PAD + PLAYER_STATUS_LAYOUT.PANEL_H / 2,
  z: 24,
});

// 瑞米横幅展示数值（占位）：攻击 = 当前行为定义实际伤害（act 内硬编码，前端无定义级
// 面板字段可读）；盾 = 「每回合开始为自身+主角赋盾量」口径——行为逻辑尚未实装，0 占位。
// 后端把面板数值暴露到定义/投影后，改由调用方经 setRemi 注入，本常量即缺省值。
const REMI_PANEL = Object.freeze({ attack: 2, shield: 0 });

export class PlayerStatusObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: 文本烘焙（透传水晶/金币/盾徽/血量数字；缺省 1x1 占位）
   *   unitArt:   UnitArtCache 共享缓存（骑士/水晶/金币美术图源；缺省退化程序化占位）
   */
  constructor({ bakeLabel = null, unitArt = null } = {}) {
    super();
    const L = PLAYER_STATUS_LAYOUT;

    // 概念图语言：无底板外框——徽章/晶粒/金币直接浮在场景上（旧暗色底板已删）

    // ---- 角色区（骑士徽章）：头像 + 绿血环 + 盾环 + 心形血量 + 盾形护盾徽章 ----
    // 肖像黑底盘：概念图肖像内圈为纯黑；美术头像透明底（alpha=0），需不透明衬底
    // 托住头盔，否则透出场景暗部且随舞台变化
    this._avatarBack = new THREE.Mesh(
      new THREE.CircleGeometry(L.AVATAR_R, 40),
      new THREE.MeshBasicMaterial({ color: 0x07070a }),
    );
    this._avatarBack.name = 'avatarBack';
    this._avatarBack.position.set(L.AVATAR_X, L.AVATAR_Y, 0.45);
    this.add(this._avatarBack);

    this._avatarMaterial = new THREE.MeshBasicMaterial({ color: 0x232838, transparent: true });
    this._avatar = new THREE.Mesh(new THREE.CircleGeometry(L.AVATAR_R, 40), this._avatarMaterial);
    this._avatar.name = 'avatar';
    this._avatar.position.set(L.AVATAR_X, L.AVATAR_Y, 0.5);
    this.add(this._avatar);

    // 烘焙像素 → 世界单位换算密度：10px/wu @SCALE=1.2 基准（旧值），面板整体
    // 放大时文字/数字物理尺寸同步放大（血量数字、金币行等 ppw 换算路径全走这里；
    // 水晶/AP 数字面片高度由 NUM_H 布局值直接给定，同样随 SCALE 缩放）
    this._ppw = 12 / STATUS_SCALE;
    // 血环（概念图细节）：绿色充能弧 + 全带宽压暗量槽（未充能段）+ 缺口分离
    // （缺口中心 11 点方向）+ 弧末端共边三角指针 + 尾端亮度渐变（软分割）
    this.playerGauge = new RingGaugeObject({
      radius: L.AVATAR_R, thickness: L.GAUGE_T, showLabel: false, bakeLabel,
      trackColor: 0x1b4226, startAngleDeg: 120, seamGapDeg: 18,
      seamArrow: true, seamFadeDeg: 26,
    });
    this.playerGauge.name = 'playerGauge';
    this.playerGauge.position.set(L.AVATAR_X, L.AVATAR_Y, 0.6);
    this.add(this.playerGauge);

    // 盾环（概念图蓝外环）：护盾语义——仅护盾存在时淡入显示，0 盾淡出。
    // 与血环之间的间隙为透明留空（概念图纯白域 = 透明，无白色分隔环）
    this.playerBorder = new THREE.Mesh(
      new THREE.RingGeometry(
        L.AVATAR_R + L.GAUGE_T + L.BORDER_GAP,
        L.AVATAR_R + L.GAUGE_T + L.BORDER_GAP + L.BORDER_T, 48,
      ),
      new THREE.MeshBasicMaterial({ color: 0x5b9fe6, transparent: true, opacity: 0 }),
    );
    this.playerBorder.name = 'playerBorder';
    this.playerBorder.position.set(L.AVATAR_X, L.AVATAR_Y, 0.66);
    this.playerBorder.visible = false;
    this.add(this.playerBorder);
    this._borderOpacity = 0;
    this._borderTarget = 0;

    // 心形 + 血量数字：挂头像内左下（概念图位置；替代旧环下数字行）。
    // 暗色圆角衬底垫在心/字之下：骑士立绘肩部偏红，裸放红心会融进背景
    this._hpOverlay = new THREE.Group();
    this._hpOverlay.name = 'hpOverlay';
    this._hpOverlay.position.set(L.AVATAR_X - L.AVATAR_R * 0.72, L.AVATAR_Y - L.AVATAR_R * 0.42, 1.1);
    const heartBaked = typeof document !== 'undefined' ? bakeHeart(48) : null;
    this._heartMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    const heart = new THREE.Mesh(
      new THREE.PlaneGeometry(L.HEART_SIZE, L.HEART_SIZE), this._heartMaterial);
    heart.name = 'heart';
    heart.position.set(L.HEART_SIZE * 0.425, 0, 0.2);
    if (heartBaked) {
      this._heartMaterial.map = heartBaked;
      this._heartMaterial.color.set(0xffffff);
    } else {
      this._heartMaterial.color.set(0xe04343); // node 退化：红心色块
    }
    this._heartMaterial.needsUpdate = true;
    this._hpOverlay.add(heart);
    // 不加衬底：头像镜像后红围巾移到对侧，黑底上红心/白字天然可读（概念图同款）
    this._hpTextMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this._hpText = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._hpTextMaterial);
    this._hpText.name = 'hpText';
    this._hpText.position.z = 0.3;
    this._hpOverlay.add(this._hpText);
    this._hpSig = null;
    this.add(this._hpOverlay);

    // 盾形护盾徽章（头像右下角悬挂；0 盾淡出）。z 抬到全组最高（2）——悬挂处与
    // 血环/盾环重叠，徽章必须盖在环上（概念图层级；状态层法则下 z 差即层级差，
    // 数字面片在徽章内再 +0.5 盖住盾面）
    this.playerShieldBadge = new ShieldBadgeObject({
      bakeLabel, width: L.SHIELD_W, height: L.SHIELD_H,
    });
    this.playerShieldBadge.name = 'playerShieldBadge';
    this.playerShieldBadge.position.set(
      L.AVATAR_X + L.AVATAR_R * 0.78, L.AVATAR_Y - L.AVATAR_R * 0.72, 2,
    );
    this.add(this.playerShieldBadge);

    // ---- 瑞米区（概念图新稿）：小圆头像叠骑士左下 + 金环 + 心形血量 + 攻/盾横幅 ----
    // 金环为纯装饰（瑞米血量走心形当前值，不走血环）。圆缘遮搭骑士头像/外环，必须
    // 整区盖在其上：状态层法则下 z 差即层级差（见 statusifyPanel）。注意骑士血环
    // （RingGaugeObject）内件自带 +0.62/+0.66 偏移，面板内血环实际 z=1.22/1.26，
    // 故整组抬 z=0.6（各件面板 z 1.3~1.8）才压得住血环栈；仍低于盾徽 z=2，
    // 全组最高件 1.8 也不破坏面板对外「压静息手牌、让位悬浮牌」的 z 层级契约。
    // 未出战/被打跑整区隐藏（setRemi 驱动）。
    this._remi = new THREE.Group();
    this._remi.name = 'remi';
    this._remi.position.set(L.REMI_AVATAR_X, L.REMI_AVATAR_Y, 0.6);
    this._remi.visible = false;
    this._remiAvatarBack = new THREE.Mesh(
      new THREE.CircleGeometry(L.REMI_AVATAR_R, 40),
      new THREE.MeshBasicMaterial({ color: 0x07070a, transparent: true }),
    );
    this._remiAvatarBack.name = 'remiAvatarBack';
    this._remiAvatarBack.position.z = 0.7;
    this._remi.add(this._remiAvatarBack);

    this._remiAvatarMaterial = new THREE.MeshBasicMaterial({ color: 0x232838, transparent: true });
    this._remiAvatar = new THREE.Mesh(
      new THREE.CircleGeometry(L.REMI_AVATAR_R, 40), this._remiAvatarMaterial);
    this._remiAvatar.name = 'remiAvatar';
    this._remiAvatar.position.z = 0.75;
    this._remi.add(this._remiAvatar);

    this._remiRing = new THREE.Mesh(
      new THREE.RingGeometry(L.REMI_AVATAR_R, L.REMI_AVATAR_R + L.REMI_RING_T, 40),
      // transparent 必开：不透明件进 opaque 队列会被透明件整体盖住（z painter 序
      // 只在透明队列内生效）——瑞米区就压不到骑士之上了
      new THREE.MeshBasicMaterial({ color: 0xc9a13b, transparent: true }),
    );
    this._remiRing.name = 'remiRing';
    this._remiRing.position.z = 0.8;
    this._remi.add(this._remiRing);

    // 心形 + 当前血量数字（概念图口径：只显当前值，无 "/max"），成对水平居中挂头像下缘
    // （瑞米圆像小，骑士的左锚定式会让数字探出环外；居中挂放同概念图）
    this._remiHpOverlay = new THREE.Group();
    this._remiHpOverlay.position.set(0, -L.REMI_AVATAR_R * 0.45, 0.9);
    const remiHeartBaked = typeof document !== 'undefined' ? bakeHeart(48) : null;
    this._remiHeartMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    const remiHeart = new THREE.Mesh(
      new THREE.PlaneGeometry(L.REMI_HEART_SIZE, L.REMI_HEART_SIZE), this._remiHeartMaterial);
    if (remiHeartBaked) {
      this._remiHeartMaterial.map = remiHeartBaked;
      this._remiHeartMaterial.color.set(0xffffff);
    } else {
      this._remiHeartMaterial.color.set(0xe04343); // node 退化：红心色块
    }
    this._remiHeartMaterial.needsUpdate = true;
    this._remiHpOverlay.add(remiHeart);
    this._remiHpTextMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this._remiHpText = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._remiHpTextMaterial);
    this._remiHpText.name = 'remiHpText';
    this._remiHpText.position.z = 0.3;
    this._remiHpOverlay.add(this._remiHpText);
    this._remiHpSig = null;
    this._remi.add(this._remiHpOverlay);

    // 攻/盾横幅：整条（暗灰底 + 剑/盾图标 + 数字）单纹理烘焙，签名去抖重烘
    this._remiBannerMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    if (typeof document === 'undefined') this._remiBannerMaterial.color.set(0x333846); // node 退化
    this._remiBanner = new THREE.Mesh(
      new THREE.PlaneGeometry(L.REMI_BANNER_W, L.REMI_BANNER_H), this._remiBannerMaterial);
    this._remiBanner.name = 'remiBanner';
    this._remiBanner.position.set(L.REMI_BANNER_X, L.REMI_BANNER_Y, 0.7);
    this._remi.add(this._remiBanner);
    this._remiBannerSig = null;
    this.add(this._remi);

    // ---- 右列：魏启水晶徽章（单水晶+大号数字） / AP 金币徽章 ----
    // 美术图（满/空晶、金币笔刷面）经 unitArt 缓存取用；未就绪先程序化占位，
    // 缓存 onLoad 后统一补挂（订阅随面板 dispose 退订）
    this.manaCrystal = new ManaCrystalObject({
      bakeLabel,
      crystalHeight: L.CRYSTAL_H, numHeight: L.NUM_H,
      fullImage: unitArt?.getFile('mana_crystal_full.png') ?? null,
      emptyImage: unitArt?.getFile('mana_crystal_empty.png') ?? null,
    });
    this.apCoin = new ApCoinObject({
      bakeLabel, radius: L.COIN_R, numHeight: L.NUM_H,
      faceImage: unitArt?.getFile('ap_coin.png') ?? null,
    });
    this.manaCrystal.position.set(L.ROW_X, L.ROW_MANA_Y, 1);
    this.apCoin.position.set(L.ROW_X + L.COIN_R - 0.2, L.ROW_AP_Y, 1);
    this.add(this.manaCrystal, this.apCoin);
    if (unitArt?.addOnLoad) {
      this._unitArtUnsub = unitArt.addOnLoad(() => {
        this.manaCrystal.setCrystalImages({
          full: unitArt.getFile('mana_crystal_full.png'),
          empty: unitArt.getFile('mana_crystal_empty.png'),
        });
        this.apCoin.setFace(unitArt.getFile('ap_coin.png'));
      });
    }

    // 整面板套状态层法则（见 statusifyPanel 注释）
    statusifyPanel(this);

    // 血量数字 node 兜底烘焙（浏览器走 bakeBoldText）
    this._bake = bakeLabel || defaultInfoBake();
  }

  /** 帧推进：水晶/金币 + 角色血环 + 护盾徽章/盾环淡入淡出（两舞台 tick 各透传一次）。 */
  update(dt) {
    this.manaCrystal.update(dt);
    this.apCoin.update(dt);
    this.playerGauge.update(dt);
    this.playerShieldBadge.update(dt);
    // 盾环透明度向目标缓动，落 0 后整环隐藏
    const k = Math.min(1, dt * 8);
    this._borderOpacity += (this._borderTarget - this._borderOpacity) * k;
    if (Math.abs(this._borderTarget - this._borderOpacity) < 0.01) this._borderOpacity = this._borderTarget;
    this.playerBorder.material.opacity = this._borderOpacity;
    this.playerBorder.visible = this._borderOpacity > 0.01;
  }

  /** 角色血量（run 层快照或战斗投影都汇到这里）：血环比例 + 头像内左下心形数字。 */
  setPlayerHp(current, max) {
    this.playerGauge.setValue(current, max);
    const sig = `hp:${current}/${max}`;
    if (sig === this._hpSig) return;
    this._hpSig = sig;
    // 概念图粗体手写感数字：浏览器专用烘焙（白字+深描边）；node 走注入 baker
    const { texture, width, height } = typeof document !== 'undefined'
      ? bakeBoldText(`${current}/${max}`)
      : this._bake(`${current}/${max}`);
    const old = this._hpTextMaterial.map;
    this._hpTextMaterial.map = texture;
    this._hpTextMaterial.color.set(0xffffff);
    this._hpTextMaterial.needsUpdate = true;
    old?.dispose?.();
    const lw = width / this._ppw;
    const lh = height / this._ppw;
    this._hpText.geometry.dispose();
    this._hpText.geometry = new THREE.PlaneGeometry(lw, lh);
    this._hpText.position.set(PLAYER_STATUS_LAYOUT.HEART_SIZE + lw / 2, 0, 0.3); // 心形右侧（随面板缩放）
  }

  /** 角色护盾：盾形徽章数字 + 蓝色盾环淡入（均仅在护盾存在时显示）。 */
  setPlayerShield(shield) {
    this.playerShieldBadge.setValue(shield);
    this._borderTarget = shield > 0 ? 0.95 : 0;
  }

  /**
   * 瑞米区同步：{ present, hp, attack?, shield? }。present=false（被打跑/未出战）整区隐藏；
   * hp = 心形当前血量（概念图口径只显当前值）。attack/shield 缺省走 REMI_PANEL 展示常量
   * （盾 = 「每回合为自身+主角赋盾量」口径，非瑞米现有盾值；行为未实装前 0 占位）。
   */
  setRemi({ present = true, hp = null, attack = REMI_PANEL.attack, shield = REMI_PANEL.shield } = {}) {
    this._remi.visible = !!present;
    if (!present || hp == null) return;
    const hpSig = `${hp}`;
    if (hpSig !== this._remiHpSig) {
      this._remiHpSig = hpSig;
      // 与骑士血量数字同语言（白字深描边粗体）；瑞米区小一号
      const { texture, width, height } = typeof document !== 'undefined'
        ? bakeBoldText(hpSig, { fontPx: 12 })
        : this._bake(hpSig);
      const old = this._remiHpTextMaterial.map;
      this._remiHpTextMaterial.map = texture;
      this._remiHpTextMaterial.color.set(0xffffff);
      this._remiHpTextMaterial.needsUpdate = true;
      old?.dispose?.();
      const lw = width / this._ppw;
      const lh = height / this._ppw;
      this._remiHpText.geometry.dispose();
      this._remiHpText.geometry = new THREE.PlaneGeometry(lw, lh);
      // 心+数成对水平居中：按数字实宽反推两挂件的对称位置（数字位数变化自适应）
      const L = PLAYER_STATUS_LAYOUT;
      const total = L.REMI_HEART_SIZE * 1.15 + lw;
      this._remiHpOverlay.children[0].position.x = -total / 2 + L.REMI_HEART_SIZE / 2;
      this._remiHpText.position.x = total / 2 - lw / 2;
    }
    const bannerSig = `${attack}:${shield}`;
    if (bannerSig !== this._remiBannerSig) {
      this._remiBannerSig = bannerSig;
      const L = PLAYER_STATUS_LAYOUT;
      if (typeof document !== 'undefined') {
        const texture = bakeRemiStatsBanner(L.REMI_BANNER_W * this._ppw, L.REMI_BANNER_H * this._ppw, attack, shield);
        const old = this._remiBannerMaterial.map;
        this._remiBannerMaterial.map = texture;
        this._remiBannerMaterial.color.set(0xffffff);
        this._remiBannerMaterial.needsUpdate = true;
        old?.dispose?.();
      }
    }
  }

  /** 挂头像纹理：用 repeat/offset 从立绘裁出方形区域注入对应头像材质。
   * （CircleGeometry 的 UV 是单位圆外接正方形，等比裁切不变形。）
   * @param {HTMLImageElement} image
   * @param {{ crop?: 'top'|'full', mirror?: boolean }} opts  crop='top'（默认）取头顶部方形
   *   （竖版立绘）；'full' 取最大居中方（近方形肖像，如骑士徽章头像），整图入圆不放大；
   *   mirror=true 水平镜像取样窗口（骑士朝向对齐概念图）
   */
  setAvatar(image, { crop = 'top', mirror = false } = {}) {
    this._applyPortrait(this._avatarMaterial, image, { crop, mirror });
  }

  /** 瑞米头像补挂（remi_avatar.png 概念图圆像）：近方肖像整图入圆，素材已预翻转不再镜像。 */
  setRemiAvatar(image) {
    this._applyPortrait(this._remiAvatarMaterial, image, { crop: 'full' });
  }

  _applyPortrait(material, image, { crop = 'top', mirror = false } = {}) {
    if (!image?.width) return;
    const texture = crop === 'full' ? cropCenterSquare(image) : cropTopSquare(image);
    if (mirror) {
      // 取样窗口原地左右翻转：u=0 映射窗口右缘、u=1 映射左缘（窗口仍 ∈[0,1]，无需 wrap）
      texture.wrapS = THREE.RepeatWrapping;
      texture.repeat.x *= -1;
      texture.offset.x += Math.abs(texture.repeat.x);
    }
    const old = material.map;
    material.map = texture;
    material.color.set(0xffffff); // 占位色换真图
    material.needsUpdate = true;
    old?.dispose?.();
  }

  dispose() {
    this._unitArtUnsub?.();
    for (const mesh of [this._avatarBack, this._avatar, this.playerBorder,
      this._remiAvatarBack, this._remiAvatar, this._remiRing, this._remiBanner]) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose?.();
      mesh.material.dispose();
    }
    this.playerGauge.dispose();
    this.playerShieldBadge.dispose();
    this.apCoin.dispose();
    this.manaCrystal.dispose();
    this._heartMaterial.map?.dispose?.();
    this._heartMaterial.dispose();
    this._hpText.geometry.dispose();
    this._hpTextMaterial.map?.dispose?.();
    this._hpTextMaterial.dispose();
    this._remiHeartMaterial.map?.dispose?.();
    this._remiHeartMaterial.dispose();
    this._remiHpText.geometry.dispose();
    this._remiHpTextMaterial.map?.dispose?.();
    this._remiHpTextMaterial.dispose();
  }
}

// 头像裁切（crop='top'）：头顶部 ≈ 全图高 62% 的方形区域（水平居中、顶对齐，竖版立绘用）
function cropTopSquare(image) {
  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  const w = image.width;
  const h = image.height;
  let fracY = 0.62;
  let fracX = fracY * (h / w); // 方形裁切：repeat.x * w_px == repeat.y * h_px
  if (fracX > 1) { fracY /= fracX; fracX = 1; } // 图太宽时退化为整宽
  texture.repeat.set(fracX, fracY);
  texture.offset.set((1 - fracX) / 2, 1 - fracY); // flipY 下 offset.y 顶对齐
  return texture;
}

// 头像裁切（crop='full'）：最大居中方（短边满铺、长边居中裁）——近方形肖像
// （如骑士徽章头像）整图构图入圆，不放大不裁掉主体
function cropCenterSquare(image) {
  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  const w = image.width;
  const h = image.height;
  if (h <= w) { // 扁图/方图：整高，水平居中
    const fracX = h / w;
    texture.repeat.set(fracX, 1);
    texture.offset.set((1 - fracX) / 2, 0);
  } else { // 竖图：整宽，垂直居中
    const fracY = w / h;
    texture.repeat.set(1, fracY);
    texture.offset.set(0, (1 - fracY) / 2);
  }
  return texture;
}

// 血量数字的 node 兜底烘焙：1x1 占位
// （浏览器下两舞台均注入真 bakeLabel，此退化只保 node 单测可建）
function defaultInfoBake() {
  return () => {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture, width: 1, height: 1 };
  };
}

// 红心烘焙：双圆弧+下尖三角的经典心形（血量数字左侧）；美术资源到位后可换贴图
function bakeHeart(sizePx) {  const S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = sizePx * S;
  canvas.height = sizePx * S;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#e04343';
  ctx.strokeStyle = 'rgba(120, 12, 12, 0.8)';
  ctx.lineWidth = 1.6 * S;
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.92);
  ctx.bezierCurveTo(-w * 0.08, h * 0.55, w * 0.12, h * 0.06, w / 2, h * 0.3);
  ctx.bezierCurveTo(w * 0.88, h * 0.06, w * 1.08, h * 0.55, w / 2, h * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 左上高光点
  ctx.fillStyle = 'rgba(255, 210, 210, 0.85)';
  ctx.beginPath();
  ctx.arc(w * 0.32, h * 0.3, w * 0.07, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 粗体血量/盾值数字烘焙见 textBakers.js（两处共用同一语言）。
// 遗物槽烘焙随遗物行迁移至 TopResourceBarObject.js。

// 瑞米攻/盾横幅烘焙：整条单纹理（暗灰圆角底 + 剑图标+攻击数 / 盾图标+赋盾数），
// 概念图语言（白粗体数字深描边；剑灰刃红柄、盾蓝渐变——与 ShieldBadge 盾面同语）。
// wPx/hPx 为逻辑像素（×_ppw 换算自世界尺寸），内部 S=3 超采样。
function bakeRemiStatsBanner(wPx, hPx, attack, shield) {
  const S = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPx * S);
  canvas.height = Math.ceil(hPx * S);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  const W = wPx;
  const H = hPx;

  // 暗灰圆角底（概念图笔刷条的整版语言）
  const r = H * 0.3;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, H, r);
  ctx.arcTo(W, H, 0, H, r);
  ctx.arcTo(0, H, 0, 0, r);
  ctx.arcTo(0, 0, W, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#333846';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const midY = H * 0.52;
  drawSwordGlyph(ctx, W * 0.16, midY, H * 0.72);
  drawBannerNum(ctx, W * 0.36, midY, H * 0.6, attack);
  drawShieldGlyph(ctx, W * 0.62, midY, H * 0.68);
  drawBannerNum(ctx, W * 0.82, midY, H * 0.6, shield);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// 横幅数字：与 bakeBoldText 同语言（白粗体 + 深描边），居中锚点
function drawBannerNum(ctx, cx, cy, fontPx, value) {
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, fontPx * 0.2);
  ctx.strokeStyle = 'rgba(5, 7, 12, 0.85)';
  ctx.strokeText(String(value), cx, cy);
  ctx.fillStyle = '#f4f6fa';
  ctx.fillText(String(value), cx, cy);
}

// 剑图标（概念图：灰刃红柄，剑尖朝上）
function drawSwordGlyph(ctx, cx, cy, h) {
  const bw = h * 0.16;          // 刃宽
  const bladeTop = cy - h / 2;
  const guardY = cy + h * 0.18; // 护手位置（刃长约七成半）
  // 刃：尖三角 + 直段，浅灰渐变
  const grad = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
  grad.addColorStop(0, '#9aa0ac');
  grad.addColorStop(0.5, '#d7dbe2');
  grad.addColorStop(1, '#878d99');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, bladeTop);
  ctx.lineTo(cx + bw, bladeTop + h * 0.3);
  ctx.lineTo(cx + bw * 0.7, guardY);
  ctx.lineTo(cx - bw * 0.7, guardY);
  ctx.lineTo(cx - bw, bladeTop + h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 12, 18, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 护手横杆
  ctx.fillStyle = '#6d7380';
  ctx.fillRect(cx - h * 0.16, guardY, h * 0.32, h * 0.09);
  // 红柄（缠绳感：两道深色环）+ 圆首
  const gripW = h * 0.11;
  ctx.fillStyle = '#a03434';
  ctx.fillRect(cx - gripW / 2, guardY + h * 0.09, gripW, h * 0.22);
  ctx.fillStyle = 'rgba(60, 12, 12, 0.9)';
  ctx.fillRect(cx - gripW / 2, guardY + h * 0.15, gripW, h * 0.035);
  ctx.fillRect(cx - gripW / 2, guardY + h * 0.24, gripW, h * 0.035);
  ctx.beginPath();
  ctx.arc(cx, guardY + h * 0.34, gripW * 0.75, 0, Math.PI * 2);
  ctx.fillStyle = '#d7dbe2';
  ctx.fill();
}

// 盾图标（纹章盾形 + 蓝渐变，ShieldBadge 盾面同语缩小版）
function drawShieldGlyph(ctx, cx, cy, h) {
  const w = h * 0.82;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.1, y0 + h * 0.1);
  ctx.quadraticCurveTo(cx, y0 + h * 0.16, x0 + w * 0.9, y0 + h * 0.1);
  ctx.quadraticCurveTo(x0 + w * 0.94, y0 + h * 0.55, cx, y0 + h * 0.96);
  ctx.quadraticCurveTo(x0 + w * 0.06, y0 + h * 0.55, x0 + w * 0.1, y0 + h * 0.1);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
  grad.addColorStop(0, '#6fb0e8');
  grad.addColorStop(0.6, '#4a8ed8');
  grad.addColorStop(1, '#2f6cb4');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 26, 48, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
