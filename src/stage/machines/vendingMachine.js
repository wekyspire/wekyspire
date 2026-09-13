// 售货机（vending）：商店房的货架 / 商品卡拾取 / 出货演出 / 溢出售货机动态生成。
// 逻辑自 RoomStage 原样下沉——RoomStage 只做通用舞台机制。
import * as THREE from 'three';
import { createVendingMachineRig } from '../scenes/interactive/vendingMachineRig.js';
import { buildShopPanel } from '../panels/index.js';
import { getProp } from '../scenes/props/index.js';
import { createRng } from '../scenes/kit/scatter.js';
import { FLOOR_Y } from '../scenes/dungeon3D.js';

/**
 * 售货机的取景主体：**货架区开口**（cards 立在托盘上，卡片顶沿再留一点余量）。
 * 取景只框"玻璃柜里的货"——整机取景会让货架缩得太小、价格读不出来（怼脸的意义就在这）。
 * 机器带 ry/缩放，故用机身的局部→世界换算，不手算朝向。
 */
function vendingSubject(entry) {
  const bay = entry.parts?.bay;
  if (!bay) return null;
  const s = entry.scale ?? 1;
  const c = entry.object.localToWorld(new THREE.Vector3(bay.x, bay.y, bay.z));
  const halfW = (bay.w / 2) * s + 0.5;
  const halfH = (bay.h / 2) * s + 0.3;
  return new THREE.Box3(
    new THREE.Vector3(c.x - halfW, c.y - halfH, c.z - 3),
    new THREE.Vector3(c.x + halfW, c.y + halfH, c.z + 3),
  );
}

export function createVendingMachine(ctx) {
  const goodsPickIds = new Set();   // 商品卡拾取 id（随货架增删对账）

  /**
   * 商品卡拾取登记（**增量对账**）：货架随快照增删（买到货、换层），登记表也要跟着变——
   * 卖掉的卡片必须立刻从 Picker 摘掉，否则空货位还能点到（"点了没反应"）。
   */
  function _syncGoodsPickables() {
    if (!ctx.picker()) return;
    const want = new Map();
    for (const rig of ctx.rigs().values()) {
      for (const t of rig?.goodsTargets?.() ?? []) want.set(`room:goods:${t.index}`, t.object);
    }
    for (const id of [...goodsPickIds]) {
      if (want.has(id)) continue;
      ctx.removePickable(id);
      goodsPickIds.delete(id);
    }
    for (const [id, object] of want) {
      if (goodsPickIds.has(id)) continue;
      ctx.addPickable(id, object, { kind: 'goods' });
      goodsPickIds.add(id);
    }
  }

  /** hit → 商品卡下标（kind 'goods' 或遗物 token 热区都算）。 */
  function _goodsIndexOf(hit) {
    const id = hit?.id;
    if (typeof id !== 'string' || !id.startsWith('room:goods:')) return null;
    const n = Number(id.slice('room:goods:'.length));
    return Number.isFinite(n) ? n : null;
  }

  /** 这件货属于哪台机器（溢出柜时的货架切片靠它区分；点哪台推近哪台）。 */
  function _goodsOwner(index) {
    for (const [name, rig] of ctx.rigs()) {
      if ((rig.goodsTargets?.() ?? []).some(t => t.index === index)) return name;
    }
    return null;
  }

  /** 某件货的卡片根对象（泡泡挂点/调试用）。 */
  function _goodsObject(index) {
    for (const rig of ctx.rigs().values()) {
      const t = (rig.goodsTargets?.() ?? []).find(x => x.index === index);
      if (t) return t.object;
    }
    return null;
  }

  /** 点商品卡：买得起 → 上行购买意图；买不起 → 盘子摇头 + 一句泡泡（不是"点了没反应"）。 */
  function _buyGoods(index) {
    const it = ctx.snap()?.shop?.items?.[index];
    if (!it || it.sold) return false;
    if (!it.affordable) {
      for (const rig of ctx.rigs().values()) rig.deny?.();
      // 泡泡挂在**被点的那件货**上方（不是机器顶）：怼脸取景里机器顶在画外，
      // 挂在机器顶上的提示玩家根本看不到（"点了没反应"的老毛病）
      const obj = _goodsObject(index);
      const sm = ctx.sm();
      const at = (obj && sm?.worldToUI)
        ? (() => { const w = obj.getWorldPosition(new THREE.Vector3()); return sm.worldToUI(w.x, w.y + 1.9, w.z); })()
        : ctx.uiAnchorOf(ctx.entryOf('shop') ?? {}, 4);
      ctx.bubbles().say('room:money', {
        x: at.x, y: at.y,
        text: `还差 ${Math.max(0, it.price - (ctx.snap().money ?? 0))} 金……`,
        kind: 'thought',
        duration: 2.2,
        tint: 0xff9a9a,
      });
      return false;
    }
    ctx.intent({ action: 'buyShopItem', index });
    return true;
  }

  /** 售货机提示泡泡的 UI 锚点：货架区**下沿**（怼脸时机器顶在画外，挂顶上等于没挂）。 */
  function _vendingHintAnchor(entry) {
    const bay = entry?.parts?.bay;
    const sm = ctx.sm();
    if (!bay || !entry || !sm?.worldToUI) return ctx.uiAnchorOf(entry ?? {}, 4);
    const p = entry.object.localToWorld(new THREE.Vector3(bay.x, bay.y - bay.h / 2 + 0.4, bay.z));
    return sm.worldToUI(p.x, p.y, p.z);
  }

  /** 卡包三选一未选就想走：镜头拉回售货机 + 打开货架面板（金币已扣，选择不能丢）。 */
  function _nudgeShopPending() {
    const name = ctx.markers().some(m => m.name === 'shop') ? 'shop' : 'shop2';
    const entry = ctx.entryOf(name);
    if (!entry) return;
    if (ctx.focused() === name) ctx.openPanel(name);
    else ctx.focusMachine(name);
    // 提示挂在**货架下沿**（怼脸取景里机器顶在画外；挂机器顶上的话玩家看不到）
    ctx.bubbles().say('room:pack', {
      ..._vendingHintAnchor(entry),
      text: '卡包里还有一张没挑呢。',
      kind: 'thought',
      duration: 2.4,
      tint: 0xffe6ad,
    });
  }

  /**
   * 按配方的锚点生成一台售货机（`index` 0 = 主柜位 shop、1 = 溢出柜位 shop2）。
   * 只用于**溢出柜**：主柜在配方 guaranteed 里（被 claim）。溢出柜位没有 claim，故先算一个
   * 不与已摆件重叠的落点（`_freeSpot`）；锚点缺失 → 放弃生成（宁可少一台，不重叠）。
   */
  function _spawnShopMachine(name, index = 1) {
    const anchors = ctx.sceneDef()?.anchors ?? {};
    const a = index === 0 ? anchors.shop : (anchors[`shop${index + 1}`] ?? anchors.shop2);
    if (!a || !ctx.room()) return false;
    const def = getProp('vendingMachine');
    const scale = a.scale ?? 1;
    const fp = def.footprint ?? { x: 3.2, z: 2.4 };
    const spot = _freeSpot(a.x, a.z, fp.x * scale, fp.z * scale);
    const obj = def.build({ rng: createRng(`${ctx.recipe}:shop:${name}`) });
    obj.position.set(spot.x, FLOOR_Y, spot.z);     // 与配方摆件同一地平面（FLOOR_Y）
    obj.rotation.y = a.ry ?? 0;
    obj.scale.setScalar(scale);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    ctx.room().group.add(obj);
    ctx.addInteractive(name, {
      object: obj, kind: obj.userData.interactive ?? 'vending',
      x: spot.x, z: spot.z, ry: a.ry ?? 0, scale,
      parts: obj.userData.parts ?? null,
    });
    return true;
  }

  /** 在 (x,z) 附近找一个不与房间已摆件重叠的落点（原始位优先，其次沿 ±x/±z 退让）。 */
  function _freeSpot(x, z, w, d) {
    const list = ctx.room()?.placements ?? [];
    const hit = (cx, cz) => list.some((p) => !p.floating && !p.onWall && !p.hosted
      && cx - w / 2 < p.x + (p.fx ?? 1) && cx + w / 2 > p.x - (p.fx ?? 1)
      && cz - d / 2 < p.z + (p.fz ?? 1) && cz + d / 2 > p.z - (p.fz ?? 1));
    if (!hit(x, z)) return { x, z };
    for (const step of [5, 10, 16, 22]) {
      for (const [dx, dz] of [[-step, 0], [step, 0], [0, -step], [0, step], [-step, -step], [step, step]]) {
        if (!hit(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
    return { x, z };
  }

  return {
    kinds: ['vending'],
    createRig: (entry) => createVendingMachineRig({
      object: entry.object, parts: entry.parts,
      // 出货演出播完 → 回执宿主（宿主再播"物品到手"的获得特写；演出顺序不能被特写盖掉）
      onDispensed: (index) => ctx.intent({ action: 'shopAnimDone', index }),
    }),
    // 售货机同样怼脸（用户定 2026-09-12：点售货机要看清货架上的商品与价格）：
    // 主体 = **货架区开口**（不含底座/操作列/顶牌），底边抬到操纵条之上（两排货 + 价格全露出来）
    focusOf: () => ({ fracH: 0.62, bottom: 0.36, pad: 0.95, subject: vendingSubject }),
    // 售货机：**只压暗外围、不打正面补光**——柜内商品是 unlit 自发光（补光照不到），
    // 而打进敞开玻璃柜的补光会把柜内背板照爆（怼脸时柜子中间一团白光，把两排货糊掉）。
    // 焦点补光的高度也压到**下半身**（出货口一带）：光心落在货架之下，柜内背板不被照爆。
    focusLightOf: () => ({ y: 0.22, fill: false }),
    panel: (name, snap) => buildShopPanel(snap),

    /** 换 picker 后：清对账集合 + 全量重登记商品卡。 */
    registerPickables() {
      goodsPickIds.clear();
      _syncGoodsPickables();
    },

    /** picker 撤/换后的内部簿记复位（旧代码不清这里，重 attach 后商品永远登记不到新 picker）。 */
    pickerChanged() { goodsPickIds.clear(); },

    /**
     * 售货机同步（**商店房 'shop' = 一整间货房**，用户定 2026-09-12）：
     *   · 主柜来自配方（`guaranteed` + `live`，name='shop'）——定点、被 claim，撒布件不会压到它；
     *   · 货架超过一台的容量（4 件，故事模式瑞米等级高时 5 件）→ 在 `anchors.shop2` 生成**溢出柜**
     *     （只此一路是动态生成：锚点位没有 claim，故生成前先避让已占红线，见 `_freeSpot`）；
     *   · 库存按机器**切片**下发（index 用全局货架下标——购买/拾取都用它）；
     *   · 卡包买到即开：三选一挂起时把面板顶到前面来（金币已扣，选择不能丢）。
     */
    sync() {
      const shop = ctx.snap()?.shop ?? null;
      if (!shop) return;                             // 非商店房：不生成、不显示
      const items = shop.items ?? [];
      const cap = Math.max(1, ctx.rigs().get('shop')?.state?.capacity ?? 4);
      const machines = Math.max(1, Math.ceil(items.length / cap));
      for (let i = 0; i < machines; i++) {
        const name = i === 0 ? 'shop' : `shop${i + 1}`;
        if (!ctx.markers().some(m => m.name === name) && !_spawnShopMachine(name, i)) break;
        const rig = ctx.rigs().get(name);
        rig?.setStock(items.slice(i * cap, (i + 1) * cap));
        rig?.setDisplay(`余额 ${ctx.snap().money ?? 0}`);
      }
      _syncGoodsPickables();
      if (shop.pending && ctx.panelKind() !== 'shop') ctx.openPanel('shop');
    },

    /** 通知型 hover：商品卡抬起 + 盘子提亮（不吞）。未怼脸时商品完全不可交互——
     *  抬起同样是"这件能点"的暗示，与 tooltip 一起门控（点击仍走 handleClick 的推近）。 */
    hover(hit) {
      const gi = _goodsIndexOf(hit);
      const owner = gi != null ? _goodsOwner(gi) : null;
      const gated = (owner && ctx.focused() === owner) ? gi : null;
      for (const rig of ctx.rigs().values()) rig.setGoodsHover?.(gated);
    },

    /** 吞掉型点击：点商品卡 = 买。**但没怼脸时先推近**——远景里机器中央就是货架，第一次点它
     * 若直接成交，玩家连商品名与价格都没看清（用户定的节奏：先 zoom in 看货，再点选购买）。 */
    handleClick(hit) {
      const gi = _goodsIndexOf(hit);
      if (gi == null) return false;
      const owner = _goodsOwner(gi);
      if (owner && ctx.focused() !== owner) { ctx.focusMachine(owner); return true; }
      _buyGoods(gi);
      return true;
    },

    /** 义务门贡献：卡包买到即开还没挑牌 = 硬拦离房（'shop'）。 */
    pendingDuty: () => (ctx.snap()?.shop?.pending ? 'shop' : null),

    /** 点「继续前进」时接管：卡包未挑 → 拉回售货机并开面板提示。 */
    onContinue() {
      if (!ctx.snap()?.shop?.pending) return false;
      _nudgeShopPending();
      return true;
    },
  };
}
