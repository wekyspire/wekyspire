import { EventNames } from './events.js';
import { enqueueAnimInstruction, WIRE_END_GATE } from './wire.js';

// BridgePresenter：Core presenter 接口的默认实现。
// 翻译规则（老版 animationSequencer + 两套状态设计的继承）：
//   战斗事件 → sequencer 动画指令。sequencer 是 command queue（多指令可并发 running，
//              tags/waitTags 决定阻塞；默认 waitTags=['all'] = 严格串行），
//              时长走 ANIM_TIMING 超时兜底，start 时经 frontendBus 发给 Stage，
//              Stage 播完回 finish。所有参与时序的 non-trivial 动画都应由它编排，
//              只有 fire-and-forget 的小特效（粒子、脉冲）允许旁路。
//   状态同步 → **sync 动画指令**（tags:['state']）：前端显示状态只在 sync 节拍推进，
//              快照在指令 start 时拉取（合并此前全部变更）。每个 presenter 方法按
//              方向决定 sync 与动画节拍的相对位置：
//                效果类（伤害/治疗/…）→ anim 先，sync 后（演完再变数字）
//                入场类（抽牌/造牌/…）→ sync 先，anim 后（先转移再播动画）
//                离场类（弃/焚/迁移）  → anim 先，sync 后（飞进坟堆数字才+1）
//   生命周期 → battleStart 直接事件（不等动画，另发一次 sync 建初始场景）；
//              battleEnd 走队列尾闸——前置动画全部完成后才发 BATTLE_END（S0）。
//   requestInput → sync（玩家决策前显示状态必须最新）+ 回调给 interactionHandler。
// 每次调用都 markDirty：状态投影统一在这里标脏（替代旧仓库的 Vue watch）。
// 兜底：markDirty 后若没有任何显式 sync 覆盖（Core 存在不经 presenter 的迁移），
// bridge 在 tick 末补一次 syncState——显示状态永远不会长期滞留。
export function createBridgePresenter({
  sequencer, frontendBus, backendBus, markDirty, getSnapshot, onRequestInput = null, projectCard = null,
}) {
  // 入队走 wire.js 的共用构造：同一条指令描述符既用于本地播放、也在直播推流时
  // 原样发给浏览器端重建（两边不会漂移）。durationMs 缺省 = ANIM_TIMING 同款兜底。
  const anim = (event, payload) => {
    enqueueAnimInstruction(sequencer, { event, payload });
    markDirty();
  };

  // 状态同步节拍：**快照在入队时捕获**——每次 sync 呈现其发生时刻的状态，
  // 一条结算链因此渐进揭示（抽牌 sync 只看见抽牌、伤害 sync 只看见伤害），
  // 后续变更由后续的 sync 覆盖。绝不能在 start 时拉取——内核同步结算完毕，
  // 那会让首个 sync 直接剧透终态（卡牌还没飞，坟堆数字已+1）。
  // 入队时先 markDirty：状态变更本身不一定经过 presenter（如指令内直接 moveCard），
  // 不标脏 getSnapshot 会拿到缓存的旧投影。
  // 快照放 meta.payload（与放 start 闭包等价——两者都在入队时刻捕获），
  // 这样直播端能从描述符里原样重建出同一条 sync 节拍。
  const syncState = () => {
    markDirty();
    const snapshot = getSnapshot();
    enqueueAnimInstruction(sequencer, {
      event: EventNames.ANIM_STATE_SYNC,
      payload: { snapshot },
      tags: ['state'],
    });
  };

  const log = (text, kind = 'info') => backendBus.emit(EventNames.BATTLE_LOG, { text, kind });

  return {
    // 兜底出口：bridge 在 tick 末发现脏状态无显式 sync 覆盖时调用
    syncState,

    battleStart: ({ battleState }) => {
      markDirty();
      backendBus.emit(EventNames.BATTLE_START, {
        enemies: battleState.enemies.map(e => ({ uniqueID: e.uniqueID, name: e.name })),
      });
      syncState(); // 初始场景经同一通道建立（队列空闲 → 立即应用）
    },
    battleEnd: ({ result }) => {
      markDirty();
      syncState(); // 终局状态（死亡/结果）同步给显示层
      // BATTLE_END 排队尾（S0）：死亡动画与终局 sync 全部完成后才发射，
      // run 层的幕间转场/切舞台不再打断尚未播完的终局演出。
      // 自完结指令：发射即 finish（同步泵起后续——如 endBattle 入队的幕间黑幕）
      sequencer.enqueueInstruction({
        meta: { event: WIRE_END_GATE },
        // 非可视化记账节拍：直播端按名特判（发本地 backendBus + 自完结），不当动画播
        wire: { event: WIRE_END_GATE, payload: { result } },
        durationMs: 0,
        start: ({ id }) => {
          backendBus.emit(EventNames.BATTLE_END, { result });
          sequencer.finish(id);
        },
      });
    },

    // ---- 效果类：先动画，后 sync（演完再变数字） ----
    damage: (p) => {
      anim(EventNames.ANIM_DAMAGE, p);
      syncState();
      log(`${p.source?.name ?? '环境'} 对 ${p.target.name} 造成 ${p.dealt} 点伤害`, 'combat');
    },
    heal: (p) => {
      anim(EventNames.ANIM_HEAL, p);
      syncState();
      log(`${p.target.name} 恢复 ${p.healed} 点生命`, 'combat');
    },
    shield: (p) => { anim(EventNames.ANIM_SHIELD, p); syncState(); },
    resource: (p) => { anim(EventNames.ANIM_RESOURCE, p); syncState(); },
    effect: (p) => { anim(EventNames.ANIM_EFFECT, p); syncState(); },
    unitDeath: (p) => {
      anim(EventNames.ANIM_UNIT_DEATH, p);
      syncState();
      log(`${p.unit.name} 被击败！`, 'combat');
    },

    // 单位生成（召唤）：入场类——先 sync（视图/槽位就位）再播「立起」演出
    unitSpawned: (p) => {
      syncState();
      anim(EventNames.ANIM_UNIT_SPAWN, p);
      log(p.source ? `${p.source.name} 召唤了 ${p.unit.name}！` : `${p.unit.name} 现身！`, 'combat');
    },

    // ---- 入场/信息类：先 sync，后动画（先转移再播动画） ----
    skillUsed: (p) => {
      syncState();
      anim(EventNames.ANIM_SKILL_USED, p);
      log(`使用 ${p.def?.name ?? p.skill.defId}`, 'skill');
    },
    chantToggled: (p) => { syncState(); anim(EventNames.ANIM_CHANT_TOGGLED, p); },
    cooldownTick: (p) => { syncState(); anim(EventNames.ANIM_COOLDOWN_TICK, p); },

    cardDrawn: (p) => { syncState(); anim(EventNames.ANIM_CARD_DRAWN, p); },
    // 造牌按落区分流：入库（toZone 'deck'）= 离场次序（先演出后 sync）——
    // 卡牌生成→飞入牌库→计数才跳增；且载荷附带 cardView（造出的卡不在显示区，
    // Stage 无法从投影反查牌面，需此处代为投影）。入手等其他落区维持入场类次序。
    cardAdded: (p) => {
      if (p.toZone === 'deck') {
        anim(EventNames.ANIM_CARD_ADDED, { ...p, cardView: projectCard?.(p.card) ?? null });
        syncState();
      } else {
        syncState();
        anim(EventNames.ANIM_CARD_ADDED, p);
      }
    },
    // 宾语展示（转化等）：入场类——先 sync（离区入 pending，区域计数先变）再飞中央。
    // cardView 由 bridge 代为投影：牌库/结算区卡不在 hand 投影内，Stage 无从取卡面
    cardShowcased: (p) => {
      syncState();
      anim(EventNames.ANIM_CARD_SHOWCASE, {
        ...p, cardView: projectCard?.(p.card) ?? null,
      });
    },
    // 转化：先 sync 后演出。held/deck 来源卡不经 hand 内容同步，换脸由节拍内
    // setCard(cardView) 承担（同 cardShowcased 的代投影理由）
    cardTransformed: (p) => {
      syncState();
      anim(EventNames.ANIM_CARD_TRANSFORMED, {
        ...p, cardView: projectCard?.(p.card) ?? null,
      });
    },

    // ---- 离场类：先离场飞行动画，后 sync（飞进坟堆数字才+1） ----
    cardDiscarded: (p) => { anim(EventNames.ANIM_CARD_DISCARDED, p); syncState(); },
    cardBurnt: (p) => { anim(EventNames.ANIM_CARD_BURNT, p); syncState(); },
    cardMoved: (p) => { anim(EventNames.ANIM_CARD_MOVED, p); syncState(); },
    cardSwapped: (p) => { anim(EventNames.ANIM_CARD_SWAPPED, p); syncState(); },

    // 结算期输入请求：先 sync（玩家决策前显示状态必须最新），
    // 请求本身不进动画队列，直接交仲裁器（战斗已挂起，等的是玩家不是动画）
    requestInput: ({ request }) => {
      markDirty();
      syncState();
      onRequestInput?.(request);
    },
  };
}
