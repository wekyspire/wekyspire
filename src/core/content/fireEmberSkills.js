// 火灵脉·叠炎组合（FIRE_VEIN_CARDS §2.1 前半）。
// 点火系列 + 燃元系列散卡（燃元/炼心/激热/化焰）+ 控火系列十张
// （燃/灭/灼/散/收/扰/爆/聚/炼/无上）。
// 自焚 / 焰愈 / 焚烧（燃烧倍增）/ 鬼火（死亡传播）/ 镜燃 + 咏唱（燃心决/取暖/绝炎）见 fireEmberMoreSkills.js。
//
// 全文件统一口径（设计稿未注明处按下列假设落地，注释就地说明）：
//   * 点火系列的伤害走 F1 攻击面板轨（基数 + 攻击 + power），battleDescribe 一律经
//     resolvedDamageText 干跑真实修正管线（A5 所见即所算）；
//   * 「每有 4 层燃烧」（燃元/炼心）按【场上敌方全体燃烧层数总和】计——叠炎主轴是把
//     燃烧叠在敌人身上，燃元系列即把这份燃烧转化为资源（自身/盟友燃烧不计）；
//   * 「消耗燃烧」= AddEffectInstruction 负层数（扣尽自动移除，负溢出无害）；
//   * 控火系列的「目标」默认玩家指定敌人（cardKit.enemyTarget：指定优先 → 首个存活敌人），
//     无存活敌人时静默落空（战斗通常已终局，此处仅防御性兜底）。

import { registerSkill, getSkillDefinition } from '../skills/registry.js';
import { aliveEnemies, unitsOfSide, allAliveUnits } from '../state/battleState.js';
import { DealDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { BurnCardInstruction, TransformCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { applyBattleModifier } from '../run/prep.js';
import { getEffectDefinition } from '../effects/registry.js';
import { enemyTarget, dealDamage, attackDamage, addEffect, gainShield, addCard, drawCards, aoeAttack, resolvedDamageText, requestPoolSelection, selected } from './cardKit.js';

// ==== 点火系列（基石：点火 C/B/A）=============================================
// 点火 C 已在 skills.js 定义；此处补 B/A 两阶。
// 2026-10-10 火系大改：去伤害去费用（0 费、冷却1），改为「洗入1余烬 + 施加燃烧」
// ——点火从直伤件变成余烬经济的启动器（燃烧 5/7/9）。

// 点火 B：0费，冷却1，洗入1余烬，施加燃烧 7。
registerSkill({
  id: 'igniteB', name: '点火', type: 'fire', tier: 'B', series: 'ignite', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'igniteA',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true; // 无存活敌人：落空（G2 收尾防御）
    addCard(sctx, 'emberMote', { index: 'random' });
    addEffect(sctx, 'burn', 7, target);
    return true;
  },
  describe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}7',
  battleDescribe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}7',
});

// 点火 A：0费，冷却1，洗入1余烬，施加燃烧 9（点火链顶点，无晋升）。
registerSkill({
  id: 'igniteA', name: '点火', type: 'fire', tier: 'A', series: 'ignite', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    addCard(sctx, 'emberMote', { index: 'random' });
    addEffect(sctx, 'burn', 9, target);
    return true;
  },
  describe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}9',
  battleDescribe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}9',
});

// ==== 燃元系列（散卡：燃烧 → 魏启资源）=======================================

// 敌方全体燃烧层数总和（燃元/炼心的统一读数口径，见文件头注释）。
function totalEnemyBurn(sctx) {
  return aliveEnemies(sctx.battleState).reduce(
    (n, e) => n + e.getEffectStacks('burn'), 0);
}

// 燃元 B/A：1AP（A 级不再消耗 AP），消耗。每有 4 层（敌方）燃烧，魏启上限 +1。
// 口径：上限抬升「战斗内永久」——写进 battleState.modifiers（本场修正），
// 随战斗对象一起消失，故**不需要战后回滚**，也不再往 skillRuntime 上挂记账字段。
function emberOriginCard({ id, tier, ap, promotesTo }) {
  registerSkill({
    id, name: '燃元', type: 'fire', tier, series: 'ember', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      const gain = Math.floor(totalEnemyBurn(sctx) / 4);
      if (gain > 0) applyBattleModifier(sctx, 'maxMana', gain);
      return true;
    },
    describe: () => '敌方每有4层/effect{燃烧}，魏启上限+1',
    battleDescribe: (sctx) => {
      const total = totalEnemyBurn(sctx);
      return `敌方每有4层/effect{燃烧}，魏启上限+1（现共${total}层）（本场战斗内）`;
    },
  });
}
emberOriginCard({ id: 'emberOriginB', tier: 'B', ap: 1, promotesTo: 'emberOriginA' });
emberOriginCard({ id: 'emberOriginA', tier: 'A', ap: 0 });

// 炼心 A：1AP。每有 4 层（敌方）燃烧，获得 1 魏启（走上限截断管线）。
registerSkill({
  id: 'refineHeart', name: '炼心', type: 'fire', tier: 'A', series: 'ember', subsystem: 'blaze',
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
    return `敌方每有4层/effect{燃烧}，获得1魏启（现共${total}层）`;
  },
});

// 激热 C/B/A：触发目标一次燃烧结算——完全复刻 burn 效果
// 的回合开始行为：无来源固定伤害（tags:['burn']，防火经该标记 veto；烈焰亲和就地
// 减免）+ 层数 -1。语义：把下一次自然跳伤提前到现在（提前一拍爆发/收尾）。
// 开销随阶收敛（设计稿口径）：C = 1AP + 消耗（一次性），B = 1AP（回库循环），
// A = 0AP（免手续费的提前拍）。
function heatSurgeCard({ id, tier, ap, exhaust, promotesTo }) {
  registerSkill({
    id, name: '激热', type: 'fire', tier, series: 'ember', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    keywords: exhaust ? ['exhaust'] : [],
    promotesTo,
    use(sctx) {
      const target = enemyTarget(sctx);
      if (!target) return true;
      const stacks = target.getEffectStacks('burn');
      if (stacks <= 0) return true; // 无燃烧：落空
      const relief = target.getEffectStacks('flameAffinity') + target.getEffectStacks('flammable') * 3;
      dealDamage(sctx, Math.max(0, stacks - relief),
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
}
heatSurgeCard({ id: 'heatSurgeC', tier: 'C', ap: 1, exhaust: true, promotesTo: 'heatSurgeB' });
heatSurgeCard({ id: 'heatSurgeB', tier: 'B', ap: 1, exhaust: false, promotesTo: 'heatSurgeA' });
heatSurgeCard({ id: 'heatSurgeA', tier: 'A', ap: 0, exhaust: false });

// ==== 控火系列（多功能散牌）===================================================
// 控火术 = 三张找卡（攻杀/守御/杂技 C/B/A）+ 发现制效果卡（不进卡包奖池、不直接掉落；
// 效果卡无晋升链——衍生牌不沉淀）。找卡/无上经 FIRE_CONTROL_IDS 引用池。
const FIRE_CONTROL_IDS = [];

// 效果卡注册：canSpawnAsReward: false（只被三张找卡与无上发现，不进奖励池）；
// 无 promotesTo（衍生牌、不沉淀，升级无意义）。
function registerFireControlPair(id, name, tier, mana, targetMode, def) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fireControl', subsystem: 'blaze',
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', canSpawnAsReward: false, ...def,
    cost: { mana, actionPoint: 0 }, targetMode,
  });
  FIRE_CONTROL_IDS.push(id);
}

// 找卡注册：同名三链（攻杀/守御/杂技）各 C/B/A，C 1AP、B/A 0AP，全员消耗；
// 段 0 请求选卡，段 1 addCard 入手（产物真卡，costOverride 不盖——费用即 def）。
function fireControlFinderCard({ id, name, tier, actionPoint, pool, promotesTo = null }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fireControlFinder', subsystem: 'blaze',
    cost: { mana: 0, actionPoint },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx, stage) {
      if (stage === 0) {
        sctx.self._find = requestPoolSelection(sctx, { defs: pool, reason: `${name}：发现一张控火术` });
        return sctx.self._find ? false : true;
      }
      const [defId] = selected(sctx.self._find);
      sctx.self._find = null;
      if (defId) addCard(sctx, defId, { toZone: 'hand' });
      return true;
    },
    describe: () => `/named{发现}一张控火术`,
    battleDescribe: () => `/named{发现}一张控火术`,
  });
}

const FC_POOL_ATTACK_C = ['fireControlBurn', 'fireControlScorch'];
const FC_POOL_ATTACK_A = [...FC_POOL_ATTACK_C, 'fireControlDetonate'];
const FC_POOL_GUARD_C = ['fireControlDisturb', 'fireControlHarvest'];
const FC_POOL_GUARD_A = [...FC_POOL_GUARD_C, 'fireControlShift'];
const FC_POOL_ACRO_C = ['fireControlGather', 'fireControlSpread'];
const FC_POOL_ACRO_A = [...FC_POOL_ACRO_C, 'fireControlRefine'];

fireControlFinderCard({ id: 'fireCtrlAtkC', name: '攻杀控火术', tier: 'C', actionPoint: 1, pool: FC_POOL_ATTACK_C, promotesTo: 'fireCtrlAtkB' });
fireControlFinderCard({ id: 'fireCtrlAtkB', name: '攻杀控火术', tier: 'B', actionPoint: 0, pool: FC_POOL_ATTACK_C, promotesTo: 'fireCtrlAtkA' });
fireControlFinderCard({ id: 'fireCtrlAtkA', name: '攻杀控火术', tier: 'A', actionPoint: 0, pool: FC_POOL_ATTACK_A });

fireControlFinderCard({ id: 'fireCtrlGuardC', name: '守御控火术', tier: 'C', actionPoint: 1, pool: FC_POOL_GUARD_C, promotesTo: 'fireCtrlGuardB' });
fireControlFinderCard({ id: 'fireCtrlGuardB', name: '守御控火术', tier: 'B', actionPoint: 0, pool: FC_POOL_GUARD_C, promotesTo: 'fireCtrlGuardA' });
fireControlFinderCard({ id: 'fireCtrlGuardA', name: '守御控火术', tier: 'A', actionPoint: 0, pool: FC_POOL_GUARD_A });

fireControlFinderCard({ id: 'fireCtrlAcroC', name: '杂技控火术', tier: 'C', actionPoint: 1, pool: FC_POOL_ACRO_C, promotesTo: 'fireCtrlAcroB' });
fireControlFinderCard({ id: 'fireCtrlAcroB', name: '杂技控火术', tier: 'B', actionPoint: 0, pool: FC_POOL_ACRO_C, promotesTo: 'fireCtrlAcroA' });
fireControlFinderCard({ id: 'fireCtrlAcroA', name: '杂技控火术', tier: 'A', actionPoint: 0, pool: FC_POOL_ACRO_A });

// 控火术：燃 C —— 伤害 12，目标每层燃烧伤害 +1（伤害读数取发动时点层数）。
registerFireControlPair('fireControlBurn', '控火术：燃', 'C', 2, 'enemy', {
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 12 + target.getEffectStacks('burn'), { target });
    return true;
  },
  describe: () => '12伤害；目标每层/effect{燃烧}，+1',
  battleDescribe: (sctx) => {
    const bonus = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    return `${resolvedDamageText(sctx, 12 + bonus)}；目标每层/effect{燃烧}，+1（当前${bonus}层）`;
  },
});

// 控火术：灼 B —— 下次你发动的攻击：每造成 2 伤害，赋予目标燃烧 1。
// 口径：伤害量按生命值实际损失（result.dealt，护盾/防御吸收部分不计）；
// floor(dealt/2) 的余数丢弃（单次触发不跨攻击累计）；"下次攻击"= 你为来源、目标为
// 敌方的下一次**主级**伤害结算（附级被动伤害不算「你发动的攻击」）。
registerFireControlPair('fireControlScorch', '控火术：灼', 'B', 2, 'enemy', {
  use(sctx) {
    sctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'post', window: 'once',
      filter: (instr) => instr.source === sctx.player
        && instr.type === 'major'
        && instr.target.side === 'enemy' && !instr.target.isDead(),
      react: (instr, ctx) => {
        const stacks = Math.floor((instr.result?.dealt ?? 0) / 2);
        if (stacks > 0) {
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: instr.target, effectId: 'burn', stacks,
          }), instr);
        }
      },
    });
    return true;
  },
  describe: () => '下次攻击每造成2伤害，赋予/effect{燃烧}1',
});

// 控火术：散 B —— 消耗目标所有燃烧，叠加到其阵营其它成员上。
// 口径：多成员时按「传播」语义——每名其它成员各获得全额层数（与鬼火
// 「其燃烧传播给所有敌人」同语言）。
registerFireControlPair('fireControlSpread', '控火术：散', 'B', 2, 'enemy', {
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
registerFireControlPair('fireControlHarvest', '控火术：收', 'B', 2, 'enemy', {
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

// 控火术：扰 C —— 消耗自身所有燃烧，每层获得 3 护盾。
registerFireControlPair('fireControlDisturb', '控火术：扰', 'C', 2, 'none', {
  use(sctx) {
    const stacks = sctx.player.getEffectStacks('burn');
    if (stacks <= 0) return true;
    addEffect(sctx, 'burn', -stacks, sctx.player);
    gainShield(sctx, stacks * 2);
    return true;
  },
  describe: () => '消耗自身全部/effect{燃烧}，每层获得2护盾',
  battleDescribe: (sctx) => {
    const stacks = sctx.player.getEffectStacks('burn');
    return `消耗自身全部/effect{燃烧}（当前${stacks}层），获得${stacks * 2}护盾`;
  },
});

// 控火术：爆 A —— 消耗所有敌人的全部燃烧，每层对全体敌人造成 1 点群伤
// （口径："敌人"取敌方全体——与同系列始终用"目标"指代单体的写法相区别；
// 群伤总量 = 消耗层数总和，tags:['aoe'] 与爆裂术同语言；选定目标恒最后命中
// ——瑞米跟随软指定，隐藏机制不明说）。
registerFireControlPair('fireControlDetonate', '控火术：爆', 'A', 4, 'enemy', {
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
    return `消耗所有敌人的全部/effect{燃烧}，每层群伤1（共${total}层 → 群伤${total}）`;
  },
});

// 控火术：聚 A —— 场上所有燃烧迁移至目标（自身/盟友/其余敌人的燃烧全部转移，
// 目标自身原有层数保留累加）。
registerFireControlPair('fireControlGather', '控火术：聚', 'C', 3, 'enemy', {
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

// 控火术：变 A —— 烈焰亲和1，消耗自身所有燃烧，每2层获得烈焰亲和1。
registerFireControlPair('fireControlShift', '控火术：变', 'A', 2, 'none', {
  use(sctx) {
    addEffect(sctx, 'flameAffinity', 1);
    const stacks = sctx.player.getEffectStacks('burn');
    if (stacks > 0) {
      addEffect(sctx, 'burn', -stacks, sctx.player);
      const extra = Math.floor(stacks / 2);
      if (extra > 0) addEffect(sctx, 'flameAffinity', extra);
    }
    return true;
  },
  describe: () => '/effect{烈焰亲和}1，消耗自身所有/effect{燃烧}，每2层获得/effect{烈焰亲和}1',
  battleDescribe: (sctx) => {
    const stacks = sctx.player.getEffectStacks('burn');
    return `/effect{烈焰亲和}1，消耗自身所有/effect{燃烧}，每2层获得/effect{烈焰亲和}1`
      + `（燃烧${stacks} → 共${1 + Math.floor(stacks / 2)}）`;
  },
});

// ==== 火墙系列（C/B/A：火系的即时格挡补缺）====================================
// 定位：火系输出碾压、但卡包里**盾牌稀缺**，所有防御都长在自燃转盾上、需要提前铺，
// 被突袭时一张即时大盾都没有——本系列补这个洞。
// 2026-10-10 火系大改：加成判据从「自身燃烧」改为「牌库余烬存量」——火墙读的是
// 余烬经济（叠炎新资源轴）。护盾基础值三阶分化 6/9/12 + 牌库每张余烬 +2
//（设计稿当日修订：三阶有区分）。全阶 1AP + 冷却 1（0 费盾不冷却 = 白嫖盾墙）。
function fireWallCard({ id, tier, base, promotesTo = null }) {
  registerSkill({
    id, name: '火墙', type: 'fire', tier, series: 'fireWall', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    // 条件满足金光（视图期判定同结算口径：牌库有余烬即加成成立）
    condition: (sctx) => sctx.battleState.zones.deck.some(c => c.defId === 'emberMote'),
    use(sctx) {
      const embers = sctx.battleState.zones.deck.filter(c => c.defId === 'emberMote').length;
      gainShield(sctx, base + embers * 2);
      return true;
    },
    describe: () => `护盾${base}，牌库中每有一张/card{emberMote}再+2`,
    battleDescribe: (sctx) => {
      const embers = sctx.battleState.zones.deck.filter(c => c.defId === 'emberMote').length;
      return `护盾${base + embers * 2}，牌库中每有一张/card{emberMote}再+2（现有${embers}张）`;
    },
  });
}
fireWallCard({ id: 'fireWallC', tier: 'C', base: 6, promotesTo: 'fireWallB' });
fireWallCard({ id: 'fireWallB', tier: 'B', base: 9, promotesTo: 'fireWallA' });
fireWallCard({ id: 'fireWallA', tier: 'A', base: 12 });

// 控火术：炼 A —— 目标每层燃烧和每层负面效果两两抵消。
// 口径：负面效果 = type 'debuff' 的效果（燃烧自身是配对主体、block/fireproof 为增益，
// 三者皆排除）；配对数 = min(燃烧层数, 负面层数总和)；多层 debuff 按效果列表顺序
// 贪心逐层扣减（先挂者先消）。
registerFireControlPair('fireControlRefine', '控火术：炼', 'A', 2, 'enemy', {
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
  describe: () => '目标每层/effect{燃烧}和每层其它效果两两抵消',
});

// 控火术：无上 S —— 选并发现一张 0 开销控火术。
// 两段式：段 0 请求从控火池选一张（池不含无上自身——防止 0 费无上自我复制形成
// 无终止链；池内候选经请求 overrides 盖 0 费戳，卡面所见即所得），段 1 应答后入手——
// 0 费走 runtime 费用覆写通道（addCard overrides 盖章，随卡旅行）；手牌满时按 §7.3 降级入牌库。
registerSkill({
  id: 'fireControlSupreme', name: '无上控火术', type: 'fire', tier: 'S', series: 'fireControl', subsystem: 'blaze',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['mini'], // 迷你：计 0 张手牌
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._find = requestPoolSelection(sctx, {
        defs: FIRE_CONTROL_IDS,
        overrides: { costOverride: { mana: 0, actionPoint: 0 } },
        reason: '无上控火术：选一张 0 费控火术入手',
      });
      return sctx.self._find ? false : true;   // 池空（理论不发生）：无事发生收尾
    }
    const [defId] = selected(sctx.self._find);
    sctx.self._find = null;
    if (defId) addCard(sctx, defId, { toZone: 'hand', overrides: { costOverride: { mana: 0, actionPoint: 0 } } });
    return true;
  },
  describe: () => '/named{发现}：选一张0费控火术入手',
  battleDescribe: () => '/named{发现}：选一张0费控火术入手',
});

// ==== 涡轮增压系列（过卡：燃烧产量换抽牌）=======================================
// 涡轮增压 C/B/A（全链消耗；C 带 1AP）｜抽 3/3/4；**自己诞生以来**全场每产生过
// 5 层燃烧，此卡多抽 1（2026-10-10 火系大改新系列——设计稿注：卡进战斗后注册
// 监听计数 AddEffect(burn) 正增量，计数挂在自身 runtime、可序列化）。
function turboChargerCard({ id, tier, draw, ap = 0, promotesTo = null }) {
  registerSkill({
    id, name: '涡轮增压', type: 'fire', tier, series: 'turbo', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    subscriptions: (sctx) => [{
      when: AddEffectInstruction, phase: 'post',
      filter: (instr) => instr.effectId === 'burn' && (instr.payload.stacks ?? 0) > 0,
      react: (instr) => {
        sctx.self.turboBurn = (sctx.self.turboBurn ?? 0) + instr.payload.stacks;
      },
    }],
    use(sctx) {
      const bonus = Math.floor((sctx.self.turboBurn ?? 0) / 5);
      drawCards(sctx, draw + bonus);
      return true;
    },
    describe: () => `抽${draw}；每产生过5层/effect{燃烧}，多抽1`,
    battleDescribe: (sctx) => `抽${draw}；每产生过5层/effect{燃烧}，多抽1（已产生${sctx.self.turboBurn ?? 0}层 → 多抽${Math.floor((sctx.self.turboBurn ?? 0) / 5)}）`,
  });
}
turboChargerCard({ id: 'turboChargerC', tier: 'C', ap: 1, draw: 3, promotesTo: 'turboChargerB' });
turboChargerCard({ id: 'turboChargerB', tier: 'B', draw: 3, promotesTo: 'turboChargerA' });
turboChargerCard({ id: 'turboChargerA', tier: 'A', draw: 4 });

// ==== 烧却系列（焚卡：非火系手牌转余烬）=========================================
// 烧却 C/B/A（全链消耗，0费）｜把手中所有**非火系**卡原地转化为余烬，抽 2/3/4。
// 转化语言（battle.md §7.3）：身份换、区域/位置延续——异系填充卡在叠炎构筑里
// 的归宿是变成燃料。自身是火系卡、不在转化集内。
function burnOffCard({ id, tier, draw, promotesTo = null }) {
  registerSkill({
    id, name: '烧却', type: 'fire', tier, series: 'burnOff', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      const targets = sctx.battleState.zones.hand.filter(c =>
        c.uniqueID !== sctx.self.uniqueID && getSkillDefinition(c.defId)?.type !== 'fire');
      for (const c of targets) {
        sctx.kernel.submitInstruction(new TransformCardInstruction({
          uniqueID: c.uniqueID, toDefId: 'emberMote',
        }));
      }
      drawCards(sctx, draw);
      return true;
    },
    describe: () => '手中非火系牌转化为/card{emberMote}，抽' + draw,
    battleDescribe: (sctx) => {
      const n = sctx.battleState.zones.hand.filter(c =>
        c.uniqueID !== sctx.self.uniqueID && getSkillDefinition(c.defId)?.type !== 'fire').length;
      return `手中非火系牌转化为/card{emberMote}，抽${draw}（可转化${n}张）`;
    },
  });
}
burnOffCard({ id: 'burnOffC', tier: 'C', draw: 2, promotesTo: 'burnOffB' });
burnOffCard({ id: 'burnOffB', tier: 'B', draw: 3, promotesTo: 'burnOffA' });
burnOffCard({ id: 'burnOffA', tier: 'A', draw: 4 });

// ==== 狂焰系列（焚卡换盾）=======================================================
// 狂焰 C/B/A（1AP，非消耗）｜焚毁所有自由手牌，获得 9/12/15 护盾——烧手牌的
// 防御镜像（一战的盾版）。已激活咏唱豁免（与一战同口径）。
function wildfireCard({ id, tier, shield, promotesTo = null }) {
  registerSkill({
    id, name: '狂焰', type: 'fire', tier, series: 'wildfire', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    promotesTo,
    use(sctx) {
      const hand = [...sctx.battleState.zones.hand].filter(c => !c.isActivated);
      for (const c of hand) {
        sctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: c.uniqueID }));
      }
      if (hand.length > 0) gainShield(sctx, shield);
      return true;
    },
    describe: () => `焚毁所有自由手牌，获得${shield}护盾`,
    battleDescribe: (sctx) => {
      const n = sctx.battleState.zones.hand.filter(c => !c.isActivated).length;
      return `焚毁所有自由手牌，获得${shield}护盾（自由手牌${n}张）`;
    },
  });
}
wildfireCard({ id: 'wildfireC', tier: 'C', shield: 9, promotesTo: 'wildfireB' });
wildfireCard({ id: 'wildfireB', tier: 'B', shield: 12, promotesTo: 'wildfireA' });
wildfireCard({ id: 'wildfireA', tier: 'A', shield: 15 });

// ==== 红云系列（坟墓利用群伤）===================================================
// 红云 C（消耗）/B/A（1AP）｜7 群伤，坟墓（焚毁区）中每有一张卡，伤害 +1/+1/+2。
function redCloudCard({ id, tier, per, exhaust = false, promotesTo = null }) {
  registerSkill({
    id, name: '红云', type: 'fire', tier, series: 'redCloud', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: exhaust ? ['exhaust'] : [],
    promotesTo,
    use(sctx) {
      aoeAttack(sctx, 7 + sctx.battleState.zones.burnt.length * per);
      return true;
    },
    describe: () => `7群伤；坟墓中每有一张卡，伤害+${per}`,
    battleDescribe: (sctx) => `${7 + sctx.battleState.zones.burnt.length * per}群伤（坟墓${sctx.battleState.zones.burnt.length}张，每张+${per}）`,
  });
}
redCloudCard({ id: 'redCloudC', tier: 'C', per: 1, exhaust: true, promotesTo: 'redCloudB' });
redCloudCard({ id: 'redCloudB', tier: 'B', per: 1, promotesTo: 'redCloudA' });
redCloudCard({ id: 'redCloudA', tier: 'A', per: 2 });
