// 售货机 rig（用户定 2026-09-12）——把 `props/vendingMachine.js` 的可动件驱动起来，并按快照的
// **货架**在四个货位锚点上立起「商品 billboard」。反馈分层（沿用老虎机/银行机的原则）：
//   · 常驻：灯牌（marquee）缓慢呼吸 + 显示条微闪（读作"通着电的柜子"）
//   · hover：灯牌提亮（由交互层调用 setHover）；悬到某件货上 → 该件抬起 + 盘子亮一档
//   · **商品 billboard**（用户 2026-09-12 定的形态）：一张立在托盘上的卡片 = 遗物/药水的
//     美术图 + 名称 + **价格**；买得起时价格是金色、**买不起时价格是红色**（用户定）。
//     卡片每帧正对相机（billboard）；美术由 `art/goodsArt.js` 取（未解码完下一帧再烘）。
//   · **买到货**：柜门荡开 → 那件卡片掉向出货口 → 出货翻板弹一下 → 柜门合上 → 灯牌爆闪
//     （演出由"快照里那件变成 sold"触发，见 setStock——购买只发生在点击/面板里，场景侧只负责演）
//   · 买不起被点：盘子闪红 + 卡片左右摇头（deny）
// 纯 Stage 层：不读 Core/Bridge，输入只有"货架与买入结果"（调用方从快照拿）。

import * as THREE from 'three';
import { P, shade } from '../kit/index.js';
import { bakeBoldText } from '../../objects/textBakers.js';
import { goodsArtTexture } from '../../art/goodsArt.js';

// 货品种类 → 无美术时的占位色/字（与 shop.js 的 kind 口径一致：potion/apple/relic/pack）
const KIND_TINT = {
  potion: () => P.potionRed,
  apple: () => P.potionGreen,
  relic: () => P.potionBlue,
  pack: () => P.gold,
};
const KIND_GLYPH = { potion: '药', apple: '果', relic: '遗', pack: '包' };
const tintOfKind = (kind) => (KIND_TINT[kind] ?? (() => shade(P.wax, -0.1)))();

const DOOR_OPEN = 0.3;      // 柜门荡开/合上时长（秒）
const DROP_T = 0.42;        // 货物落下时长

// 商品卡（机器局部单位，机器再整体放大 2.2）。宽高比 = 烘焙画布 256×360。
const CARD = { w: 0.9, h: 1.2, gap: 0.06 };
const CARD_PX = { w: 256, h: 360 };

const PRICE_OK = '#ffd75e';      // 买得起：金
const PRICE_NO = '#ff6060';      // 买不起：红（用户定）

/** three 的调色板 token 是**数值** hex（`shade` 返回 number）——canvas 的 fillStyle 只吃字符串。 */
const cssHex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/** 圆角矩形路径（无 roundRect 依赖：headless 版 Chromium 不一定有）。 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 单行文本，超宽自动降字号（价格/名称都不许溢出货盘）。 */
function fitText(ctx, text, { fontPx, maxW, weight = 'bold' }) {
  let px = fontPx;
  ctx.font = `${weight} ${px}px sans-serif`;
  while (px > 10 && ctx.measureText(text).width > maxW) {
    px -= 1;
    ctx.font = `${weight} ${px}px sans-serif`;
  }
  return px;
}

/**
 * 烘一张商品卡：商品图（或占位色块）+ 名称 + 价格。
 * ⚠ **不加底板、不加边框**（用户定 2026-09-12）：美术素材自带 alpha，售货机柜内色彩干净、
 * 没有可辨认性问题——加一层深色货盘/描边只会把"立在货架上的实物"读成一张 UI 卡片。
 * 文字直接浮在图下方（黑描边保证在亮柜内也读得清）。
 * @returns {{texture, canvas}|null} 无 document（node/headless）→ null
 */
function bakeCard(item, artTex) {
  if (typeof document === 'undefined') return null;
  const { w: W, h: H } = CARD_PX;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const afford = item.affordable !== false;
  // ① 商品图（有美术用美术；没有就色块 + 一个字，占位阶段也读得出是什么）
  const AX = 10, AY = 8, AW = W - 20, AH = 186;
  const img = artTex?.image ?? null;
  if (img) {
    const k = Math.min(AW / img.width, AH / img.height);
    const dw = img.width * k, dh = img.height * k;
    ctx.drawImage(img, AX + (AW - dw) / 2, AY + (AH - dh) / 2, dw, dh);
  } else {
    roundRect(ctx, AX + AW * 0.22, AY + 10, AW * 0.56, AH - 20, 12);
    ctx.fillStyle = cssHex(shade(tintOfKind(item.kind), -0.05));
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const g = KIND_GLYPH[item.kind] ?? '物';
    fitText(ctx, g, { fontPx: 72, maxW: AW * 0.5 });
    ctx.strokeText(g, W / 2, AY + AH / 2);
    ctx.fillText(g, W / 2, AY + AH / 2);
  }
  // ② 名称（白字黑边；太长就缩字号）
  const name = item.name ?? item.label ?? '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 5;
  ctx.fillStyle = '#ffffff';
  fitText(ctx, name, { fontPx: 30, maxW: W - 30 });
  ctx.strokeText(name, W / 2, 224);
  ctx.fillText(name, W / 2, 224);
  // ③ 价格（**买不起 = 红字**已经说清"钱不够"，不另加「金币不足」小字——用户定 2026-09-13）
  const price = `${item.price} 金`;
  fitText(ctx, price, { fontPx: 54, maxW: W - 30 });
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.strokeText(price, W / 2, 296);
  ctx.fillStyle = afford ? PRICE_OK : PRICE_NO;
  ctx.fillText(price, W / 2, 296);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, canvas };
}

export function createVendingMachineRig({
  object, parts, seed = 'vending', art = goodsArtTexture, onDispensed = null,
} = {}) {
  const body = parts?.body ?? object;
  const door = parts?.doorPivot ?? null;
  const slots = parts?.slots ?? [];
  const flap = parts?.flap ?? null;
  const marquee = parts?.marquee ?? null;
  const display = parts?.display ?? null;

  // 逐帧改色的件由 rig 持独立材质（资产禁自建材质是契约）
  if (marquee) marquee.material = new THREE.MeshBasicMaterial({ color: shade(P.wax, 0.35) });
  if (display) display.material = new THREE.MeshBasicMaterial({ color: shade(P.wax, 0.2) });
  const flapBaseZ = flap?.position.z ?? 0;
  const marqueeBase = marquee ? new THREE.Color(shade(P.wax, 0.35)) : null;

  const st = {
    t: 0,
    phase: Math.random() * 10,
    capacity: slots.length,   // 一台能装几件（宿主据此切片货架）
    hover: 0,
    focus: 0,
    stock: [],        // 上一次的库存（{ index, kind, sold }）——用于检测"刚卖掉"
    seq: null,        // 出货演出时序 { steps, i, t, index }
    flash: 0,         // 灯牌爆闪衰减
    displayText: '',
    hoverGoods: null, // 悬停的货位 index
    deny: 0,          // 买不起被点的摇头衰减
    focused: false,   // 相机怼脸中（商品 hover 说明的门禁：未怼脸时商品完全不可交互）
  };

  // ---- 显示条：烘字（余额），与银行机同一套（bakeBoldText 小字号 + 描边） ----
  function bakeDisplay(text) {
    if (!display || typeof document === 'undefined') return;
    const out = bakeBoldText(text || '', { fontPx: 26, tint: '#f4f8ff', stroke: 'rgba(6,10,16,0.85)' });
    display.material.map?.dispose?.();
    display.material.map = out.texture;
    display.material.needsUpdate = true;
  }
  /** 显示条文本（宿主给，如"余额 30"）。 */
  function setDisplay(text) {
    if (text === st.displayText) return false;
    st.displayText = text ?? '';
    bakeDisplay(st.displayText);
    return true;
  }

  // ---- 商品卡（billboard）：一件货 = 锚点上一张立卡（**按槽位顺序**认领，见 setStock） ----
  const goods = new Map();   // 槽位下标 -> tile（tile.index = **全局货架下标**，拾取/购买都用它）

  /** 取/建某个槽位的卡片（`index` 是这件货在整层货架上的全局下标）。 */
  function ensureTile(slotPos, slotDef) {
    let tile = goods.get(slotPos);
    if (tile) return tile;
    const root = new THREE.Group();
    root.position.set(0, CARD.h / 2 + CARD.gap, 0);   // 立在托盘上表面之上
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD.w, CARD.h), mat);
    root.add(mesh);
    slotDef.anchor.add(root);
    tile = {
      slot: slotPos, index: -1, root, mesh, mat, anchor: slotDef.anchor,
      item: null, texKey: '', texture: null, baseY: root.position.y,
    };
    goods.set(slotPos, tile);
    return tile;
  }

  /** 烘/换这张卡的贴图（状态键变了或美术刚到才重烘）。 */
  function refreshTile(tile) {
    const it = tile.item;
    if (!it) return;
    // 遗物立绘的 key = **遗物显示名**（与 art/relicArt.js 的约定一致）；其余按 kind 查道具/物品图
    const artKey = it.kind === 'relic' ? (it.name ?? '') : artKeyOfKind(it);
    const artTex = artKey ? art(artKey) : null;
    const key = `${it.kind}|${artKey}|${it.price}|${it.affordable !== false}|${artTex ? artTex.uuid : 'noart'}`;
    if (key === tile.texKey) return;
    const baked = bakeCard(it, artTex);
    tile.texKey = key;
    if (!baked) return;                                // node/headless：只有几何，不烘字
    tile.mat.map?.dispose?.();
    tile.texture?.dispose?.();
    tile.texture = baked.texture;
    tile.mat.map = baked.texture;
    tile.mat.needsUpdate = true;
  }

  /** 商品卡的取图 key：遗物走遗物立绘（名字即 key），其余走道具/物品图。 */
  const artKeyOfKind = (it) => ({
    potion: 'potion', apple: 'apple', pack: 'pack',
  }[it.kind] ?? '');

  function disposeTile(tile) {
    tile.root.removeFromParent();
    tile.mesh.geometry.dispose();
    tile.mat.map?.dispose?.();
    tile.texture?.dispose?.();
    tile.mat.dispose();
    goods.delete(tile.slot);
  }

  const _q = new THREE.Quaternion();

  /** token 门禁：只在怼脸（聚焦）时把 hover 说明挂到卡片根上（Picker 的 tooltip 来源）。 */
  function applyTokenGate(tile) {
    tile.root.userData.token = st.focused ? (tile.token ?? null) : null;
  }

  /**
   * 库存下行：`items = [{ index, kind, name, price, sold, affordable, relicId }]`——**按顺序**领货
   * （items[0] 放第 0 格、items[1] 放第 1 格…）：调用方给的是本机的**切片**，全局下标在 `index` 里，
   * 卡片/拾取/购买都用它（一台装不下时第二台机器拿的是 items[4..]，不能按下标匹配）。
   * **检测刚卖掉的格子并播出货演出**——购买只发生在点击/面板里，场景侧只负责演。
   */
  function setStock(items = []) {
    const prev = st.stock;   // 上一次**逐槽位**的库存（数组，与 slots 同序）
    for (let s = 0; s < slots.length; s++) {
      const slotDef = slots[s];
      const it = items[s] ?? null;
      const was = prev[s] ?? null;
      if (!it || it.sold) {
        const tile = goods.get(s);
        if (tile) {
          // 刚卖掉 → 演出（演出期间卡片由动画接管，见 _playDispense）；本来就是空的 → 直接收掉
          if (was && !was.sold && it?.sold) { tile.index = it.index; tile.item = it; _playDispense(tile); }
          else { disposeTile(tile); }
        }
        continue;
      }
      const tile = ensureTile(s, slotDef);
      tile.index = it.index;
      tile.item = it;
      // hover 说明：遗物货走遗物效果预览（与面板遗物行同一挂钩）；药水/苹果/卡包走
      // core 算好的 `tip` 文本（无卡面/立绘的东西必须有说明——用户定 2026-09-12）。
      // token 是**怼脸专属**（用户定 2026-09-13）：未 zoom-in 时商品完全不可交互，
      // 远景就弹 tooltip 会让人觉得"现在就能买"，与"先推近看货、再点选购买"的节奏矛盾。
      // 逻辑 token 存 tile.token，userData 由 applyTokenGate 按焦点门控写入。
      tile.token = it.relicId
        ? { type: 'relic', payload: { relicId: it.relicId } }
        : (it.tip ? { type: 'item', payload: it.tip } : null);
      applyTokenGate(tile);
      tile.root.visible = !st.seq || st.seq.index !== tile.index;
      refreshTile(tile);
    }
    st.stock = slots.map((_, s) => {
      const it = items[s];
      return it ? { index: it.index, kind: it.kind, sold: !!it.sold } : null;
    });
    return true;
  }

  // ---- 出货演出：门开 → 货掉落 → 翻板弹 → 门合 → 灯牌爆闪（结束时回执宿主） ----
  let _lastDispensed = -1;

  function _playDispense(tile) {
    const y0 = tile.baseY;
    const yEnd = y0 - 2.4;                       // 掉到出货口一带
    _lastDispensed = tile.index;
    st.seq = {
      index: tile.index, i: 0, t: 0,
      steps: [
        { dur: DOOR_OPEN, fn: (k) => { if (door) door.rotation.y = -0.95 * k; } },
        { dur: DROP_T, fn: (k) => {
          tile.root.visible = true;
          tile.root.position.y = y0 + (yEnd - y0) * k;
          tile.root.scale.setScalar(1 - 0.5 * k);
        } },
        { dur: 0.18, fn: () => { if (flap) flap.position.z = flapBaseZ + 0.22; st.flash = 1; } },
        { dur: 0.22, fn: (k) => { if (flap) flap.position.z = flapBaseZ + 0.22 * (1 - k); } },
        { dur: DOOR_OPEN, fn: (k) => { if (door) door.rotation.y = -0.95 * (1 - k); } },
        { dur: 0.1, fn: () => { disposeTile(tile); } },
      ],
    };
  }

  /** 推进出货时序；返回"本轮是否刚刚播完"（宿主据此回执 → 播获得演出）。 */
  function stepSeq(dt) {
    const q = st.seq;
    if (!q) return false;
    q.t += dt;
    const step = q.steps[q.i];
    const k = step.dur > 0 ? Math.min(1, q.t / step.dur) : 1;
    step.fn(k);
    if (q.t >= step.dur) {
      q.i += 1;
      q.t = 0;
      if (q.i >= q.steps.length) { st.seq = null; return true; }
    }
    return false;
  }

  function update(dt, camera = null) {
    st.t += dt;
    if (stepSeq(dt)) onDispensed?.(_lastDispensed);
    st.hover += ((st.hoverTarget ?? 0) - st.hover) * Math.min(1, dt * 8);
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    st.flash = Math.max(0, st.flash - dt * 2.6);
    st.deny = Math.max(0, st.deny - dt * 2.2);

    // 灯牌：缓慢呼吸 + hover 提亮 + 出货爆闪（乘算保色相，同老虎机彩灯的口径）
    if (marquee) {
      const breathe = 1 + 0.12 * Math.sin(st.t * 1.5 + st.phase);
      const k = breathe * (1 + 0.25 * st.hover) + st.flash * 5;
      marquee.material.color.copy(marqueeBase).multiplyScalar(k);
    }
    // 显示条：微闪（通电感；出货时压一档亮度让灯牌抢眼）
    if (display) {
      const flick = 0.96 + 0.04 * Math.sin(st.t * 9.1 + st.phase);
      display.material.color.copy(new THREE.Color(shade(P.wax, 0.2)))
        .multiplyScalar(flick * (1 - 0.35 * st.flash));
    }
    // 商品卡：正对相机 + 呼吸浮动 + hover 抬起 + 被拒摇头
    for (const tile of goods.values()) {
      if (camera) {
        // billboard：卡片是机身（可能带 ry/缩放）的后代 → 用父级世界四元数把相机朝向换算到局部
        const parent = tile.root.parent ?? body;
        parent.getWorldQuaternion(_q);
        tile.root.quaternion.copy(_q.invert()).multiply(camera.quaternion);
      }
      if (st.seq?.index === tile.index) continue;   // 出货演出期间由时序接管
      const hovered = st.hoverGoods === tile.index;
      const bob = Math.sin(st.t * 1.8 + tile.index * 1.7) * 0.03;
      const shake = st.deny > 0 ? Math.sin(st.t * 46) * 0.075 * st.deny : 0;
      tile.root.position.set(shake, tile.baseY + bob + (hovered ? 0.14 : 0), 0);
      tile.root.scale.setScalar(1 + (hovered ? 0.07 : 0));
      // 悬停/被拒：盘子整体提亮（乘算保色相）
      tile.mat.color.setScalar(hovered ? 1.18 : (st.deny > 0 ? 1 + 0.5 * st.deny : 1));
    }
  }

  return {
    update,
    setStock,
    setDisplay,
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    /** 追光（相机怼脸）开关：与其它机器同义（此处只影响灯牌呼吸幅度）。
     *  同时是商品 hover 说明的门禁：怼脸才挂 token（未聚焦时商品完全不可交互）。 */
    setFocus: (on) => {
      st.focusTarget = on ? 1 : 0;
      st.focused = !!on;
      for (const tile of goods.values()) applyTokenGate(tile);
    },
    /** 悬停某件货（index | null）：抬卡 + 盘子提亮。 */
    setGoodsHover: (index) => { st.hoverGoods = index; },
    /** 买不起被点：盘子闪红 + 卡片摇头。 */
    deny: () => { st.deny = 1; return true; },
    /** 货品的拾取目标（RoomStage 登记进 Picker）：注册**卡片根**（token 挂在它上面）。 */
    goodsTargets: () => [...goods.values()].map(t => ({ index: t.index, object: t.root })),
    /** 正忙（出货演出中）：宿主据此可暂缓其它演出。 */
    isBusy: () => !!st.seq,
    state: st,
  };
}
