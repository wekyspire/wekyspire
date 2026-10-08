// 火灵脉·扩容批。六个新维度各补一块机制空白，全部用火系现有语言（燃烧/魏启/自焚/咏唱/焚卡）：
//   * 多段小伤（火花链）——「每段触发」下游（控火:灼 每伤上燃、灼脉/炎魔能力）等到了弹药；
//   * 余烬注入（火种链）——火系自己的造牌语言（瞬击的镜像），造牌-翻倍-传播链条启动；
//   * 燃烧收割（燃爆）——「燃烧→即时伤害」的变现出口（激热是提前一拍，收/爆在 B/A）；
//   * 敌方 debuff（爆裂冲击链）——伤残放大燃烧固定伤，「烧得皮开肉绽」语言；
//   * 瞬发资源/条件件（急燃/焰刃/回火/铲灰/热浪）——自焚流的节奏与斩杀件；
//   * 咏唱反甲（熔岩铠甲）——被攻击上燃烧。
// 数值对标同阶白板（无条件部分不超白板，加成才是体系溢价）；所有卡接进阶链
// （不接链的低阶卡是「拿了升不上去的负资产」）。

import { registerSkill } from '../skills/registry.js';
import { DealDamageInstruction, ApplyDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { GainManaInstruction } from '../instructions/resources.js';
import {
  enemyTarget, dealDamage, attackDamage, addEffect, addCard, drawCards, resolvedDamageText,
  randomAliveEnemy, reactFx,
} from './cardKit.js';

// ==== 多段链（火花 C/B/A + 终极火花 S）：每段独立结算，随机目标 ====
// 每段随机选取存活敌人（种子 rng，可复现）——乱射。随机索敌故不需要玩家瞄准
// （targetMode 缺省 'none'）。
function sparkCard({ id, name = '火花', tier, damage, hits, promotesTo = null }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'spark',
    cost: { mana: 2, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      for (let i = 0; i < hits; i++) {
        const target = randomAliveEnemy(sctx);
        if (!target) break;
        attackDamage(sctx, damage, { target });
      }
      return true;
    },
    describe: () => `随机${damage}伤害×${hits}`,
    battleDescribe: (sctx) => `随机${resolvedDamageText(sctx, damage)}×${hits}`,
  });
}
sparkCard({ id: 'fireSparkC', tier: 'C', damage: 3, hits: 4, promotesTo: 'fireSparkB' });
sparkCard({ id: 'fireSparkB', tier: 'B', damage: 4, hits: 4, promotesTo: 'fireSparkA' });
sparkCard({ id: 'fireSparkA', tier: 'A', damage: 5, hits: 4 });
sparkCard({ id: 'ultimateSpark', name: '终极火花', tier: 'S', damage: 5, hits: 7 });

// ==== 余烬链：火种 C + 两张 B 分岔 + A 不灭 + 衍生牌余烬 ====
// 余烬 = 火系的造牌语言：0 费即抛的燃烧施加。造出来的牌吃焚烧翻倍、鬼火传播、
// 控火散/收/聚的一切搬运——叠炎的节奏件。火种 C 直分岔到 B 双选。

// 火种 C：1魏 冷却1——向牌库随机位洗入 3 张「余烬」，抽2（升级：抽3——升级收益
// = 抽牌加一，不增加洗入余烬数量）。
registerSkill({
  id: 'sparkSeedC', name: '火种', type: 'fire', tier: 'C', series: 'ember',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'sparkSeedB',
  use(sctx) {
    for (let i = 0; i < 3; i++) addCard(sctx, 'emberMote', { index: 'random' });
    drawCards(sctx, sctx.self.promoted ? 3 : 2);
    return true;
  },
  describe: () => '/named{洗入3}/card{emberMote}，抽2（升级后抽3）',
  battleDescribe: (sctx) => `/named{洗入3}/card{emberMote}，抽${sctx.self.promoted ? 3 : 2}`,
});

// 火种 B：1魏 冷却1——洗入 3 张余烬，抽3（升级：抽4——同火种口径，
// 加抽牌不洗更多余烬）。
registerSkill({
  id: 'sparkSeedB', name: '火种', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (let i = 0; i < 3; i++) addCard(sctx, 'emberMote', { index: 'random' });
    drawCards(sctx, sctx.self.promoted ? 4 : 3);
    return true;
  },
  describe: () => '/named{洗入3}/card{emberMote}，抽3（升级后抽4）',
  battleDescribe: (sctx) => `/named{洗入3}/card{emberMote}，抽${sctx.self.promoted ? 4 : 3}`,
});

// 不灭火种 A：0费 冷却1——洗入 3 张余烬并抽 3（潜伏量的即时兑现分岔）。
registerSkill({
  id: 'eternalSpark', name: '不灭火种', type: 'fire', tier: 'A', series: 'ember',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (let i = 0; i < 3; i++) addCard(sctx, 'emberMote', { index: 'random' });
    drawCards(sctx, 3);
    return true;
  },
  describe: () => '/named{洗入3}/card{emberMote}，抽3',
  battleDescribe: () => '/named{洗入3}/card{emberMote}，抽3',
});

// 余烬（衍生牌）：0费即抛——赋予目标燃烧3，打出即焚毁。只经造牌入场。
// （等阶记 C——衍生牌等阶只是账务口径。）
registerSkill({
  id: 'emberMote', name: '余烬', type: 'fire', tier: 'C', series: 'ember',
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

// ==== 燃烧收割（燃爆 B/A）：燃烧→即时固定伤害的变现出口 ====
// 消耗目标一半燃烧层数（向下取整），每层转 2 点固定伤害（固定伤不吃面板、
// 护盾仍可吸收，与燃烧跳伤同语言；8层 → 耗4层换 8 固伤）。B 位消耗、A 起免消耗
// ——低阶一次性防复用，高阶走 FIFO 回库循环。无燃烧打出 = 落空。
function burnSnapCard({ id, tier, exhaust, promotesTo }) {
  registerSkill({
    id, name: '燃爆', type: 'fire', tier, series: 'fireControl',
    cost: { mana: 1, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    keywords: exhaust ? ['exhaust'] : [],
    promotesTo,
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
      return `消耗目标一半/effect{燃烧}：${Math.floor(stacks / 2) * 2}固定伤害`;
    },
  });
}
burnSnapCard({ id: 'burnSnapB', tier: 'B', exhaust: true, promotesTo: 'burnSnapA' });
burnSnapCard({ id: 'burnSnapA', tier: 'A', exhaust: false });

// ==== 敌方 debuff 链（爆裂冲击 C/B → 轰灭 A）：伤残放大一切后续伤害 ====
// 全阶消耗（伤残是延时价值，消耗防长局无限复用同一份伤残）。
// 阶梯：C 10/+3 → B 13/+3 → A 轰灭 13/+4（A 位溢价在伤残层数——延时价值型斩杀铺垫）。
function blastShockCard({ id, tier, damage, maim, promotesTo }) {
  registerSkill({
    id, name: '爆裂冲击', type: 'fire', tier, series: 'shock',
    cost: { mana: 2, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      const target = enemyTarget(sctx);
      if (!target) return true;
      attackDamage(sctx, damage, { target });
      addEffect(sctx, 'maim', maim, target);
      return true;
    },
    describe: () => `${damage}伤害，赋予/effect{伤残}${maim}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，赋予/effect{伤残}${maim}`,
  });
}
blastShockCard({ id: 'blastShockC', tier: 'C', damage: 10, maim: 3, promotesTo: 'blastShockB' });
blastShockCard({ id: 'blastShockB', tier: 'B', damage: 13, maim: 3, promotesTo: 'doomBlast' });

// 轰灭 A：2魏 13伤 + 伤残4（与 B 同伤，伤残 +1 是 A 位溢价——延时价值型斩杀铺垫）。
registerSkill({
  id: 'doomBlast', name: '轰灭', type: 'fire', tier: 'A', series: 'shock',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 13, { target });
    addEffect(sctx, 'maim', 4, target);
    return true;
  },
  describe: () => '13伤害，赋予/effect{伤残}4',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 13)}，赋予/effect{伤残}4`,
});

// ==== 自焚流的节奏与斩杀件（散卡，挂现有链）====

// 急燃 C/B/A（0费 冷却1）：获得 2/3/4 魏启，自身燃烧4
// （一次性、立刻兑现的自焚节奏件——自焚是代价也是燃料——镜燃/焰愈/灼脉都吃它。
//  C 位是火路线起始牌组的回蓝件——随开局直发）。
function flashBurnCard({ id, tier, mana, promotesTo }) {
  registerSkill({
    id, name: '急燃', type: 'fire', tier, series: 'fever',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: mana }));
      addEffect(sctx, 'burn', 4);
      return true;
    },
    describe: () => `获得${mana}魏启，/effect{燃烧}4`,
    battleDescribe: () => `获得${mana}魏启，/effect{燃烧}4`,
  });
}
flashBurnCard({ id: 'flashBurnC', tier: 'C', mana: 2, promotesTo: 'flashBurnB' });
flashBurnCard({ id: 'flashBurnB', tier: 'B', mana: 3, promotesTo: 'flashBurnA' });
flashBurnCard({ id: 'flashBurnA', tier: 'A', mana: 4 });

// 焰刃链 C/B/A：1AP 7 伤；你正在燃烧时 +7/+11/+15
// （自焚流的条件件——基础伤恒 7，档位差全在燃烧加成斜率）。
function flameEdgeCard({ id, name, tier, bonus, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'selfImmolate',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const burning = sctx.player.getEffectStacks('burn') > 0;
      attackDamage(sctx, burning ? 7 + bonus : 7);
      return true;
    },
    describe: () => `7伤害；正在/effect{燃烧}，+${bonus}`,
    battleDescribe: (sctx) => {
      const burning = sctx.player.getEffectStacks('burn') > 0;
      return `${resolvedDamageText(sctx, burning ? 7 + bonus : 7)}；正在/effect{燃烧}，+${bonus}${burning ? '（燃烧中）' : ''}`;
    },
  });
}
flameEdgeCard({ id: 'redHotBlade', name: '红热焰刃', tier: 'C', bonus: 7, promotesTo: 'goldHotBlade' });
flameEdgeCard({ id: 'goldHotBlade', name: '金热焰刃', tier: 'B', bonus: 11, promotesTo: 'whiteHotBlade' });
flameEdgeCard({ id: 'whiteHotBlade', name: '白热焰刃', tier: 'A', bonus: 15 });

// 热浪链 C/B/A（1魏）：8 伤；目标燃烧 ≥5 层时 +8/+12/+16
// （斩杀/条件爆发——叠炎的「火候到了」一击）。门槛恒 5 不变，档位差全在加成斜率。
function heatWaveCard({ id, tier, bonus, promotesTo }) {
  registerSkill({
    id, name: '热浪', type: 'fire', tier, series: 'ignite',
    cost: { mana: 1, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const target = enemyTarget(sctx);
      const hot = (target?.getEffectStacks('burn') ?? 0) >= 5;
      attackDamage(sctx, hot ? 8 + bonus : 8, { target });
      return true;
    },
    describe: () => `8伤害；目标/effect{燃烧}不少于5层时，+${bonus}`,
    battleDescribe: (sctx) => {
      const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
      const hot = stacks >= 5;
      return `${resolvedDamageText(sctx, hot ? 8 + bonus : 8)}`
        + `；目标/effect{燃烧}不少于5层时，+${bonus}（燃${stacks}/5${hot ? '，已生效' : ''}）`;
    },
  });
}
heatWaveCard({ id: 'heatWaveC', tier: 'C', bonus: 8, promotesTo: 'heatWaveB' });
heatWaveCard({ id: 'heatWaveB', tier: 'B', bonus: 12, promotesTo: 'heatWaveA' });
heatWaveCard({ id: 'heatWaveA', tier: 'A', bonus: 16 });

// 铲灰链 C/B/A（0费 冷却1）：抽 1 牌；坟墓里有至少 3/2/2 张牌时
// 再抽 1/1/2（回响烈焰 B 的低阶教学：火系的坟场语言从前期就有踪迹）。
function ashRakeCard({ id, tier, threshold, extraDraw, promotesTo }) {
  registerSkill({
    id, name: '铲灰', type: 'fire', tier, series: 'fuel',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      drawCards(sctx, 1);
      if (sctx.battleState.zones.burnt.length >= threshold) drawCards(sctx, extraDraw);
      return true;
    },
    describe: () => `抽1；坟墓不少于${threshold}张牌时，再抽${extraDraw}`,
    battleDescribe: (sctx) => `抽1；坟墓不少于${threshold}张牌时，再抽${extraDraw}（坟墓${sctx.battleState.zones.burnt.length}张）`,
  });
}
ashRakeCard({ id: 'ashRakeC', tier: 'C', threshold: 3, extraDraw: 1, promotesTo: 'ashRakeB' });
ashRakeCard({ id: 'ashRakeB', tier: 'B', threshold: 2, extraDraw: 1, promotesTo: 'ashRakeA' });
ashRakeCard({ id: 'ashRakeA', tier: 'A', threshold: 2, extraDraw: 2 });

// ==== 咏唱反甲（熔岩铠甲 B/A）：受攻击给攻击方上燃烧 ====
// 不再是一次性买盾，点亮期间**每次**被攻击都灼烧攻击者
// （1AP 咏唱1：受攻击时赋予攻击方 2/3 层燃烧）。受击判定挂应用原语 POST +
// 只认主级：有来源的**主级**伤害才算攻击——附级反伤/毒 tick
// 不触发；订阅挂卡牌 owner，熄灭自动注销，无回合窗自清（咏唱常驻即反甲常驻）。
function magmaArmorCard({ id, tier, burn, promotesTo }) {
  registerSkill({
    id, name: '熔岩铠甲', type: 'fire', tier, series: 'magmaArmor',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ApplyDamageInstruction, phase: 'post',
        filter: (instr) => instr.target === sctx.player
          && instr.source && !instr.source.isDead() && instr.source.side === 'enemy'
          && instr.type === 'major',
        react: (instr, ctx) => {
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: instr.source, effectId: 'burn', stacks: burn,
          }), instr);
          reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
        },
      }],
    },
    describe: () => `受攻击时，赋予攻击方/effect{燃烧}${burn}`,
    battleDescribe: () => `受攻击时，赋予攻击方/effect{燃烧}${burn}`,
  });
}
magmaArmorCard({ id: 'magmaArmorB', tier: 'B', burn: 2, promotesTo: 'magmaArmorA' });
magmaArmorCard({ id: 'magmaArmorA', tier: 'A', burn: 3 });
