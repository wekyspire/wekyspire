// 「到手那一拍」的演出编排（从 runController 抽出的第一个域，用户定 的原则）：
// **core 结算已经发生**，这里只管"什么时候播、播在哪个舞台、播完接什么"——时序归 Shell。
//
// 由 runController 构造（`createRunShowcase(ctx)`），ctx 里的引用一律**晚绑定**：
//   · panelStage()/roomStage()/notify() —— runController 里这些 const/function 在本模块
//     构造之后才初始化；箭头闭包捕获词法绑定，运行期才取值，初始化顺序安全。
//   · actions（leaveRoom）—— 同上，领域动作由 runController 注入。
// 模块内的 core 调用（chooseDemonDebuff/buyShopItem/answerQuestion）随函数一起搬进来。

import { getRelicDefinition } from '../core/relics/registry.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { withLabels } from '../stage/panels/shared.js';
import { RARITY_COLORS } from '../stage/objects/RelicScrollPickerObject.js';
import { showcaseItemOf } from './runPresenter.js';
import { chooseDemonDebuff, DEMON_DEBUFFS , takeBankOffer } from '../core/run/rooms/bank.js';
import { buyShopItem } from '../core/run/rooms/shop.js';
import { answerQuestion } from '../core/run/questions.js';
import { SLOT_GIFTS } from '../core/run/rooms/slotMachine.js';
import { tooltipHide } from './tooltipHub.js';
import { enqueueFlowInstruction } from './flowInstruction.js';

export function createRunShowcase(ctx) {
  const { run, runPresenter, dedicatedSequencer, actions } = ctx;

  // ---- 获得遗物特写----
  // 遗物获取路径很多（奖励选包 / 商店货架 / 老虎机奖品 / 古尔帕斯 / 事件…），逐个接线必漏；
  // 这里统一在 notify 那一拍做**拥有集差分**：动作跑完后多出来的遗物 = 刚到手，播一次特写
  // （物品图查 `assets/relics/<遗物名>`，没素材就退化成色块——组件自带兜底）。
  // 同一拍最多播一件：上一件还在播就排队（onDismiss 链式补排 + 空闲沿补排兜底）。
  // 入队由授予源显式调 presentRelic（P4a 前置重整：内容触发下沉触发源，不再 notify 差分）。
  const relicShowcaseQueue = [];
  const isShopDispensing = () => !!dedicatedSequencer.findPending(i => i.meta?.event === 'room:shop-dispense');
  const flushRelicShowcase = () => {
    const stage = ctx.panelStage();                     // 当前活动舞台（battle ?? room ?? map，晚绑定）
    if (!stage?.showcaseItem || !relicShowcaseQueue.length || stage.showcasing) return false;
    if (run.gameStage === 'battle') return false;        // 战斗内不打断（差分已记，战后那拍再播）
    if (isShopDispensing()) return false;                // 售货机出货演出中：等场景回执再播（别盖住出货）
    const def = getRelicDefinition(relicShowcaseQueue.shift());
    if (!def) return false;
    return stage.showcaseItem({
      title: def.name ?? def.id,
      effect: def.description ?? '',
      // 设计稿 RELICS.md 里该遗物的斜体文本（铭文）——获得演出最下方一行斜体
      // （定义侧 flavor 字段与设计稿逐字同步，见 smoke-relic-flavor）
      flavor: def.flavor ?? null,
      artKey: def.name ?? def.id,
      tint: parseInt((RARITY_COLORS[def.rarity] ?? RARITY_COLORS.C).slice(1), 16),
      // 链式补排：这件被点掉后下一件即刻顶上（不依赖任何外部刷新节拍）
      onDismiss: () => flushRelicShowcase(),
    });
  };
  /** 授予源显式调：新遗物入队 + 尝试立刻播一件（忙碌时由链式/空闲沿补排）。 */
  const presentRelic = (id) => {
    if (!id || relicShowcaseQueue.includes(id)) return;
    relicShowcaseQueue.push(id);
    flushRelicShowcase();
  };

  // ---- 恶魔 roll（银行机超额取款）----
  // 演出顺序 = 视角切到老虎机 → 关闸换恶魔盘（灯池染红）→ 自动转 → **在转盘上点一根盘
  // 承受词条**（转出来的那一面就是诅咒本身；悬停出 tooltip）→ 退场换回普通盘 →
  // **获得演出**（先"获得"这个词条，再报那笔超额取款的金币）。场景退场那半在 RoomStage 的
  // 状态机里；这里挂一条「等场景回执」指令接住节拍（demonAnimDone 回执 / durationMs 保险丝
  // 两路收尾），收尾拍再把特写链排成 'room:demon-flow' 流程指令——每拍 await 落定再走下一拍，
  // 链对队列可见（单飞/静止断言），特写被切幕强杀（onCancel）即中止余下节拍，
  // 附赠 offer 由问句驱动在下一拍 notify 兜底重呈现。
  const DEMON_TINT = { yellow: 0xb08a3a, red: 0x9a3a3a, black: 0x3a2440 };
  let demonRewardShow = null;   // { gold, tier, name, desc, burnt }
  function bankDemonPick(id) {
    const pr = run.bank?.pendingRoll;
    const gold = pr?.gold ?? 0;
    // ⚠ run 侧的 pendingRoll.options 是 **id 数组**（展开成对象只发生在快照里），
    // 所以词条描述要从定义表取，不能从 pr.options 里找对象
    const def = DEMON_DEBUFFS[id] ?? null;
    const res = chooseDemonDebuff(run, id);
    // 被焚卡（忘却/忘记的 immediate）：逐张接「焚毁」特写拍（2026-09-30 用户裁定——
    // 之前随机焚卡零演出，玩家看不见损失了什么）
    const burnt = Array.isArray(res.immediate) ? res.immediate : [];
    demonRewardShow = { gold, tier: res.tier, name: res.name, desc: def?.desc ?? '', burnt };
    // 金币走显示标量通道（§4.6 首个消费者）：core 已结算，显示按住旧值——
    // 金币拍落定后的飞行拍才释放（下面 playDemonReward 的 flight）。
    // ⚠ 裸 hold 的安全前提：紧随的 enqueue（reel-out 指令或 demon-flow）在同一同步
    // 栈内完成——队列即刻非空，空闲对账冲不掉按住；改这段时不得在 hold 与 enqueue
    // 之间插入任何可能触发 notify 的调用（吞噬侧用的是 holdBeat 指令化形态，见 runMachines）
    if (gold > 0) ctx.scalars?.hold('money', gold);
    const inScene = !!ctx.roomStage() && run.currentRoom === 'slot';
    if (!inScene) { enqueueDemonReward(); return res; }
    // 等场景退场回执：回执（demonAnimDone 意图）或保险丝，谁先到都进特写链
    dedicatedSequencer.enqueueInstruction({
      meta: { event: 'room:demon-reel-out' },
      durationMs: 6000,   // 场景没回执（被拆/异常）也要把特写放出来
      onEnd: () => enqueueDemonReward(),
    });
    return res;
  }
  /** 场景回执（demonAnimDone 意图）：收掉等待指令——onEnd 接力排特写链。 */
  function demonAnimDone() {
    const instr = dedicatedSequencer.findPending(i => i.meta?.event === 'room:demon-reel-out');
    if (instr) dedicatedSequencer.finish(instr.id, { reason: 'frontend' });
    return instr != null;
  }
  function enqueueDemonReward() {
    return enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'demon-flow', meta: { event: 'room:demon-reward' },
      entryOk: () => demonRewardShow != null,
      play: playDemonReward,
    });
  }
  /** 单拍特写：await 到落定。resolve 值为出口（'dismiss'|'skip'|'cancel'|'failed'）。 */
  const showBeat = (item) => new Promise((resolve) => {
    const stage = ctx.panelStage();
    if (!stage?.showcaseItem) { resolve('failed'); return; }
    stage.showcaseItem({ ...item, onDismiss: () => resolve('dismiss'), onSkip: () => resolve('skip'), onCancel: () => resolve('cancel') });
  });
  async function playDemonReward(done) {
    const p = demonRewardShow;
    demonRewardShow = null;
    try {
      if (!p) return;
      // 拍序列（2026-09-30 用户定）：词条特写 → 逐张卡牌焚毁演出（不在场景的随机焚毁卡
      // 在画面中央亮相后燃尽——cardBurnFlight，与战斗同款 C0 吞蚀视觉；舞台没有该能力时
      // 退回「焚毁」文字特写拍）→ 金币 → （有附赠则）自动开选卡界面。
      const beats = [{ title: p.name, effect: p.desc, tint: DEMON_TINT[p.tier] ?? DEMON_TINT.black, autoDismissMs: 1900 }];
      for (const b of p.burnt ?? []) beats.push({ burn: b });
      beats.push({ title: `+${p.gold} 金币`, artKey: 'gold', tint: 0xffd75e, autoDismissMs: 1700 });
      for (const beat of beats) {
        if (beat.burn) {
          // onDone 恰好一次（flight 自带兜底计时器，烧不尽也回调）——await 无悬死风险
          const burnt = await new Promise((resolve) => {
            const played = ctx.panelStage()?.playCardBurn?.({
              defId: beat.burn.defId, view: beat.burn.view ?? null,
              onDone: () => resolve(true),
            });
            if (!played) resolve(false);
          });
          if (burnt) continue;
          const r = await showBeat({
            title: `焚毁 ${beat.burn.name}`,
            desc: '忘却的代价，这张卡牌离开了你的牌库',
            artKey: beat.burn.defId, tint: 0xd96a4a, autoDismissMs: 1600,
          });
          if (r === 'cancel') return;   // 切幕强杀：链中止
          continue;
        }
        const r = await showBeat(beat);
        if (r === 'cancel') return;   // 切幕强杀：链中止（金币那拍没播不追账——core 已结算；
        //                                按住的显示增量由空闲对账兜底贴回）
      }
      if (p.gold > 0) {
        // 飞行拍（§4.6）：金币特写落定 → 粒子飞向顶栏（占位定时；粒子演出落地后替换）
        // → 抵达拍释放显示增量，顶栏数字此刻才 +N
        await ctx.scalars?.flight({ scalar: 'money', amount: p.gold });
      }
      // 链尾直开附赠选卡读 panelHost._snap：此刻 demon-flow 指令还在队（门控必跳过常规
      // notify）——force 刷新，候选不得含已焚卡（幻影卡播完整演出后 core 拒账）
      ctx.notify({ force: true });
      openBankOfferPicker();   // 链尾：附赠 → 选卡界面
    } finally {
      done();
    }
  }
  /**
   * 词条附赠的"**立马**做一件事"（浑浑噩噩=免费升级一张 / 忘却=自选焚毁一张）：
   * 演出播完直接开全屏选卡界面——不再要求玩家回头去银行机面板里点那个按钮。
   * 关掉选卡界面不消费 offer（面板里的按钮仍在，可稍后再来）。
   */
  function openBankOfferPicker() {
    const offer = run.bank?.offers?.[0] ?? null;
    // 返回/关闭 = 放弃这份附赠（面板按钮已删，offer 不再有无入口的死状态）
    const onSkip = () => {
      if (run.bank?.offers?.length) { takeBankOffer(run); ctx.notify?.(); }
    };
    const opened
      = offer === 'upgrade' ? !!ctx.panelStage()?.openUpgradePicker?.('bankUpgrade', { onSkip })
        : offer === 'burn' ? !!ctx.panelStage()?.openUpgradePicker?.('bankBurn', { onSkip })
          : false;
    // 无候选（如升级 offer 但全牌组无过门晋升目标）：这份附赠无处兑现——弃置，
    // 别留一个没有任何入口的死 offer（面板按钮已删）。
    if (!opened && offer) { takeBankOffer(run); ctx.notify?.(); }
  }
  /** 两拍获得演出的编排已指令化（见上方 playDemonReward）：词条 → 逐张焚毁 → 金币 → 附赠选卡。 */

  // 老虎机产出的获得特写/多选一已移交问句驱动（runQuestions → openSlotPrizeShowcase，
  //  等转轮落定拍才弹）；本文件不再管 slotPending 的呈现。

  // 离房安慰奖（SLOT_MACHINE.md：同一层拉了 ≥3 次杆没中奖 → 送可乐/鸡腿二选一）：
  // 场景端播完"吐出→点选→飞出"后上行到这里结算，再播一次获得物特写（获得动画），
  // **然后自动把"离房"接着走完**：触发点就是玩家点「继续前进」，
  // 整条链是"离房 → 机器凑上来吐货 → 二选一 → 获得演出 → 离房切幕"，中间不需要玩家再点一次。
  const GIFT_TINT = { cola: 0xc0392b, chicken: 0xd9a05b };
  function slotTakeGift(choice) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    if (!answerQuestion(run, choice)) return;   // 欠着才有得答（不可放弃：义务门要求亲手领）
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
  // 商店房 = 一整间货房：点货架上的商品即买。**演出顺序**是
  // 「机器出货（场景 rig）→ 物品获得特写」——所以买入时场景里真的有这张卡位才挂一条
  // 「出货中」指令（等场景回执 shopAnimDone / durationMs 保险丝，两路收尾都补 notify）；
  // 问句呈现（开包）与遗物差分特写都让位到它收尾（否则全屏特写会直接盖住出货的开门/
  // 掉落/翻板那几拍）。逐商品一条指令、按序排队：并发购买各自的包各自等各自的回执。
  function shopBuy(index) {
    if (run.gameStage !== 'room' || !run.shop) return;
    const it = run.shop.items?.[index];
    // try/catch 硬化（同 bankDo/gurpasDo/slotTake 惯例）：场景端按快照的 sold/affordable
    // 放行意图，P4a 门控把陈旧窗拉宽到出货指令全程（最长 4s）——陈旧窗内重复点已售
    // 商品，core throw 不得炸穿点击链（pageerror），pending 留给下一次对账
    let res = null;
    try {
      res = buyShopItem(run, index);
    } catch (err) {
      console.warn('[shop]', err.message);
      return;
    }
    tooltipHide(); // 购买结算拍清悬空 tooltip：商品视图即离场（药水等"买了立即生效"件
                   // 没有后续 picker 接力——不清会空货位挂框 ≥8s，夜测 r4路2 两跑实证）
    // 出货演出位：场景里真的有这张卡片才播（有回执）；开包呈现由 runQuestions
    // 驱动——非出货路径本拍 notify 直接开，出货路径等回执那拍（别盖住掉落演出）
    const hasTile = [...(ctx.roomStage()?.rigs?.values() ?? [])]
      .some(r => (r.goodsTargets?.() ?? []).some(t => t.index === index));
    if (hasTile) {
      dedicatedSequencer.enqueueInstruction({
        meta: { event: 'room:shop-dispense', index },
        durationMs: 4000,   // 场景没回执（无场景/被拆）也要放行：收尾拍 notify 让问句驱动接手
        onEnd: () => ctx.notify(),
      });
    }
    ctx.notify();
    return res;
  }
  /** 场景回执：那件货已经掉进出货口 → 收掉对应出货指令（onEnd 补 notify 开包/差分特写）。 */
  function shopAnimDone(index) {
    if (run.gameStage !== 'room') return false;
    const instr = dedicatedSequencer.findPending(
      i => i.meta?.event === 'room:shop-dispense' && i.meta.index === index);
    if (instr) dedicatedSequencer.finish(instr.id, { reason: 'frontend' });
    return true;
  }

  /** 播完 core 声明的获得物特写（见 runPresenter.js：内容只声明，时序归 Shell）。 */
  function flushRunPresentations() {
    // 单位演出指令：事件驱动房间单位移动/形态——同排水时机送活动舞台。
    // 只有房间舞台实现 roomUnitCommand（battle/map 无房间活物，静默丢弃）。
    for (const cmd of runPresenter.drainUnitCommands()) {
      ctx.panelStage()?.roomUnitCommand?.(cmd);
    }
    for (const intent of runPresenter.drain()) {
      // 遗物获得：走遗物特写队列（铭文/稀有度着色/逐件排队），不吃通用三行特写
      if (intent?.kind === 'relic') { presentRelic(intent.defId); continue; }
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
      // 通用特写播完的补排钩子：特写播放不占队列（纯舞台态），期间入队的遗物特写
      // 等不到空闲沿——点掉这拍顺势补排（与遗物自身 onDismiss 链同款语义）
      ctx.panelStage()?.showcaseItem?.({ ...showcaseItemOf(intent), onDismiss: () => flushRelicShowcase() });
    }
  }

  /** 离局清理：挂起的待播演出/队列一并弃掉（属于这一局，重进由检查点重建稳态）；
   *  指令侧由 runController dispose 的 dedicatedSequencer.cancelAll() 一把收。 */
  function dispose() {
    demonRewardShow = null;
    relicShowcaseQueue.length = 0;
  }

  return {
    presentRelic, flushRelicShowcase,
    bankDemonPick, demonAnimDone, openBankOfferPicker,
    shopBuy, shopAnimDone,
    isShopDispensing,   // 问句呈现驱动的让位判据（= 出货指令在队）
    slotTakeGift,
    flushRunPresentations,
    dispose,
    intents: {
      buyShopItem: (i) => shopBuy(i.index),
      shopAnimDone: (i) => shopAnimDone(i.index),
      demonAnimDone: () => demonAnimDone(),   // 恶魔 roll 退场回执（非玩家意图）
      slotTakeGift: (i) => slotTakeGift(i.choice),
    },
  };
}
