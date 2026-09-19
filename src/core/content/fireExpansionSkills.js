// 火灵脉·扩容批（2026-09-14 用户审查定稿：「D-C 截面扩容到 40+」+ D 卡全部接进阶链）。
// 六个新维度各补一块机制空白，全部用火系现有语言（燃烧/魏启/自焚/咏唱/焚卡）：
//   * 多段小伤（火花链）——「每段触发」下游（控火:灼 每伤上燃、灼脉/炎魔能力）等到了弹药；
//   * 余烬注入（火种链）——火系自己的造牌语言（瞬echó拳的镜像），造牌-翻倍-传播链条启动；
//   * 燃烧收割（燃爆）——「燃烧→即时伤害」的 D/C 变现出口（激热是提前一拍，收/爆在 B/A）；
//   * 敌方 debuff（爆裂冲击链）——伤残放大燃烧固定伤，「烧得皮开肉绽」语言；
//   * 瞬发资源/条件件（急燃/焰刃/回火/扒灰/热浪）——自焚流的节奏与斩杀件；
//   * 咏唱反甲（熔岩铠甲，2026-09-18 接替已除名的烫甲）——被攻击上燃烧。
// 数值对标同阶白板（无条件部分不超白板，加成才是体系溢价）；D 卡全部 promotesTo
// 现有链位或新链（用户定：不接链的 D 卡是「拿了升不上去的负资产」）。

import { registerSkill } from '../skills/registry.js';
import { DealDamageInstruction, ApplyDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { GainManaInstruction } from '../instructions/resources.js';
import {
  enemyTarget, dealDamage, attackDamage, addEffect, addCard, drawCards, resolvedDamageText,
} from './cardKit.js';

// ==== 多段链（火花 D/C/B → 终极火花 A）：每段独立结算，吃「每段触发」面板 ====
// 2026-09-18 设计稿拍平：全链同名同机制（纯多段小伤，档位差只在段数/段伤）——
// 原连珠火 C 的「每段上燃」骑乘已删（机制在等级间漂移会让升级变成换玩法）。

// 火花 D/C/B：2魏 4/5/6 伤 ×3/3/4（对标火弹 D 2魏15抽1 / 火箭 C 2魏15抽2 /
// 火球 B 2魏25抽2：多段触发面是溢价，总伤压白板之下）。
function sparkCard({ id, tier, damage, hits, promotesTo }) {
  registerSkill({
    id, name: '火花', type: 'fire', tier, series: 'spark',
    cost: { mana: 2, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      for (let i = 0; i < hits; i++) attackDamage(sctx, damage);
      return true;
    },
    describe: () => `${damage}伤害×${hits}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}×${hits}`,
  });
}
sparkCard({ id: 'fireSpark', tier: 'D', damage: 4, hits: 3, promotesTo: 'fireChain' });
sparkCard({ id: 'fireChain', tier: 'C', damage: 5, hits: 3, promotesTo: 'blazingStream' });
sparkCard({ id: 'blazingStream', tier: 'B', damage: 6, hits: 4, promotesTo: 'sparkStorm' });

// 终极火花 A：2魏 6×6（总伤 36 对标大火球 37 抽2——不抽牌，段数触发面是溢价）。
registerSkill({
  id: 'sparkStorm', name: '终极火花', type: 'fire', tier: 'A', series: 'spark',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    for (let i = 0; i < 6; i++) attackDamage(sctx, 6);
    return true;
  },
  describe: () => '6伤害×6',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 6)}×6`,
});

// ==== 余烬链（2026-09-18 设计稿重做）：火种 D/C + 三张 B 分岔 + 衍生牌余烬 ====
// 余烬 = 火系的造牌语言：0 费即抛的燃烧施加。造出来的牌吃爆燃翻倍、鬼火传播、
// 控火散/收/聚的一切搬运——叠炎的节奏件。原续燃 C（咏唱注入）/撒火 B（发现 3）
// 已随重做除名：注入节奏统一收进火种本体，B 位三分岔各管一种兑现方式。

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

// 火种 D/C：1魏 冷却1——向牌库随机位洗入 2/4 张「余烬」（蓄力 D 的火版镜像；
// 2026-09-18 设计稿：0费改 1魏——白嫖造牌引擎过强，费用与档位同涨）。
function sparkSeedCard({ id, tier, count, promotesTo }) {
  registerSkill({
    id, name: '火种', type: 'fire', tier, series: 'ember',
    cost: { mana: 1, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      for (let i = 0; i < count; i++) addCard(sctx, 'emberMote', { index: 'random' });
      return true;
    },
    describe: () => `/named{洗入${count}}/card{emberMote}`,
  });
}
sparkSeedCard({ id: 'sparkSeed', tier: 'D', count: 2, promotesTo: 'sparkSeedPlus' });
sparkSeedCard({ id: 'sparkSeedPlus', tier: 'C', count: 4, promotesTo: ['quickSpark', 'latentSpark', 'eternalSpark'] });

// 速生火种 B：1魏 冷却1——发现 4 张余烬直接进手（注入量最大，但要从手里一张张
// 打出去——手牌吞吐是它的天花板）。
registerSkill({
  id: 'quickSpark', name: '速生火种', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (let i = 0; i < 4; i++) addCard(sctx, 'emberMote', { toZone: 'hand' });
    return true;
  },
  describe: () => '/named{发现}4/card{emberMote}',
  battleDescribe: () => '/named{发现}4/card{emberMote}',
});

// 潜伏火种 B：1魏 冷却1——洗入 6 张余烬（量大管饱，但沉在库里要靠抽牌慢慢兑现）。
registerSkill({
  id: 'latentSpark', name: '潜伏火种', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (let i = 0; i < 6; i++) addCard(sctx, 'emberMote', { index: 'random' });
    return true;
  },
  describe: () => '/named{洗入6}/card{emberMote}',
  battleDescribe: () => '/named{洗入6}/card{emberMote}',
});

// 不灭火种 B：1魏 冷却1——洗入 6 张余烬并抽 3（潜伏量的即时兑现分岔：抽上来的
// 立刻能打，代价是没有速生的全部到手）。
registerSkill({
  id: 'eternalSpark', name: '不灭火种', type: 'fire', tier: 'B', series: 'ember',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (let i = 0; i < 6; i++) addCard(sctx, 'emberMote', { index: 'random' });
    drawCards(sctx, 3);
    return true;
  },
  describe: () => '/named{洗入6}/card{emberMote}，抽3',
  battleDescribe: () => '/named{洗入6}/card{emberMote}，抽3',
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

// ==== 燃烧收割（燃爆 C/B/A，2026-09-18 设计稿扩阶）：燃烧→即时固定伤害的变现出口 ====
// 消耗目标一半燃烧层数（向下取整），每层转 1/1/2（A）点固定伤害（固定伤不吃面板、
// 护盾仍可吸收，与燃烧跳伤同语言；8层 → 耗4层换 4/4/8 固伤）。C 位消耗、B 起免消耗
// ——低阶一次性防复用，高阶走 FIFO 回库循环。无燃烧打出 = 落空。
function burnSnapCard({ id, tier, per, exhaust, promotesTo }) {
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
      dealDamage(sctx, consume * per, { target, source: null, fixed: true });
      return true;
    },
    describe: () => `消耗目标一半/effect{燃烧}，每层造成${per}固定伤害`,
    battleDescribe: (sctx) => {
      const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
      const consume = Math.floor(stacks / 2);
      return `消耗目标一半/effect{燃烧}：${consume * per}固定伤害`;
    },
  });
}
burnSnapCard({ id: 'burnSnap', tier: 'C', per: 1, exhaust: true, promotesTo: 'burnSnapPlus' });
burnSnapCard({ id: 'burnSnapPlus', tier: 'B', per: 1, exhaust: false, promotesTo: 'burnSnapGrand' });
burnSnapCard({ id: 'burnSnapGrand', tier: 'A', per: 2, exhaust: false });

// ==== 敌方 debuff 链（爆裂冲击 C → 爆裂冲击 B → 轰灭 A）：伤残放大一切后续伤害 ====
// 2026-09-18 设计稿重排：原「C 爆裂冲击 / B 轰灭」扩为三阶——B 位承袭爆裂冲击之名
// （22伤 伤残2），轰灭升 A（22伤 伤残4）；B→A 档位差全在伤残深度（延时价值）。

// 爆裂冲击 C/B：2魏 13/22 伤 + 目标伤残2（C 对标火箭术 C 14抽2：13<14，伤残2=
// 后续每次受伤+2，与燃烧跳伤/固伤天然联动）。2026-09-17 用户定：**转消耗卡**
// （伤残是延时价值，消耗防长局无限复用同一份伤残）。
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
blastShockCard({ id: 'blastShock', tier: 'C', damage: 13, maim: 2, promotesTo: 'blastShockPlus' });
blastShockCard({ id: 'blastShockPlus', tier: 'B', damage: 22, maim: 2, promotesTo: 'doomBlast' });

// 轰灭 A：2魏 22伤 + 伤残4（对标火球连发 A 14×2抽3：单发 22 与 B 持平，
// 伤残 4 是 A 位溢价——延时价值型斩杀铺垫）。
registerSkill({
  id: 'doomBlast', name: '轰灭', type: 'fire', tier: 'A', series: 'shock',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    attackDamage(sctx, 22, { target });
    addEffect(sctx, 'maim', 4, target);
    return true;
  },
  describe: () => '22伤害，赋予/effect{伤残}4',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 22)}，赋予/effect{伤残}4`,
});

// ==== 自焚流的节奏与斩杀件（散卡，挂现有链）====

// 急燃链 D/C/B/A（0费 冷却1，2026-09-18 设计稿扩为四阶）：获得 2/3/4/5 魏启，
// 自身燃烧4（发烧咏唱版的瞬发镜像：一次性、立刻兑现；自焚是代价也是燃料——
// 镜燃/焰愈/灼脉都吃它。原 D 位燃烧 2 同步上调到 4，全阶统一）。
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
flashBurnCard({ id: 'flashBurn', tier: 'D', mana: 2, promotesTo: 'flashBurnPlus' });
flashBurnCard({ id: 'flashBurnPlus', tier: 'C', mana: 3, promotesTo: 'flashBurnGrand' });
flashBurnCard({ id: 'flashBurnGrand', tier: 'B', mana: 4, promotesTo: 'flashBurnMaster' });
flashBurnCard({ id: 'flashBurnMaster', tier: 'A', mana: 5 });

// 焰刃链 D/C/B/A（2026-09-18 设计稿四阶化）：1AP 6 伤；你正在燃烧时 +5/+10/+15/+22
// （自焚流的条件件——基础伤恒 6，档位差全在燃烧加成斜率；全阶同机制同名前缀）。
function flameEdgeCard({ id, name, tier, bonus, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'selfImmolate',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const burning = sctx.player.getEffectStacks('burn') > 0;
      attackDamage(sctx, burning ? 6 + bonus : 6);
      return true;
    },
    describe: () => `6伤害；正在/effect{燃烧}，+${bonus}`,
    battleDescribe: (sctx) => resolvedDamageText(sctx,
      sctx.player.getEffectStacks('burn') > 0 ? 6 + bonus : 6),
  });
}
flameEdgeCard({ id: 'flameEdge', name: '焰刃', tier: 'D', bonus: 5, promotesTo: 'redHotBlade' });
flameEdgeCard({ id: 'redHotBlade', name: '红热焰刃', tier: 'C', bonus: 10, promotesTo: 'goldHotBlade' });
flameEdgeCard({ id: 'goldHotBlade', name: '金热焰刃', tier: 'B', bonus: 15, promotesTo: 'whiteHotBlade' });
flameEdgeCard({ id: 'whiteHotBlade', name: '白热焰刃', tier: 'A', bonus: 22 });

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
  describe: () => '8伤害；每有3层/effect{燃烧}，+4',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, backfireAmount(sctx))}`
    + `（+${Math.floor(sctx.player.getEffectStacks('burn') / 3) * 4}）`,
});
function backfireAmount(sctx) {
  return 8 + Math.floor(sctx.player.getEffectStacks('burn') / 3) * 4;
}

// 热浪链 C/B/A（1魏，2026-09-18 设计稿扩为三阶）：10 伤；目标燃烧 ≥5 层时
// +8/+13/+20（斩杀/条件爆发——叠炎的「火候到了」一击）。门槛恒 5 不变，
// 档位差全在加成斜率。
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
      attackDamage(sctx, hot ? 10 + bonus : 10, { target });
      return true;
    },
    describe: () => `10伤害；目标/effect{燃烧}不少于5层时，+${bonus}`,
    battleDescribe: (sctx) => {
      const stacks = enemyTarget(sctx)?.getEffectStacks('burn') ?? 0;
      return stacks >= 5
        ? resolvedDamageText(sctx, 10 + bonus)
        : `${resolvedDamageText(sctx, 10)}（燃${stacks}/5）`;
    },
  });
}
heatWaveCard({ id: 'heatWave', tier: 'C', bonus: 8, promotesTo: 'heatWavePlus' });
heatWaveCard({ id: 'heatWavePlus', tier: 'B', bonus: 13, promotesTo: 'heatWaveMaster' });
heatWaveCard({ id: 'heatWaveMaster', tier: 'A', bonus: 20 });

// 扒灰链 D/C/B（0费 冷却1，2026-09-18 设计稿扩为三阶）：抽 1 牌；坟墓里有
// 至少 4 张牌时再抽 1/2/3（回响烈焰 B 的 D 阶教学：火系的坟场语言从前期
// 就有踪迹）。门槛恒 4，档位差在追加抽牌数。
function ashRakeCard({ id, tier, extraDraw, promotesTo }) {
  registerSkill({
    id, name: '扒灰', type: 'fire', tier, series: 'fuel',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      drawCards(sctx, 1);
      if (sctx.battleState.zones.burnt.length >= 4) drawCards(sctx, extraDraw);
      return true;
    },
    describe: () => `抽1；坟墓不少于4张牌时，再抽${extraDraw}`,
    battleDescribe: (sctx) => `抽1（坟墓${sctx.battleState.zones.burnt.length}张）`,
  });
}
ashRakeCard({ id: 'ashRake', tier: 'D', extraDraw: 1, promotesTo: 'ashRakePlus' });
ashRakeCard({ id: 'ashRakePlus', tier: 'C', extraDraw: 2, promotesTo: 'ashRakeMaster' });
ashRakeCard({ id: 'ashRakeMaster', tier: 'B', extraDraw: 3 });

// ==== 咏唱反甲（熔岩铠甲 B/A）：受攻击给攻击方上燃烧 ====
// 烫甲（C，一次性护盾 + 一回合反甲）已于 2026-09-18 设计稿除名——同机制的咏唱
// 化版本熔岩铠甲顶上：不再是一次性买盾，点亮期间**每次**被攻击都灼烧攻击者
// （1AP 咏唱1：受攻击时赋予攻击方 2/3 层燃烧）。受击判定挂应用原语 POST +
// 只认主级（2026-09-15 拆分）：有来源的**主级**伤害才算攻击——附级反伤/毒 tick
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
        },
      }],
    },
    describe: () => `受攻击时，赋予攻击方/effect{燃烧}${burn}`,
    battleDescribe: () => `受攻击时，赋予攻击方/effect{燃烧}${burn}`,
  });
}
magmaArmorCard({ id: 'magmaArmor', tier: 'B', burn: 2, promotesTo: 'magmaArmorMaster' });
magmaArmorCard({ id: 'magmaArmorMaster', tier: 'A', burn: 3 });
