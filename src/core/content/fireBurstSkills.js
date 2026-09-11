// 火灵脉·爆炎组合 + 通用散卡（FIRE_VEIN_CARDS §1、§3）。
// 火球术 / 爆裂术 / 凝焰 / 高热 / 可燃 / 火雨 / 添柴 / 先发 / 忍耐 / 回响烈焰·放手一搏
// + 通用（火源归一/火墙/含焰术/膨胀/火焰精通/火焰眷顾）。
//
// 数值口径备注（全文件通用）：
// - 攻击类卡伤害走 F1 面板轨（基数 + 攻击 + power），battleDescribe 一律经
//   resolvedDamageText 干跑真实修正管线（A5 所见即所算）；设计稿数字为基数。
// - 「燃烧」作为无目标写法的代价/副作用语言时默认**自施**（爆炎体系的燃烧
//   是代价而非输出，与高热系列、膨胀、火墙一致）。
// - 设计稿未写费用 = 0 费；未写咏唱值的咏唱卡按默认咏唱2（helpers.handWeightOf 兜底）。

import { registerSkill, getSkillDefinition } from '../skills/registry.js';
import { aliveEnemies, allAliveUnits } from '../state/battleState.js';
import { DealDamageInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction } from '../instructions/cards.js';
import { GainManaInstruction, ConsumeManaInstruction } from '../instructions/resources.js';
import { PostBattleInstruction } from '../instructions/battleRoot.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import {
  enemyTarget, dealDamage, attackDamage, resolvedDamageText, gainShield, addEffect,
  drawCards, burnCard, requestHandSelection, selected,
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
fireBallCard({ id: 'fireBolt', name: '火弹术', tier: 'D', damage: 15, draw: 1, promotesTo: 'fireArrow' });
fireBallCard({ id: 'fireArrow', name: '火箭术', tier: 'C', damage: 15, draw: 2, promotesTo: 'fireBall' });
fireBallCard({ id: 'fireBall', name: '火球术', tier: 'B', damage: 25, draw: 2 });
// 火球连发（A，多段分叉）与大火球术（A，单发大数字）是 B 位之后的两条并列分叉，
// 不设 promotesTo（升阶链止于 B 的双选）。
fireBallCard({ id: 'fireBarrage', name: '火球连发', tier: 'A', damage: 15, hits: 2, draw: 3 });
fireBallCard({ id: 'greaterFireBall', name: '大火球术', tier: 'A', damage: 38, draw: 2 });

// 蓄热火球（C）：8 直伤；每次打出后**自身**伤害永久 +12（本场战斗内，其他卡
// 吃不到——平衡口径见 2026-09 反馈）。加成由 runtime.power 承载（伤害公式
// 基数+面板+power 同源，卡面威力直读）；先结算本拍再+12：本次打出不享受。
registerSkill({
  id: 'heatChargedBall', name: '蓄热火球', type: 'fire', tier: 'C', series: 'fireBall',
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 8);
    sctx.self.power += 12;
    return true;
  },
  describe: () => '8伤害，/named{蓄热}（伤害+12）',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 8)}，/named{蓄热}（伤害+12）`,
});

// ====================================================================
// §1.1 爆裂术系列（咏唱输出：激活期蓄能，终止时群伤爆发）
// ====================================================================

// 爆裂术工厂。语义假设（设计稿「每消耗1魏启伤害+5。终止：30群伤」）：
// - 发动（4魏启）仅点亮咏唱，无即时效果；发动费在订阅注册前结算，**不计入**蓄能。
// - 激活期间玩家**任意来源**的魏启消耗（其他卡的费用、X 费全耗等）每 1 点为
//   终止伤害 +系数（计数挂 skillRuntime，不藏闭包）。
// - 「终止」= 咏唱熄灭（再次打出免费解除 / 离手），onDisable 时按 基数+蓄能
//   对所有存活敌人打出群伤；熄灭路径由指令层统一走 deactivateChant，本卡不焚毁
//   （无消耗关键词），解除后回牌库底。
function burstChantCard({ id, name, tier, base, perMana }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'burst',
    cost: { mana: 4, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    use() { return true; }, // 无即时效果：蓄能靠 activated 订阅，爆发靠 onDisable
    activated: {
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
  });
}
burstChantCard({ id: 'smallBurst', name: '小爆裂术', tier: 'B', base: 25, perMana: 5 });
burstChantCard({ id: 'karadiaBurst', name: '卡拉狄亚爆裂术', tier: 'A', base: 35, perMana: 7 });
burstChantCard({ id: 'qimingBlaze', name: '齐明天炎', tier: 'S', base: 45, perMana: 9 });

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
condenseFlameCard({ id: 'flameSurge', name: '焰涌', tier: 'B', naqi: 3, burnPerX: 3, promotesTo: 'flameCondense' });
condenseFlameCard({ id: 'flameCondense', name: '焰凝', tier: 'A', naqi: 5, burnPerX: 4 });

// ====================================================================
// §1.1 高热系列（回蓝：每回合咏唱触发 纳气 + 自施燃烧；消耗咏唱）
// ====================================================================

// 高热工厂。「纳气N，燃烧4」为**咏唱触发效果**（battle.md P5：激活咏唱卡每回合
// 在咏唱触发阶段结算）——挂 ChantTriggerInstruction POST 订阅（owner=卡牌，熄灭
// 自动注销），点亮本身不结算。设计稿未写咏唱值，按默认咏唱2计手牌压力。
// 燃烧自施（副作用语言）。再次打出免费解除，因带消耗关键词落焚毁区。
function feverChantCard({ id, name, tier, naqi, promotesTo }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'fever',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 2,
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
// 设计稿 A 阶未写费用 → 0 费；咏唱值未写 → 按默认咏唱2计手牌压力。
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
kindlingBloodCard({ id: 'kindlingBlood', name: '可燃血液', tier: 'C', shield: 9, ap: 1, promotesTo: 'kindlingBloodPlus' });
kindlingBloodCard({ id: 'kindlingBloodPlus', name: '可燃血液', tier: 'B', shield: 13, ap: 1, promotesTo: 'kindlingBloodMaster' });
kindlingBloodCard({ id: 'kindlingBloodMaster', name: '可燃血液', tier: 'A', shield: 13, ap: 0 });

// ====================================================================
// §1.1 火雨系列（低耗群伤）
// ====================================================================

// 火雨（C）：3魏启，对所有敌人 12 伤害（每敌一枚 aoe 标记指令）。
registerSkill({
  id: 'fireRain', name: '火雨', type: 'fire', tier: 'C', series: 'fireRain',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'fireStream',
  use(sctx) {
    aoeDamage(sctx, 12, enemyTarget(sctx));
    return true;
  },
  describe: () => '群伤12',
});

// 火流（A）：两波群伤。分两个 stage 提交——第二波提交时重读存活敌人，
// 首波击杀的目标不会吃第二波（多段群伤的减员语义）。
registerSkill({
  id: 'fireStream', name: '火流', type: 'fire', tier: 'A', series: 'fireRain',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx, stage) {
    aoeDamage(sctx, 12, enemyTarget(sctx));
    return stage === 0 ? false : true; // stage 0 第一波，stage 1 第二波（重读存活）
  },
  describe: () => '群伤12×2',
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
firstStrikeCard({ id: 'firstShot', name: '先发火弹', tier: 'D', damage: 8, promotesTo: 'firstArrow' });
firstStrikeCard({ id: 'firstArrow', name: '先发火矢', tier: 'C', damage: 12, promotesTo: 'firstFireBall' });
firstStrikeCard({ id: 'firstFireBall', name: '先发火球', tier: 'B', damage: 17 });

// ====================================================================
// §1.1 散卡·忍耐（燃烧受伤转魏启）
// ====================================================================

// 忍耐（C，咏唱1）：激活期间每**累计**受到 5 点燃烧伤害回 1 魏启，余数保留
// （计数挂 skillRuntime，跨回合累积；重复熄灭/再激活不清零——计数属于卡牌身份）。
// 读 result.dealt（燃烧为固定伤害，dealt 即护盾吸收后的实际生命损失；被防火 veto 的结算无 POST）。
registerSkill({
  id: 'patience', name: '忍耐', type: 'fire', tier: 'C', series: 'patience',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DealDamageInstruction,
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

// 突破极限（A，消耗，咏唱4）：激活期间蓝量大于 0 即可透支出牌（费用缺口由资源指令
// 的 clamp 兜底，蓝量扣到 0 为止）。放行钩子走 helpers.canUseSkill 的「已激活咏唱
// activated.canUseSkill」裁决环——卡牌级费用豁免，与能力的 canUseSkill 同语义。
registerSkill({
  id: 'breakLimit', name: '突破极限', type: 'fire', tier: 'A', series: 'depth',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 4,
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
  id: 'echoingFlames', name: '回响烈焰', type: 'fire', tier: 'B', series: 'depth',
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

// 放手一搏（A，消耗）：焚毁所有手牌（结算中自身已离手，手中即其余卡），
// 每张回复 2 魏启，抽3。
registerSkill({
  id: 'allIn', name: '放手一搏', type: 'fire', tier: 'A', series: 'depth',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const hand = [...sctx.battleState.zones.hand];
    for (const c of hand) burnCard(sctx, c.uniqueID);
    if (hand.length > 0) {
      sctx.kernel.submitInstruction(new GainManaInstruction({ amount: hand.length * 2 }));
    }
    drawCards(sctx, 3);
    return true;
  },
  describe: () => '焚毁所有手牌，每张回复2魏启，抽3',
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

// 火墙（C，4魏启，消耗）：阻挡玩家的下一次攻击，自身燃烧3。
// 「下一次攻击」判定近似：敌方来源、目标为玩家、非燃烧/中毒等环境标记的伤害指令
// ——PRE veto 整枚指令（被取消的结算无联动，A4），once 窗口触发即注销。
// 燃烧3为打出时点的自施代价（副作用语言，与文件头口径一致）。
registerSkill({
  id: 'fireWall', name: '火墙', type: 'fire', tier: 'C', series: 'common',
  cost: { mana: 4, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', window: 'once',
      filter: (instr) => instr.target === sctx.player
        && instr.source?.side === 'enemy'
        && !instr.tags?.includes('burn')
        && !instr.tags?.includes('poison'),
      react: (instr, ctx) => ctx.kernel.veto(instr, 'fireWall'),
    });
    addEffect(sctx, 'burn', 3);
    return true;
  },
  describe: () => '阻挡下一次攻击，自身/effect{燃烧}3',
});

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
// 手牌上限是 run 级字段（跨战斗持久），卡片效果按战斗级处理——战后经 PostBattle
// once-POST 回滚，避免跨战斗残留。
registerSkill({
  id: 'expand', name: '膨胀', type: 'fire', tier: 'A', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    sctx.player.maxHandSize += 1;
    sctx.kernel.addSubscription({
      when: PostBattleInstruction, phase: 'post', window: 'once',
      react: (instr, ctx) => { ctx.player.maxHandSize -= 1; },
    });
    addEffect(sctx, 'burn', 5);
    return true;
  },
  describe: () => '手牌上限+1，自身/effect{燃烧}5',
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

// 火焰眷顾（B，消耗，咏唱3）：激活期间火灵脉牌的魏启消耗 -1。
// 判定方式：沿 ConsumeManaInstruction 的父链上溯取「正在打出的卡」
// （cardConsumingMana），type==='fire' 才减免——X 费火卡（凝焰系列，ConsumeMana
// 由 use 内直接提交，父链同样可达持卡指令）一并享受减免。
// PRE 只做 payload 修饰（费用管线与数值管线同构，R2）；最低减到 0。
registerSkill({
  id: 'fireAffinity', name: '火焰眷顾', type: 'fire', tier: 'B', series: 'common',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
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
