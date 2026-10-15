// 「房间机器流」域：老虎机 / 银行机 / 古尔帕斯之店 / 售货机收尾 / 吞噬 这几台机器的**交互编排**。
//
// 分工：core 结算与各房间 API 在 `core/run/rooms/*`（纯逻辑、可 headless）；这里管
// 「意图 → core 调用 → notify → 附带演出触发」——时序归 Shell，机器语义归 core。
//
// 由 runController 构造（`createRunMachines(ctx)`），ctx 里的引用一律**晚绑定**（与 runShowcase 同律）：
//   · notify()/panelStage()/roomStage() —— runController 里这些在构造之后才初始化；
//     箭头闭包捕获词法绑定，运行期才取值，初始化顺序安全。
//   · slot —— 同一对象引用（房间层舞台侧瞬态：老虎机演出播放态）。
// 模块内的 core 调用随函数一起搬进来（见下方 import）。

import {
  bankDeposit, bankWithdraw, bankOverdraft, bankUpgrade, bankBurn,
} from '../core/run/rooms/bank.js';
import {
  buyGurpas, takeGurpasCard, sellGurpasRelic, removeCardAtGurpas,
} from '../core/run/rooms/gurpas.js';
import {
  spinSlot, slotUpgrade,
  devourSlot, devourableRelics, devourableCards, devourReady, slotView,
} from '../core/run/rooms/slotMachine.js';
import { answerQuestion } from '../core/run/questions.js';
import { panelSnapshot } from '../core/run/panelSnapshot.js';
import { getRelicDefinition } from '../core/relics/registry.js';
import { tooltipHide } from './tooltipHub.js';
import { enqueueFlowInstruction, waitFor } from './flowInstruction.js';
import { settings, persistSettings } from './settings.js';

export function createRunMachines(ctx) {
  const { run, slot, dedicatedSequencer, cutscene, showcase } = ctx;

  // ---- 机器内容触发 ----
  // 恶魔 roll 解说（面板指引文本全删，改对话简述）——超额取款入账、机器切恶魔形态
  // 那一刻讲：生涯首次讲清规则（持久化 settings），之后每次只一句「你知道该干什么。」。
  // 让位必须带重试：上一发词条→金币特写常常还没收完（uiBusy），等待期间 pendingRoll
  // 翻篇即不解说（无墙钟：玩家节奏段）。
  let narratedDemonRoll = null;
  function maybeNarrateDemonRoll() {
    const pr = run.bank?.pendingRoll;
    if (!pr) { narratedDemonRoll = null; return; }
    if (pr === narratedDemonRoll) return;
    if (run.gameStage !== 'room') return;
    narratedDemonRoll = pr;
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'demon-narrate', meta: { event: 'room:demon-narrate' },
      entryOk: () => run.bank?.pendingRoll === pr && run.gameStage === 'room',
      play: async (done) => {
        try {
          await waitFor(() => !ctx.panelStage()?.uiBusy);
          if (run.bank?.pendingRoll !== pr) return;   // 等待期间局面已翻篇：不讲
          const first = !settings.demonRollTutored;
          if (first) { settings.demonRollTutored = true; persistSettings(); }
          await cutscene.play({
            steps: [{
              type: 'dialogue',
              pages: [{
                speaker: '恶魔轮盘',
                text: first
                  ? '支付代价的时候到了。\n转动恶魔轮盘，然后选一个诅咒承受。'
                  : '你知道该干什么。',
              }],
            }],
          });
        } finally { done(); }
      },
    });
  }

  // 吞噬首满教学：生涯首次把老虎机喂到张嘴时弹一次指引对话，
  // 持久化在 settings（跨局只弹一次）；UI 上不放任何吞噬说明文本。
  function maybeTutorDevour() {
    if (settings.slotDevourTutored) return;
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot' || !devourReady(run)) return;
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'room:devour-tutor')) return;   // 已有一份在等/在播
    enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'devour-tutor', meta: { event: 'room:devour-tutor' },
      entryOk: () => true,   // 生涯标记在开播前才消费（放弃路径可重试）；指令只管让位时序
      play: async (done) => {
        try {
          if (settings.slotDevourTutored) return;   // 排队期间首份已播（无早消费后的防重入）
          // 限期让位（无墙钟：玩家节奏段）：模态开着等它收。⚠ 等待期出现产出待领
          // （slotPending）立即放弃本次——产出特写/选卡的呈现被本指令占队推迟会互等
          // 死锁（P4a 门控实测形态）；放弃不消费标记，下一杆 onEnd / 进房钩子自然重试
          let bailed = false;
          await waitFor(() => {
            if (run.slotPending) { bailed = true; return true; }
            return !ctx.panelStage()?.uiBusy;
          });
          if (bailed) return;
          if (run.gameStage !== 'room' || run.currentRoom !== 'slot' || !devourReady(run)) return;
          settings.slotDevourTutored = true;   // 开播前消费：放弃路径不烧生涯唯一一次
          persistSettings();
          await cutscene.play({
            steps: [{
              type: 'dialogue',
              pages: [{
                speaker: '老虎机',
                text: '吃得太饱了。\n机器张开了嘴——投进去点什么，它会用金币回报你。',
              }],
            }],
          });
        } finally { done(); }
      },
    });
  }

  // 进房钩子（恢复/重进覆盖）：赌厅入场景后查两个电平——喂满待教学、恶魔 roll 挂起待解说。
  // 读档恢复带出的 pendingRoll / 满进度由此兑现（恢复即重发，同问句驱动口径）。
  function onSlotRoomEntered() {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    maybeTutorDevour();
    maybeNarrateDemonRoll();
  }

  // ---- 银行机（与老虎机成对；SLOT_MACHINE.md §银行机）----
  function bankDo(kind, arg, arg2 = null) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    try {
      if (kind === 'deposit') bankDeposit(run, arg ?? null);       // 缺省 = 全部存入
      else if (kind === 'withdraw') bankWithdraw(run);
      else if (kind === 'overdraft') bankOverdraft(run, arg);
      else if (kind === 'pick') showcase.bankDemonPick(arg);
      else if (kind === 'upgradeOffer') bankUpgrade(run, arg, arg2); // arg2 = 分叉目标
      else if (kind === 'burnOffer') bankBurn(run, arg);
    } catch (err) {
      console.warn('[bank]', err.message);
    }
    ctx.notify();
    if (run.bank?.pendingRoll) maybeNarrateDemonRoll();   // 恶魔 roll 挂起：解说在 overdraft 入账那拍触发
  }

  // Boss 奖励的删卡机会（§2.1）：与古尔帕斯删卡服务同一套能力。
  // 机会即时消耗不留存：获得那一拍（领完奖励/跳过进阶后）就地弹全屏删卡，
  // 放弃 = 作废；确认 = 焚卡演出落账（bossRemoveCard）。
  function bossRemoveCard(uniqueID) {
    if (run.pendingCardRemoval <= 0) return;
    try {
      removeCardAtGurpas(run, uniqueID);
      run.pendingCardRemoval -= 1;
    } catch (err) {
      console.warn('[removeCard]', err.message);
    }
    ctx.notify();   // 选卡器随确认自收；流程指令的 waitFor 在 uiBusy 落定拍接住
  }

  // 编排 = 'run:boss-remove' 流程指令（队列单飞）：先让位在播特写（特写 busy 会吞掉
  // 选卡器的全部点击 = 玩家死锁），弹删卡选卡后等它以**任意路径**收起（uiBusy 盖住
  // 选卡/焚卡两态）——确认与放弃各有消费路径，切幕静默收视为放弃（机会作废）。
  // 返回的 Promise 在流程收尾拍 resolve：claimReward 的回塔链 await 它
  //（删卡没落定不切幕，选卡不会被黑幕中途吞掉）。
  function playBossRemoveNow() {
    return new Promise((resolve) => {
      const enqueued = enqueueFlowInstruction(dedicatedSequencer, {
        tag: 'boss-remove', meta: { event: 'run:boss-remove' },
        entryOk: () => run.pendingCardRemoval > 0,
        play: async (done) => {
          try {
            // 入手特写在播时让位（特写 busy 会吞掉选卡器的全部点击 = 玩家死锁）：
            // 等特写落定（玩家点收下）再弹。正常流程领奖前特写必已收——这是防御位。
            await waitFor(() => !ctx.panelStage()?.showcasing);
            // 候选快照现场投影直喂（opts.snap）：不读分布式面板快照——boss-remove 窗口期
            // gameStage 已离 reward，battleStage 的面板分发是 setPanel(null)（读 _snap 必
            // 空手）；现场投影既带 cardRemoval 段、也含刚领的奖励卡（P4a 前的陈旧窗旧病同除）
            const opened = ctx.panelStage()?.openUpgradePicker?.('bossRemove', {
              snap: panelSnapshot(run, {}),
              // 放弃（返回/关闭）= 机会作废，不留存
              onSkip: () => { run.pendingCardRemoval = 0; ctx.notify(); },
            });
            if (!opened) {   // 无候选可删（空牌组等极端）：机会无从使用，直接作废
              run.pendingCardRemoval = 0;
              ctx.notify();
              return;
            }
            // 等收起（含焚毁演出）。静默收（切幕 dismissModals 不触发 onSkip——旧实现
            // 在这里会永远等不到回执）：没消费就收起 = 与放弃同判，机会作废。
            await waitFor(() => !ctx.panelStage()?.uiBusy);
            if (run.pendingCardRemoval > 0) { run.pendingCardRemoval = 0; ctx.notify(); }
          } finally {
            done();
            resolve();
          }
        },
      });
      if (!enqueued) resolve();   // 机会已不在（并发消费/局面翻篇）：立即回执
    });
  }

  // ---- 古尔帕斯之店（35 层固定房；SHOP.md §二）----
  function gurpasDo(kind, arg, arg2) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'gurpas') return;
    try {
      if (kind === 'buy') {
        const res = buyGurpas(run, arg);
        // 删卡服务（qa 断链）：付完款**当场**开全屏选卡——购买动作此前
        // 只扣钱计次，选卡界面没人打开（来源表/意图都在，唯独缺这一跳）
        if (res?.kind === 'remove') ctx.panelStage()?.openUpgradePicker?.('gurpasRemove');
        // 遗物货架：买定即获得特写（授予源显式声明，不再依赖拥有集差分）
        if (res?.kind === 'relic' && res.relicId) showcase.presentRelic(res.relicId);
      }
      else if (kind === 'take') takeGurpasCard(run, arg);
      else if (kind === 'sell') sellGurpasRelic(run, arg);
      else if (kind === 'remove') removeCardAtGurpas(run, arg2 ?? arg);
    } catch (err) {
      console.warn('[gurpas]', err.message);
    }
    ctx.notify();
  }

  // ---- 老虎机拉杆（转轮 = 纯演出指令）----
  // 逻辑先行（spinSlot 扣费定奖挂 slotPending=问句），转轮随后揭示产出：
  //   · start 直调当前宿主的 playSlotSpin（RoomStage 机器 rig / MapStage 降级转轮，
  //     同一指令的两个宿主实现），播完回执 sequencer.finish；
  //   · onEnd（apply-point 'end'）落揭示载荷（slot.lastSpin + notify）——回执与
  //     durationMs 保险丝两条完成路径都走它，转轮卡死也不会把「转动中」闸门锁死；
  //   · 产出特写/多选一由问句驱动接管（runQuestions，等转轮落定拍）。
  function spin() { // 可重复消费（每次扣费/消耗免费 roll）；roll 动画经 run sequencer 串行编排
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    if (run.slotPending) return; // 上一次产出还没处理
    // 转轮在播即拒（类型化队列查询，不依赖面板置灰——P4a 门控下置灰随空闲沿补发，
    // 演出窗内按钮可点，连点防双扣的仲裁必须走队列真值）
    if (dedicatedSequencer.findPending(i => i.meta?.event === 'room:slot-spin')) return;
    const prize = spinSlot(run); // 逻辑先行：扣费与定奖立即结算，演出随后揭示产出
    dedicatedSequencer.enqueueInstruction({
      meta: { event: 'room:slot-spin', prize: prize.kind },
      durationMs: 4000, // 前端卡死保险丝：超时强杀时 onEnd 载荷照样揭示
      start: ({ id }) => {
        const done = () => dedicatedSequencer.finish(id, { reason: 'frontend' });
        if (!ctx.panelStage()?.playSlotSpin?.({ id, tier: prize.tier }, done)) done();
      },
      onEnd: () => {
        slot.lastSpin = prize; // 结果在动画落定后揭示（渐进揭示语义）
        ctx.notify();
        maybeTutorDevour();    // 喂满那一拉：教学在揭示拍触发（转轮已定，产出/模态由流程内让位）
      },
    });
    ctx.notify({ force: true });   // 拉杆拍强制刷面板：转轮窗内按钮即时置灰（防连点反馈，队列守卫兜正确性）
  }
  // 产出结算（可放弃——文档：这些产出总是可以放弃不要的）。try/catch 硬化：
  // core 校验失败（脏档/竞态）不得炸穿点击链——回执进调试面板，pending 留给「放弃」兜底
  function slotTake(choice = null) {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    const prize = slot.lastSpin;   // 领取前留影：遗物类奖项的授予 id 从揭示横幅读
    try {
      answerQuestion(run, choice ?? 'take'); // choice=null 的收下（无需挑选的奖项）
    } catch (err) {
      console.warn('[slotTake]', err.message);
    }
    // 遗物奖项（固定 relicId / relicChoices 择一）授予源显式特写（单件遗物直答路径
    // 在 runQuestions 的 slotPrize present 里，两处同源同款）
    const granted = prize?.relicChoices
      ? (prize.relicChoices.some(r => r.id === choice) ? choice : null)
      : (prize?.relicId ?? null);
    if (granted) showcase.presentRelic(granted);
    // 大奖「免费指定升级」：收下即欠一次升级选卡——编排器就地开（force 刷新面板快照，
    // panelHost 直开读活 _snap；kit 闭包旧快照开卡必空的软锁根因即在此拍没刷新）
    if (run.slotUpgradePending) {
      ctx.notify({ force: true });   // 快照新鲜度契约：下一行直开选卡，此刻选卡/飞行可能占队
      ctx.panelStage()?.openUpgradePicker?.('slot');
    }
    ctx.notify();
  }
  function slotDecline() {
    if (run.gameStage !== 'room' || !run.slotPending) return;
    try {
      answerQuestion(run, null);
    } catch (err) {
      console.warn('[slotDecline]', err.message);
    }
    ctx.notify();
  }
  // 大奖「免费指定升级」：选卡界面确认后落地（分叉卡由升级子面板带 targetId）
  function slotPickUpgrade(uniqueID, targetId = null) {
    if (run.gameStage !== 'room' || !run.slotUpgradePending) return;
    slotUpgrade(run, uniqueID, targetId);
    ctx.notify();
  }
  // 吞噬（粉碎换金币）
  function slotDevour(target) {
    if (run.gameStage !== 'room' || run.currentRoom !== 'slot') return;
    devourSlot(run, target);
    ctx.notify();
  }

  // 离房安慰奖（可乐/鸡腿二选一 + 获得演出 + 自动续上离房）在 runShowcase.js（slotTakeGift）。

  // ---- 粉碎物品（老虎机吞噬）----
  // 链条：入口（投料口热区/兜底面板按钮）→ **dialogue 层**问「粉碎什么？」（选项按
  // 可粉碎内容动态隐藏）→ 全屏选卡 / 选遗物 → 提交 core → 金币获得特写。
  // 对话是 Shell 层的东西（CutsceneOverlay），所以这条链只能编排在这里——Stage 只负责
  // 「谁被点了」和「把候选画出来」，不做游戏判定。
  // 单飞纪律归队列（不再手写 busy 锁）：流程 = 一条 'room:devour-flow' 指令（默认串行），
  // 在播期间的再入排在队尾，轮到它时若进度已被首份流程消费（devourReady=false）即自灭。
  // 投料口点选先于模态路由（RoomStage 既有秩序），选卡界面开着时 3D 投料口照样吃得着
  // 点击——这正是要靠队列 + 状态门拦的再入源。
  // start 内 try/finally 收尾 finish：链上任何一环抛错指令也不悬挂；玩家节奏段
  // （对话/选卡可长考）不上墙钟保险丝（时基约定同 battle-span）。
  function openDevourFlow() {
    // 壳见 flowInstruction.js：流程内部还要往同一队列排剧本步骤/特写链，故退出 'all'
    // 防互等死锁；再入由自家标签互等拦住排队，轮到时 entryOk 状态门自灭。
    return enqueueFlowInstruction(dedicatedSequencer, {
      tag: 'devour-flow', meta: { event: 'room:devour-flow' },
      entryOk: () => run.gameStage === 'room' && run.currentRoom === 'slot'
        && !run.slotPending && devourReady(run)
        && (devourableCards(run).length > 0 || devourableRelics(run).length > 0),
      play: playDevourFlow,
    });
  }
  async function playDevourFlow(done) {
    try {
      const relics = devourableRelics(run);
      const cards = devourableCards(run);
      const choices = [];
      if (cards.length) choices.push({ id: 'card', label: '粉碎一张卡牌', hint: `${cards.length} 张可选` });
      if (relics.length) choices.push({ id: 'relic', label: '粉碎一件遗物', hint: `${relics.length} 件可选` });
      choices.push({ id: 'cancel', label: '算了' });
      let picked = null;
      await cutscene.play({
        steps: [{
          type: 'dialogue',
          pages: [{
            speaker: '老虎机',
            text: '机器张开了嘴，齿间漏出金币碰撞的响声。\n「粉碎什么？」',
            choices,
          }],
          onChoice: (id) => { picked = id; },
        }],
      });
      if (picked !== 'card' && picked !== 'relic') return;
      const stage = ctx.panelStage();
      if (stage?.cardPicker?.opened || stage?.relicPicker?.opened) return;
      stage?.openDevourPicker({
        kind: picked,
        cards: cards.map(c => ({ uniqueID: c.uniqueID, defId: c.defId })),
        relics: relics.map(r => ({
          id: r.id, name: r.name, rarity: r.rarity,
          desc: getRelicDefinition(r.id)?.description ?? '',
        })),
        onPick: (key) => {
          const res = picked === 'card'
            ? devourSlot(run, { kind: 'card', uniqueID: key })
            : devourSlot(run, { kind: 'relic', relicId: key });
          // 金币走显示标量通道（§4.6）：core 已结算，先按住显示再 notify（那拍顶栏仍是旧值）。
          // 按住窗指令化（holdBeat）：特写播放挂在队列里，空闲对账不会把它冲掉
          let releaseHold = null;
          if (res.gold > 0) releaseHold = ctx.scalars.holdBeat({ scalar: 'money', amount: res.gold });
          const releaseGold = () => {
            const alive = releaseHold?.();   // holdBeat 收尾回执：false = 保险丝已收（长 AFK
            releaseHold = null;              // 边界，delta 已被对账贴平）——跳过 flight 防过冲
            if (alive !== false) void ctx.scalars.flight({ scalar: 'money', amount: res.gold });
          };
          ctx.notify();                          // 进度即刻清零：排队中的再入自此全部自灭
          ctx.roomStage()?.playCrush?.();   // 机器端的"咬合 + 迸币"演出（结算已完成，这里只是表现）
          // 金币获得特写（通用组件：有素材用素材，没有就拿色块代替）：
          // 点掉特写 → 飞行拍释放显示增量，顶栏数字此刻才 +N（§4.6 通道）；
          // 切幕强收（cancel 出口）→ 立即释放（收尾 holdBeat 指令不留孤儿），
          // 不播飞行——cancel 语义 = 呈现被弃，显示直接由对账贴平
          const opened = ctx.panelStage()?.showcaseItem({
            title: `+${res.gold} 金币`,
            desc: picked === 'card' ? '老虎机满意地嚼碎了那张卡牌' : '老虎机满意地嚼碎了那件遗物',
            effect: res.freeRoll ? '作为回报，它决定让你免费玩一轮老虎机！' : '金币已经落进你的钱袋！',
            artKey: 'gold',
            tint: 0xffd75e,
            onDismiss: releaseGold,
            onCancel: () => {
              releaseHold?.();
              releaseHold = null;
              ctx.scalars.release('money', res.gold);
            },
          });
          if (!opened) releaseGold();
        },
      });
    } catch (err) {
      console.warn('[devour]', err.message);   // 链上异常不炸穿：指令在 finally 里收尾
    } finally {
      done();
    }
  }
  // ---- 商店（售货机，SHOP.md §一）----
  // 购货的出货演出与获得特写（含"买到即自动开包"）在 runShowcase.js（shopBuy/shopAnimDone）。
  function shopTakeCard(defId) {
    if (run.gameStage !== 'room' || !run.shopPending) return;
    answerQuestion(run, defId);  // defId = null → 放弃这个卡包（choice 不够好时的出口）
    tooltipHide();              // 售出商品视图即离场：悬空 tooltip 必清
    ctx.notify();
  }
  function shopTakeRelic(relicId) {
    if (run.gameStage !== 'room' || !run.shopPending) return;
    answerQuestion(run, relicId);  // relicId = null → 放弃这个遗物包（与卡包同口径）
    tooltipHide();                  // 同上
    if (relicId) showcase.presentRelic(relicId);   // 授予源显式特写
    ctx.notify();
  }

  return {
    bankDo, bossRemoveCard, playBossRemoveNow, gurpasDo,
    spin, slotTake, slotDecline, slotPickUpgrade, slotDevour,
    openDevourFlow, shopTakeCard, shopTakeRelic,
    onSlotRoomEntered,   // 进房钩子（runController enterRoomPresentation 派发：恢复/重进的电平覆盖）
    slotView: () => slotView(run),
    devourableRelics: () => devourableRelics(run),
    devourableCards: () => devourableCards(run),
    // 静止态断言（quiescence.js 消费）：全屏模态关闭的静止时刻，这些位必须回稳态。
    // 吞噬/删卡流程均已指令化（流程指令在队 = 队列忙，断言器自然不采样）。
    quiescenceFailures: () => [],
    intents: {
      spin: () => spin(),
      bankDeposit: (i) => bankDo('deposit', i.amount ?? null),
      bankWithdraw: () => bankDo('withdraw'),
      bankOverdraft: (i) => bankDo('overdraft', i.tier),
      bankPick: (i) => bankDo('pick', i.id),
      bankUpgradeOffer: (i) => bankDo('upgradeOffer', i.uniqueID, i.targetId ?? null),
      bankBurnOffer: (i) => bankDo('burnOffer', i.uniqueID),
      bossRemoveCard: (i) => bossRemoveCard(i.uniqueID),
      gurpasBuy: (i) => gurpasDo('buy', i.index),
      gurpasTake: (i) => gurpasDo('take', i.defId),
      gurpasSell: (i) => gurpasDo('sell', i.relicId),
      gurpasRemove: (i) => gurpasDo('remove', i.uniqueID, i.uniqueID),
      slotTake: (i) => slotTake(i.choice ?? null),
      slotDecline: () => slotDecline(),
      slotPickUpgrade: (i) => slotPickUpgrade(i.uniqueID, i.targetId ?? null),
      requestDevour: () => openDevourFlow(),
      slotDevourRelic: (i) => slotDevour({ kind: 'relic', relicId: i.relicId }),
      slotDevourCard: (i) => slotDevour({ kind: 'card', uniqueID: i.uniqueID }),
      takeShopCard: (i) => shopTakeCard(i.defId),
      takeShopRelic: (i) => shopTakeRelic(i.relicId),
    },
  };
}
