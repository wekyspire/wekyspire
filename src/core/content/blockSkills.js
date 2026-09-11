// 体修·拆组合（BODY_CULTIVATION_CARDS §3：格挡体系）。
// 精准（完美/命中）/ 破势（破）/ 格挡 / 盾 / 姿态（龟守·武术·狂战）/ 以无胜有·以有胜无 咏唱。
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
import { AddEffectInstruction } from '../instructions/effects.js';
import { DealDamageInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainActionPointsInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction, PlayerTurnStartInstruction } from '../instructions/turn.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { canUseSkill, effectiveHandCount } from '../skills/helpers.js';
import {
  attackDamage, dealDamage, resolvedDamageText,
  gainShield, gainBlock, addEffect,
  breakAllBlock, beginHitProbe, hitLanded,
} from './cardKit.js';

// 抱头（格挡系列 D）：+1 层格挡（block 效果，非护盾池）。promotesTo 格挡（C）。
registerSkill({
  id: 'duckHead', name: '抱头', type: 'normal', tier: 'D', series: 'block',
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

// 精准一击（精准系列 D）：完美。23 伤害。promotesTo 精心一击（C）。
registerSkill({
  id: 'perfectStrike', name: '精准一击', type: 'normal', tier: 'D', series: 'block',
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'carefulStrike',
  canUse: perfectReady,
  use(sctx) {
    attackDamage(sctx, 17);
    return true;
  },
  describe: () => '/named{完美}。17伤害',
  battleDescribe: (sctx) => `/named{完美}。${resolvedDamageText(sctx, 17)}`,
});

// 精心一击（精准系列 C）：完美。15 伤害。promotesTo 折杨手（B，机制跃迁到命中）。
registerSkill({
  id: 'carefulStrike', name: '精心一击', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'foldWillow',
  canUse: perfectReady,
  use(sctx) {
    attackDamage(sctx, 12);
    return true;
  },
  describe: () => '/named{完美}。12伤害',
  battleDescribe: (sctx) => `/named{完美}。${resolvedDamageText(sctx, 12)}`,
});

// 精心二击（精准系列 B·延伸卡）：完美。12 伤害 ×2（2026-09 稿：C→B、数值下调、冷却1）。
registerSkill({
  id: 'doubleStrike', name: '精心二击', type: 'normal', tier: 'B', series: 'block',
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  canUse: perfectReady,
  use(sctx) {
    attackDamage(sctx, 12);
    attackDamage(sctx, 12);
    return true;
  },
  describe: () => '/named{完美}。12伤害×2',
  battleDescribe: (sctx) => `/named{完美}。${resolvedDamageText(sctx, 12)}×2`,
});

// 折杨手/揽云手/摘星手（精准系列 B/A/S）：23 伤害；命中：格挡 N。
// 两段式：段 0 提交攻击并挂命中探针，段 1 读探针——>0 点生命值伤害才获得格挡。
const hitStrike = (id, name, tier, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  canUse: perfectReady,
  use(sctx, stage) {
    if (stage === 0) {
      beginHitProbe(sctx, attackDamage(sctx, 20));
      return false; // 挂起一拍：等伤害子节点完整落地后再读探针
    }
    if (hitLanded(sctx)) gainBlock(sctx, per);
    return true;
  },
  describe: () => `/named{完美}。20伤害；/named{命中}：/effect{格挡}${per}`,
  battleDescribe: (sctx) => `/named{完美}。${resolvedDamageText(sctx, 20)}，/named{命中}：/effect{格挡}${per}`,
});
hitStrike('foldWillow', '折杨手', 'B', 2, 'embraceCloud');
hitStrike('embraceCloud', '揽云手', 'A', 3, null); // S（摘星手）阶梯外，不作晋升目标
hitStrike('pluckStar', '摘星手', 'S', 4, null);

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

// 坚固盾（盾系列 C）：8 护盾。
registerSkill({
  id: 'solidShield', name: '坚固盾', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    gainShield(sctx, 8);
    return true;
  },
  describe: () => '8护盾',
});

// 强化盾（盾系列 C，并行支线）：8 护盾 + 1 层格挡。
registerSkill({
  id: 'reinforcedShield', name: '强化盾', type: 'normal', tier: 'C', series: 'block',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    gainShield(sctx, 8);
    gainBlock(sctx, 1);
    return true;
  },
  describe: () => '8护盾，/effect{格挡}1',
});

// ==== 姿态系列（常驻引擎·咏唱）=================================================

// 龟守链（咏唱4，P5 咏唱触发攒格挡）：ChantTriggerInstruction POST → 获得 N 层格挡。
// 笨拙是发动瞬间的一次性代价（activated.onEnable 时获得层数；解除不回收——层数按
// 笨拙自身规则逐次消耗。设计稿未写解除回收，此为落地假设）。
const turtleStanceCard = (id, name, tier, ap, blockPerTrigger, clumsy, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 4,
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
turtleStanceCard('turtleStance', '龟守姿态', 'B', 1, 2, 2, 'mysticTurtle');
turtleStanceCard('mysticTurtle', '玄龟姿态', 'A', 1, 2, 1, null); // 神龟（S）阶梯外，不接晋升
turtleStanceCard('divineTurtle', '神龟姿态', 'S', 1, 2, 0, null);

// 武术链（咏唱3，格挡转攻击）：激活期间，玩家为来源的每一条伤害指令 PRE 加
// 「格挡层数 × N」。固定伤害（fixed）payload 白名单为空、不可修饰，跳过。
// 与贯心的逐层破伤天然咬合（§3「天一+贯心」斩杀线的引擎件）。
const martialStanceCard = (id, name, tier, ap, per, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DealDamageInstruction, phase: 'pre',
      filter: (instr) => instr.source === sctx.player && !instr.fixed,
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

// 狂战链（咏唱4，格挡转力量）：获得格挡时（一次正向获得事件，非逐层）也获得
// 1 层力量；失去格挡（破的负层数 AddEffect）不触发。
const berserkStanceCard = (id, name, tier, ap, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 4,
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

// 以有胜无（B）：加权手牌不少于 6 张（囤牌）→ 3 层格挡
handGateChant('haveWithout', '以有胜无', '若你手牌不少于6张', (sctx, battleState) =>
  effectiveHandCount(battleState) >= 6);

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

// ==== 散卡（2026-09 设计稿新增）=================================================

// 快如雨（C）/ 疾如风（B）：1AP 冷却1——打出时按**本回合已打出的牌数**结算：
// 每 4 张（B：每 3 张）获得 1 层格挡（向下取整，不含自身——发动卡结算时尚未计入）。
const rapidBlockCard = (id, name, tier, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'block',
  cost: { mana: 0, actionPoint: 1 },
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
    sctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'post', owner,
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
