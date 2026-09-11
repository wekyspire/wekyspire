// 火灵脉·叠炎组合（FIRE_VEIN_CARDS §2.1 前半）。
// 点火系列（烈焰/炙焰）+ 燃元系列散卡（燃元/炼心/激热/化焰）+ 控火系列十张
// （燃/灭/灼/散/收/扰/爆/聚/炼/无上）。
// 自焚 / 焰愈 / 焚原 / 镜燃 + 咏唱（燃心决/取暖/绝炎）见 fireEmberMoreSkills.js。
//
// 全文件统一口径（设计稿未注明处按下列假设落地，注释就地说明）：
//   * 点火系列的伤害走 F1 攻击面板轨（基数 + 攻击 + power），battleDescribe 一律经
//     resolvedDamageText 干跑真实修正管线（A5 所见即所算）；
//   * 「每有 4 层燃烧」（燃元/炼心）按【场上敌方全体燃烧层数总和】计——叠炎主轴是把
//     燃烧叠在敌人身上，燃元系列即把这份燃烧转化为资源（自身/盟友燃烧不计）；
//   * 「消耗燃烧」= AddEffectInstruction 负层数（扣尽自动移除，负溢出无害）；
//   * 控火系列的「目标」默认玩家指定敌人（cardKit.enemyTarget：指定优先 → 首个存活敌人），
//     无存活敌人时静默落空（战斗通常已终局，此处仅防御性兜底）。

import { registerSkill } from '../skills/registry.js';
import { zoneOf, aliveEnemies, unitsOfSide, allAliveUnits } from '../state/battleState.js';
import { DealDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { applyBattleModifier } from '../run/prep.js';
import { getEffectDefinition } from '../effects/registry.js';
import { enemyTarget, dealDamage, attackDamage, addEffect, gainShield, addCard, resolvedDamageText } from './cardKit.js';

// ==== 点火系列（基石：点火 C → 烈焰 B → 炙焰 A）===============================
// 点火 C（3伤害 + 燃烧5）已在 skills.js 定义；此处补 B/A 两阶。
// 伤害走 F1 攻击面板轨，与「点火」同口径；升阶只放大燃烧层数。

// 烈焰 B：1AP，3 伤害，施加燃烧 7。
registerSkill({
  id: 'blaze', name: '烈焰', type: 'fire', tier: 'B', series: 'ignite',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'inferno',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true; // 无存活敌人：落空（G2 收尾防御）
    attackDamage(sctx, 3, { target });
    addEffect(sctx, 'burn', 7, target);
    return true;
  },
  describe: () => '3伤害，赋予/effect{燃烧}7',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 3)}，赋予/effect{燃烧}7`,
});

// 炙焰 A：1AP，3 伤害，施加燃烧 10（点火链顶点，无晋升）。
registerSkill({
  id: 'inferno', name: '炙焰', type: 'fire', tier: 'A', series: 'ignite',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 3, { target });
    addEffect(sctx, 'burn', 10, target);
    return true;
  },
  describe: () => '3伤害，赋予/effect{燃烧}10',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 3)}，赋予/effect{燃烧}10`,
});

// ==== 燃元系列（散卡：燃烧 → 魏启资源）=======================================

// 敌方全体燃烧层数总和（燃元/炼心的统一读数口径，见文件头注释）。
function totalEnemyBurn(sctx) {
  return aliveEnemies(sctx.battleState).reduce(
    (n, e) => n + e.getEffectStacks('burn'), 0);
}

// 燃元 B：1AP，消耗。每有 4 层（敌方）燃烧，魏启上限 +1。
// 口径：上限抬升「战斗内永久」——写进 battleState.modifiers（本场修正），
// 随战斗对象一起消失，故**不需要战后回滚**，也不再往 skillRuntime 上挂记账字段。
registerSkill({
  id: 'emberOrigin', name: '燃元', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    const gain = Math.floor(totalEnemyBurn(sctx) / 4);
    if (gain > 0) applyBattleModifier(sctx, 'maxMana', gain);
    return true;
  },
  describe: () => '敌方每有4层/effect{燃烧}，魏启上限+1（本场战斗内）',
  battleDescribe: (sctx) => {
    const total = totalEnemyBurn(sctx);
    return `敌方/effect{燃烧}共${total}层：魏启上限+${Math.floor(total / 4)}（本场战斗内）`;
  },
});

// 炼心 A：1AP。每有 4 层（敌方）燃烧，获得 1 魏启（走上限截断管线）。
registerSkill({
  id: 'refineHeart', name: '炼心', type: 'fire', tier: 'A', series: 'ember',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    const gain = Math.floor(totalEnemyBurn(sctx) / 4);
    if (gain > 0) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: gain }));
    }
    return true;
  },
  describe: () => '敌方每有4层/effect{燃烧}，获得1魏启',
  battleDescribe: (sctx) => {
    const total = totalEnemyBurn(sctx);
    return `敌方/effect{燃烧}共${total}层：获得${Math.floor(total / 4)}魏启`;
  },
});

// 激热 C：0 费。触发目标一次燃烧结算——完全复刻 burn 效果的回合开始行为：
// 无来源固定伤害（tags:['burn']，防火经该标记 veto；烈焰亲和就地减免）+ 层数 -1。
// 语义：把下一次自然跳伤提前到现在（提前一拍爆发/收尾）。
registerSkill({
  id: 'heatSurge', name: '激热', type: 'fire', tier: 'C', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const stacks = target.getEffectStacks('burn');
    if (stacks <= 0) return true; // 无燃烧：落空
    dealDamage(sctx, Math.max(0, stacks - target.getEffectStacks('flameAffinity')),
      { target, source: null, fixed: true, tags: ['burn'] });
    addEffect(sctx, 'burn', -1, target);
    return true;
  },
  describe: () => '触发一次目标/effect{燃烧}结算',
  battleDescribe: (sctx) => {
    const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    return `触发一次/effect{燃烧}结算（当前${stacks}层）`;
  },
});

// 化焰 C：0 费。被动：每一点溢出魏启，为所有单位（敌我双方）施加燃烧 1。
// 口径假设：设计稿未注明生效区，按「在手时生效」落地（与猛拳「在手时」语言同类；
// 打出即失效回库，占手是其代价）。溢出 = payload.amount - result.gained
// （GainManaInstruction 的截断量可从结算结果可靠读出）。
registerSkill({
  id: 'meltFlame', name: '化焰', type: 'fire', tier: 'C', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use() { return true; }, // 纯被动：打出本身无效果（0 费循环/腾手）
  subscriptions: (sctx) => [{
    when: GainManaInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand'
      && (instr.payload.amount - (instr.result?.gained ?? 0)) > 0,
    react: (instr, ctx) => {
      const overflow = instr.payload.amount - instr.result.gained;
      for (const unit of allAliveUnits(ctx.battleState, ctx.player)) {
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: overflow,
        }), instr);
      }
    },
  }],
  describe: () => '在手时：每一点溢出魏启，为所有单位赋予/effect{燃烧}1',
});

// ==== 控火系列（多功能散牌）===================================================
// 「发现 0 费控火术」的卡池：费用是定义级字段、无运行时覆写通道（ConsumeSkillResources
// 只读 def.cost），故每张控火术注册一份 0 费镜像 def（同效果同描述，canSpawnAsReward
// 排除出奖励池），化整为零地承载「0 开销」语义。
const FIRE_CONTROL_ZERO_IDS = [];

function registerFireControlPair(id, name, tier, mana, targetMode, def) {
  const common = {
    name, type: 'fire', tier, series: 'fireControl',
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', ...def,
  };
  registerSkill({ ...common, id, cost: { mana, actionPoint: 0 }, targetMode });
  registerSkill({
    ...common, id: `${id}Zero`,
    cost: { mana: 0, actionPoint: 0 }, targetMode,
    canSpawnAsReward: false,
  });
  FIRE_CONTROL_ZERO_IDS.push(`${id}Zero`);
}

// 控火术：燃 C —— 伤害 12，目标每层燃烧伤害 +1（伤害读数取发动时点层数）。
registerFireControlPair('fireControlBurn', '控火术：燃', 'C', 3, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 12 + target.getEffectStacks('burn'), { target });
    return true;
  },
  describe: () => '12伤害；目标每层/effect{燃烧}，伤害+1',
  battleDescribe: (sctx) => {
    const bonus = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    return `${12 + bonus}伤害（12+目标/effect{燃烧}${bonus}）`;
  },
});

// 控火术：灭 C —— 驱散目标 9 层燃烧（负层数扣减；不足 9 层则清空，负溢出无害）。
registerFireControlPair('fireControlExtinguish', '控火术：灭', 'C', 3, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    addEffect(sctx, 'burn', -9, target);
    return true;
  },
  describe: () => '驱散目标9层/effect{燃烧}',
});

// 控火术：灼 B（2026-09 由 C 改 B）—— 下次你发动的攻击：每造成 3 伤害，赋予目标燃烧 1。
// 口径：伤害量按生命值实际损失（result.dealt，护盾/防御吸收部分不计）；
// floor(dealt/3) 的余数丢弃（单次触发不跨攻击累计）；"下次攻击"= 你为来源、
// 目标为敌方的下一次伤害结算（燃烧跳伤无来源，天然不触发）。
registerFireControlPair('fireControlScorch', '控火术：灼', 'B', 3, 'enemy', {
  use(sctx) {
    sctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'post', window: 'once',
      filter: (instr) => instr.source === sctx.player
        && instr.target.side === 'enemy' && !instr.target.isDead(),
      react: (instr, ctx) => {
        const stacks = Math.floor((instr.result?.dealt ?? 0) / 3);
        if (stacks > 0) {
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: instr.target, effectId: 'burn', stacks,
          }), instr);
        }
      },
    });
    return true;
  },
  describe: () => '你下次造成伤害时，每3点伤害赋予目标/effect{燃烧}1',
});

// 控火术：散 B —— 消耗目标所有燃烧，叠加到其阵营其它成员上。
// 口径：多成员时按「传播」语义——每名其它成员各获得全额层数（与焚原
// 「其燃烧传播给所有敌人」同语言）。
registerFireControlPair('fireControlSpread', '控火术：散', 'B', 3, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const stacks = target.getEffectStacks('burn');
    if (stacks <= 0) return true; // 无燃烧：落空
    addEffect(sctx, 'burn', -stacks, target);
    const others = (target.side === 'enemy'
      ? aliveEnemies(sctx.battleState)
      : unitsOfSide(sctx.battleState, sctx.player, 'player')
    ).filter(u => u !== target);
    for (const u of others) {
      addEffect(sctx, 'burn', stacks, u);
    }
    return true;
  },
  describe: () => '消耗目标全部/effect{燃烧}，叠加到其阵营其它成员身上',
});

// 控火术：收 B —— 消耗目标所有燃烧，每 3 层获得 1 魏启（走上限截断管线）。
registerFireControlPair('fireControlHarvest', '控火术：收', 'B', 3, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const stacks = target.getEffectStacks('burn');
    if (stacks <= 0) return true;
    addEffect(sctx, 'burn', -stacks, target);
    const gain = Math.floor(stacks / 3);
    if (gain > 0) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: gain }));
    }
    return true;
  },
  describe: () => '消耗目标全部/effect{燃烧}，每3层获得1魏启',
  battleDescribe: (sctx) => {
    const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    return `消耗目标全部/effect{燃烧}（当前${stacks}层），获得${Math.floor(stacks / 3)}魏启`;
  },
});

// 控火术：扰 C（2026-09 由 B 改 C）—— 消耗自身所有燃烧，每层获得 3 护盾。
registerFireControlPair('fireControlDisturb', '控火术：扰', 'C', 3, 'none', {
  use(sctx) {
    const stacks = sctx.player.getEffectStacks('burn');
    if (stacks <= 0) return true;
    addEffect(sctx, 'burn', -stacks, sctx.player);
    gainShield(sctx, stacks * 3);
    return true;
  },
  describe: () => '消耗自身全部/effect{燃烧}，每层获得3护盾',
  battleDescribe: (sctx) => {
    const stacks = sctx.player.getEffectStacks('burn');
    return `消耗自身全部/effect{燃烧}（当前${stacks}层），获得${stacks * 3}护盾`;
  },
});

// 控火术：爆 A —— 消耗所有敌人的全部燃烧，每层对全体敌人造成 1 点群伤
// （口径："敌人"取敌方全体——与同系列始终用"目标"指代单体的写法相区别；
// 群伤总量 = 消耗层数总和，tags:['aoe'] 与爆裂术同语言；选定目标恒最后命中
// ——瑞米跟随软指定，隐藏机制不明说）。
registerFireControlPair('fireControlDetonate', '控火术：爆', 'A', 6, 'enemy', {
  use(sctx) {
    const chosen = enemyTarget(sctx);
    const enemies = aliveEnemies(sctx.battleState).filter(e => e !== chosen);
    if (chosen && !chosen.isDead()) enemies.push(chosen);
    let total = 0;
    for (const e of [...enemies]) {
      const stacks = e.getEffectStacks('burn');
      if (stacks > 0) {
        addEffect(sctx, 'burn', -stacks, e);
        total += stacks;
      }
    }
    if (total <= 0) return true; // 全场无燃烧：落空
    for (const e of enemies) { // 快照遍历，途中减员照常结算（既有群伤范式）
      dealDamage(sctx, total, { target: e, tags: ['aoe'] });
    }
    return true;
  },
  describe: () => '消耗所有敌人的全部/effect{燃烧}，每层群伤1',
  battleDescribe: (sctx) => {
    const total = totalEnemyBurn(sctx);
    return `消耗所有敌人的全部/effect{燃烧}（共${total}层），群伤${total}`;
  },
});

// 控火术：聚 A —— 场上所有燃烧迁移至目标（自身/盟友/其余敌人的燃烧全部转移，
// 目标自身原有层数保留累加）。
registerFireControlPair('fireControlGather', '控火术：聚', 'A', 6, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    for (const unit of allAliveUnits(sctx.battleState, sctx.player)) {
      if (unit === target) continue;
      const stacks = unit.getEffectStacks('burn');
      if (stacks > 0) {
        addEffect(sctx, 'burn', -stacks, unit);
        addEffect(sctx, 'burn', stacks, target);
      }
    }
    return true;
  },
  describe: () => '场上所有/effect{燃烧}迁移至目标',
});

// 控火术：炼 A —— 目标每层燃烧和每层负面效果两两抵消。
// 口径：负面效果 = type 'debuff' 的效果（燃烧自身是配对主体、block/fireproof 为增益，
// 三者皆排除）；配对数 = min(燃烧层数, 负面层数总和)；多层 debuff 按效果列表顺序
// 贪心逐层扣减（先挂者先消）。
registerFireControlPair('fireControlRefine', '控火术：炼', 'A', 4, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const debuffs = target.effects.filter(e =>
      e.effectId !== 'burn' && e.effectId !== 'block' && e.effectId !== 'fireproof'
      && getEffectDefinition(e.effectId).type === 'debuff');
    const debuffTotal = debuffs.reduce((n, e) => n + e.stacks, 0);
    const pairs = Math.min(target.getEffectStacks('burn'), debuffTotal);
    if (pairs <= 0) return true;
    addEffect(sctx, 'burn', -pairs, target);
    let remaining = pairs;
    for (const e of debuffs) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, e.stacks);
      addEffect(sctx, e.effectId, -take, target);
      remaining -= take;
    }
    return true;
  },
  describe: () => '目标每层/effect{燃烧}和每层负面效果两两抵消',
});

// 控火术：无上 S —— 选并发现一张 0 开销控火术。
// 近似说明：现有输入种类只有 selectHandCard/selectDeckCard，无「从卡池三选一」；
// 退化为随机获得一张 0 费控火术镜像入手（走种子 rng，可复现）。发现池不含无上自身
// （防止 0 费无上自我复制形成无终止链）。手牌满时按 §7.3 降级入牌库。
registerSkill({
  id: 'fireControlSupreme', name: '控火术：无上', type: 'fire', tier: 'S', series: 'fireControl',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    const defId = FIRE_CONTROL_ZERO_IDS[
      sctx.battleState.rng.int(0, FIRE_CONTROL_ZERO_IDS.length - 1)];
    addCard(sctx, defId, { toZone: 'hand' });
    return true;
  },
  describe: () => '/named{发现}一张0费控火术入手（九种之中随机）',
  battleDescribe: () => '/named{发现}一张0费控火术入手（九种之中随机）',
});
