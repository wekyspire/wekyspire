// 体修·拆组合（BODY_CULTIVATION_CARDS §3：格挡体系）。
// 精准（完美/命中）/ 破势（破）/ 格挡 / 扫腿（多敌防卡）/ 忍耐（受击转格挡·弱化）
// / 盾 / 姿态（龟守·武术·狂战）/ 以无胜有·以有胜无 咏唱。
// 格挡一律落 block 效果层数（≠ 护盾池）；伤害走 cardKit 统一算式。
//
// 机制词（NAMED.md）落地口径：
//   【完美】canUse 逐张判定左侧手牌可用性（canUseSkill 全量口径：费用/充能冷却/
//           咏唱规则/各卡自定义条件一并算入）；
//   【命中】use 多阶段：段 0 提交伤害 + beginHitProbe，段 1 hitLanded（>0 点生命值
//           伤害；被护盾全吸收/被 veto/打空均算未命中，A4 取消无联动）才给奖励；
//   【破】  breakAllBlock 一条指令清零格挡，再逐层各提交一枚独立的转化指令
//           （「每失去一层触发一次」严格同构：每层单独结算、可各自被修饰/取消）。

import { registerSkill } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DealDamageInstruction, ApplyDamageInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainActionPointsInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction, PlayerTurnStartInstruction } from '../instructions/turn.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { canUseSkill, effectiveHandCount } from '../skills/helpers.js';
import {
  attackDamage, dealDamage, resolvedDamageText, enemyTarget, aoeAttack,
  gainShield, gainBlock, addEffect,
  breakAllBlock, beginHitProbe, hitLanded, isLastHandCardAtPlay,
} from './cardKit.js';

// 抱头（格挡系列 D）：+1 层格挡（block 效果，非护盾池）。promotesTo 格挡（C）。
registerSkill({
  id: 'duckHead', name: '抱头', type: 'normal', tier: 'D', series: 'block',
  canSpawnAsReward: false, // D− 初始卡，不进奖励池（批次 14）
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

// 格挡（格挡系列 C）：+2 层格挡。
registerSkill({
  id: 'blockGuard', name: '格挡', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
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
// 2026-09-14 用户裁决重做：伤害削到**每AP与拳系白板相当**（精准一击 12/2AP=6/AP 对标
// 基础拳；精心一击 10/1AP 对标快拳 9/AP+完美小溢价），**命中给格挡下放到全系列**
// （原 B 阶起才有——功能性下放换数值，系列从「完美大数字」转型「稳定格挡+阶梯伤害」）。
// 阶梯（用户定稿）：格挡 1/1/1/1/2/2——揽云手与折杨同伤 23 但格挡 2（小质变），
// 摘星手 30 伤格挡 2（S 卡要强度）。完美条件不动（战术挑战保留）。
// 【命中】两段式：段 0 提交攻击并挂命中探针，段 1 读探针——>0 点生命值伤害才给格挡。
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
        let last = null;
        for (let i = 0; i < hits; i++) {
          last = attackDamage(sctx, damage, { tags: ['perfect'] }); // tags：架势镜等完美轴效果统一识别口径
        }
        beginHitProbe(sctx, last); // 挂末段：命中语义 = 至少一段造成生命伤害
        return false; // 挂起一拍：等伤害子节点完整落地后再读探针
      }
      if (hitLanded(sctx)) gainBlock(sctx, block);
      return true;
    },
    describe: () => `/named{完美}。${dmgText((d) => d)}伤害；/named{命中}：/effect{格挡}${block}`,
    battleDescribe: (sctx) => `/named{完美}。${dmgText((d) => resolvedDamageText(sctx, d))}，/named{命中}：/effect{格挡}${block}`,
  });
};
perfectSeries('perfectStrike', '精准一击', 'D', 12); // 12/2AP=6/AP，对标基础拳
perfectSeries('carefulStrike', '精心一击', 'C', 10, { ap: 1, promotesTo: 'foldWillow' }); // 10/1AP，对标快拳
perfectSeries('doubleStrike', '精心二击', 'B', 12, { hits: 2 }); // 延伸卡随系列对标：2AP 24 总伤
perfectSeries('foldWillow', '折杨手', 'B', 23, { promotesTo: 'embraceCloud' });
perfectSeries('embraceCloud', '揽云手', 'A', 23, { block: 2 }); // 与折杨同伤、格挡2（小质变）；S 阶梯外不作晋升目标
perfectSeries('pluckStar', '摘星手', 'S', 30, { block: 2 }); // S 卡要强度

// ==== 破势系列（格挡转资源）====================================================

// 【破】逐层展开：先 breakAllBlock 一条指令整体清零格挡，再按失去层数逐层提交
// 独立的转化指令。转化数值取设计稿字面值（不吃攻击面板/power——面板已计入基础
// 一击，逐层叠加面板会指数化膨胀）。基础伤害仍是标准攻击算式（基数+面板+power）。

// 破势/解体/贯心（破势系列 C/B/A）：7 伤害；破：N 伤害。
const breakAttack = (id, name, tier, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, 7);
    const layers = breakAllBlock(sctx);
    for (let i = 0; i < layers; i++) dealDamage(sctx, per);
    return true;
  },
  describe: () => `7伤害；/named{破}：${per}伤害`,
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    const bonus = layers > 0 ? `（当前${layers}层 → +${layers * per}）` : '';
    return `${resolvedDamageText(sctx, 7)}，/named{破}：${per}伤害${bonus}`;
  },
});
breakAttack('breakStance', '破势', 'C', 7, 'disassemble');
breakAttack('disassemble', '解体', 'B', 11, 'pierceHeart');
breakAttack('pierceHeart', '贯心', 'A', 16, null);

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
breakShield('barrier', '壁垒', 'C', 10, 12, { promotesTo: 'fortress' });
breakShield('fortress', '堡垒', 'B', 12, 14, { promotesTo: 'bronzeCity' });
breakShield('bronzeCity', '铜城', 'A', 16, 18, {});

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
// 盾（D）已在 skills.js（guard）；promotesTo 链 guard→solidShield 由 skills.js 侧接线。

// 坚固盾（盾系列 C）：8 护盾。promotesTo 强化盾（C——设计稿表内同列次阶，同阶数值梯）。
registerSkill({
  id: 'solidShield', name: '坚固盾', type: 'normal', tier: 'C', series: 'block',
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

// 强化盾（盾系列 B，链顶）：12 护盾 + 1 层格挡。
// （2026-09-14 等阶铁律修正：原 C 阶与坚固盾同阶晋升，违反「升级等阶必然提升」——
// 升 B 并把 8盾 提到 12盾（对标 B 阶盾线：火壁条件 22 / 古木壁垒 10+荆棘3）。）
registerSkill({
  id: 'reinforcedShield', name: '强化盾', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    gainShield(sctx, 12);
    gainBlock(sctx, 1);
    return true;
  },
  describe: () => '12护盾，/effect{格挡}1',
});

// （批次 17 的绷劲/丹田气两张体修盾已于 2026-09-13 删除——用户试玩判「数值太低
// 没什么用」，裁决直接删卡而非加强。）

// ==== 扫腿系列（多敌防卡）======================================================
// 2026-09-14 定案迁入拆组合（原拳组合的群伤位，重做为防卡后归属格挡经济）：
// 群伤走折价数字不追输出，C 阶起每命中 1 敌人格挡 1——敌人越多越硬，多敌房的
// 应对防卡；格挡按命中数并成单枚指令（狂战姿态按「获得事件」只喂 1 力量）。
const sweepCard = ({ id, name, tier, damage, block = 0, promotesTo = null }) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    const struck = aoeAttack(sctx, damage);
    if (block > 0 && struck > 0) gainBlock(sctx, block * struck);
    return true;
  },
  describe: () => `群伤${damage}${block ? `，每命中1敌人/effect{格挡}${block}` : ''}`,
  battleDescribe: (sctx) => `群伤${resolvedDamageText(sctx, damage).replace('伤害', '')}`
    + (block ? `，每命中1敌人/effect{格挡}${block}` : ''),
});
sweepCard({ id: 'heavyStomp', name: '重踏', tier: 'D', damage: 7, promotesTo: 'sweepKick' });
sweepCard({ id: 'sweepKick', name: '横扫', tier: 'C', damage: 7, block: 1, promotesTo: 'whirlLeg' });
sweepCard({ id: 'whirlLeg', name: '旋风腿', tier: 'B', damage: 9, block: 1 });

// ==== 忍耐系列（受击转格挡 · 弱化）==============================================
// 2026-09-14 用户定套票：忍耐 = 到自己回合开始，每受一次伤害长等层数格挡
// （效果本体见 content/effects.js）。蔑视是拆组合第一张「读层不消费」的出口——
// 与武术姿态同向（都抱着格挡打），破系清空流之外的第二条构筑线。

// 忍耐 D：忍耐1。
registerSkill({
  id: 'endure', name: '忍耐', type: 'normal', tier: 'D', series: 'block',
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

// 强撑 C：格挡2；目标虚弱3。
registerSkill({
  id: 'toughItOut', name: '强撑', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'disdain',
  use(sctx) {
    gainBlock(sctx, 2);
    const target = enemyTarget(sctx);
    if (target) addEffect(sctx, 'weaken', 3, target);
    return true;
  },
  describe: () => '/effect{格挡}2；目标/effect{虚弱}3',
});

// 蔑视 B：所有敌人虚弱1；每有一层格挡，多赋予1层。
registerSkill({
  id: 'disdain', name: '蔑视', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    const stacks = 1 + sctx.player.getEffectStacks('block');
    for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'weaken', stacks, e);
    return true;
  },
  describe: () => '所有敌人/effect{虚弱}1；每有一层/effect{格挡}，多赋予1层',
  battleDescribe: (sctx) => `所有敌人/effect{虚弱}${1 + sctx.player.getEffectStacks('block')}`,
});

// ==== 姿态系列（常驻引擎·咏唱）=================================================

// 龟守链（咏唱2，P5 咏唱触发攒格挡）：ChantTriggerInstruction POST → 获得 N 层格挡。
// 笨拙是发动瞬间的一次性代价（activated.onEnable 时获得层数；解除不回收——层数按
// 笨拙自身规则逐次消耗。设计稿未写解除回收，此为落地假设）。
const turtleStanceCard = (id, name, tier, ap, blockPerTrigger, clumsy, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
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
turtleStanceCard('defensePrep', '防御准备', 'C', 2, 1, 0, 'guardStance');
turtleStanceCard('guardStance', '守护姿态', 'B', 1, 1, 0, 'turtleStance');
// 龟守姿态（A，链顶）：升阶优化代价（笨拙 2→1）。2026-09-14 等阶铁律修正：
// 原 B 阶与守护姿态同阶晋升违规，升 A 并减笨拙；玄龟姿态改为同效高代价的直出散卡。
turtleStanceCard('turtleStance', '龟守姿态', 'A', 1, 2, 1, null);
// 玄龟姿态（A 直出散卡，无晋升来源）：与链顶同效但代价更大（笨拙2）——
// 晋升终点（龟守）必须 ≥ 直抽散卡，否则晋升失去意义。
turtleStanceCard('mysticTurtle', '玄龟姿态', 'A', 1, 2, 2, null);
turtleStanceCard('divineTurtle', '神龟姿态', 'S', 1, 2, 0, null);

// 武术链（咏唱2，格挡转攻击）：激活期间，玩家为来源的每一条**主级**伤害指令 PRE 加
// 「格挡层数 × N」。固定伤害（fixed）payload 白名单为空、不可修饰，跳过。
// 主级过滤是精通病灶的修复本体（2026-09-15 用户报）：精通/无双每抽一张牌发一条
// 附级伤害，此前每条都吃「格挡×N」加成——一回合几十上百的爆炸伤害即由此来。
// 与贯心的逐层破伤天然咬合（§3「天一+贯心」斩杀线的引擎件）。
const martialStanceCard = (id, name, tier, ap, per, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
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
  describe: () => `每层/effect{格挡}令你的伤害+${per}`,
  battleDescribe: (sctx) => `每层/effect{格挡}令你的伤害+${per}`,
});
martialStanceCard('martialStance', '武术姿态', 'C', 2, 2, 'masterStance');
martialStanceCard('masterStance', '大师姿态', 'B', 1, 4, 'heavenStance');
martialStanceCard('heavenStance', '天一姿态', 'A', 0, 6, null);

// 狂战链（咏唱2，格挡转力量）：获得格挡时（一次正向获得事件，非逐层）也获得
// 1 层力量；失去格挡（破的负层数 AddEffect）不触发。
const berserkStanceCard = (id, name, tier, ap, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
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
  describe: () => '获得/effect{格挡}时也/effect{力量}1',
  battleDescribe: (sctx) => '获得/effect{格挡}时也/effect{力量}1',
});
berserkStanceCard('berserkStance', '狂战姿态', 'B', 1, 'berserkMastery');
berserkStanceCard('berserkMastery', '狂战掌控', 'A', 0, null);

// ==== 咏唱散卡（以无胜有 / 以有胜无）===========================================
// 手牌形态双向终端：P5 按手牌数给 8 层格挡（2026-09 设计稿简化）。
// 「只有1手牌」按原始张数判定（此卡自身即那 1 张——激活咏唱驻手是物理事实）；
// 「手牌多于6张」按加权口径（T3 手牌压力同源：激活咏唱按咏唱值计多张）。
// 设计稿未给咏唱值 → 取 2（落地假设）。
const handGateChant = (id, name, conditionText, gate) => registerSkill({
  id, name, type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        if (gate(sctx, ctx.battleState)) gainBlock(sctx, 3, ctx.player);
      },
    }],
  },
  describe: () => `${conditionText}，/effect{格挡}3`,
  battleDescribe: (sctx) => `${conditionText}，/effect{格挡}3`,
});

// 以无胜有（B）：只有这一张手牌（清手）→ 3 层格挡
handGateChant('winWithout', '以无胜有', '若你只有1手牌', (sctx, battleState) =>
  battleState.zones.hand.length === 1);

// 以有胜无（B）：加权手牌不少于 5 张（囤牌）→ 3 层格挡
// （2026-09-13 批次 13：上限 7→6 后「>=6」在结算中此卡离手时永不成立=直接删卡，
//   对齐为 5 = 恢复「满手触发」原语义。）
handGateChant('haveWithout', '以有胜无', '若你手牌不少于5张', (sctx) =>
  effectiveHandCount(sctx) >= 5);

// 活动筋骨（C/B，1AP 冷却2）：获得力量。C 版固定 1；B 版「力量 1+N」，
// N = 此牌本场已打出次数（打出前计数——首打仍为 1，越打越强，与冷却2的循环咬合）。
const rallyCard = (id, name, tier, scaled, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
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
rallyCard('rally', '活动筋骨', 'C', false, 'rallyPlus');
rallyCard('rallyPlus', '活动筋骨', 'B', true);

// ==== 扩容批（2026-09-14 用户审查定稿：「D-C 扩容 + D 卡全部接链」）====
// 五张补拆组合的格挡来源与转化出口，全部用现有语言（盾/格挡/破/后手/受击）：
//   * 稳桩/收势：D 阶补厚（混合件 + 后手防御位——后手语言此前只在拳侧）；
//   * 铁靠：受击转格挡（拳拆之间的桥——纯输出构筑挨打终于有回收）；
//   * 碎击链（设计稿欠账实装）：破→虚弱，格挡转 debuff 的出口（破势转伤的分岔）。

// 稳桩 D：1AP 4盾 + 格挡1（盾5/抱头1的混合件——拆组合 D 阶补厚）。
registerSkill({
  id: 'steadyPost', name: '稳桩', type: 'normal', tier: 'D', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'blockGuard',
  use(sctx) {
    gainShield(sctx, 4);
    gainBlock(sctx, 1);
    return true;
  },
  describe: () => '护盾4，/effect{格挡}1',
});

// 收势 D：1AP 5盾；后手（手牌最后的非激活卡打出）时再 +5 盾
// （基础 = 盾 D 白板；后手溢价 +5——虚形拳的时序语言落到防御位）。
registerSkill({
  id: 'closingStance', name: '收势', type: 'normal', tier: 'D', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'solidShield',
  use(sctx) {
    gainShield(sctx, isLastHandCardAtPlay(sctx) ? 10 : 5);
    return true;
  },
  describe: () => '护盾5。/named{后手}：再+5',
  battleDescribe: (sctx) => `护盾${isLastHandCardAtPlay(sctx) ? 10 : 5}`,
});

// 铁靠 C：1AP 6盾 + 忍耐1（2026-09-14 并入忍耐机制词——此前的专属受击订阅
// 就是忍耐1的语义，统一走效果本体；顺带多覆盖环境 DoT 与格挡获得事件）。
registerSkill({
  id: 'ironLean', name: '铁靠', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'reinforcedShield',
  use(sctx) {
    gainShield(sctx, 6);
    addEffect(sctx, 'endure', 1);
    return true;
  },
  describe: () => '护盾6。/effect{忍耐}1',
});

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
    attackDamage(sctx, 7);
    const target = enemyTarget(sctx);
    if (breakAllBlock(sctx) > 0 && target) addEffect(sctx, 'weaken', 2, target);
    return true;
  },
  describe: () => '7伤害；/named{破}：目标/effect{虚弱}2',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `${resolvedDamageText(sctx, 7)}，/named{破}：目标/effect{虚弱}2（当前${layers}层）`;
  },
});

// 碎骨 B：1AP 7伤；破：全体敌人虚弱2（多敌房的群体压制件）。
registerSkill({
  id: 'shatterBone', name: '碎骨', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 7);
    if (breakAllBlock(sctx) > 0) {
      for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'weaken', 2, e);
    }
    return true;
  },
  describe: () => '7伤害；/named{破}：所有敌人/effect{虚弱}2',
  battleDescribe: (sctx) => {
    const layers = sctx.player.getEffectStacks('block');
    return `${resolvedDamageText(sctx, 7)}，/named{破}：所有敌人/effect{虚弱}2（当前${layers}层）`;
  },
});

// ==== 散卡（2026-09 设计稿新增）=============================================

// 快如雨（C）/ 疾如风（B）：0费 冷却1——打出时按**本回合已打出的牌数**结算：
// 每 4 张（B：每 3 张）获得 1 层格挡（向下取整，不含自身——发动卡结算时尚未计入）。
// 2026-09-16 用户定：1AP→0费（原强度偏低）。
const rapidBlockCard = (id, name, tier, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 0 },
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
rapidBlockCard('fastRain', '快如雨', 'C', 4, 'fastWind');
rapidBlockCard('fastWind', '疾如风', 'B', 3);

// 准备出招（D/C/B）：1AP/1AP/0AP 冷却1——打出后到**下回合开始前**若未受到生命值伤害，
// 获得 2/3/3 层格挡（监听 DealDamage 标记受伤 + 下一次 PlayerTurnStart 结算）。
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
    // （dealt>0，含 DoT）——是状态检测不是响应触发，不筛主/附级。
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
prepareCard('prepareMove', '准备出招', 'D', 1, 2, 'prepareMovePlus');
prepareCard('prepareMovePlus', '准备出招', 'C', 1, 3, 'prepareMoveMaster');
prepareCard('prepareMoveMaster', '准备出招', 'B', 0, 3);

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
