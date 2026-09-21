// 体修·拆组合（BODY_CULTIVATION_CARDS §3：格挡体系）。
// 精准（完美/命中）/ 破势（破）/ 格挡 / 扫腿（多敌防卡）/ 忍耐（受击转格挡·弱化）
// / 盾 / 姿态（龟守·武术·狂战）/ 以无胜有·以有胜无 咏唱。
// 格挡一律落 block 效果层数（≠ 护盾池）；伤害走 cardKit 统一算式。
//
// 机制词（NAMED.md）落地口径：
//   【完美】canUse 逐张判定左侧手牌可用性（canUseSkill 全量口径：费用/充能冷却/
//           咏唱规则/各卡自定义条件一并算入）；
//   【命中】use 多阶段：段 0 逐段提交伤害并留引用，段 1 读各段聚合结果——
//           造成伤害即命中（打在护盾上也算；被 veto/闪避/目标已死才未命中），
//           多段伤害能触发多次（2026-09-21 用户定，与 NAMED 词条一致）；
//   【破】  breakAllBlock 一条指令清零格挡，再逐层各提交一枚独立的转化指令
//           （「每失去一层触发一次」严格同构：每层单独结算、可各自被修饰/取消）。

import { registerSkill } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DealDamageInstruction, ApplyDamageInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainActionPointsInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction, PlayerTurnStartInstruction } from '../instructions/turn.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { canUseSkill } from '../skills/helpers.js';
import {
  attackDamage, dealDamage, resolvedDamageText, enemyTarget, aoeAttackProbes,
  damageLandedCount, gainShield, gainBlock, addEffect,
  breakAllBlock,
} from './cardKit.js';

// 抱头（格挡系列 C）：+1 层格挡（block 效果，非护盾池）。2026-09-21 大调 D→C——
// 不再是起始专属卡，作为系列链首正常入包（通用填充卡只有拳/盾）。
registerSkill({
  id: 'duckHead', name: '抱头', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'blockGuard',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'block', stacks: 1,
    }));
    return true;
  },
  describe: () => '/effect{格挡}1',
});

// 格挡（格挡系列 B）：+1 层格挡，**无冷却**（升阶 = 去冷却；2026-09-21 大调 C→B、格挡 2→1）。
registerSkill({
  id: 'blockGuard', name: '格挡', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  promotesTo: 'blockGuardA',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'block', stacks: 1,
    }));
    return true;
  },
  describe: () => '/effect{格挡}1',
});

// 格挡（格挡系列 A）：+2 层格挡，无冷却。
registerSkill({
  id: 'blockGuardA', name: '格挡', type: 'normal', tier: 'A', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  promotesTo: 'perfectBlock',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'block', stacks: 2,
    }));
    return true;
  },
  describe: () => '/effect{格挡}2',
});

// 完美格挡（格挡系列 S）：0 费 +2 层格挡（费用栏留空 → 无任何资源消耗）。
registerSkill({
  id: 'perfectBlock', name: '完美格挡', type: 'normal', tier: 'S', series: 'block',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'block', stacks: 2,
    }));
    return true;
  },
  describe: () => '/effect{格挡}2',
});

// ==== 精准系列（位置要求——与刀组共享"位置"语言）================================

// 【完美】判定（NAMED.md）：仅当其前方（手牌更左端）所有卡都可打出时可打出。
// canUse 只在预览态被调用（自身仍在手），逐张走 canUseSkill 全量口径；左侧若含
// 同类完美卡则各自向左递归判定，索引严格递减、无环。
function perfectReady(sctx) {
  const hand = sctx.battleState.zones.hand;
  const selfIndex = hand.findIndex(c => c.uniqueID === sctx.self.uniqueID);
  for (let i = 0; i < selfIndex; i++) {
    if (!canUseSkill(sctx, hand[i])) return false;
  }
  return true;
}
// 标记：headless 的 why 诊断按此识别完美条件、点名左侧压位卡（第 6 轮 A 建议——
// 「只报自定义条件不满足，玩家要自己反推是哪张」）
perfectReady.isPerfectCondition = true;

// ==== 精准（完美/命中）系列 =====================================================
// 2026-09-14 用户裁决重做：伤害削到**每AP与拳系白板相当**（精准一击 10/1AP 对标
// 快拳 9/AP+完美小溢价），命中给格挡下放到全系列。
// 2026-09-21 大调（等阶扁平化）：D 阶精准一击删除（链首让位给 C 精心一击更名精准一击），
// 数字收为 10 / 20格挡2 / 2×10 / 24格挡2 / S 30格挡4。完美条件不动（战术挑战保留）。
// 【命中】口径（2026-09-21 用户定，与 NAMED 词条一致）：**造成伤害即可触发**——
// 不要求生命值伤害（打在护盾上也算命中），被闪避/被 veto/目标已死才算未命中；
// 多段伤害能触发多次（精心二击两段都命中 → 格挡×2）。
const perfectSeries = (id, name, tier, damage, { ap = 2, hits = 1, block = 1, promotesTo = null } = {}) => {
  const dmgText = (fn) => `${fn(damage)}${hits > 1 ? `×${hits}` : ''}`;
  return registerSkill({
    id, name, type: 'normal', tier, series: 'block',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    canUse: perfectReady,
    use(sctx, stage) {
      if (stage === 0) {
        sctx.self._hitProbes = [];
        for (let i = 0; i < hits; i++) {
          sctx.self._hitProbes.push(attackDamage(sctx, damage, { tags: ['perfect'] }));
        }
        return false; // 挂起一拍：等伤害子节点完整落地后再读探针
      }
      const landed = damageLandedCount(sctx.self._hitProbes);
      sctx.self._hitProbes = null;
      if (landed > 0) gainBlock(sctx, block * landed);
      return true;
    },
    describe: () => `/named{完美}。${dmgText((d) => d)}伤害；/named{命中}：/effect{格挡}${block}`,
    battleDescribe: (sctx) => `/named{完美}。${dmgText((d) => resolvedDamageText(sctx, d))}，/named{命中}：/effect{格挡}${block}`,
  });
};
perfectSeries('carefulStrike', '精准一击', 'C', 10, { ap: 1, promotesTo: 'foldWillow' }); // 10/1AP，对标快拳
perfectSeries('doubleStrike', '精心二击', 'B', 10, { hits: 2 }); // 延伸卡：2AP 2×10，命中两段各喂格挡
perfectSeries('foldWillow', '折杨手', 'B', 20, { block: 2, promotesTo: 'embraceCloud' });
perfectSeries('embraceCloud', '揽云手', 'A', 24, { block: 2 }); // S 直出不作晋升目标（S 只走事件，D4-c）
perfectSeries('pluckStar', '摘星手', 'S', 30, { block: 4 });

// ==== 破势系列（格挡转资源）====================================================

// 【破】逐层展开：先 breakAllBlock 一条指令整体清零格挡，再按失去层数逐层提交
// 独立的转化指令。转化数值取设计稿字面值（不吃攻击面板/power——面板已计入基础
// 一击，逐层叠加面板会指数化膨胀）。基础伤害仍是标准攻击算式（基数+面板+power）。

// 破势/解体/贯心（破势系列 C/B/A）：基础伤害 7/8/9；破：每层 7/8/9 伤害
//（2026-09-21 大调：破伤 7/11/16 → 7/8/9，基础随阶微涨——破势的爆发全押在格挡层数上）。
const breakAttack = (id, name, tier, base, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, base);
    const layers = breakAllBlock(sctx);
    for (let i = 0; i < layers; i++) dealDamage(sctx, per);
    return true;
  },
  describe: () => `${base}伤害；/named{破}：${per}伤害`,
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    const bonus = layers > 0 ? `（当前${layers}层 → +${layers * per}）` : '';
    return `${resolvedDamageText(sctx, base)}，/named{破}：${per}伤害${bonus}`;
  },
});
breakAttack('breakStance', '破势', 'C', 7, 7, 'disassemble');
breakAttack('disassemble', '解体', 'B', 8, 8, 'pierceHeart');
breakAttack('pierceHeart', '贯心', 'A', 9, 9, null);

// 壁垒/堡垒/铜城（破势系列 C/B/A）：基础护盾 + 破：N 护盾（三阶皆消耗，2026-09 稿）。
// 设计稿未写费用 → 0 费。先给基础护盾，再清空格挡逐层转化。
const breakShield = (id, name, tier, base, per, { promotesTo = null } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    if (base > 0) gainShield(sctx, base);
    const layers = breakAllBlock(sctx);
    for (let i = 0; i < layers; i++) gainShield(sctx, per);
    return true;
  },
  describe: () => `${base}护盾，/named{破}：${per}护盾`,
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    const bonus = layers > 0 ? `×${layers}层（→${layers * per}护盾）` : '';
    return `${base}护盾，/named{破}：${per}护盾${bonus}`;
  },
});
breakShield('barrier', '壁垒', 'C', 10, 6, { promotesTo: 'fortress' });
breakShield('fortress', '堡垒', 'B', 12, 7, { promotesTo: 'bronzeCity' });
breakShield('bronzeCity', '铜城', 'A', 14, 8, {});

// 武魂（破势系列 A）：消耗。破：1 行动点（每层独立一枚 AP 指令，可各自被修饰）。
registerSkill({
  id: 'soulOfWar', name: '武魂', type: 'normal', tier: 'A', series: 'block',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    const layers = breakAllBlock(sctx);
    for (let i = 0; i < layers; i++) {
      sctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }));
    }
    return true;
  },
  describe: () => '/named{破}：1行动点',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `/named{破}：1行动点${layers > 0 ? `×${layers}层` : ''}`;
  },
});

// ==== 盾系列（自保补全）========================================================
// 盾（C）已在 skills.js（guard）；promotesTo 链 guard→solidShield 由 skills.js 侧接线。

// 坚固盾（盾系列 B）：8 护盾，冷却1（2026-09-21 大调 C→B）。
registerSkill({
  id: 'solidShield', name: '坚固盾', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'reinforcedShield',
  use(sctx) {
    gainShield(sctx, 8);
    return true;
  },
  describe: () => '8护盾',
});

// 强化盾（盾系列 A，链顶）：11 护盾 + 1 层格挡（2026-09 大调 B→A、12→11）。
registerSkill({
  id: 'reinforcedShield', name: '强化盾', type: 'normal', tier: 'A', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    gainShield(sctx, 11);
    gainBlock(sctx, 1);
    return true;
  },
  describe: () => '11护盾，/effect{格挡}1',
});

// （批次 17 的绷劲/丹田气两张体修盾已于 2026-09-13 删除——用户试玩判「数值太低
// 没什么用」，裁决直接删卡而非加强。）

// ==== 扫腿系列（多敌防卡）======================================================
// 定案迁入拆组合（原拳组合的群伤位，重做为防卡后归属格挡经济）：
// 群伤走折价数字不追输出，每命中 1 敌人格挡 N——敌人越多越硬，多敌房的应对防卡；
// 格挡按命中数并成单枚指令（狂战姿态按「获得事件」只喂 1 力量）。
// 2026-09-21 大调（文档定稿）：全链同名扫堂腿 C/B/A（5/8/11 群伤，格挡1）→ S 旋风腿
//（15 群伤格挡2）；id 沿用旧链（重踏/横扫/扫堂腿/旋风腿位，名字统一回收为文档口径）。
const sweepCard = ({ id, name, tier, damage, block, promotesTo = null }) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._hitProbes = aoeAttackProbes(sctx, damage);
      return false; // 挂起一拍：按「每命中 1 敌人」逐敌结算格挡
    }
    const landed = damageLandedCount(sctx.self._hitProbes);
    sctx.self._hitProbes = null;
    if (block > 0 && landed > 0) gainBlock(sctx, block * landed);
    return true;
  },
  describe: () => `群伤${damage}，每命中1敌人/effect{格挡}${block}`,
  battleDescribe: (sctx) => `群伤${resolvedDamageText(sctx, damage).replace('伤害', '')}，每命中1敌人/effect{格挡}${block}`,
});
sweepCard({ id: 'heavyStomp', name: '扫堂腿', tier: 'C', damage: 5, block: 1, promotesTo: 'sweepKick' });
sweepCard({ id: 'sweepKick', name: '扫堂腿', tier: 'B', damage: 8, block: 1, promotesTo: 'sweepHall' });
sweepCard({ id: 'sweepHall', name: '扫堂腿', tier: 'A', damage: 11, block: 1, promotesTo: 'whirlLeg' });
sweepCard({ id: 'whirlLeg', name: '旋风腿', tier: 'S', damage: 15, block: 2 });

// ==== 忍耐系列（受击转格挡）====================================================
// 2026-09-20 稿重构：忍耐效果去掉「自己回合开始时消失」（常驻受击引擎，见
// content/effects.js）；强撑改为 忍耐1 + 自身和目标虚弱3。

// 忍耐 C（2026-09-21 大调 D→C）：忍耐1。
registerSkill({
  id: 'endure', name: '忍耐', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'toughItOut',
  use(sctx) {
    addEffect(sctx, 'endure', 1);
    return true;
  },
  describe: () => '/effect{忍耐}1',
});

// 强撑 B（大调 C→B）：忍耐1，自身和目标虚弱3（自弱换敌弱——忍耐姿态的代价面）。
registerSkill({
  id: 'toughItOut', name: '强撑', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    addEffect(sctx, 'endure', 1);
    addEffect(sctx, 'weaken', 3, sctx.player);
    const target = enemyTarget(sctx);
    if (target) addEffect(sctx, 'weaken', 3, target);
    return true;
  },
  describe: () => '/effect{忍耐}1，自身和目标/effect{虚弱}3',
});

// ==== 姿态系列（常驻引擎·咏唱）=================================================

// 龟守链（咏唱触发 P5 攒格挡）：ChantTriggerInstruction POST → 获得 N 层格挡。
// 笨拙是发动瞬间的一次性代价（activated.onEnable 时获得层数；解除不回收——层数按
// 笨拙自身规则逐次消耗。设计稿未写解除回收，此为落地假设）。
// weight 缺省 2（2026-09-21 用户定稿：龟守链 C/B/B/A 统一咏唱2）；神龟姿态 S 咏唱 1
// （2026-09-20 稿：咏唱 2→1，S 卡零负担顶点）。
// 阶梯为**菱形链**（2026-09-21 用户澄清）：C 防御准备 → 分叉 B 守护（格挡1 无代价）
// / B 龟守（格挡2+笨拙1）→ 合流 A 玄龟（格挡2 无笨拙——两条支线的升级终点各自有意义：
// 守护线加量、龟守线去代价）→ S 神龟直出顶点（无晋升来源）。
const turtleStanceCard = (id, name, tier, ap, blockPerTrigger, clumsy, promotesTo, weight = 2) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: weight,
  promotesTo,
  use() { return true; },
  activated: {
    onEnable: (sctx) => {
      if (clumsy > 0) addEffect(sctx, 'clumsy', clumsy);
    },
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => gainBlock(sctx, blockPerTrigger, ctx.player),
    }],
  },
  describe: () => `/effect{格挡}${blockPerTrigger}`
    + (clumsy > 0 ? `；发动时/effect{笨拙}${clumsy}` : ''),
  battleDescribe: (sctx) => {
    const effect = `/effect{格挡}${blockPerTrigger}`
      + (clumsy > 0 ? `；发动时/effect{笨拙}${clumsy}` : '');
    return effect;
  },
});
turtleStanceCard('defensePrep', '防御准备', 'C', 2, 1, 0, ['guardStance', 'turtleStance']);
turtleStanceCard('guardStance', '守护姿态', 'B', 1, 1, 0, 'mysticTurtle');
// 龟守姿态（B 支线）：格挡2 + 笨拙1（与守护并列的分叉位，不是守护的晋升目标）
turtleStanceCard('turtleStance', '龟守姿态', 'B', 1, 2, 1, 'mysticTurtle');
// 玄龟姿态（A 合流顶点）：格挡2、无笨拙（2026-09-21 裁定去掉笨拙——守护线升格挡、
// 龟守线去笨拙，两条支线在终点合流）
turtleStanceCard('mysticTurtle', '玄龟姿态', 'A', 1, 2, 0, null);
turtleStanceCard('divineTurtle', '神龟姿态', 'S', 1, 2, 0, null, 1);

// 武术链（格挡转攻击）：激活期间，玩家为来源的每一条**主级**伤害指令 PRE 加
// 「格挡层数 × N」。固定伤害（fixed）payload 白名单为空、不可修饰，跳过。
// C 1AP / B 0AP / A 0AP，咏唱 C/B=3、天一 A=2；数值全链 +2（2026-09-21 大调定稿：
// 等阶差距全押在费用与咏唱值上，每层加成不再涨）。
// 主级过滤是精通病灶的修复本体（2026-09-15 用户报）：精通/无双每抽一张牌发一条
// 附级伤害，此前每条都吃「格挡×N」加成——一回合几十上百的爆炸伤害即由此来。
// 与贯心的逐层破伤天然咬合（§3「天一+贯心」斩杀线的引擎件）。
const martialStanceCard = (id, name, tier, ap, per, weight, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: weight,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DealDamageInstruction, phase: 'pre',
      filter: (instr) => instr.source === sctx.player && !instr.fixed
        && instr.type === 'major',
      react: (instr) => {
        const stacks = sctx.player.getEffectStacks('block');
        if (stacks > 0) instr.setPayload('damage', instr.payload.damage + stacks * per);
      },
    }],
  },
  describe: () => `每层/effect{格挡}，伤害+${per}`,
  battleDescribe: (sctx) => `每层/effect{格挡}令你的伤害+${per}`,
});
martialStanceCard('martialStance', '武术姿态', 'C', 1, 2, 3, 'masterStance');
martialStanceCard('masterStance', '大师姿态', 'B', 0, 2, 3, 'heavenStance');
martialStanceCard('heavenStance', '天一姿态', 'A', 0, 2, 2, null);

// 狂战链（格挡转力量）：获得格挡时（一次正向获得事件，非逐层）也获得
// 1 层力量；失去格挡（破的负层数 AddEffect）不触发。咏唱 1（2026-09-21 用户定稿）。
const berserkStanceCard = (id, name, tier, ap, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: AddEffectInstruction, phase: 'post',
      filter: (instr) => instr.target === sctx.player && instr.effectId === 'block'
        && instr.payload.stacks > 0,
      react: (instr, ctx) => addEffect(sctx, 'strength', 1, ctx.player),
    }],
  },
  describe: () => '获得/effect{格挡}时，/effect{力量}1',
  battleDescribe: (sctx) => '获得/effect{格挡}时也/effect{力量}1',
});
berserkStanceCard('berserkStance', '狂战姿态', 'B', 1, 'berserkMastery');
berserkStanceCard('berserkMastery', '狂战掌控', 'A', 0, null);

// ==== 咏唱散卡（以无胜有 / 以有胜无）===========================================
// 手牌形态双向终端：P5 按手牌数给格挡。手牌数按**裸张数**计（2026-09-20 用户定：
// 卡面手牌数 = 直观张数，激活咏唱算 1 张，不加权——见 battle.md §1 基础约定）；
// 触发时激活的自身也在手、算 1 张。设计稿未给咏唱值 → 取 2（落地假设）。
const handGateChant = (id, name, tier, conditionText, gate, { ap = 1, block = 3, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        if (gate(sctx, ctx.battleState)) gainBlock(sctx, block, ctx.player);
      },
    }],
  },
  describe: () => `${conditionText}，/effect{格挡}${block}`,
  battleDescribe: (sctx) => `${conditionText}，/effect{格挡}${block}`,
});

// 以无胜有（B→A）：只有这一张手牌（清手）→ 3 层格挡（A 档 0AP——升阶 = 免费化）。
handGateChant('winWithout', '以无胜有', 'B', '若你只有1手牌',
  (sctx, battleState) => battleState.zones.hand.length === 1,
  { promotesTo: 'winWithoutA' });
handGateChant('winWithoutA', '以无胜有', 'A', '若你只有1手牌',
  (sctx, battleState) => battleState.zones.hand.length === 1,
  { ap: 0, block: 3 });

// 以有胜无（B→A）：手牌不少于 5 张（囤满手）→ 3 / 4 层格挡。
// 2026-09-21 大调：门槛 ≥6 → ≥5（随手牌上限 6→5 同步降档；P5 在**回合末**触发、
// 咏唱驻手，囤 5 张收尾即可达成）。触发时激活的自身也在手、算 1 张。
handGateChant('haveWithout', '以有胜无', 'B', '若你手牌不少于5张',
  (sctx, battleState) => battleState.zones.hand.length >= 5,
  { promotesTo: 'haveWithoutA' });
handGateChant('haveWithoutA', '以有胜无', 'A', '若你手牌不少于5张',
  (sctx, battleState) => battleState.zones.hand.length >= 5,
  { block: 4 });

// 活动筋骨（C/B/A，1AP（A 级 0AP）冷却2）：获得力量。C 版固定 1；B 版起
// 「力量 1+N」，N = 此牌本场已打出次数（打出前计数——首打仍为 1，越打越强，
// 与冷却2的循环咬合）。
const rallyCard = (id, name, tier, ap, scaled, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 2 },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    const played = sctx.self.rallyCount ?? 0;
    addEffect(sctx, 'strength', scaled ? 1 + played : 1);
    if (scaled) sctx.self.rallyCount = played + 1; // 计数器放 runtime（可序列化，不藏闭包）
    return true;
  },
  describe: () => (scaled ? '/effect{力量}1+N（N=此牌本场已打出次数）' : '/effect{力量}1'),
  battleDescribe: (sctx) => (scaled
    ? `/effect{力量}${1 + (sctx.self.rallyCount ?? 0)}`
    : '/effect{力量}1'),
});
rallyCard('rally', '活动筋骨', 'C', 1, false, 'rallyPlus');
rallyCard('rallyPlus', '活动筋骨', 'B', 1, true, 'rallyMaster');
rallyCard('rallyMaster', '活动筋骨', 'A', 0, true);

// ==== 扩容批大扫除（2026-09-21 D4）=============================================
// 稳桩/收势/铁靠（2026-09-14 扩容批的 D/C 混合件）已从设计稿移除——等阶扁平化后
// 「盾+格挡混合件」正是 D4 要清出的凑数变体，整卡删除（链端 promotesTo 同步摘除）。

// 碎击 C → 碎骨 B（设计稿「碎击系列」：格挡转负面效果）。
// 【破】在此是固定触发（不按层）：消耗全部格挡，换目标/全体的虚弱。
// 碎击 C：1AP 7伤；破：目标虚弱2。
registerSkill({
  id: 'shatterHit', name: '碎击', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'shatterBone',
  use(sctx) {
    attackDamage(sctx, 9);
    const target = enemyTarget(sctx);
    if (breakAllBlock(sctx) > 0 && target) addEffect(sctx, 'weaken', 2, target);
    return true;
  },
  describe: () => '9伤害；/named{破}：目标/effect{虚弱}2',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `${resolvedDamageText(sctx, 9)}，/named{破}：目标/effect{虚弱}2（当前${layers}层）`;
  },
});

// 碎骨 B：1AP 9伤；破：目标虚弱3（2026-09-21 大调：全体虚弱2 → 目标虚弱3——
// AoE 化是 A 碎头的阶差）。
registerSkill({
  id: 'shatterBone', name: '碎骨', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'shatterHead',
  use(sctx) {
    attackDamage(sctx, 9);
    const target = enemyTarget(sctx);
    if (breakAllBlock(sctx) > 0 && target) addEffect(sctx, 'weaken', 3, target);
    return true;
  },
  describe: () => '9伤害；/named{破}：目标/effect{虚弱}3',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `${resolvedDamageText(sctx, 9)}，/named{破}：目标/effect{虚弱}3（当前${layers}层）`;
  },
});

// 碎头 A（2026-09-20 稿补）：1AP 9伤；破：全体敌人虚弱3。
registerSkill({
  id: 'shatterHead', name: '碎头', type: 'normal', tier: 'A', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 9);
    if (breakAllBlock(sctx) > 0) {
      for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'weaken', 3, e);
    }
    return true;
  },
  describe: () => '9伤害；/named{破}：所有敌人/effect{虚弱}3',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `${resolvedDamageText(sctx, 9)}，/named{破}：所有敌人/effect{虚弱}3（当前${layers}层）`;
  },
});

// ==== 散卡（2026-09 设计稿新增）=============================================

// 快如雨（C）/ 疾如风（B→A）：冷却1——打出时按**本回合已打出的牌数**结算：
// 每 4 / 3 / 3 张获得 1 层格挡（向下取整，不含自身——发动卡结算时尚未计入）。
// 2026-09-20 稿：C/B 回到 1AP（撤销 2026-09-16 的 0 费调值）、补 A 档 0AP。
const rapidBlockCard = (id, name, tier, ap, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    const played = sctx.battleState.history.turn.played;
    const stacks = Math.floor(played / per);
    if (stacks > 0) gainBlock(sctx, stacks);
    return true;
  },
  describe: () => `本回合每打出${per}牌，/effect{格挡}1`,
  battleDescribe: (sctx) => {
    const played = sctx.battleState.history.turn.played;
    return `本回合已打出${played}牌（/effect{格挡}${Math.floor(played / per)}）`;
  },
});
rapidBlockCard('fastRain', '快如雨', 'C', 1, 4, 'fastWind');
rapidBlockCard('fastWind', '疾如风', 'B', 1, 3, 'fastWindA');
rapidBlockCard('fastWindA', '疾如风', 'A', 0, 3);

// 准备出招（C/B/A）：1AP/0AP/0AP 冷却1——打出后到**下回合开始前**若未受到生命值伤害，
// 获得 2/2/3 层格挡（监听 DealDamage 标记受伤 + 下一次 PlayerTurnStart 结算）。
// 2026-09-21 大调收阶：D 移除；B 档免费化（格挡回 2），A 档格挡 3。
const prepareCard = (id, name, tier, ap, block, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    const owner = `prepare:${sctx.self.uniqueID}`;
    let hurt = false;
    // 挂应用原语 POST（受击侧掉血检测，2026-09-15 拆分）：「受伤」口径=实际生命损失
    //（dealt>0，含 DoT）——是状态检测不是响应触发，不筛主/附级。
    sctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === sctx.player && (instr.result?.dealt ?? 0) > 0,
      react: () => { hurt = true; },
    });
    sctx.kernel.addSubscription({
      when: PlayerTurnStartInstruction, phase: 'post', owner,
      react: (instr, ctx) => {
        if (!hurt) gainBlock(sctx, block, ctx.player);
        ctx.kernel.removeSubscriptionsByOwner(owner);
      },
    });
    return true;
  },
  describe: () => `下回合开始前未受伤则/effect{格挡}${block}`,
  battleDescribe: () => `下回合开始前未受伤则/effect{格挡}${block}`,
});
prepareCard('prepareMove', '准备出招', 'C', 1, 2, 'prepareMovePlus');
prepareCard('prepareMovePlus', '准备出招', 'B', 0, 2, 'prepareMoveMaster');
prepareCard('prepareMoveMaster', '准备出招', 'A', 0, 3);

// 血拳 B/A（1AP，消耗）：打出后，本回合每打 1 卡恢复 1/2 生命。
// 订阅挂 'turn' 窗口——回合结束自动清扫，「本回合」的时限由窗口语义承载；
// 排除自身（自身打出时订阅尚未生效，双保险 filter）。治疗走 ApplyHeal 管线。
const bloodFistCard = (id, name, tier, heal, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    const selfID = sctx.self.uniqueID;
    sctx.kernel.addSubscription({
      when: UseSkillInstruction, phase: 'post', window: 'turn',
      filter: (instr) => instr.skill.uniqueID !== selfID,
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new ApplyHealInstruction({ target: ctx.player, amount: heal }), instr),
    });
    return true;
  },
  describe: () => `打出后，本回合每打1卡，恢复${heal}生命`,
  battleDescribe: () => `打出后，本回合每打1卡，恢复${heal}生命`,
});
bloodFistCard('bloodFist', '血拳', 'B', 1, 'bloodFistA');
bloodFistCard('bloodFistA', '血拳', 'A', 2);

// ==== 深入卡（§3.3：需拆组合精英能力「武者」——rewards.js DEEP_GATES）====
// 架势 B/A（1AP / A 级 0AP，消耗）：翻倍你的格挡（当前 N 层 → 再获 N 层）。
// 2026-09-21 稿同步补装——设计稿 §3.3 一直在册（本批并 B→B/A 双档），实现缺位。
// 走 gainBlock 正向获得事件（狂战姿态按事件喂力量，联动有意）。
const powerStanceCard = (id, tier, ap, promotesTo = null) => registerSkill({
  id, name: '架势', type: 'normal', tier, series: 'block', deep: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    const layers = sctx.player.getEffectStacks('block');
    if (layers > 0) gainBlock(sctx, layers);
    return true;
  },
  describe: () => '翻倍你的/effect{格挡}',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `翻倍你的/effect{格挡}${layers > 0 ? `（当前${layers}层 → +${layers}）` : ''}`;
  },
});
powerStanceCard('powerStance', 'B', 1, 'powerStanceA');
powerStanceCard('powerStanceA', 'A', 0);
