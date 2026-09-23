// 「到手那一拍」的演出编排（从 runController 抽出的第一个域，用户定 2026-09-12 的原则）：
// **core 结算已经发生**，这里只管"什么时候播、播在哪个舞台、播完接什么"——时序归 Shell。
//
// 由 runController 构造（`createRunShowcase(ctx)`），ctx 里的引用一律**晚绑定**：
//   · panelStage()/roomStage()/notify() —— runController 里这些 const/function 在本模块
//     构造之后才初始化；箭头闭包捕获词法绑定，运行期才取值，初始化顺序安全。
//   · actions（slotTake/slotDecline/leaveRoom）—— 同上，领域动作由 runController 注入。
// 模块内的 core 调用（chooseDemonDebuff/buyShopItem/takeSlotGift）随函数一起搬进来。

import { getRelicDefinition } from '../core/relics/registry.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { withLabels } from '../stage/panels/shared.js';
import { RARITY_COLORS } from '../stage/objects/RelicScrollPickerObject.js';
import { slotPrizeText } from '../stage/panels/index.js';
import { showcaseItemOf } from './runPresenter.js';
import { chooseDemonDebuff, DEMON_DEBUFFS } from '../core/run/rooms/bank.js';
import { buyShopItem } from '../core/run/rooms/shop.js';
import { takeSlotGift, SLOT_GIFTS } from '../core/run/rooms/slotMachine.js';

export function createRunShowcase(ctx) {
  const { run, runPresenter, actions } = ctx;

  // ---- 获得遗物特写（用户定 2026-09-12）----
  // 遗物获取路径很多（奖励选包 / 商店货架 / 老虎机奖品 / 古尔帕斯 / 事件…），逐个接线必漏；
  // 这里统一在 notify 那一拍做**拥有集差分**：动作跑完后多出来的遗物 = 刚到手，播一次特写
  // （物品图查 `assets/relics/<遗物名>`，没素材就退化成色块——组件自带兜底）。
  // 同一拍最多播一件：上一件还在播就先排队，等下一次 notify 继续（玩家点掉特写总伴随下一次
  // 操作）；基准集在读档/入档时同步，不会把已有遗物当成"刚获得"。
  let shownRelicIds = new Set(run.player.relics);
  const relicShowcaseQueue = [];
  // 售货机购买的演出协调（声明在 flushRelicShowcase 之前：那个闭包要读 shopDispensing）
  let shopPendingShow = null;   // 刚买下、等着播获得演出的那件
  let shopDispensing = false;   // 出货演出进行中（挡住遗物差分的即时特写）
  let shopFuse = null;          // 兜底：场景没回执（无场景/被拆）也要把特写放出来
  const flushRelicShowcase = () => {
    const stage = ctx.panelStage();                     // 当前活动舞台（roomStage ?? mapStage，晚绑定）
    if (!stage?.showcaseItem || !relicShowcaseQueue.length || stage.showcasing) return false;
    if (run.gameStage === 'battle') return false;        // 战斗内不打断（差分已记，战后那拍再播）
    if (shopDispensing) return false;                    // 售货机出货演出中：等场景回执再播（别盖住出货）
    const def = getRelicDefinition(relicShowcaseQueue.shift());
    if (!def) return false;
    const cost = def.nonSlot ? '非槽位式' : `占用 ${def.cost ?? 0} 槽`;
    return stage.showcaseItem({
      title: def.name ?? def.id,
      desc: `遗物 · ${def.rarity ?? 'C'} 级 · ${cost}`,
      effect: def.description ?? '',
      // 设计稿 RELICS.md 里该遗物的斜体文本（铭文）——获得演出最下方一行斜体
      // （2026-09-21 用户定；定义侧 flavor 字段与设计稿逐字同步，见 smoke-relic-flavor）
      flavor: def.flavor ?? null,
      artKey: def.name ?? def.id,
      tint: parseInt((RARITY_COLORS[def.rarity] ?? RARITY_COLORS.C).slice(1), 16),
    });
  };
  /** notify 末尾调用：拥有集差分 → 新遗物入队 → 尝试立刻播一件（见上方差分注释）。 */
  const diffNewRelics = () => {
    for (const id of run.player.relics) {
      if (!shownRelicIds.has(id)) { shownRelicIds.add(id); relicShowcaseQueue.push(id); }
    }
    flushRelicShowcase();
  };

  // ---- 恶魔 roll（银行机超额取款）----
  // 演出顺序 = 视角切到老虎机 → 关闸换恶魔盘（灯池染红）→ 自动转 → **在转盘上点一根盘
  // 承受词条**（转出来的那一面就是诅咒本身；悬停出 tooltip）→ 退场换回普通盘 →
  // **获得演出**（先"获得"这个词条，再报那笔超额取款的金币）。场景那半在 RoomStage 的
  // 状态机里，这里只记"选完词条后要播什么"，等场景回执 demonAnimDone 再播（否则特写会盖住退场演出）。
  const DEMON_TIER_LABEL = { yellow: '黄色级', red: '红色级', black: '黑色级' };
  const DEMON_TINT = { yellow: 0xb08a3a, red: 0x9a3a3a, black: 0x3a2440 };
  let demonRewardShow = null;   // { gold, tier, name, desc }
  let demonFuse = null;         // 兜底：场景没回执（无场景/被拆）也要把特写放出来
  function bankDemonPick(id) {
    const pr = run.bank?.pendingRoll;
    const gold = pr?.gold ?? 0;
    // ⚠ run 侧的 pendingRoll.options 是 **id 数组**（展开成对象只发生在快照里），
    // 所以词条描述要从定义表取，不能从 pr.options 里找对象
    const def = DEMON_DEBUFFS[id] ?? null;
    const res = chooseDemonDebuff(run, id);
    demonRewardShow = { gold, tier: res.tier, name: res.name, desc: def?.desc ?? '' };
    const inScene = !!ctx.roomStage() && run.currentRoom === 'slot';
    if (!inScene) { showDemonReward(); return res; }
    clearTimeout(demonFuse);
    demonFuse = setTimeout(() => { demonFuse = null; showDemonReward(); }, 6000);
    return res;
  }
  /**
   * 词条附赠的"**立马**做一件事"（浑浑噩噩=免费升级一张 / 忘却=自选焚毁一张）：
   * 演出播完直接开全屏选卡界面——不再要求玩家回头去银行机面板里点那个按钮。
   * 关掉选卡界面不消费 offer（面板里的按钮仍在，可稍后再来）。
   */
  function openBankOfferPicker() {
    const offer = run.bank?.offers?.[0] ?? null;
    if (offer === 'upgrade') ctx.panelStage()?.openUpgradePicker?.('bankUpgrade');
    else if (offer === 'burn') ctx.panelStage()?.openUpgradePicker?.('bankBurn');
  }
  /** 两拍获得演出：① 词条本身（诅咒就是这次轮盘的产物）② 那笔超额取款的金币。
   *  金币那拍**不再写"代价：xxx"**（用户定 2026-09-13：上一拍刚演过，纯冗余）。 */
  function showDemonReward() {
    clearTimeout(demonFuse);
    demonFuse = null;
    const p = demonRewardShow;
    demonRewardShow = null;
    if (!p) return false;
    const stage = ctx.panelStage();
    if (!stage?.showcaseItem) return false;
    return !!stage.showcaseItem({
      title: p.name,
      desc: `恶魔词条 · ${DEMON_TIER_LABEL[p.tier] ?? p.tier}`,
      effect: p.desc,
      tint: DEMON_TINT[p.tier] ?? DEMON_TINT.black,
      autoDismissMs: 1900,
      onDismiss: () => ctx.panelStage()?.showcaseItem?.({
        title: `+${p.gold} 金币`,
        desc: '银行机超额取款',
        artKey: 'gold',   // 无素材时组件烘"金币堆"占位（用户要的观感）
        tint: 0xffd75e,
        autoDismissMs: 1700,
        // 两拍都演完 → 有"立马做一件事"的附赠就直接开选卡界面（用户定 2026-09-13）
        onDismiss: openBankOfferPicker,
      }),
    });
  }

  /**
   * 中奖落定 → **直接唤起获得演出**（用户定 2026-09-12）：产出不再由操纵条里的「领取」按钮
   * 处理（"没有获得感"）。点任意处 = 收下（需要选一张的奖项：随后在面板/全屏选卡里选；
   * 免费指定升级：随后自动开选卡界面）；点「跳过」= 放弃这份产出。
   * 一次产出只播一次（按对象身份去重；领取/放弃后 pending 清空，自然复位）。
   */
  let shownSlotPrize = null;
  function maybeShowSlotPrize() {
    const p = run.slotPending;
    if (!p) { shownSlotPrize = null; return false; }
    if (p === shownSlotPrize) return false;
    shownSlotPrize = p;
    const stage = ctx.panelStage();
    if (!stage?.showcaseItem) return false;
    const needsPick = (p.choices?.length ?? 0) > 0 || (p.relicChoices?.length ?? 0) > 0;
    const freeUpgrade = p.upgrade?.kind === 'free';
    const major = p.tier === 'major';
    stage.showcaseItem({
      title: slotPrizeText(p),
      desc: `老虎机 · ${major ? '★ 大奖' : '小奖'}`,
      effect: needsPick ? '收下之后，在候选里选一张带走'
        : freeUpgrade ? '收下之后，选择要免费升级的卡'
          : '点任意处收下 ｜ 点「跳过」放弃这份产出',
      artKey: p.money != null ? 'gold' : null,   // 金币奖 → 组件烘"金币堆"占位
      tint: major ? 0xffd75e : 0xd8e2f4,
      skippable: true,
      onSkip: () => actions.slotDecline(),
      onDismiss: () => {
        if (freeUpgrade) { actions.slotTake(null); ctx.panelStage()?.openUpgradePicker?.('slot'); }
        // 多选一奖项（2026-09-22 统一）：dismiss 后直接接全屏 overlay 候选（选卡/选遗物），
        // 「返回」= 放弃——不再落回 dock 面板的内嵌卡行/按钮墙（旧逻辑已删）
        else if (needsPick) ctx.panelStage()?.openSlotPrizePicker?.();
        else actions.slotTake(null);
      },
    });
    return true;
  }

  // 离房安慰奖（SLOT_MACHINE.md：同一层拉了 ≥4 次杆没中奖（D5） → 送可乐/鸡腿二选一）：
  // 场景端播完"吐出→点选→飞出"后上行到这里结算，再播一次获得物特写（获得动画），
  // **然后自动把"离房"接着走完**（用户定 2026-09-13）：触发点就是玩家点「继续前进」，
  // 整条链是"离房 → 机器凑上来吐货 → 二选一 → 获得演出 → 离房切幕"，中间不需要玩家再点一次。
  const GIFT_TINT = { cola: 0xc0392b, chicken: 0xd9a05b };
  function slotTakeGift(choice) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    const res = takeSlotGift(run, choice);
    if (!res) return;
    ctx.notify();
    const g = SLOT_GIFTS[choice];
    ctx.panelStage()?.showcaseItem?.({
      title: g.name, desc: g.desc, effect: g.effect,
      tint: GIFT_TINT[choice] ?? 0xffd75e,
      autoDismissMs: 1800,
      onDismiss: () => actions.leaveRoom(),
    });
  }

  // ---- 商店（售货机，SHOP.md §一）----
  // 商店房 = 一整间货房（用户定 2026-09-12）：点货架上的商品即买。**演出顺序**是
  // 「机器出货（场景 rig）→ 物品获得特写」——所以这里买入只记下"待演出"，等场景回执
  // `shopAnimDone` 再播特写；否则全屏特写会直接盖住出货的开门/掉落/翻板那几拍。
  function shopBuy(index) {
    if (run.gameStage !== 'room' || !run.shop) return;
    const it = run.shop.items?.[index];
    const res = buyShopItem(run, index);
    // 买到的东西都要"到手那一拍"：卡包也走获得演出（展示卡包图 → 演完自动开包），
    // 与药水/遗物同一条链（用户定 2026-09-12：购买必须走获得演出）
    shopPendingShow = it
      ? { index, kind: it.kind, name: it.name, effect: it.effect, relicId: it.relicId ?? null }
      : null;
    // 场景里真的有这张卡片才会播出货演出 → 有回执；没有就当场播特写（headless/降级路径）
    const hasTile = !!shopPendingShow && [...(ctx.roomStage()?.rigs?.values() ?? [])]
      .some(r => (r.goodsTargets?.() ?? []).some(t => t.index === index));
    shopDispensing = hasTile;
    clearTimeout(shopFuse);
    shopFuse = null;
    if (shopDispensing) {
      shopFuse = setTimeout(() => {
        shopFuse = null;
        shopDispensing = false;
        shopShowcase(shopPendingShow);
        shopPendingShow = null;
      }, 4000);
    }
    ctx.notify();
    if (!shopDispensing) { shopShowcase(shopPendingShow); shopPendingShow = null; }
    return res;
  }
  /** 场景回执：那件货已经掉进出货口了 → 播获得特写（遗物走全局差分那条线，口径统一）。 */
  function shopAnimDone(index) {
    if (run.gameStage !== 'room') return false;
    clearTimeout(shopFuse);
    shopFuse = null;
    shopDispensing = false;
    const p = shopPendingShow && (index == null || shopPendingShow.index === index) ? shopPendingShow : null;
    shopPendingShow = null;
    if (!p) { flushRelicShowcase(); return false; }   // 仍要放行被挡下的遗物特写
    shopShowcase(p);
    return true;
  }
  const SHOP_TINT = { potion: 0xd94f4f, apple: 0x8fd45a, pack: 0xffd75e, relic: 0xc9a86a };
  /** 买到手的那件东西的特写（单件遗物已改为**遗物包三选一**（2026-09-13 用户定），
   *  遗物直购不复存在，kind 'relic' 现在恒为遗物包：特写演完自动开三选一）。
   *  出货演出播完即**自动收下**（用户定 2026-09-13）：机器那边已经演过一遍"出货"，
   *  这里只是把到手的那件亮一下，不需要玩家再点一次"收货"——操纵条里也不另设收货 UI。 */
  function shopShowcase(p) {
    if (!p) return false;
    const stage = ctx.panelStage();
    if (!stage?.showcaseItem) return false;
    const pack = p.kind === 'pack';
    const relicPack = p.kind === 'relic';
    return !!stage.showcaseItem({
      title: p.name ?? '买到的东西',
      desc: pack ? '售货机 · 卡包' : relicPack ? '售货机 · 遗物包' : '售货机',
      effect: p.effect ?? '',
      artKey: pack ? 'pack' : p.kind,   // assets/items|props：pack / potion / apple / relic（没素材就色块）
      tint: SHOP_TINT[p.kind] ?? 0xffe6ad,
      // 卡包/遗物包停久一点：看完就**自动开包**（全屏三选一，可放弃）——整条购买链不需要玩家点任何一下
      autoDismissMs: (pack || relicPack) ? 2100 : 1700,
      // 卡包：获得演出看完**自动开包**（全屏三选一，可放弃；见 openShopPackPicker）
      // 遗物包：同理开**遗物三选一**（openShopRelicPackPicker）
      onDismiss: pack ? () => ctx.panelStage()?.openShopPackPicker?.()
        : relicPack ? () => ctx.panelStage()?.openShopRelicPackPicker?.() : null,
    });
  }

  /** 播完 core 声明的获得物特写（见 runPresenter.js：内容只声明，时序归 Shell）。 */
  function flushRunPresentations() {
    for (const intent of runPresenter.drain()) {
      // 卡牌升级：播「变身收编」演出（原卡金闪变新卡后飞入牌库），不是三行文本特写。
      // 换面要**投影后的卡面视图**（裸 defId 会被 bakeFace 烘成空卡）——这里按面板同
      // 口径现投影（休息阶段语境，带 player 的应用前 describe）。
      if (intent?.kind === 'cardUpgrade') {
        const viewOf = (id) => {
          try { return withLabels(cardViewFromDef(getSkillDefinition(id), { player: run.player })); }
          catch { return null; }   // 定义缺失等异常：交给 kit 的 defId 兜底，不拦排水
        };
        ctx.panelStage()?.playCardUpgrade?.({
          fromDefId: intent.fromDefId, toDefId: intent.toDefId,
          fromView: viewOf(intent.fromDefId), toView: viewOf(intent.toDefId),
        });
        continue;
      }
      ctx.panelStage()?.showcaseItem?.(showcaseItemOf(intent));
    }
  }

  /** 离局清理：两个兜底定时器必须清掉（否则离局后仍可能开火——原实现漏清，本次补上），
   *  挂起的待播演出/队列也一并弃掉（属于这一局，重进由检查点重建稳态）。 */
  function dispose() {
    clearTimeout(demonFuse);
    demonFuse = null;
    clearTimeout(shopFuse);
    shopFuse = null;
    demonRewardShow = null;
    shopPendingShow = null;
    shopDispensing = false;
    relicShowcaseQueue.length = 0;
  }

  return {
    diffNewRelics, flushRelicShowcase,
    bankDemonPick, showDemonReward,
    maybeShowSlotPrize,
    shopBuy, shopAnimDone,
    slotTakeGift,
    flushRunPresentations,
    dispose,
    intents: {
      buyShopItem: (i) => shopBuy(i.index),
      shopAnimDone: (i) => shopAnimDone(i.index),
      demonAnimDone: () => showDemonReward(),   // 恶魔 roll 退场回执（非玩家意图）
      slotTakeGift: (i) => slotTakeGift(i.choice),
    },
  };
}
