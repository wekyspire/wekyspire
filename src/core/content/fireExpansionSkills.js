// 火灵脉·扩容批（2026-09-14 用户审查定稿：「D-C 截面扩容到 40+」+ D 卡全部接进阶链）。
// 六个新维度各补一块机制空白，全部用火系现有语言（燃烧/魏启/自焚/咏唱/焚卡）：
//   * 多段小伤（火花链）——「每段触发」下游（控火:灼 每伤上燃、灼脉/炎魔能力）等到了弹药；
//   * 余烬注入（火种链）——火系自己的造牌语言（瞬echó拳的镜像），造牌-翻倍-传播链条启动；
//   * 燃烧收割（燃爆）——「燃烧→即时伤害」的 D/C 变现出口（激热是提前一拍，收/爆在 B/A）；
//   * 敌方 debuff（爆裂冲击链）——伤残放大燃烧固定伤，「烧得皮开肉绽」语言；
//   * 瞬发资源/条件件（急燃/焰刃/回火/扒灰/热浪）——自焚流的节奏与斩杀件；
//   * 反制防御（烫甲）——被攻击上燃烧，火墙家族的反伤分岔。
// 数值对标同阶白板（无条件部分不超白板，加成才是体系溢价）；D 卡全部 promotesTo
// 现有链位或新链（用户定：不接链的 D 卡是「拿了升不上去的负资产」）。

import { registerSkill } from '../skills/registry.js';
import { DealDamageInstruction, ApplyDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction, PlayerTurnStartInstruction } from '../instructions/turn.js';
import {
  enemyTarget, dealDamage, attackDamage, addEffect, gainShield, addCard, drawCards, resolvedDamageText,
} from './cardKit.js';

// ==== 多段链（火花 D → 连珠火 C → 炽流 B）：每段独立结算，吃「每段触发」面板 ====

// 火花 D：2魏 4伤×3（对标火弹术 D 2魏15抽1：总量 12<15，无抽牌，多段触发面是溢价）。
registerSkill({
  id: 'fireSpark', name: '火花', type: 'fire', tier: 'D', series: 'spark',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'fireChain',
  use(sctx) {
    for (let i = 0; i < 3; i++) attackDamage(sctx, 4);
    return true;
  },
  describe: () => '4伤害×3',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 4)}×3`,
});

// 连珠火 C：2魏 5伤×3，每段赋予目标燃烧1（对标火箭术 C 2魏15抽2：15+3层燃烧）。
registerSkill({
  id: 'fireChain', name: '连珠火', type: 'fire', tier: 'C', series: 'spark',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'blazingStream',
  use(sctx) {
    const target = enemyTarget(sctx);
    for (let i = 0; i < 3; i++) {
      attackDamage(sctx, 5);
      if (target && !target.isDead()) addEffect(sctx, 'burn', 1, target);
    }
    return true;
  },
  describe: () => '5伤害×3，每段赋予/effect{燃烧}1',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 5)}×3，每段赋予/effect{燃烧}1`,
});

// 炽流 B：2魏 6伤×4（对标火球术 B 2魏25抽2：24<25，多段补偿）。
registerSkill({
  id: 'blazingStream', name: '炽流', type: 'fire', tier: 'B', series: 'spark',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    for (let i = 0; i < 4; i++) attackDamage(sctx, 6);
    return true;
  },
  describe: () => '6伤害×4',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 6)}×4`,
});

// ==== 余烬链（火绒 D → [点火] ｜ 火种 D → 续燃 C → 撒火 B + 衍生牌余烬）====
// 余烬 = 火系的造牌语言：0 费即抛的燃烧施加。造出来的牌吃爆燃翻倍、鬼火传播、
// 控火散/收/聚的一切搬运——叠炎的节奏件。

// 火绒 D：0费 3伤 + 目标燃烧2（D 阶敌方燃烧入口——此前上敌方燃烧最低是 C 阶点火）。
registerSkill({
  id: 'tinder', name: '火绒', type: 'fire', tier: 'D', series: 'ignite',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'inflame',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 3, { target });
    addEffect(sctx, 'burn', 2, target);
    return true;
  },
  describe: () => '3伤害，赋予/effect{燃烧}2',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 3)}，赋予/effect{燃烧}2`,
});

// 火种 D：0费 冷却1——向牌库随机位洗入 2 张「余烬」（蓄力 D 的火版镜像）。
registerSkill({
  id: 'sparkSeed', name: '火种', type: 'fire', tier: 'D', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'emberChant',
  use(sctx) {
    for (let i = 0; i < 2; i++) addCard(sctx, 'emberMote', { index: 'random' });
    return true;
  },
  describe: () => '/named{洗入2}/card{emberMote}',
});

// 余烬（衍生牌）：0费即抛——赋予目标燃烧3，打出即焚毁。只经造牌入场。
registerSkill({
  id: 'emberMote', name: '余烬', type: 'fire', tier: 'D', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use(sctx) {
    const target = enemyTarget(sctx);
    if (target) addEffect(sctx, 'burn', 3, target);
    return true;
  },
  describe: () => '赋予/effect{燃烧}3',
  battleDescribe: () => '赋予/effect{燃烧}3',
});

// 续燃 C：0费 咏唱1——每回合咏唱触发，向牌库随机位洗入 2 张余烬
// （取暖的注入版：单目标但可蓄，无自施代价——注入本身需要手牌打出才兑现）。
registerSkill({
  id: 'emberChant', name: '续燃', type: 'fire', tier: 'C', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo: 'emberSow',
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: () => {
        for (let i = 0; i < 2; i++) addCard(sctx, 'emberMote', { index: 'random' });
      },
    }],
  },
  describe: () => '每回合/named{洗入}2/card{emberMote}',
  battleDescribe: () => '每回合/named{洗入}2/card{emberMote}',
});

// 撒火 B：0费 消耗——发现 3 张余烬直接进手牌（一瞬千击 A 的火版）。
registerSkill({
  id: 'emberSow', name: '撒火', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    for (let i = 0; i < 3; i++) addCard(sctx, 'emberMote', { toZone: 'hand' });
    return true;
  },
  describe: () => '/named{发现}3/card{emberMote}',
  battleDescribe: () => '/named{发现}3/card{emberMote}',
});

// ==== 燃烧收割（燃爆 C → [控火术：收 B]）：燃烧→即时固定伤害的变现出口 ====

// 燃爆 C：1魏——消耗目标一半燃烧层数（向下取整），每层转 2 点固定伤害
// （8层 → 耗4层换 8 固伤；固定伤不吃面板、护盾仍可吸收，与燃烧跳伤同语言）。
registerSkill({
  id: 'burnSnap', name: '燃爆', type: 'fire', tier: 'C', series: 'fireControl',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'fireControlHarvest',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const consume = Math.floor(target.getEffectStacks('burn') / 2);
    if (consume <= 0) return true; // 无燃烧：落空
    addEffect(sctx, 'burn', -consume, target);
    dealDamage(sctx, consume * 2, { target, source: null, fixed: true });
    return true;
  },
  describe: () => '消耗目标一半/effect{燃烧}，每层造成2固定伤害',
  battleDescribe: (sctx) => {
    const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    const consume = Math.floor(stacks / 2);
    return `消耗目标一半/effect{燃烧}（当前${stacks}层）：${consume * 2}固定伤害`;
  },
});

// ==== 敌方 debuff 链（爆裂冲击 C → 轰灭 B）：伤残放大一切后续伤害 ====

// 爆裂冲击 C：2魏 13伤 + 目标伤残2（对标火箭术 C 15抽2：13<15，伤残2=后续每次受伤+2，
// 与燃烧跳伤/固伤天然联动）。
registerSkill({
  id: 'blastShock', name: '爆裂冲击', type: 'fire', tier: 'C', series: 'shock',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'doomBlast',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 13, { target });
    addEffect(sctx, 'maim', 2, target);
    return true;
  },
  describe: () => '13伤害，赋予/effect{伤残}2',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 13)}，赋予/effect{伤残}2`,
});

// 轰灭 B：2魏 22伤 + 伤残3（对标火球术 B 25抽2）。
registerSkill({
  id: 'doomBlast', name: '轰灭', type: 'fire', tier: 'B', series: 'shock',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 22, { target });
    addEffect(sctx, 'maim', 3, target);
    return true;
  },
  describe: () => '22伤害，赋予/effect{伤残}3',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 22)}，赋予/effect{伤残}3`,
});

// ==== 自焚流的节奏与斩杀件（散卡，挂现有链）====

// 急燃 D：0费 冷却1——获得 2 魏启，自身燃烧2（发烧咏唱版的瞬发镜像：一次性、
// 立刻兑现；自焚是代价也是燃料——镜燃/焰愈/灼脉都吃它）。
registerSkill({
  id: 'flashBurn', name: '急燃', type: 'fire', tier: 'D', series: 'fever',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'fever',
  use(sctx) {
    sctx.kernel.submitInstruction(new GainManaInstruction({ amount: 2 }));
    addEffect(sctx, 'burn', 2);
    return true;
  },
  describe: () => '获得2魏启，自身/effect{燃烧}2',
  battleDescribe: () => '获得2魏启，自身/effect{燃烧}2',
});

// 焰刃 D：1AP 8伤；若你正在燃烧 +6（自焚流的 D 阶条件件——燃烧管理好就是 D 阶最强拳）。
registerSkill({
  id: 'flameEdge', name: '焰刃', type: 'fire', tier: 'D', series: 'selfImmolate',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'drawFlame',
  use(sctx) {
    const burning = sctx.player.getEffectStacks('burn') > 0;
    attackDamage(sctx, burning ? 14 : 8);
    return true;
  },
  describe: () => '8伤害；若你正在/effect{燃烧}，+6',
  battleDescribe: (sctx) => resolvedDamageText(sctx,
    sctx.player.getEffectStacks('burn') > 0 ? 14 : 8),
});

// 回火 C：1魏 8伤；自身每有 3 层燃烧，伤害 +4（自烧越狠打得越痛——
// 自焚烧血流的攻击位，与可燃血液/焰愈的防御位互补）。
registerSkill({
  id: 'backfire', name: '回火', type: 'fire', tier: 'C', series: 'selfImmolate',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'immolate',
  use(sctx) {
    attackDamage(sctx, backfireAmount(sctx));
    return true;
  },
  describe: () => '8伤害；自身每有3层/effect{燃烧}，伤害+4',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, backfireAmount(sctx))}`
    + `（8+${Math.floor(sctx.player.getEffectStacks('burn') / 3) * 4}）`,
});
function backfireAmount(sctx) {
  return 8 + Math.floor(sctx.player.getEffectStacks('burn') / 3) * 4;
}

// 热浪 C：1魏 10伤；目标燃烧 ≥5 层时 +8（斩杀/条件爆发——叠炎的「火候到了」一击）。
registerSkill({
  id: 'heatWave', name: '热浪', type: 'fire', tier: 'C', series: 'ignite',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'fireBall',
  use(sctx) {
    const target = enemyTarget(sctx);
    const hot = (target?.getEffectStacks('burn') ?? 0) >= 5;
    attackDamage(sctx, hot ? 18 : 10);
    return true;
  },
  describe: () => '10伤害；目标/effect{燃烧}不少于5层时，+8',
  battleDescribe: (sctx) => {
    const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
    return stacks >= 5
      ? `${resolvedDamageText(sctx, 18)}（燃烧${stacks}层，已达成）`
      : `${resolvedDamageText(sctx, 10)}（燃烧${stacks}层）`;
  },
});

// 扒灰 D：0费 冷却1——抽 1 牌；坟墓里有至少 4 张牌时再抽 1
// （回响烈焰 B 的 D 阶教学：火系的坟场语言从前期就有踪迹）。
registerSkill({
  id: 'ashRake', name: '扒灰', type: 'fire', tier: 'D', series: 'fuel',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'fuelTheFire',
  use(sctx) {
    drawCards(sctx, 1);
    if (sctx.battleState.zones.burnt.length >= 4) drawCards(sctx, 1);
    return true;
  },
  describe: () => '抽1牌；若坟墓里有至少4张牌，再抽1',
  battleDescribe: (sctx) => `抽1牌（坟墓${sctx.battleState.zones.burnt.length}张）`,
});

// ==== 反制防御（烫甲 C → [火壁 B]）：火墙家族的反伤分岔 ====

// 烫甲 C：1AP 冷却1——6盾；到你的下回合开始前，你每受到一次攻击，
// 对攻击者施加燃烧2（受击判定挂应用原语 POST + 只认主级（2026-09-15 拆分）：
// 有来源的**主级**伤害才算攻击——附级反伤/毒 tick 不触发；「本回合」按敌方攻击的
// 实际发生窗口实现——battle 窗口订阅 + 下回合开始自清）。
registerSkill({
  id: 'scaldArmor', name: '烫甲', type: 'fire', tier: 'C', series: 'fireWall',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'fireWallMaster',
  use(sctx) {
    gainShield(sctx, 6);
    const owner = `scaldArmor:${sctx.self.uniqueID}`;
    sctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === sctx.player
        && instr.source && !instr.source.isDead() && instr.source.side === 'enemy'
        && instr.type === 'major',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: instr.source, effectId: 'burn', stacks: 2,
        }), instr);
      },
    });
    sctx.kernel.addSubscription({
      when: PlayerTurnStartInstruction, phase: 'post', owner,
      react: (instr, ctx) => ctx.kernel.removeSubscriptionsByOwner(owner),
    });
    return true;
  },
  describe: () => '护盾6。到你的下回合开始，你每受到一次攻击，对攻击者施加/effect{燃烧}2',
  battleDescribe: () => '护盾6。到你的下回合开始，你每受到一次攻击，对攻击者施加/effect{燃烧}2',
});
