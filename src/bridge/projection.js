import { swapCostOf } from '../core/state/battleState.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { getEffectDefinition, hasEffect } from '../core/effects/registry.js';
import { makeSkillCtx, canUseSkill, chantActivationLegal, pickOverflowVictims, handLimitOf, chantCapacityOf, handBreakdown } from '../core/skills/helpers.js';
import { isWaitingPlayerInput } from '../core/flow/battle.js';
import { createSkillRuntime } from '../core/state/skillRuntime.js';

// 状态投影：battleState → 前端只读视图（纯数据、可序列化）。
// 约定：runtime 上 `_` 结尾的字段是后端私有（_input/_draw/_slots…），一律不外发；
// 定义数据经注册表反查后压平进视图，Stage/Shell 不需要 import Core 注册表。

export function projectSkill(rt) {
  return {
    uniqueID: rt.uniqueID,
    defId: rt.defId,
    power: rt.power,
    remainingUses: rt.remainingUses,
    currentCooldown: rt.currentCooldown,
    isActivated: rt.isActivated,
  };
}

export function projectUnit(u) {
  return {
    uniqueID: u.uniqueID,
    defId: u.defId ?? null,
    name: u.name,
    side: u.side,
    hp: u.hp,
    maxHp: u.maxHp,
    shield: u.shield,
    isDead: u.isDead(),
    effects: u.effects.map(e => {
      // 定义元数据压平进视图（Stage 渲染效果行用，不 import Core 注册表）；
      // 未注册的效果（防御路径）按 id 兜底显示
      const def = hasEffect(e.effectId) ? getEffectDefinition(e.effectId) : null;
      return {
        effectId: e.effectId,
        stacks: e.stacks,
        name: def?.name ?? e.effectId,
        type: def?.type ?? 'buff', // 'buff'（层数绿）| 'debuff'（层数红）
        color: def?.color ?? null, // 特征色（richtext 颜色名）
        icon: def?.icon ?? null,
      };
    }),
    intention: u.intention ?? null,
  };
}

// 卡牌完整视图（Stage 烘焙纹理用）：runtime 投影 + 定义元数据 + 动态描述文本
// 关键词 id → 卡面页脚标签（drawFooter 直出；未映射的透传原词）。
// 导出供 shell 侧同源卡面预览（CardFacePreview）复用同一映射。
export const KEYWORD_LABELS = Object.freeze({
  exhaust: '消耗',
  innate: '固有',
  transient: '短暂',
  slowStart: '慢热',
  anchored: '锁定',
  blood: '卖血',
});

export function projectCardFull(battle, rt) {
  const def = getSkillDefinition(rt.defId);
  const sctx = makeSkillCtx(battle.ctx, rt);
  return {
    ...projectSkill(rt),
    name: def.name ?? rt.defId,
    tier: def.tier ?? null,
    type: def.type ?? 'normal',
    series: def.series ?? null,
    image: def.image ?? null,
    // 费用徽章同口径带上逐卡动态加价（manaCostDelta，如蓄热火球链「每次打出+1」）——
    // 手牌 sig 含 cost，蓄热次数变化会触发卡面重烘，徽章不漂移
    cost: (() => {
      const c = def.cost ?? { mana: 0, actionPoint: 0 };
      if (typeof c.mana !== 'number') return c;
      const d = def.manaCostDelta?.(sctx) ?? 0;
      return d ? { ...c, mana: c.mana + d } : c;
    })(),
    keywords: (def.keywords ?? []).map(k => KEYWORD_LABELS[k] ?? k),
    cardMode: def.cardMode ?? 'normal',
    chantWeight: def.chantWeight ?? null,
    pack: def.pack ?? null, // 'common' = 通用灰卡：卡面走偏白主题色
    // 前端交互声明：'enemy' = 需指定敌方目标（瞄准交互）；'none' = 免目标（拖拽出牌）
    targetMode: def.targetMode ?? 'none',
    charges: def.charges ?? null,
    // 战斗卡面 = 应用后描述（实时结算，previewDamage 干跑）；缺省回落应用前机制描述
    text: def.battleDescribe?.(sctx) ?? (def.describe ? def.describe(sctx) : ''),
    // 未应用描述（机制详情）：仅双轨卡提供（战斗卡面按住 Shift 临时切换），
    // 纯机制卡（无 battleDescribe）本身就是未应用口径，无切换意义 → null
    textAlt: def.battleDescribe && def.describe ? def.describe(sctx) : null,
  };
}

export function projectBattle(battle) {
  const { battleState, ctx } = battle;
  return {
    turn: { count: battleState.turn.count, side: battleState.turn.side },
    verdict: ctx.kernel.verdict,
    result: battleState.result,
    waitingPlayerInput: isWaitingPlayerInput(battle),
    pendingInput: battleState.pendingInput
      ? (() => {
        const req = battleState.pendingInput.request;
        // 「定义池选卡」（source 'pool'，发现类）：候选不在任何区——用一次性 runtime
        // 现投影（与真实区卡同形状，前端 _openPick 走 instantiate 分支直接实例化；
        // runtime 不入任何 zone，选完即弃，不影响对账）。
        let poolCards = null;
        if (req?.source === 'pool') {
          poolCards = {};
          for (const id of req.candidates ?? []) {
            try { poolCards[id] = projectCardFull(battle, createSkillRuntime(id)); }
            catch { poolCards[id] = null; }   // 定义缺失等异常：跳过该候选的渲染
          }
        }
        return poolCards ? { request: req, poolCards } : { request: req };
      })()
      : null,
    swapCost: swapCostOf(battleState),
    player: {
      ...projectUnit(ctx.player),
      mana: ctx.player.mana,
      maxMana: ctx.player.maxMana,
      actionPoints: ctx.player.actionPoints,
      maxActionPoints: ctx.player.maxActionPoints,
    },
    enemies: battleState.enemies.map(projectUnit),
    // 失明（银行机恶魔词条）：玩家看不见敌人意图（Stage 据此隐藏意图条）
    blind: !!battleState.debuffs?.blind,
    allies: battleState.allies.map(projectUnit),
    // 手牌额外带 usable：可用性判定本体在 core（canUseSkill），本地渲染直接调 core；
    // 但直播观战端没有 core，只能吃投影——故随投影下发，远端 bridge 据此回答
    // intents.canPlayCard（BattleStage.js:811 用它定手牌亮度）
    hand: battleState.zones.hand.map(rt => {
      const usable = canUseSkill(ctx, rt);
      // 不可用原因（首期只标「咏唱发动会被手牌压力挡下」——这类灰卡玩家看不出原因，
      // 需要 UI 给出提示；资源/冷却不足肉眼可读，不在此列）
      const def = getSkillDefinition(rt.defId);
      const blocked = (!usable && def?.cardMode === 'chant' && !rt.isActivated
        && !chantActivationLegal(ctx, rt, def)) ? 'chantPressure' : null;
      // locked（无人战体「解除威胁」）：被锁定的卡——回合结束时仍在手则被焚毁，
      // 离手即免除；不影响任何操作（BattleStage 据此挂四角锁定标记）
      return { ...projectCardFull(battle, rt), usable, blocked, locked: !!rt.locked };
    }),
    // 结算区（发动/被跨节拍处理的卡）：仅 id 列表——手牌来源的卡视图已在离手前
    // 的 hand 投影中建好；牌库来源（如斩进阶的宾语转化）无既有卡面，由 presenter
    // 的 cardShowcased/cardTransformed 载荷代投影 cardView（cardAdded 同款协议）。
    // Stage 据此将其映射为 held 展示态（停展示位等离场节拍，防对账绊线误杀）；
    // 咏唱卡结算后回手（发动/关停都留在手牌，激活态 = isActivated）
    pending: battleState.zones.pending.map(rt => rt.uniqueID),
    // P9 超载尾弃预告：此刻点结束回合会被弃掉的手牌（uniqueID 列表，尾部在前）。
    // BattleStage 在回合结束按钮 hover 时给这些卡打「将弃」标记——算法与核心清理
    // 共用 pickOverflowVictims（helpers.js），两处不得各自实现
    overflowVictims: pickOverflowVictims(battleState.zones.hand, ctx),
    // 手牌容量分解（批次 13 灯珠指示器与 headless 文本同源）：蓝珠=咏唱容量占用、
    // 绿珠=普通占用、黄珠=溢出激活咏唱占用、灰=空；超载无指示器（用户定 2026-09-13）。
    handCapacity: (() => {
      const { normal, chantW } = handBreakdown(battleState);
      const cap = chantCapacityOf(ctx);
      return {
        max: handLimitOf(ctx),
        chantCap: cap,
        normalUsed: normal,
        chantCapUsed: Math.min(chantW, cap),
        chantOverflowUsed: Math.max(0, chantW - cap),
      };
    })(),
    // 覆盖层（牌库/焚毁区查看器）用完整列表（含牌面烘焙所需的定义数据）；常规 HUD 只读 counts
    counts: {
      deck: battleState.zones.deck.length,
      burnt: battleState.zones.burnt.length,
    },
    zones: {
      deck: battleState.zones.deck.map(rt => projectCardFull(battle, rt)),
      burnt: battleState.zones.burnt.map(rt => projectCardFull(battle, rt)),
    },
  };
}
