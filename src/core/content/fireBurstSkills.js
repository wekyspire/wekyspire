// 火灵脉·爆炎组合 + 通用散卡（FIRE_VEIN_CARDS §1、§3）。
// 火球术 / 爆裂术 / 凝焰 / 高热 / 可燃 / 火雨 / 添柴 / 先发 / 熬焰 / 回响烈焰·背水一战·放手一搏
// + 通用（火源归一/含焰术/膨胀/灭火/火焰精通/火焰眷顾）。
//
// 数值口径备注（全文件通用）：
// - 攻击类卡伤害走 F1 面板轨（基数 + 攻击 + power），battleDescribe 一律经
//   resolvedDamageText 干跑真实修正管线（A5 所见即所算）；设计稿数字为基数。
// - 「燃烧」作为无目标写法的代价/副作用语言时默认**自施**（爆炎体系的燃烧
//   是代价而非输出，与高热系列、膨胀一致）。
// - 设计稿未写费用 = 0 费；未写咏唱值的咏唱卡按默认咏唱2（helpers.handWeightOf 兜底）。

import { registerSkill, getSkillDefinition } from '../skills/registry.js';
import { aliveEnemies, allAliveUnits } from '../state/battleState.js';
import BattleInstruction from '../kernel/BattleInstruction.js';
import { DealDamageInstruction, ApplyDamageInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction, BurnCardInstruction, MoveCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction, ConsumeManaInstruction } from '../instructions/resources.js';
import { applyBattleModifier } from '../run/prep.js';
import { deactivateChant } from '../skills/helpers.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import {
  enemyTarget, dealDamage, attackDamage, resolvedDamageText, gainShield, addEffect,
  drawCards, burnCard, requestHandSelection, selected, gainPower, addCard,
} from './cardKit.js';

// ====================================================================
// 共享原语
// ====================================================================

// 群伤：对每个存活敌人提交一枚 tags:['aoe'] 的伤害指令（群伤标记供「爆发」类
// 能力/订阅识别，见 test/elementalBurst.test.js 群伤原型）。选定目标（若有）恒
// 排在最后命中——瑞米跟随「最后被命中的敌人」，群伤卡由此获得软指定索敌
// （隐藏机制：卡面仍写「群伤N」，选目标只是改变命中顺序，不写明）。
function aoeDamage(sctx, amount, chosen = null) {
  const enemies = aliveEnemies(sctx.battleState).filter(e => e !== chosen);
  if (chosen && !chosen.isDead()) enemies.push(chosen);
  for (const e of enemies) {
    attackDamage(sctx, amount, { target: e, tags: ['aoe'] });
  }
}

// 沿结算树上溯找「正在打出的卡」：魏启消耗指令的祖先链上必然挂着持卡指令
// （UseSkillInstruction / ConsumeSkillResourcesInstruction / ActivateSkillInstruction
// 均带 .skill 字段）。换牌走 AP 不产生魏启消耗，不会进入本判定。
// 火焰眷顾用它判定「这次消耗是否由火灵脉牌引起」。
function cardConsumingMana(instr) {
  let node = instr;
  while (node) {
    if (node.skill?.defId) return node.skill;
    node = node.parentInstruction;
  }
  return null;
}

// ====================================================================
// §1.1 火球术系列（基石：直伤 + 抽牌）
// ====================================================================

// 火球系列工厂：N 魏启直伤（可多段）+ 抽牌。伤害走 F1 面板轨（见文件头）。
// 2026-09-17 用户定：全系伤害 -1（爆裂链前期靠火球开路，只轻削不伤筋骨）。
function fireBallCard({ id, name, tier, damage, hits = 1, draw, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fireBall',
    cost: { mana: 2, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const target = enemyTarget(sctx);
      // 多段同目标：段间不做重选（点击时点已锁定目标，G1 结算时校验存活）
      for (let i = 0; i < hits; i++) attackDamage(sctx, damage, { target });
      if (draw > 0) drawCards(sctx, draw);
      return true;
    },
    describe: () => `${damage}伤害${hits > 1 ? `${hits}次` : ''}${draw ? `，抽${draw}` : ''}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}${hits > 1 ? `${hits}次` : ''}${draw ? `，抽${draw}` : ''}`,
  });
}
fireBallCard({ id: 'fireBolt', name: '火弹术', tier: 'D', damage: 14, draw: 1, promotesTo: 'fireArrow' });
fireBallCard({ id: 'fireArrow', name: '火箭术', tier: 'C', damage: 14, draw: 2, promotesTo: 'fireBall' });
fireBallCard({ id: 'fireBall', name: '火球术', tier: 'B', damage: 24, draw: 2 });
// 火球连发（A，多段分叉）与大火球术（A，单发大数字）是 B 位之后的两条并列分叉，
// 不设 promotesTo（升阶链止于 B 的双选）。
fireBallCard({ id: 'fireBarrage', name: '火球连发', tier: 'A', damage: 14, hits: 2, draw: 3 });
fireBallCard({ id: 'greaterFireBall', name: '大火球术', tier: 'A', damage: 37, draw: 2 });

// 蓄热火球（C）：7 直伤；每次打出后**自身**伤害永久 +12（本场战斗内，其他卡
// 吃不到——平衡口径见 2026-09 反馈）。加成由 runtime.power 承载（伤害公式
// 基数+面板+power 同源，卡面威力直读）；先结算本拍再+12：本次打出不享受。
registerSkill({
  id: 'heatChargedBall', name: '蓄热火球', type: 'fire', tier: 'C', series: 'fireBall',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 7);
    gainPower(sctx, sctx.self, 12);   // 本拍结算完再+12：本次打出不享受（公共放缩节拍走 gainPower）
    return true;
  },
  describe: () => '7伤害，/named{蓄热}（伤害+12）',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 7)}，/named{蓄热}（伤害+12）`,
});

// ====================================================================
// §1.1 爆裂术系列（咏唱输出：激活期蓄能，终止时群伤爆发）
// ====================================================================

// 爆裂术工厂。语义假设（设计稿「每消耗1魏启伤害+5。终止：30群伤」）：
// - 发动（1魏启）仅点亮咏唱，无即时效果；发动费在订阅注册前结算，**不计入**蓄能。
// - 激活期间玩家**任意来源**的魏启消耗（其他卡的费用、X 费全耗等）每 1 点为
//   终止伤害 +系数（计数挂 skillRuntime，不藏闭包）。
// - 「终止」= 咏唱熄灭（再次打出免费解除 / 离手），onDisable 时按 基数+蓄能
//   对所有存活敌人打出群伤；熄灭路径由指令层统一走 deactivateChant，本卡不焚毁
//   （无消耗关键词），解除后回牌库底。
// 费用沿革：4（设计稿）→ 2（第 7 轮裁决）→ 1（2026-09-17 用户定：全系发动费 1，
// 点亮即廉价、重点亮无负担——蓄能价值全部转移给「激活期间倾蓝」）。等阶阶梯
// C→B→A→S：基伤 10/25/35/45 起跳，每魏蓄能 3/5/7/9。
// 固有 + 咏唱2（2026-09-17 用户定）：终止需要「再打出一次」，激活的咏唱常驻手中
// ——固有保证开局必在手（点一次管全场，不存在「池满了卡在库底」的干瞪眼）；
// 代价是激活后占 2 个手位（吃咏唱压力是爆裂体系的本分）。
function burstChantCard({ id, name, tier, base, perMana, promotesTo = null }) {
  const def = {
    name, type: 'fire', tier, series: 'burst',
    cost: { mana: 1, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 2,
    keywords: ['innate'],
    use() { return true; }, // 无即时效果：蓄能靠 activated 订阅，爆发靠 onDisable
    activated: {
      // 激活演出自定（火焰橙——默认是金色脉冲，见 BattleStage _chantActivateBeat）
      anim: { color: 0xff9a3d },
      onEnable: (sctx) => { sctx.self.burstPool = 0; },
      subscriptions: (sctx) => [{
        when: ConsumeManaInstruction,
        phase: 'post',
        filter: (instr) => (instr.result?.consumed ?? 0) > 0,
        react: (instr) => { sctx.self.burstPool += instr.result.consumed * perMana; },
      }],
      onDisable: (sctx) => {
        const total = base + (sctx.self.burstPool ?? 0);
        aoeDamage(sctx, total, enemyTarget(sctx)); // 解除时带目标：选定敌人最后命中
      },
    },
    describe: () => `每消耗1魏启，/named{终止}伤害+${perMana}。/named{终止}：${base}群伤`,
    battleDescribe: () => `每消耗1魏启，/named{终止}伤害+${perMana}；/named{终止}：${base}群伤`,
  };
  registerSkill({ ...def, id, promotesTo });
  // 咏唱开销 0 镜像：「爆炸艺术——发现同阶爆裂术并将其咏唱开销置 0」的载体。
  // **咏唱开销 = 咏唱值（chantWeight：激活后占手牌上限的权重），≠ 发动费**（用户
  // 2026-09-17 纠正：咏唱0不等于0费）——镜像保持 1 费发动，但点亮后不占手牌压力，
  // 蓄能期白嫖一个手位。咏唱值是定义级字段、无逐卡覆写通道，镜像化整为零
  // （控火无上的 Zero 池同范式），不进奖励池。
  registerSkill({
    ...def, id: `${id}Unbound`,
    chantWeight: 0,
    canSpawnAsReward: false,
  });
}
// 烟花术（C，2026-09-17 用户新增）：爆裂链的低阶入口——此前系列 B 起步，前期
// 卡包摸不到这条线。升阶接小爆裂（B）。
burstChantCard({ id: 'fireworks', name: '烟花术', tier: 'C', base: 10, perMana: 3, promotesTo: 'smallBurst' });
burstChantCard({ id: 'smallBurst', name: '小爆裂术', tier: 'B', base: 25, perMana: 5 });
burstChantCard({ id: 'karadiaBurst', name: '卡拉狄亚爆裂术', tier: 'A', base: 35, perMana: 7 });
burstChantCard({ id: 'qimingBlaze', name: '齐明天炎', tier: 'S', base: 45, perMana: 9 });

// ====================================================================
// §1.1 熔融 / 炎魔决（2026-09-17 用户新增：爆裂侧的高蓝耗大件）
// ====================================================================

// 熔融（B，4魏，消耗）：消耗自身所有燃烧，赋予所有敌人虚弱2，每消耗4层燃烧再+1。
// 等阶未定档（用户口述「蓝耗高效果强的系列消耗卡」），暂挂 B——4 费在初始上限 3
// 之下本就打不出，天然是进阶后的中期件。虚弱=每层攻击-1（全体削锋）：撑到爆裂
// 终止收割的防御支柱；自燃烧是火系的代价货币（可燃血液/高热攒的层在此二次变现）。
// 0 燃烧打出 = 只有基础虚弱2（不设门槛，不白退）。
registerSkill({
  id: 'meltDown', name: '熔融', type: 'fire', tier: 'B', series: 'melt',
  cost: { mana: 4, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const stacks = sctx.player.getEffectStacks('burn');
    if (stacks > 0) addEffect(sctx, 'burn', -stacks);
    const weak = 2 + Math.floor(stacks / 4);
    for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'weaken', weak, e);
    return true;
  },
  describe: () => '消耗自身所有/effect{燃烧}，赋予所有敌人/effect{虚弱}2，每消耗4层+1',
  battleDescribe: (sctx) => {
    const stacks = sctx.player.getEffectStacks('burn');
    return `消耗自身所有/effect{燃烧}（当前${stacks}层）：全体/effect{虚弱}${2 + Math.floor(stacks / 4)}`;
  },
});

// 炎魔决（A，6魏）：获得炎魔1——主级伤害每次命中附带燃烧1（效果 flameDemon，
// 与体系能力同款、可叠层）。多段卡（火花/炽流/连珠火）与火球链每击皆触发，
// 「撑到收割」的过程同时变成铺燃烧。6 费 > 初始上限 3：进阶/遗物抬上限后才可出
// （canUse 费用门槛）——高蓝耗高收益的定位本体，非消耗（回库循环再见）。
registerSkill({
  id: 'flameDemonPact', name: '炎魔决', type: 'fire', tier: 'A', series: 'burst',
  cost: { mana: 6, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    addEffect(sctx, 'flameDemon', 1);
    return true;
  },
  describe: () => '获得/effect{炎魔}1',
  battleDescribe: () => '获得/effect{炎魔}1',
});

// ====================================================================
// §1.1 吃蓝量消耗系列（2026-09-17 用户第二批：爆裂术难找 → 补「消耗量变现」件）
// ====================================================================

// 爆炸艺术 C/B/A（3魏，消耗）：发现同阶爆裂术（咏唱开销 0 镜像）入手。定向检索位
// ——爆裂链在奖励池稀缺（B 起步、仅四张），本系列保证「想玩爆裂就能摸到爆裂」；
// 咏唱开销置 0 = 点亮后不占手牌上限权重（蓄能期白嫖手位，长蓄爆裂的真正痛点）。
// 3 费本身同时喂已激活爆裂的蓄能（消耗即蓄能的双收口径，数值已按此压）。
// 手牌满时 addCard 按 §7.3 降级入牌库。
const BURST_TIER_TWIN = { C: 'fireworksUnbound', B: 'smallBurstUnbound', A: 'karadiaBurstUnbound', S: 'qimingBlazeUnbound' };
function explosiveArtCard({ id, tier, promotesTo }) {
  const twin = BURST_TIER_TWIN[tier];
  registerSkill({
    id, name: '爆炸艺术', type: 'fire', tier, series: 'explosiveArt',
    cost: { mana: 3, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      if (twin) addCard(sctx, twin, { toZone: 'hand' });
      return true;
    },
    describe: () => `/named{发现}/card{${twin}}（咏唱开销为0）`,
    battleDescribe: () => `/named{发现}/card{${twin}}（咏唱开销为0）`,
  });
}
explosiveArtCard({ id: 'explosiveArt', tier: 'C', promotesTo: 'explosiveArtPlus' });
explosiveArtCard({ id: 'explosiveArtPlus', tier: 'B', promotesTo: 'explosiveArtMaster' });
explosiveArtCard({ id: 'explosiveArtMaster', tier: 'A' });

// 火焰旋风 C/B/A（0费，咏唱2，用户定）：激活期间每消耗 1 魏启，立刻造成一次
// **次级（附级）群伤**（2/3/4——用户 2026-09-17 定档：主级太逆天）。次级 = 不吃
// 攻击加成、不触发任何响应（炎魔附燃/控火灼/伤残/格挡都不连锁）——旋风是消耗的
// 回声，不是攻击；与爆裂术同亮时同一笔消耗吃双份回报（蓄能 + 即时群伤）仍成立，
// 但不再与炎魔互喂滚雪球。即时+可叠加是溢价，每点数值压在爆裂 deferred 系数之下。
function fireWhirlCard({ id, tier, dmg, promotesTo }) {
  registerSkill({
    id, name: '火焰旋风', type: 'fire', tier, series: 'fireWhirl',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 2,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ConsumeManaInstruction,
        phase: 'post',
        filter: (instr) => (instr.result?.consumed ?? 0) > 0,
        react: (instr) => {
          for (let i = 0; i < instr.result.consumed; i++) {
            for (const e of aliveEnemies(sctx.battleState)) {
              if (!e.isDead()) dealDamage(sctx, dmg, { target: e, type: 'minor', tags: ['aoe'] });
            }
          }
        },
      }],
    },
    describe: () => `每消耗1魏启，立刻造成${dmg}次级群伤`,
    battleDescribe: () => `每消耗1魏启，立刻造成${dmg}次级群伤`,
  });
}
fireWhirlCard({ id: 'fireWhirl', tier: 'C', dmg: 2, promotesTo: 'fireWhirlPlus' });
fireWhirlCard({ id: 'fireWhirlPlus', tier: 'B', dmg: 3, promotesTo: 'fireWhirlMaster' });
fireWhirlCard({ id: 'fireWhirlMaster', tier: 'A', dmg: 4 });

// 余热 C/B/A/S（0费，消耗，用户定档）：本回合每消耗过 N 蓝回复 M 蓝——
// C 4/2、B 3/2、A 3/3、S 3/4。读 history.turn.manaConsumed（core:manaLedger
// 台账，实付口径），打出时点快照（之后的消耗不追溯）；回蓝是 Gain，不入台账、
// 不计爆裂蓄能——余热只回收已发生的消耗，自身不制造消耗事件（防自馈循环）。
// S 位不进直出白名单：只能 A 升阶拿到（余热是引擎件，白名单留给身份卡）。
function residualHeatCard({ id, tier, per, back, promotesTo }) {
  registerSkill({
    id, name: '余热', type: 'fire', tier, series: 'residualHeat',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      const consumed = sctx.battleState.history.turn.manaConsumed ?? 0;
      const refund = Math.floor(consumed / per) * back;
      if (refund > 0) sctx.kernel.submitInstruction(new GainManaInstruction({ amount: refund }));
      return true;
    },
    describe: () => `本回合每消耗过${per}魏启，回复${back}魏启`,
    battleDescribe: (sctx) => {
      const consumed = sctx.battleState.history.turn.manaConsumed ?? 0;
      return `本回合已消耗${consumed}魏启：回复${Math.floor(consumed / per) * back}魏启`;
    },
  });
}
residualHeatCard({ id: 'residualHeat', tier: 'C', per: 4, back: 2, promotesTo: 'residualHeatPlus' });
residualHeatCard({ id: 'residualHeatPlus', tier: 'B', per: 3, back: 2, promotesTo: 'residualHeatMaster' });
residualHeatCard({ id: 'residualHeatMaster', tier: 'A', per: 3, back: 3, promotesTo: 'residualHeatStar' });
residualHeatCard({ id: 'residualHeatStar', tier: 'S', per: 3, back: 4 });

// 火焰淬炼 C/B（3魏，冷却1）：立刻回复 3/4 魏启，并获得 4 护盾——萃取系列的火系
// 镜像，效果弱一档（盾 4 vs 12、蓝量 -1）换「不延迟一回合」（萃取走纳气 = 下回合
// 开闸）。盾是用户 2026-09-17 补的兜底位：没有蓝耗引擎（无爆裂/旋风/余热可喂）时
// 它也是一张 3 换 3 蓝 + 4 盾的可用功能卡，不至于变成死牌。净蓝量为零（3 换 3），
// 在爆裂体系里「消耗 3」本身就是燃料：喂蓄能/旋风/余热台账——一次过蓝多份回报。
function fireTemperCard({ id, name, tier, mana, shield, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fireTemper',
    cost: { mana: 3, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'none',
    promotesTo,
    use(sctx) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: mana }));
      gainShield(sctx, shield);
      return true;
    },
    describe: () => `立刻回复${mana}魏启，${shield}护盾`,
    battleDescribe: () => `立刻回复${mana}魏启，${shield}护盾`,
  });
}
fireTemperCard({ id: 'fireTemper', name: '火焰淬炼', tier: 'C', mana: 3, shield: 4, promotesTo: 'fireTemperPlus' });
fireTemperCard({ id: 'fireTemperPlus', name: '烈焰淬炼', tier: 'B', mana: 4, shield: 4 });

// 烫手 C/B/A（2魏，用户定）：抽 4/5/6，**冷却 1**（2026-09-17 用户裁决补挂：非
// 消耗 + FIFO 回库 = 每轮必再见，2 蓝买 4~6 张的周转率会滚成永动式过牌引擎，
// 冷却限频保住「烫手山芋扔了又回来」的循环意象）——爆裂体系的过牌引擎（此前
// 火系可持续过牌只有火球链的抽 1~3，撑不起高蓝耗卡组的手牌吞吐）。刻意的高斜率：
// 抽到的牌仍要付蓝/AP 才变现，手牌上限（6 起步）是天然刹车；对标大火球 2 魏 37
// 伤抽 2 的「费用换资源」档。
function hotHandsCard({ id, tier, draw, promotesTo }) {
  registerSkill({
    id, name: '烫手', type: 'fire', tier, series: 'hotHands',
    cost: { mana: 2, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'none',
    promotesTo,
    use(sctx) {
      drawCards(sctx, draw);
      return true;
    },
    describe: () => `抽${draw}`,
    battleDescribe: () => `抽${draw}`,
  });
}
hotHandsCard({ id: 'hotHands', tier: 'C', draw: 4, promotesTo: 'hotHandsPlus' });
hotHandsCard({ id: 'hotHandsPlus', tier: 'B', draw: 5, promotesTo: 'hotHandsMaster' });
hotHandsCard({ id: 'hotHandsMaster', tier: 'A', draw: 6 });

// ====================================================================
// §1.1 爆裂防御（2026-09-17 用户定稿：沉默 + 泄压阀）
// ====================================================================

// 沉默 C/B/A（0费，消耗）：终止你激活的**所有**咏唱卡，获得 9/13/17 护盾——爆裂
// 体系的专用防卡兼**远程引爆器**：终止走指令层统一熄灭路径（deactivateChant →
// 各咏唱自己的 onDisable），爆裂术的终止群伤由它代为引爆；不止爆裂，可燃血液/
// 旋风等一切激活咏唱一并熄灭——沉默之名。当回合即时盾是火系「铺垫型防御」里
// 唯一的大盾位；代价是烧掉全部咏唱引擎（熄灭的卡回牌库底、要再摸回再点亮，
// 引擎重启成本即其 balancing）。
function silenceCard({ id, tier, shield, promotesTo }) {
  registerSkill({
    id, name: '沉默', type: 'fire', tier, series: 'silence',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      for (const c of [...sctx.battleState.zones.hand]) {
        if (c.isActivated) deactivateChant(sctx, c, 'silenced');
      }
      gainShield(sctx, shield);
      return true;
    },
    describe: () => `终止你激活的所有咏唱，获得${shield}护盾`,
    battleDescribe: (sctx) => {
      const n = sctx.battleState.zones.hand.filter(c => c.isActivated).length;
      return `终止你激活的所有咏唱（${n}张），获得${shield}护盾`;
    },
  });
}
silenceCard({ id: 'silence', tier: 'C', shield: 9, promotesTo: 'silencePlus' });
silenceCard({ id: 'silencePlus', tier: 'B', shield: 13, promotesTo: 'silenceMaster' });
silenceCard({ id: 'silenceMaster', tier: 'A', shield: 17 });

// 泄压阀 C/B/A（X魏，消耗）：每消耗 1 魏启获得 5/6/7 护盾（B 位 6/魏 为原定档，
// 两侧 +1 成阶）——即时、可调档的防御位，而这笔消耗照常喂爆裂蓄能/旋风/余热
// 台账：一张把防御买成引擎燃料的卡。每魏对标：灵力/灵能护盾 5~8/魏（非消耗、
// 定值）、火焰精通 3/魏（永续咏唱）——泄压阀居中，消耗+弹性是它的档位语言。
// 原案名「泄洪」（洪联想水，不合火系主题，用户 2026-09-17 更名）。
function reliefValveCard({ id, tier, perMana, promotesTo }) {
  registerSkill({
    id, name: '泄压阀', type: 'fire', tier, series: 'relief',
    cost: { mana: 'X', actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      const X = sctx.self.xCost?.mana ?? 0;
      if (X > 0) gainShield(sctx, X * perMana);
      return true;
    },
    describe: () => `每消耗1魏启，获得${perMana}护盾`,
    battleDescribe: (sctx) => {
      const X = sctx.self.xCost?.mana ?? sctx.player.mana; // 未打出时按当前魏启预估
      return `获得${X * perMana}护盾（${X}魏启全耗）`;
    },
  });
}
reliefValveCard({ id: 'reliefValve', tier: 'C', perMana: 5, promotesTo: 'reliefValvePlus' });
reliefValveCard({ id: 'reliefValvePlus', tier: 'B', perMana: 6, promotesTo: 'reliefValveMaster' });
reliefValveCard({ id: 'reliefValveMaster', tier: 'A', perMana: 7 });

// ====================================================================
// §1.1 凝焰系列（X魏启 = 消耗所有现有魏启，NAMED「消耗为X」）
// ====================================================================

// 凝焰工厂。X = 打出时点的全部现有魏启——**走费用系统**（cost.mana = 'X'，卡面只出
// X 徽章，文本不再解释）；实付量由费用指令记在 runtime.xCost 上供效果读取。
// 燃烧施加给**目标敌人**（2026-09 修正：此前误按自施代价实现）。X=0 时只给纳气。
function condenseFlameCard({ id, name, tier, naqi, burnPerX, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'condense',
    cost: { mana: 'X', actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const X = sctx.self.xCost?.mana ?? 0;
      addEffect(sctx, 'naqi', naqi);
      const target = enemyTarget(sctx);
      if (X > 0 && target) addEffect(sctx, 'burn', burnPerX * X, target);
      return true;
    },
    describe: () => `/effect{纳气}${naqi}，施加/effect{燃烧}${burnPerX}X`,
    battleDescribe: (sctx) => {
      const X = sctx.self.xCost?.mana ?? sctx.player.mana; // 未打出时按当前魏启预估
      return `/effect{纳气}${naqi}，施加/effect{燃烧}${burnPerX * X}`;
    },
  });
}
condenseFlameCard({ id: 'flameBirth', name: '焰生', tier: 'C', naqi: 1, burnPerX: 3, promotesTo: 'flameSurge' });
condenseFlameCard({ id: 'flameSurge', name: '焰涌', tier: 'B', naqi: 2, burnPerX: 3, promotesTo: 'flameCondense' });
condenseFlameCard({ id: 'flameCondense', name: '焰凝', tier: 'A', naqi: 4, burnPerX: 4 });

// ====================================================================
// §1.1 高热系列（回蓝：每回合咏唱触发 纳气 + 自施燃烧；消耗咏唱）
// ====================================================================

// 高热工厂。「纳气N，燃烧4」为**咏唱触发效果**（battle.md P5：激活咏唱卡每回合
// 在咏唱触发阶段结算）——挂 ChantTriggerInstruction POST 订阅（owner=卡牌，熄灭
// 自动注销），点亮本身不结算。咏唱值取 1（2026-09-13 权重分档：大量 1 咏）。
// 燃烧自施（副作用语言）。再次打出免费解除，因带消耗关键词落焚毁区。
function feverChantCard({ id, name, tier, naqi, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fever',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    keywords: ['exhaust'],
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ChantTriggerInstruction, phase: 'post',
        react: () => {
          addEffect(sctx, 'naqi', naqi);
          addEffect(sctx, 'burn', 4); // 自施燃烧（代价语言）
        },
      }],
    },
    describe: () => `/effect{纳气}${naqi}，自身/effect{燃烧}4`,
  });
}
feverChantCard({ id: 'fever', name: '发烧', tier: 'C', naqi: 1, promotesTo: 'highFever' });
feverChantCard({ id: 'highFever', name: '高热', tier: 'B', naqi: 2 });

// ====================================================================
// §1.1 可燃系列（防御：每回合咏唱触发 护盾 + 自施燃烧，2026-09 设计稿新增）
// ====================================================================

// 可燃血液工厂。「护盾N，燃烧3」为**咏唱触发效果**（battle.md P5：激活咏唱卡
// 每回合在咏唱触发阶段结算）——挂 ChantTriggerInstruction POST 订阅，点亮本身
// 不结算；解除打出免费、回牌库（非消耗），停泵后可再点亮续泵。
// 燃烧自施是火灵脉的防御代价口径（燃烧换护盾，焰愈/火源归一消化）。
// 设计稿 A 阶未写费用 → 0 费；咏唱值取 2（中量档——第 5 轮试玩唯一验证为强卡的咏唱，留 2）。
// 定稿（用户 2026-09-13 两轮定调）：R8「自燃无封顶 = 死亡计时器」的修法**不削危险、
// 不加补偿机制**（短命方案「至多补到 6 层」被否——纯为补偿而非趣味性的机制不要），
// 只把收益抬到配得上风险：盾量三阶 +2（9/13/13 → 11/15/15），自燃 3 原样保留——
// 爆燃/焚烧翻倍把自燃推上去是「玩火自焚」身份的正当互动（R9-C 实测 tick 15 穿盾），
// 乘算局的出口是火源归一/控火术：收，不是给卡本身上锁。
function kindlingBloodCard({ id, name, tier, shield, ap, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'kindling',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 2,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ChantTriggerInstruction, phase: 'post',
        react: () => {
          gainShield(sctx, shield);
          addEffect(sctx, 'burn', 3);
        },
      }],
    },
    describe: () => `护盾${shield}，自身/effect{燃烧}3`,
    battleDescribe: (sctx) => `护盾${shield}，自身/effect{燃烧}3`,
  });
}
kindlingBloodCard({ id: 'kindlingBlood', name: '可燃血液', tier: 'C', shield: 11, ap: 1, promotesTo: 'kindlingBloodPlus' });
kindlingBloodCard({ id: 'kindlingBloodPlus', name: '可燃血液', tier: 'B', shield: 15, ap: 1, promotesTo: 'kindlingBloodMaster' });
kindlingBloodCard({ id: 'kindlingBloodMaster', name: '可燃血液', tier: 'A', shield: 15, ap: 0 });

// ====================================================================
// §1.1 火雨系列（低耗群伤）
// ====================================================================

// 火雨（C）：3魏启，对所有敌人 14 伤害（每敌一枚 aoe 标记指令）。
// 2026-09-17 用户定 +2（原 12：单敌 4/魏明显低于火球锚，群伤系列裸值小幅回填）。
registerSkill({
  id: 'fireRain', name: '火雨', type: 'fire', tier: 'C', series: 'fireRain',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'fireStream',
  use(sctx) {
    aoeDamage(sctx, 14, enemyTarget(sctx));
    return true;
  },
  describe: () => '群伤14',
});

// 火流（A）：两波群伤。分两个 stage 提交——第二波提交时重读存活敌人，
// 首波击杀的目标不会吃第二波（多段群伤的减员语义）。
registerSkill({
  id: 'fireStream', name: '火流', type: 'fire', tier: 'A', series: 'fireRain',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx, stage) {
    aoeDamage(sctx, 14, enemyTarget(sctx));
    return stage === 0 ? false : true; // stage 0 第一波，stage 1 第二波（重读存活）
  },
  describe: () => '群伤14×2',
});

// ====================================================================
// §1.1 添柴系列（焚卡换魏启）
// ====================================================================

// 添柴/旺火：1AP 消耗，选 1 手牌焚毁 → 获得魏启。
// 可打出条件：手上有「其他卡」可焚（结算中自身已离手进 pending，canUse 在
// 预览态读手牌需排除自身）。
function fuelCard({ id, name, tier, mana, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fuel',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    promotesTo,
    canUse: (sctx) => sctx.battleState.zones.hand.some(
      c => c.uniqueID !== sctx.self.uniqueID),
    use(sctx, stage) {
      if (stage === 0) {
        // 嵌套强发兜底：手牌为空时不发输入请求，效果落空（不白得魏启）
        if (sctx.battleState.zones.hand.length === 0) return true;
        sctx.self._pick = requestHandSelection(sctx, { count: 1, reason: '选择1张手牌焚毁' });
        return false;
      }
      const [uniqueID] = selected(sctx.self._pick);
      sctx.self._pick = null;
      if (uniqueID != null) {
        burnCard(sctx, uniqueID);
        sctx.kernel.submitInstruction(new GainManaInstruction({ amount: mana }));
      }
      return true;
    },
    describe: () => `选1手牌焚毁，获得${mana}魏启`,
  });
}
fuelCard({ id: 'fuelTheFire', name: '添柴', tier: 'C', mana: 3, promotesTo: 'roaringFire' });
fuelCard({ id: 'roaringFire', name: '旺火', tier: 'B', mana: 4, promotesTo: 'blazeUp' });

// 猛火（A）：选 1 手牌焚毁 → 抽2 → 获得 4 魏启。
registerSkill({
  id: 'blazeUp', name: '猛火', type: 'fire', tier: 'A', series: 'fuel',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  canUse: (sctx) => sctx.battleState.zones.hand.some(
    c => c.uniqueID !== sctx.self.uniqueID),
  use(sctx, stage) {
    if (stage === 0) {
      if (sctx.battleState.zones.hand.length === 0) return true;
      sctx.self._pick = requestHandSelection(sctx, { count: 1, reason: '选择1张手牌焚毁' });
      return false;
    }
    const [uniqueID] = selected(sctx.self._pick);
    sctx.self._pick = null;
    if (uniqueID != null) {
      burnCard(sctx, uniqueID);
      drawCards(sctx, 2);
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: 4 }));
    }
    return true;
  },
  describe: () => '选1手牌焚毁，抽2，获得4魏启',
});

// 燎原（A）：抽 2 牌焚毁（不可控）→ 抽2 → 获得 9 魏启。
// 「抽2牌焚毁」分两个 stage：先抽（持有 DrawCardsInstruction 引用读 result.drawn），
// 次段焚毁刚抽到的牌——满手/空库时抽牌落空，焚毁随之落空，魏启照发。
registerSkill({
  id: 'wildfire', name: '燎原', type: 'fire', tier: 'A', series: 'fuel',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._drawn = new DrawCardsInstruction({ count: 2 });
      sctx.kernel.submitInstruction(sctx.self._drawn);
      return false;
    }
    const drawn = sctx.self._drawn?.result?.drawn ?? [];
    sctx.self._drawn = null;
    for (const card of drawn) burnCard(sctx, card.uniqueID);
    drawCards(sctx, 2);
    sctx.kernel.submitInstruction(new GainManaInstruction({ amount: 9 }));
    return true;
  },
  describe: () => '抽2牌焚毁，抽2，获得9魏启',
});

// ====================================================================
// §1.1 先发系列（固有消耗快速开场爆发）
// ====================================================================

// 先发工厂：0 费直伤 + 抽1牌（第一轮爆发 + 不亏手牌，FIRE_VEIN_CARDS §先发 2026-09 修订：
// 原「快速咏唱」提前节拍不够直观，换抽牌）。固有保证起手上手；消耗保证不沉淀。
function firstStrikeCard({ id, name, tier, damage, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'firstStrike',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    keywords: ['exhaust', 'innate'],
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      drawCards(sctx, 1);
      return true;
    },
    describe: () => `${damage}伤害，抽1牌`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，抽1牌`,
  });
}
firstStrikeCard({ id: 'firstShot', name: '先发火弹', tier: 'D', damage: 5, promotesTo: 'firstArrow' });
firstStrikeCard({ id: 'firstArrow', name: '先发火矢', tier: 'C', damage: 9, promotesTo: 'firstFireBall' });
firstStrikeCard({ id: 'firstFireBall', name: '先发火球', tier: 'B', damage: 13 });
// 数值（2026-09-13 第 6 轮试玩后 nerfed：原 8/12/17）：0 魏启 0 AP + 抽 1 + 固有 = 零资源
// 白打，三位 agent 一致评为版本最优（C 一局 4 张开局白送 32 伤）。削到 5/9/13 后仍保有
// 「免费开路 + 滤牌」的先发身份，但不再是一抓即赢的比率。升阶 delta 保持 +4。

// ====================================================================
// §1.1 散卡·熬焰（燃烧受伤转魏启；2026-09-14 由「忍耐」更名——让位拆组合机制词）
// ====================================================================

// 熬焰（C，咏唱1）：激活期间每**累计**受到 5 点燃烧伤害回 1 魏启，余数保留
// （计数挂 skillRuntime，跨回合累积；重复熄灭/再激活不清零——计数属于卡牌身份）。
// 读 result.dealt（燃烧为固定伤害，dealt 即护盾吸收后的实际生命损失；被防火 veto 的结算无 POST）。
registerSkill({
  id: 'patience', name: '熬焰', type: 'fire', tier: 'C', series: 'patience',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ApplyDamageInstruction,
      phase: 'post',
      filter: (instr) => instr.target === sctx.player && instr.tags?.includes('burn'),
      react: (instr, ctx) => {
        const self = sctx.self;
        self.patiencePool = (self.patiencePool ?? 0) + (instr.result?.dealt ?? 0);
        const refunds = Math.floor(self.patiencePool / 5);
        if (refunds > 0) {
          self.patiencePool -= refunds * 5; // 余数保留，跨结算继续累计
          ctx.kernel.submitInstruction(new GainManaInstruction({ amount: refunds }), instr);
        }
      },
    }],
  },
  describe: () => '每累计受到5点/effect{燃烧}伤害，获得1魏启',
});

// 突破极限（A，消耗，咏唱3——2026-09-13 用户定档：魏启透支是真超模，少量 3-4 咏档）：
// 激活期间蓝量大于 0 即可透支出牌（费用缺口由资源指令
// 的 clamp 兜底，蓝量扣到 0 为止）。放行钩子走 helpers.canUseSkill 的「已激活咏唱
// activated.canUseSkill」裁决环——卡牌级费用豁免，与能力的 canUseSkill 同语义。
registerSkill({
  id: 'breakLimit', name: '突破极限', type: 'fire', tier: 'A', series: 'depth',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  keywords: ['exhaust'],
  use() { return true; },
  activated: {
    canUseSkill: (sctx) => sctx.player.mana > 0,
  },
  describe: () => '蓝量大于0时，可以透支蓝量出牌',
  battleDescribe: () => '蓝量大于0时，可以透支蓝量出牌',
});

// ====================================================================
// §1.2 深入卡
// ====================================================================

// 回响烈焰（B，消耗）：每张坟墓（zones.burnt）中的卡提供 1 魏启，抽3。
// 计数时点 = 打出时（自身尚未落位，不把自己算进去）。
registerSkill({
  id: 'echoingFlames', name: '回响烈焰', type: 'fire', tier: 'B', series: 'depth', deep: 'burst',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const graves = sctx.battleState.zones.burnt.length;
    if (graves > 0) sctx.kernel.submitInstruction(new GainManaInstruction({ amount: graves }));
    drawCards(sctx, 3);
    return true;
  },
  battleDescribe: (sctx) => `坟墓${sctx.battleState.zones.burnt.length}张：获得等量魏启，抽3`,
  describe: () => '每张坟墓中的卡牌提供1魏启，抽3',
});

// 背水一战（B，消耗，2026-09-13 用户新文档新增）：焚毁所有未激活咏唱的手牌，
// 每张回复 2 魏启，抽3。已激活的咏唱卡豁免——点亮的咏唱是构筑引擎本身，
// 烧引擎换蓝等于自拆台（旧版放手一搏的全烧口径下放到 B 阶时收的口子）。
registerSkill({
  id: 'lastStand', name: '背水一战', type: 'fire', tier: 'B', series: 'depth', deep: 'burst',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const hand = [...sctx.battleState.zones.hand].filter(c => !c.isActivated);
    for (const c of hand) burnCard(sctx, c.uniqueID);
    if (hand.length > 0) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: hand.length * 2 }));
    }
    drawCards(sctx, 3);
    return true;
  },
  describe: () => '焚毁所有未激活咏唱的手牌，每张回复2魏启，抽3',
  battleDescribe: (sctx) => {
    const n = sctx.battleState.zones.hand.filter(c => !c.isActivated).length;
    return `焚毁${n}张手牌：回复${n * 2}魏启，抽3`;
  },
});

// 放手一搏（A，消耗，2026-09-13 用户新文档重做）：先抽 5 补手，再焚毁牌库中
// 所有卡，每张回 2 魏启。裸奔不加保护窗（拍板：烧完牌库本身就是玩法——空库后
// 无牌可抽，回蓝必须在烧完前变现为杀伤）。两阶段指令：抽牌先结算完再数牌库
// 余量（手牌上限截断 / 牌库不足 5 张时，余量以抽完后为准，不许按打出时点预估）。
class AllInInstruction extends BattleInstruction {
  execute(ctx) {
    switch (this._stage) {
      case 0:
        ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 5 }), this);
        return false;
      default: {
        const deck = [...ctx.battleState.zones.deck];
        for (const c of deck) {
          ctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: c.uniqueID }), this);
        }
        if (deck.length > 0) {
          ctx.kernel.submitInstruction(new GainManaInstruction({ amount: deck.length * 2 }), this);
        }
        return true;
      }
    }
  }
}
registerSkill({
  id: 'allIn', name: '放手一搏', type: 'fire', tier: 'A', series: 'depth', deep: 'burst',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new AllInInstruction());
    return true;
  },
  describe: () => '抽5，焚毁牌库中所有卡，每张回复2魏启',
  battleDescribe: (sctx) =>
    `抽5，焚毁牌库中所有卡（现存${sctx.battleState.zones.deck.length}张），每张回复2魏启`,
});

// 烟花秀（A，消耗，深入，2026-09-17 用户定稿）：抽出牌库中**所有**爆裂术——爆裂
// 体系后期成长的最后拼图：多张爆裂同亮分层蓄能（每张独立池），配合沉默/自解除
// 的收割节奏全部握在手里。「抽出」术语首个用例（定向检索：牌库没有则无事发生，
// 不白给不空转）；满手按 §7.3 降级入牌库（MoveCardInstruction 自带）。Unbound
// 镜像同属 burst 系列，万一经降级落过牌库也一并抽出（无差别待遇）。
registerSkill({
  id: 'fireworkShow', name: '烟花秀', type: 'fire', tier: 'A', series: 'depth', deep: 'burst',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    // 提交不即执行（子节点在收尾后跑），快照仅为防御性写法
    for (const c of [...sctx.battleState.zones.deck]) {
      if (getSkillDefinition(c.defId)?.series === 'burst') {
        sctx.kernel.submitInstruction(new MoveCardInstruction({ uniqueID: c.uniqueID, toZone: 'hand' }));
      }
    }
    return true;
  },
  describe: () => '/named{抽出}牌库中所有爆裂术',
  battleDescribe: (sctx) => {
    const n = sctx.battleState.zones.deck
      .filter(c => getSkillDefinition(c.defId)?.series === 'burst').length;
    return `/named{抽出}牌库中所有爆裂术（现存${n}张）`;
  },
});

// ====================================================================
// §3.1 通用单卡
// ====================================================================

// 火源归一（A，1AP，消耗）：吸纳场上**所有单位**（含自身/盟友/敌人）的燃烧层数，
// 每层获得 3 护盾。吸纳 = 负层数 AddEffect（扣尽自动注销燃烧订阅）。
registerSkill({
  id: 'gatherFlame', name: '火源归一', type: 'fire', tier: 'A', series: 'common',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    let total = 0;
    for (const unit of allAliveUnits(sctx.battleState, sctx.player)) {
      const stacks = unit.getEffectStacks('burn');
      if (stacks > 0) {
        total += stacks;
        sctx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -stacks,
        }));
      }
    }
    if (total > 0) gainShield(sctx, total * 3);
    return true;
  },
  describe: () => '吸纳场上所有单位的/effect{燃烧}，每层获得3护盾',
});

// 旧「火墙」（C，4魏启，阻挡下一次攻击）已于 2026-09-13 删除：其 id/卡名与
// 火墙链（火盾 D/火墙 C/火壁 B，见 fireEmberSkills.js）撞车，且新文档 §3.1 已将其除名。

// 含焰术（C，消耗）：防火1（效果 id 'fireproof'：燃烧结算跳过伤害，层数-1）。
registerSkill({
  id: 'fireWard', name: '含焰术', type: 'fire', tier: 'C', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    addEffect(sctx, 'fireproof', 1);
    return true;
  },
  describe: () => '/effect{防火}1',
});

// 膨胀（A）：手牌上限+1，自身燃烧5。按设计稿无费用无消耗：可重复打出，自施燃烧为代价。
// 手牌上限是 run 级字段（跨战斗持久），卡片效果按战斗级处理——写 battleState.modifiers
// （本场修正，随战斗消失），故不需要战后回滚；重复打出即多次 +1（与打出次数一致）。
registerSkill({
  id: 'expand', name: '膨胀', type: 'fire', tier: 'A', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    applyBattleModifier(sctx, 'maxHandSize', 1);
    addEffect(sctx, 'burn', 5);
    return true;
  },
  describe: () => '手牌上限+1，自身/effect{燃烧}5',
});

// 灭火（C，消耗，2026-09-13 用户新文档新增）：驱散自身所有燃烧。
// 玩火体系的紧急泄压阀——与控火术：扰（燃烧转盾变现）互补：扰是把火变现，
// 灭火是纯保命（0 费但消耗，清完不附带任何后续防护；对标含焰术防火1只挡一次跳伤）。
registerSkill({
  id: 'douseFlame', name: '灭火', type: 'fire', tier: 'C', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const stacks = sctx.player.getEffectStacks('burn');
    if (stacks > 0) addEffect(sctx, 'burn', -stacks);
    return true;
  },
  describe: () => '驱散自身所有/effect{燃烧}',
  battleDescribe: (sctx) => `驱散自身所有/effect{燃烧}（当前${sctx.player.getEffectStacks('burn')}层）`,
});

// ====================================================================
// §3.2 通用咏唱
// ====================================================================

// 火焰精通（A，消耗，咏唱）：激活期间每消耗 1 魏启获得 3 护盾。
// 读 result.consumed（实际消耗量，经 clamp/费用减免后的真值）。设计稿未写咏唱值，
// 按默认咏唱2计手牌压力。发动自身 0 费，不会自触发。
registerSkill({
  id: 'fireMastery', name: '火焰精通', type: 'fire', tier: 'A', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  keywords: ['exhaust'],
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ConsumeManaInstruction,
      phase: 'post',
      filter: (instr) => (instr.result?.consumed ?? 0) > 0,
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(
          new GainShieldInstruction({ target: sctx.player, amount: 3 * instr.result.consumed }),
          instr);
      },
    }],
  },
  describe: () => '每消耗1魏启，获得3护盾',
});

// 火焰眷顾（B，消耗，咏唱2）：激活期间火灵脉牌的魏启消耗 -1。
// 判定方式：沿 ConsumeManaInstruction 的父链上溯取「正在打出的卡」
// （cardConsumingMana），type==='fire' 才减免——X 费火卡（凝焰系列，ConsumeMana
// 由 use 内直接提交，父链同样可达持卡指令）一并享受减免。
// PRE 只做 payload 修饰（费用管线与数值管线同构，R2）；最低减到 0。
registerSkill({
  id: 'fireAffinity', name: '火焰眷顾', type: 'fire', tier: 'B', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  keywords: ['exhaust'],
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ConsumeManaInstruction,
      phase: 'pre',
      filter: (instr) => {
        const card = cardConsumingMana(instr);
        return card != null && getSkillDefinitionSafe(card.defId) === 'fire';
      },
      react: (instr) => {
        instr.setPayload('amount', Math.max(0, instr.payload.amount - 1));
      },
    }],
  },
  describe: () => '火灵脉牌的魏启消耗-1',
});

// type 读取（定义缺失防御：非注册卡不参与减免）
function getSkillDefinitionSafe(defId) {
  try { return getSkillDefinition(defId).type; } catch { return null; }
}
