// 木灵脉（WOOD_VEIN_CARDS，2026-09-14 二轮推敲定稿）============================
// 体系哲学：恢复、卖血、持久战。两个子体系：
//   生息组合（恢复/不灭——治疗、再生、荆棘、残血爆发）
//   瘴毒组合（叠毒/卖血——中毒叠层、卖血换毒、翻倍收束）
// 数值锚点见设计文档§0：中毒层数 ≈ 同位燃烧 −1~2（穿透高贵）；直接治疗小/贵/带代价
// （D≤4，C≤7，B≤12，A≤20，非消耗治疗一律冷却1限频）；卖血 1 生命 ≈ 1.5~2 点模型价值。
// 全部效果（中毒/再生/荆棘/治疗/奇迹）用既有注册表，不新增效果定义。
//
// 口径备忘（二轮推敲推论，详见设计文档锚点）：
//   * 「-1/回合效果 + 每回合固定获得」= 层数线性膨胀——咏唱不给「每回合再生/荆棘+2」，
//     生息系给直接治疗、根须缠绕荆棘1砍半、瘴气术做放大器（已有中毒才加速）；
//   * 平方衰减模型下「消耗中毒换线性伤害」恒亏——收束卡（败血）= 中毒翻倍（镜像爆燃）；
//   * 「你施加的中毒 +N」订阅判据 = 目标是敌人（敌方对玩家上毒天然排除，
//     出牌树/咏唱节拍/遗物施加全覆盖；PRE 只修饰 payload，铁律不违）；
//   * 卖血（失去生命）走 pierce 伤害（防御/护盾不减免），不做 minHp 地板——
//     玩家对自己血条负责（奇迹效果是全局 minHp 读轨，会自然兜住）；
//   * 卖血卡带 'blood' 关键词：页脚警示 + 漂浮系「随机发动牌库卡」filter 排除。

import { registerSkill } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { DealDamageInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import {
  attackDamage, gainShield, addEffect, drawCards, resolvedDamageText, enemyTarget,
} from './cardKit.js';

// ---- 共用：卖血（失去生命 = 无来源穿透伤害，标签 'blood' 供未来联动检索）----
function loseHp(sctx, amount) {
  sctx.kernel.submitInstruction(new DealDamageInstruction({
    source: null, target: sctx.player, amount, pierce: true, tags: ['blood'],
  }));
}

// ---- 共用：「你施加的中毒 +N」PRE 修饰订阅工厂（瘴主精英/腐殖之心/瘟神附体共用）----
// window 由调用方定（能力=战斗常驻；卡牌=本场战斗一次注册）。
// 判据 = effectId 中毒 + 正向层数 + 目标是敌人（target.side==='enemy'）：
// 敌人对玩家上毒天然排除；出牌树/咏唱节拍/遗物造成的上毒全部覆盖。
// 注意：effectId 是指令字段不在 payload（payload 白名单只放 stacks），过滤读字段。
export function poisonAmpSubscription(stacks, window = 'battle') {
  return {
    when: AddEffectInstruction, phase: 'pre', window,
    filter: (instr) => instr.effectId === 'poison'
      && instr.stacks > 0
      && instr.target?.side === 'enemy'
      && !instr.noPoisonAmp,   // 败血翻倍等「倍增非施加」的指令豁免（卡面承诺精确数值）
    react: (instr) => instr.setPayload('stacks', instr.payload.stacks + stacks),
  };
}

// ==== 生息组合 ===============================================================

// 草药系列（直接治疗，全链冷却1——非消耗治疗循环必须限频，否则龟缩流治疗压过敌人 DPS）
const herbCard = (id, name, tier, ap, heal, { regen = 0, cleanse = false, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'wood', tier, series: 'woodHerb',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new ApplyHealInstruction({ target: sctx.player, amount: heal }));
    if (regen > 0) addEffect(sctx, 'regen', regen);
    if (cleanse) {
      // 净化：按当前层数整量负向移除（无层数静默落空）
      for (const effectId of ['poison', 'burn']) {
        const stacks = sctx.player.getEffectStacks(effectId);
        if (stacks > 0) addEffect(sctx, effectId, -stacks, sctx.player);
      }
    }
    return true;
  },
  describe: () => `治疗${heal}${regen > 0 ? `，/effect{再生}${regen}` : ''}${cleanse ? '，清除自身/effect{中毒}与/effect{燃烧}' : ''}`,
  battleDescribe: (sctx) => `治疗${heal}${regen > 0 ? `，再生${regen}` : ''}${cleanse ? `（当前中毒${sctx.player.getEffectStacks('poison')}/燃烧${sctx.player.getEffectStacks('burn')}）` : ''}`,
});
herbCard('herbPaste', '草药膏', 'D', 1, 4, { promotesTo: 'cureGrass' });
herbCard('cureGrass', '愈伤草', 'C', 1, 7, { promotesTo: 'rejuvDew' });
herbCard('rejuvDew', '回春露', 'B', 1, 12, { regen: 2, promotesTo: 'reviveAll' });
herbCard('reviveAll', '万木回春', 'A', 2, 18, { regen: 3, cleanse: true });

// 硬皮系列（盾+再生/荆棘双轨）：硬皮→藤甲→古木壁垒→世界树之壁
const barkCard = (id, name, tier, shield, { regen = 0, thorns = 0, cd = 1, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'wood', tier, series: 'woodBark',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: cd },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    gainShield(sctx, shield);
    if (regen > 0) addEffect(sctx, 'regen', regen);
    if (thorns > 0) addEffect(sctx, 'thorns', thorns);
    return true;
  },
  describe: () => `${shield}护盾${regen > 0 ? `，/effect{再生}${regen}` : ''}${thorns > 0 ? `，/effect{荆棘}${thorns}` : ''}`,
  battleDescribe: (sctx) => `${shield}护盾${regen > 0 ? `，再生${regen}` : ''}${thorns > 0 ? `，荆棘${thorns}` : ''}`,
});
barkCard('hardenSkin', '硬皮', 'D', 6, { regen: 1, promotesTo: 'vineArmor' });
barkCard('vineArmor', '藤甲', 'C', 6, { thorns: 2, promotesTo: 'ancientBulwark' });
barkCard('ancientBulwark', '古木壁垒', 'B', 10, { thorns: 3, promotesTo: 'worldTreeWall' });
barkCard('worldTreeWall', '世界树之壁', 'A', 14, { thorns: 4, regen: 2, cd: 2 });

// 生息咏唱线（每回合直接治疗——「每回合再生+n」在 -1/回合口径下层数会线性膨胀，
// 直接治疗干净平价）：生息(C 治疗1/回合) → 生息术(B 治疗2/回合)，占位同 2。
const healChantCard = ({ id, name, tier, heal, promotesTo = null }) => registerSkill({
  id, name, type: 'wood', tier, series: 'woodChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(
          new ApplyHealInstruction({ target: ctx.player, amount: heal }), instr);
      },
    }],
  },
  describe: () => `每回合开始：治疗你${heal}`,
  battleDescribe: () => `每回合开始：治疗你${heal}`,
});
healChantCard({ id: 'breathOfLife', name: '生息', tier: 'C', heal: 1, promotesTo: 'vitalBreath' });
healChantCard({ id: 'vitalBreath', name: '生息术', tier: 'B', heal: 2 });

// 根须缠绕（C 咏唱，独立无晋升）：每回合荆棘1——荆棘不衰减＝线性投资，+1/回合是
// 砍半后的定价（初稿 +2/回合 10 回合 20 层＝滚雪球滥强）；块状来源（藤甲系）才是主加速。
registerSkill({
  id: 'rootSnare', name: '根须缠绕', type: 'wood', tier: 'C', series: 'woodChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(
          new AddEffectInstruction({ target: ctx.player, effectId: 'thorns', stacks: 1 }), instr);
      },
    }],
  },
  describe: () => '每回合开始：/effect{荆棘}1',
  battleDescribe: () => '每回合开始：荆棘1',
});

// 世界树之心（A 深入，生息门禁）：治疗12+再生4；生命不高于一半时翻倍（残血爆发治疗——
// 「不灭」的戏剧性由残血翻倍表达。不给奇迹：奇迹1 归零即死，挂在赠品位是陷阱）。
registerSkill({
  id: 'worldTreeHeart', name: '世界树之心', type: 'wood', tier: 'A', series: 'woodHerb', deep: 'renew',
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    const desperate = sctx.player.hp * 2 <= sctx.player.maxHp;
    sctx.kernel.submitInstruction(new ApplyHealInstruction({
      target: sctx.player, amount: desperate ? 24 : 12,
    }));
    addEffect(sctx, 'regen', desperate ? 8 : 4);
    return true;
  },
  describe: () => '治疗12，/effect{再生}4；若你生命不高于一半，改为治疗24，/effect{再生}8',
  battleDescribe: (sctx) => (sctx.player.hp * 2 <= sctx.player.maxHp
    ? '治疗24，再生8（残血翻倍）' : '治疗12，再生4'),
});

// ==== 瘴毒组合 ===============================================================

// 毒刺系列（直伤+叠毒）：毒刺→腐叶刃→败血刃→瘟神之刃
const stingCard = (id, name, tier, ap, damage, hits, poison, { draw = 0, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'wood', tier, series: 'woodSting',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    for (let i = 0; i < hits; i++) attackDamage(sctx, damage, { target });
    addEffect(sctx, 'poison', poison, target);
    if (draw > 0) drawCards(sctx, draw);
    return true;
  },
  describe: () => `${damage}伤害${hits > 1 ? `×${hits}` : ''}，施加/effect{中毒}${poison}${draw > 0 ? `，抽${draw}` : ''}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}${hits > 1 ? `×${hits}` : ''}，中毒${poison}${draw > 0 ? `，抽${draw}` : ''}`,
});
stingCard('poisonSting', '毒刺', 'D', 1, 3, 1, 2, { promotesTo: 'rotLeafBlade' });
stingCard('rotLeafBlade', '腐叶刃', 'C', 1, 2, 2, 2, { promotesTo: 'septicBlade' });
stingCard('septicBlade', '败血刃', 'B', 1, 7, 1, 4, { promotesTo: 'plagueBlade' });
stingCard('plagueBlade', '瘟神之刃', 'A', 2, 12, 1, 6, { draw: 1 });

// 瘴气系列（纯叠毒/群毒）：瘴气→毒雾弥漫→瘟潮
const miasmaCard = (id, name, tier, ap, poison, { all = false, draw = 0, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'wood', tier, series: 'woodMiasma',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: all ? 'none' : 'enemy',
  promotesTo,
  use(sctx) {
    if (all) {
      for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'poison', poison, e);
    } else {
      const target = enemyTarget(sctx);
      if (!target) return true;
      addEffect(sctx, 'poison', poison, target);
    }
    if (draw > 0) drawCards(sctx, draw);
    return true;
  },
  describe: () => `${all ? '所有敌人' : '施加'}/effect{中毒}${poison}${draw > 0 ? `，抽${draw}` : ''}`,
  battleDescribe: () => `${all ? '所有敌人' : '施加'}中毒${poison}${draw > 0 ? `，抽${draw}` : ''}`,
});
miasmaCard('miasma', '瘴气', 'C', 1, 4, { promotesTo: 'poisonFog' });
miasmaCard('poisonFog', '毒雾弥漫', 'B', 1, 3, { all: true, promotesTo: 'plagueTide' });
miasmaCard('plagueTide', '瘟潮', 'A', 2, 5, { all: true, draw: 1 });

// 血祭（C 卖血起步件，0AP 冷却1——彻底 0 开销卡默认冷却 1 起步）→ 血藤（B）
registerSkill({
  id: 'bloodSacrifice', name: '血祭', type: 'wood', tier: 'C', series: 'woodBlood',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['blood'],
  promotesTo: 'bloodVine',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    loseHp(sctx, 3);
    addEffect(sctx, 'poison', 3, target);
    return true;
  },
  describe: () => '失去3生命，施加/effect{中毒}3',
  battleDescribe: () => '失去3生命，中毒3',
});
registerSkill({
  id: 'bloodVine', name: '血藤', type: 'wood', tier: 'B', series: 'woodBlood',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['blood'],
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    loseHp(sctx, 4);
    addEffect(sctx, 'poison', 6, target);
    addEffect(sctx, 'regen', 3);
    return true;
  },
  describe: () => '失去4生命，施加/effect{中毒}6，自身/effect{再生}3',
  battleDescribe: () => '失去4生命，中毒6，再生3',
});

// 败血（A，收束）：目标中毒层数翻倍（镜像火系爆燃——平方衰减模型下
// 「消耗中毒换每层X伤」的线性买断恒亏，翻倍才是叠毒体系的真收束）。
registerSkill({
  id: 'septicemia', name: '败血', type: 'wood', tier: 'A', series: 'woodMiasma',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    const target = enemyTarget(sctx);
    if (!target) return true;
    const stacks = target.getEffectStacks('poison');
    if (stacks <= 0) return true;   // 无中毒：落空
    // 翻倍是「倍增」不是「施加」：豁免中毒放大 PRE（卡面承诺精确翻倍，10→20 而非 21）
    const instr = new AddEffectInstruction({ target, effectId: 'poison', stacks });
    instr.noPoisonAmp = true;
    sctx.kernel.submitInstruction(instr);
    return true;
  },
  describe: () => '目标/effect{中毒}层数翻倍',
  battleDescribe: (sctx) => `目标中毒翻倍（当前${sctx.target?.getEffectStacks('poison') ?? 0}层）`,
});

// 瘴气术（B 咏唱）：每回合敌全体中毒1，已有中毒者改为+2——放大器定位而非独立引擎：
// 「每回合群毒+n」裸奔在 -1/回合口径下是净 +n−1/回合 的平方级膨胀，必须绑前置投资。
registerSkill({
  id: 'miasmaChant', name: '瘴气术', type: 'wood', tier: 'B', series: 'woodChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 2,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        for (const e of aliveEnemies(ctx.battleState)) {
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: e, effectId: 'poison',
            stacks: e.getEffectStacks('poison') > 0 ? 2 : 1,
          }), instr);
        }
      },
    }],
  },
  describe: () => '每回合开始：所有敌人/effect{中毒}1；若其已有中毒，改为+2',
  battleDescribe: () => '每回合开始：所有敌人中毒1（已有中毒者+2）',
});

// 瘟神附体（A 深入，瘴毒门禁）：敌全体中毒4 + 本场你施加的中毒 +1
registerSkill({
  id: 'plagueIncarnate', name: '瘟神附体', type: 'wood', tier: 'A', series: 'woodMiasma', deep: 'blight',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    for (const e of aliveEnemies(sctx.battleState)) addEffect(sctx, 'poison', 4, e);
    sctx.kernel.addSubscription(poisonAmpSubscription(1));
    return true;
  },
  describe: () => '所有敌人/effect{中毒}4；本场战斗你施加的中毒+1',
  battleDescribe: () => '所有敌人中毒4；你施加的中毒+1',
});

// ==== S 级（阶梯外） =========================================================

// 塞西莉亚奇迹（S，消耗）：奇迹3——3 回合不死，层数归零时死亡（EFFECTS.md 奇迹口径）
registerSkill({
  id: 'ceciliaMiracle', name: '塞西莉亚奇迹', type: 'wood', tier: 'S', series: 'woodHerb',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    addEffect(sctx, 'miracle', 3);
    return true;
  },
  describe: () => '/effect{奇迹}3',
  battleDescribe: () => '奇迹3',
});

// 腐殖之心（S，0AP 消耗——一次性豁免 0 费谨慎口径）：本场你施加的中毒 +2
registerSkill({
  id: 'heartOfHumus', name: '腐殖之心', type: 'wood', tier: 'S', series: 'woodMiasma',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.addSubscription(poisonAmpSubscription(2));
    return true;
  },
  describe: () => '本场战斗你施加的/effect{中毒}+2',
  battleDescribe: () => '你施加的中毒+2',
});
