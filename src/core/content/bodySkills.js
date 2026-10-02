// 体修·拳组合（BODY_CULTIVATION_CARDS §1：过牌体系）。
// 刀组合见 bladeSkills.js、拆组合见 blockSkills.js——三子体系分文件维护。
// 设计约定：
//   * 体修卡全走 AP（无魏启），type 'normal'（体修灰卡面）；
//   * 伤害统一走「基数 + 攻击面板 + power」语言（cardKit.attackAmount / attackDamage）；
//   * 设计稿费用栏留空的卡按 battle.md 费用缺省约定免费（0 费）；
//   * 【后手】= 此牌作为手牌中最后一张自由牌打出（右侧没有别的自由牌；左侧不挡），
//     判定统一走 cardKit.isLastHandCardAtPlay；
//   * 【先手】= 本回合打出的第一张牌（敏捷连击系判据），判定统一走 cardKit.isFirstPlayThisTurn；
//   * 咏唱触发效果 = activated.subscriptions 订阅 ChantTriggerInstruction(post)（P5 挂载点）。

import { registerSkill, getSkillDefinition, allSkills } from '../skills/registry.js';
import { zoneOf } from '../state/battleState.js';
import { UseSkillInstruction, SkillCooldownInstruction } from '../instructions/skill.js';
import { GainActionPointsInstruction } from '../instructions/resources.js';
import { DrawCardsInstruction, DiscardCardInstruction, TransformCardInstruction } from '../instructions/cards.js';
import { DealDamageInstruction, previewDamage } from '../instructions/combat.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { TIER_RANK, packOf } from '../run/rewards.js';
import {
  attackAmount, attackDamage, resolvedDamageText, enemyTarget,
  dealDamage, drawCards, addCard, randomAliveEnemy,
  isLastHandCardAtPlay, isFirstPlayThisTurn, aoeAttack, gainShield,
  requestHandSelection, selected, reactFx,
} from './cardKit.js';

// ==== 1. 真拳系列（基石：纯伤害直线升级，S 阶跃迁为无任何资源消耗）====
// 拳 C（6 伤）在 skills.js，是全系列链首；此处补 B/A/S 三阶。
function registerPureFist({ id, name, tier, damage, cost, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost, charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      return true;
    },
    describe: () => `${damage}伤害`,
    battleDescribe: (sctx) => resolvedDamageText(sctx, damage),
  });
}

// 快拳（真拳系列 B）：1AP 9 伤。
registerPureFist({
  id: 'fastPunch', name: '快拳', tier: 'B', damage: 9,
  cost: { mana: 0, actionPoint: 1 }, promotesTo: 'cannonFist',
});

// 炮拳（真拳系列 A）：1AP 12 伤。
registerPureFist({
  id: 'cannonFist', name: '炮拳', tier: 'A', damage: 12,
  cost: { mana: 0, actionPoint: 1 }, promotesTo: 'trueFist',
});

// 真拳（真拳系列 S）：0费0AP 15 伤——设计稿明示「无任何资源消耗」，
// 是全库少见的白嫖伤害位（S 不入包：只走事件投放，D4-c）。
registerPureFist({
  id: 'trueFist', name: '真拳', tier: 'S', damage: 15,
  cost: { mana: 0, actionPoint: 0 },
});

// ==== 2. 崩拳系列（出牌冷却附伤：充能大弹匣，出牌是唯一上膛途径）====

// 崩拳族共用骨架：8 回合大冷却 + 高额伤害；冷却走全局回合扫掠（P2 每回合 1 拍），
// 打出其他牌是**手中加速**途径（每打 1 牌即刻冷却 1，定向直达），
// 与拳组合「高频出牌」哲学互为引擎。自身打出结算完成时已离手（pending→deck），
// 不会自我加速。
function registerCollapseFist({ id, name, tier, damage, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 8 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      return true;
    },
    // 在手时：任意一次出牌（POST）都推进本卡冷却 1（含嵌套出牌）
    subscriptions: (sctx) => [{
      when: UseSkillInstruction, phase: 'post',
      filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(
          new SkillCooldownInstruction({ skill: sctx.self, delta: 1 }), instr);
        reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
      },
    }],
    describe: () => `${damage}伤害；在手时每打出1牌冷却1`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}；在手时每打出1牌冷却1`,
  });
}

// 猛拳（崩拳系列 C）
registerCollapseFist({ id: 'fierceFist', name: '猛拳', tier: 'C', damage: 15, promotesTo: 'boomFist' });
// 轰拳（崩拳系列 B）
registerCollapseFist({ id: 'boomFist', name: '轰拳', tier: 'B', damage: 20, promotesTo: 'collapseFist' });
// 崩拳（崩拳系列 A）
registerCollapseFist({ id: 'collapseFist', name: '崩拳', tier: 'A', damage: 25 });

// ==== 3. 敏捷连击系列（先手抽牌：本回合第一张打出 = 领跑奖励）====
// 判据为【先手】时序而非「最左端打出」——最左端被抽牌顺序与激活咏唱驻左卡死
// （玩家不可控），先手完全可控；且每回合天然限触发一次（第一张只有一张）。
// 咏唱发动也是一次打出、会抢先手位 = 真实顺序抉择。

function registerAgileCombo({ id, name, tier, damage, draw, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      // 先手（本回合第一张打出，UseSkill stage 1 捕获口径）才有抽牌奖励
      if (isFirstPlayThisTurn(sctx)) drawCards(sctx, draw);
      return true;
    },
    describe: () => `${damage}伤害；/named{先手}：抽${draw}`,
    // 无 battleDescribe：「先手」条件简单，静态描述即机制。
  });
}

// 敏捷连击（C）——8 伤，先手抽 2
registerAgileCombo({ id: 'agileCombo', name: '敏捷连击', tier: 'C', damage: 8, draw: 2, promotesTo: 'rapidCombo' });
// 疾速连击（B）——11 伤，先手抽 2
registerAgileCombo({ id: 'rapidCombo', name: '疾速连击', tier: 'B', damage: 11, draw: 2, promotesTo: 'stormCombo' });
// 暴风连击（A）——14 伤，先手抽 2
registerAgileCombo({ id: 'stormCombo', name: '暴风连击', tier: 'A', damage: 14, draw: 2 });

// ==== 4. 虚形拳系列（后手：清手奖励——最后一张打出时质变）====
// 两条分叉线：伤害线（仿形→豹形→虎形→空形）与抽牌线（蛇形→龙形→虚形）。

// 常规档：基础 9 伤；后手 +bonus 且抽 draw 张（结算读 isLastHandCardAtPlay 出牌时点口径）
function registerShadowFist({ id, name, tier, bonus, draw = 0, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const last = isLastHandCardAtPlay(sctx);
      attackDamage(sctx, last ? 9 + bonus : 9);
      if (last && draw > 0) drawCards(sctx, draw);
      return true;
    },
    describe: () => `9伤害；/named{后手}：+${bonus}${draw > 0 ? `，抽${draw}` : ''}`,
    // 无 battleDescribe：「后手」条件简单，静态描述即机制。
  });
}

// 仿形拳（C）：链首——晋升在此分叉（升级必须提升等阶，C→B 的两个同族成员都是
// 合法方向；抉择走升级子面板，随机升级随机取）
registerShadowFist({ id: 'mimicFist', name: '仿形拳', tier: 'C', bonus: 7, promotesTo: ['leopardFist', 'snakeFist'] });
// 豹形拳（B）：伤害线——后手 +12
registerShadowFist({ id: 'leopardFist', name: '豹形拳', tier: 'B', bonus: 12, promotesTo: 'tigerFist' });
// 蛇形拳（B）：抽牌分叉线——后手抽 1
registerShadowFist({ id: 'snakeFist', name: '蛇形拳', tier: 'B', bonus: 7, draw: 1, promotesTo: 'dragonFist' });
// 虎形拳（A）：伤害线——后手 +18
registerShadowFist({ id: 'tigerFist', name: '虎形拳', tier: 'A', bonus: 18 });
// 龙形拳（A）：抽牌线——后手抽 2
registerShadowFist({ id: 'dragonFist', name: '龙形拳', tier: 'A', bonus: 7, draw: 2 });

// 虚形拳（S，抽牌线顶点）：无基础伤害——后手：抽7。S 为阶梯外等阶，不设 promotesTo。
registerSkill({
  id: 'voidFist', name: '虚形拳', type: 'normal', tier: 'S', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    if (isLastHandCardAtPlay(sctx)) drawCards(sctx, 7);
    return true;
  },
  describe: () => '/named{后手}：抽7',
  // 无 battleDescribe：条件不满足时显示「无效果」会让玩家永远看不到机制
  // （判定条件简单的卡保持原 describe）。
});

// 空形拳（S，伤害线顶点）：无基础伤害——后手：55 伤。
registerSkill({
  id: 'emptyFist', name: '空形拳', type: 'normal', tier: 'S', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    if (isLastHandCardAtPlay(sctx)) attackDamage(sctx, 55);
    return true;
  },
  describe: () => '/named{后手}：55伤害',
  // 无 battleDescribe：同虚形拳（条件简单，保持机制可见）。
});

// ==== 5. 蓄力系列（向牌库注入价值：瞬击 = 0 费即抛型过牌弹药）====

// 洗入档（C/B/A）：向牌库随机位插入 count 张「瞬击」。
function registerChargeShuffle({ id, name, tier, count, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 2 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      for (let i = 0; i < count; i++) addCard(sctx, 'instantStrike', { index: 'random' });
      return true;
    },
    describe: () => `/named{洗入${count}}/card{instantStrike}`,
  });
}

// 蓄力（C）
registerChargeShuffle({ id: 'chargeUp', name: '蓄力', tier: 'C', count: 2, promotesTo: 'comboStrike' });
// 连击（B）
registerChargeShuffle({ id: 'comboStrike', name: '连击', tier: 'B', count: 3, promotesTo: 'quadrupleHit' });
// 四重击（A）
registerChargeShuffle({ id: 'quadrupleHit', name: '四重击', tier: 'A', count: 4 });

// 无限连击（A）：1AP 消耗 + 咏唱1——
// 发动后驻手，每次咏唱触发洗入 3 张瞬击（常驻引擎）；再次打出免费解除，因消耗焚毁离场。
registerSkill({
  id: 'endlessCombo', name: '无限连击', type: 'normal', tier: 'A', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  keywords: ['exhaust'],
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: () => {
        for (let i = 0; i < 3; i++) addCard(sctx, 'instantStrike', { index: 'random' });
        reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
      },
    }],
  },
  describe: () => '/named{洗入3}/card{instantStrike}',
  battleDescribe: (sctx) => '/named{洗入3}/card{instantStrike}',
});

// 一瞬千击（S）：1AP 消耗——发现 5 张瞬击（直接进手牌；满手按 §7.3 溢入牌库）。
registerSkill({
  id: 'instantThousand', name: '一瞬千击', type: 'normal', tier: 'S', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    for (let i = 0; i < 5; i++) addCard(sctx, 'instantStrike', { toZone: 'hand' });
    return true;
  },
  describe: () => '/named{发现}5/card{instantStrike}',
});

// 瞬击（蓄力系列衍生牌）：0 费即抛——6 伤 + 抽 1，打出即焚毁。
// 只经造牌指令入场，不入奖励池。等阶记 C（衍生牌的等阶只是账务口径，不进任何池）。
registerSkill({
  id: 'instantStrike', name: '瞬击', type: 'normal', tier: 'C', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 6);
    drawCards(sctx, 1);
    return true;
  },
  describe: () => '6伤害，抽1牌',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 6)}，抽1牌`,
});

// ==== 6. 肘击系列（小体系：打击位成链 + 牢大乘区 + 坠机爆发）====

// 肘击小体系的卡池门禁口径（rewards.js 通用落地）：牢大/牢大归来/坠机只在
// 持有至少一张「肘击打击位」时进入卡包奖励列表，且持有越多档内权重越高。
// fierceElbowFree 是局内转化形态（不在牌组），列入只为判定口径统一。
const ELBOW_STRIKE_IDS = Object.freeze([
  'elbowStrike', 'fierceElbow', 'strongElbow', 'pureElbow', 'fierceElbowFree',
]);

// 肘击伤害预览文本（带 elbow 标记）：牢大的翻倍只认 tags 含 elbow 的伤害，
// 预估必须带同一标记走真实 PRE 管线，才能「所见即所算」（battle.md A5）。
// resolvedDamageText（cardKit）不带 tags，此处本地补一版带标记的干跑。
function elbowDamageText(sctx, base) {
  const amount = attackAmount(sctx, base);
  const target = enemyTarget(sctx);
  const { damage } = target
    ? previewDamage(sctx, { source: sctx.player, target, amount, tags: ['elbow'] })
    : { damage: amount };
  return `${damage}伤害`;
}

// 肘击打击位（D→C→B→A）：咏唱1（轻压力），每次咏唱触发（每回合 P5）随机敌人
// damage 伤，B/A 额外护盾。伤害打 tags:['elbow']——牢大以此识别「肘击卡伤害」。
// ap/spawnable 可覆写：`fierceElbowFree`（HeLiCoPtEr 变换出来的 0 费形态）用 0 费 +
// 不进奖励池（只经局内转化获得，同碎铁口径）。
function registerElbow({ id, name, tier, damage, shield = 0, promotesTo = null, ap = 1, spawnable = true }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    promotesTo,
    canSpawnAsReward: spawnable,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ChantTriggerInstruction, phase: 'post',
        // 随机目标：咏唱自动触发没有出牌时点，随机选一个存活敌人（走种子 rng 可复现）
        react: () => {
          const target = randomAliveEnemy(sctx);
          if (target) dealDamage(sctx, attackAmount(sctx, damage), { target, tags: ['elbow'] });
          if (shield > 0) gainShield(sctx, shield);
        },
      }],
    },
    describe: () => `随机${damage}伤害${shield > 0 ? `，${shield}护盾` : ''}`,
    battleDescribe: (sctx) => `随机${elbowDamageText(sctx, damage)}${shield > 0 ? `，${shield}护盾` : ''}`,
  });
}

// 肘击（C）
registerElbow({ id: 'elbowStrike', name: '肘击', tier: 'C', damage: 6, promotesTo: 'fierceElbow' });
// 猛烈肘击（B）——8 伤
registerElbow({ id: 'fierceElbow', name: '猛烈肘击', tier: 'B', damage: 8, promotesTo: 'strongElbow' });
// 强大肘击（A）——8 伤 + 2 盾
registerElbow({ id: 'strongElbow', name: '强大肘击', tier: 'A', damage: 8, shield: 2, promotesTo: 'pureElbow' });
// 纯粹肘击（S；费用栏留空 → 0 费）
registerElbow({ id: 'pureElbow', name: '纯粹肘击', tier: 'S', damage: 10, shield: 4, ap: 0 });
// 猛烈肘击·0 费形态：HeLiCoPtEr（COMMON_CARDS「将所有手牌变换为0开销猛烈肘击」）
// 的变换目标——同名同形态、只是免费（0AP），且**只经局内转化获得**（不进奖励池/不进抽选）。
registerElbow({ id: 'fierceElbowFree', name: '猛烈肘击', tier: 'B', damage: 8, ap: 0, spawnable: false });

// 牢大（B/A）：咏唱1/0——你的肘击卡伤害翻倍。设计稿费用栏留空 → 0 费（代价押在
// 咏唱手牌压力与构建上；A 档咏唱 0 = 零容量压力）。实现：PRE 修饰 tags 含 elbow 的伤害。
function elbowMasterCard({ id, tier, weight, promotesTo = null }) {
  registerSkill({
    id, name: '牢大', type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: weight,
    promotesTo,
    requiresAnyOf: ELBOW_STRIKE_IDS,
    affinityCards: ELBOW_STRIKE_IDS,
    use() { return true; },
    activated: {
      subscriptions: () => [{
        when: DealDamageInstruction, phase: 'pre',
        filter: (instr) => instr.tags?.includes('elbow') === true && !instr.fixed
          && instr.type === 'major',
        react: (instr) => instr.setPayload('damage', instr.payload.damage * 2),
      }],
    },
    describe: () => '肘击卡伤害翻倍',
    battleDescribe: () => '你的肘击卡伤害翻倍',
  });
}
elbowMasterCard({ id: 'elbowMasterB', tier: 'B', weight: 1, promotesTo: 'elbowMasterA' });
elbowMasterCard({ id: 'elbowMasterA', tier: 'A', weight: 0 });

// 牢大归来（B/A，1AP）：发现同等阶肘击（B → 猛烈肘击；A → 强大肘击）。
function elbowReturnCard({ id, tier, targetId, promotesTo = null }) {
  registerSkill({
    id, name: '牢大归来', type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    promotesTo,
    requiresAnyOf: ELBOW_STRIKE_IDS,
    affinityCards: ELBOW_STRIKE_IDS,
    use(sctx) {
      addCard(sctx, targetId, { toZone: 'hand' });
      return true;
    },
    describe: () => `/named{发现}同等阶肘击：/card{${targetId}}`,
  });
}
elbowReturnCard({ id: 'elbowReturnB', tier: 'B', targetId: 'fierceElbow', promotesTo: 'elbowReturnA' });
elbowReturnCard({ id: 'elbowReturnA', tier: 'A', targetId: 'strongElbow' });

// 坠机（A，消耗，费用栏留空 → 0 费）：你的全部激活的肘击卡变为随机高一阶的体修卡
// （转化自动熄灭咏唱；体修卡 = 基础包卡，排除深入卡/衍生牌/诅咒。高一阶：C→B→A→S）。
registerSkill({
  id: 'crashLanding', name: '坠机', type: 'normal', tier: 'A', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  requiresAnyOf: ELBOW_STRIKE_IDS,
  affinityCards: ELBOW_STRIKE_IDS,
  use(sctx) {
    const activated = sctx.battleState.zones.hand.filter(
      c => c.isActivated && ELBOW_STRIKE_IDS.includes(c.defId));
    for (const card of activated) {
      const nextId = randomBodyCardAbove(sctx, getSkillDefinition(card.defId).tier);
      if (!nextId) continue;
      sctx.kernel.submitInstruction(new TransformCardInstruction({
        uniqueID: card.uniqueID, toDefId: nextId, keepPower: false,
      }));
    }
    return true;
  },
  describe: () => '你的全部激活的肘击卡变为随机高一阶的体修卡',
  battleDescribe: (sctx) => {
    const n = sctx.battleState.zones.hand.filter(
      c => c.isActivated && ELBOW_STRIKE_IDS.includes(c.defId)).length;
    return `你的全部激活的肘击卡变为随机高一阶的体修卡（当前激活${n}张）`;
  },
});

// 坠机的目标池：基础包（体修）卡中随机取一阶高一档的可spawn卡；空池（如 S 之上）返回 null。
function randomBodyCardAbove(sctx, tier) {
  const rank = (TIER_RANK[tier] ?? 0) + 1;
  const pool = allSkills().filter(def =>
    packOf(def) === 'body' && !def.deep && def.canSpawnAsReward !== false
    && def.tier !== 'Z' && (TIER_RANK[def.tier] ?? -1) === rank);
  if (!pool.length) return null;
  return pool[sctx.battleState.rng.int(0, pool.length - 1)].id;
}

// ==== 7. 太极系列（打出牌数 → 抽牌，跨回合计数）====
// 计数器放 skillRuntime（chantCount，plain data 可序列化），跨回合累积不清零；
// 自身发动/解除不计入（filter 按 uniqueID 排除）。

// 频次阶梯 5/5/4/4；B 档起费用栏留空 → 0 费；S 档咏唱0。
function registerPlayCountChant({ id, name, tier, every, ap = 1, weight = 1, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: weight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: UseSkillInstruction, phase: 'post',
        filter: (instr) => instr.skill.uniqueID !== sctx.self.uniqueID,
        react: (instr, ctx) => {
          sctx.self.chantCount = (sctx.self.chantCount ?? 0) + 1;
          if (sctx.self.chantCount % every === 0) {
            ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr);
          }
        },
      }],
    },
    describe: () => `每打出${every}张牌，抽1牌`,
    battleDescribe: (sctx) => `每打出${every}张牌，抽1牌（已打${sctx.self.chantCount ?? 0}）`,
  });
}

registerPlayCountChant({ id: 'leverageC', name: '借力', tier: 'C', every: 5, promotesTo: 'leverageB' });
registerPlayCountChant({ id: 'leverageB', name: '借力', tier: 'B', every: 5, ap: 0, promotesTo: 'leverageA' });
registerPlayCountChant({ id: 'leverageA', name: '借力', tier: 'A', every: 4, ap: 0, promotesTo: 'taijiS' });
registerPlayCountChant({ id: 'taijiS', name: '太极', tier: 'S', every: 4, ap: 0, weight: 0 });

// ==== 8. 武学系列（抽牌 → 伤害，与太极互为引擎）====
// 每抽 1 张牌（一切抽牌来源：回合开始/技能/造牌连锁）对随机敌人 damage 伤，
// 每张独立随机选靶（多敌时伤害散步）；无存活敌人（战斗收尾）静默落空。

function registerDrawDamageChant({ id, name, tier, damage, ap = 1, weight = 1, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: weight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: DrawCardsInstruction, phase: 'post',
        react: (instr) => {
          for (let i = 0; i < (instr.result?.drawn?.length ?? 0); i++) {
            const target = randomAliveEnemy(sctx);
            if (!target) break; // 敌已死光（收尾期）：伤害落空
            // 附级伤害：被动触发的抽卡伤害不是攻击——不吃任何加成（武术姿态×精通
            // =一回合上百爆炸伤的病灶）、不上燃、不触发受击响应。
            dealDamage(sctx, attackAmount(sctx, damage), { target, type: 'minor' });
          }
        },
      }],
    },
    describe: () => `每抽1牌，随机${damage}伤害`,
    battleDescribe: (sctx) => `每抽1牌，随机${resolvedDamageText(sctx, damage)}`,
  });
}

registerDrawDamageChant({ id: 'masteryC', name: '精通', tier: 'C', damage: 2, promotesTo: 'masteryB' });
registerDrawDamageChant({ id: 'masteryB', name: '精通', tier: 'B', damage: 2, ap: 0, promotesTo: 'masteryA' });
registerDrawDamageChant({ id: 'masteryA', name: '精通', tier: 'A', damage: 3, ap: 0, promotesTo: 'peerlessS' });
registerDrawDamageChant({ id: 'peerlessS', name: '无双', tier: 'S', damage: 3, ap: 0, weight: 0 });

// ==== 9. 深入卡（需精英能力「拳师」）====

// 万变拳（A/S）：1AP 冷却2——**选择 1/2 张手牌免费发动**（2026-10-01 用户定改版：
// 原「下N张打出 AP 费用为 0」的 PRE 计数豁免弃用——可用性判定不认豁免导致灰卡
// 打不出（1001 夜测中危）。现行 = 结算期手牌选卡（overlay 覆盖层）→ 逐张嵌套
// 强发（costOverride 0/0，随机敌目标——与漂浮系 freePlayCard 同范式）；手牌不足
// 张数时按余量截断（buildCardSelectionRequest 的 min/max 收口），空手静默落空。
function wildFistCard({ id, tier, count, promotesTo = null }) {
  registerSkill({
    id, name: '万变拳', type: 'normal', tier, series: 'fist', deep: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 2 },
    cardMode: 'normal',
    promotesTo,
    use(sctx, stage) {
      if (stage === 0) {
        sctx.self._fistPick = requestHandSelection(sctx, {
          count,
          reason: `万变拳：选${count === 1 ? '一' : '两'}张手牌免费发动`,
        });
        return sctx.self._fistPick ? false : true;   // 空手守卫：静默落空
      }
      const ids = selected(sctx.self._fistPick);
      sctx.self._fistPick = null;
      for (const uid of ids) {
        const card = sctx.battleState.zones.hand.find(c => c.uniqueID === uid) ?? null;
        if (!card) continue;   // 结算中途被挪走：静默落空（DiscardCard 范式）
        sctx.kernel.submitInstruction(new UseSkillInstruction({
          skill: card,
          costOverride: { mana: 0, actionPoint: 0 },
          targetUniqueID: randomAliveEnemy(sctx)?.uniqueID ?? null,
        }));
      }
      return true;
    },
    describe: () => `选${count === 1 ? '一' : '两'}张手牌免费发动`,
    battleDescribe: () => `选${count === 1 ? '一' : '两'}张手牌免费发动`,
  });
}
wildFistCard({ id: 'wildFistA', tier: 'A', count: 1, promotesTo: 'wildFistS' });
wildFistCard({ id: 'wildFistS', tier: 'S', count: 2 });

// 假动作系列（C→B→A）：抽 2 牌，洗入 2 「虚无」。
// 升阶：B 不消耗；A 抽 3。过牌换稀释：短期手牌质量提升，牌库被虚无污染
//（虚无 0 费打出即焚，白吃一手节奏）。
const feintCard = ({ id, tier, draw, exhaust = true, promotesTo = null }) => registerSkill({
  id, name: '假动作', type: 'normal', tier, series: 'fist', deep: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: [...(exhaust ? ['exhaust'] : [])],
  promotesTo,
  use(sctx) {
    drawCards(sctx, draw);
    for (let i = 0; i < 2; i++) addCard(sctx, 'voidCard', { index: 'random' });
    return true;
  },
  describe: () => `抽${draw}牌，/named{洗入}2/card{voidCard}`,
});
feintCard({ id: 'feintC', tier: 'C', draw: 2, promotesTo: 'feintB' });
feintCard({ id: 'feintB', tier: 'B', draw: 2, exhaust: false, promotesTo: 'feintA' });
feintCard({ id: 'feintA', tier: 'A', draw: 3 });

// 虚无（假动作衍生牌）：0 费无效果消耗牌——纯粹的牌库噪音，只经造牌入场。
// 等阶记 C（衍生牌的等阶只是账务口径）。
registerSkill({
  id: 'voidCard', name: '虚无', type: 'normal', tier: 'C', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use() { return true; },
  describe: () => '无效果',
});

// ==== 10. 扩容批（五个机制空白维度补齐）====
// 五个新维度补拳组合的机制空白，全部用体修现有语言（过牌/先手后手/瞬击/咏唱/打出计数）：
//   * 卖血爆发（狂拳链）——HP 一次性代价换高伤+抽牌；
//   * 多段连击（乱拳链）——「连击」主题终于有 ×N 段，吃快如雨/拳师/灼类「每段触发」；
//   * 群伤 AOE（重踏链）——拳组合此前零 AOE（武学只是随机散步）；
//   * 瞬击下游（拳压，拳师深入卡）——蓄力系造的瞬击终于有「吃瞬击」的加成件；
//   * 弃牌引擎（混元）——弃牌语言（呼吸/假动作/以无胜有）的消费端。
// 数值对标：无条件部分 = 同阶白板（乱拳 6=拳、密雨 9=快拳、千手 12=炮拳），
// 多段/条件加成才是体系溢价。失去生命 = 无来源固定伤害（跳修正、护盾可吸收、
// 不触发荆棘/忍耐类反制——纯代价语义）。

// 群伤原语（bodyAoe）与扫腿链归拆组合（blockSkills.js，series 'block'）
// ——扫腿线重做为多敌防卡后归属拆；群伤原语上移 cardKit.aoeAttack 共用。

// 狂拳 C → B → A（卖血链；C 9伤 / B 13伤 / A 13伤+2AP）。失去生命 = 无来源固定伤害
// （跳修正、护盾可吸收、不触发荆棘/忍耐类反制——纯代价语义）；获得 AP 走指令
// （伤害换节奏）。
function wildPunchCard({ id, tier, damage, lifeLoss, ap = 0, promotesTo = null }) {
  registerSkill({
    id, name: '狂拳', type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: sctx.player, amount: lifeLoss, fixed: true, tags: ['selfcost'],
      }));
      if (ap > 0) sctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: ap }));
      return true;
    },
    describe: () => `${damage}伤害，失去${lifeLoss}生命${ap > 0 ? `，获得${ap}行动点` : ''}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，失去${lifeLoss}生命${ap > 0 ? `，获得${ap}行动点` : ''}`,
  });
}
wildPunchCard({ id: 'wildPunchC', tier: 'C', damage: 9, lifeLoss: 2, ap: 1, promotesTo: 'wildPunchB' });
wildPunchCard({ id: 'wildPunchB', tier: 'B', damage: 13, lifeLoss: 2, ap: 1, promotesTo: 'wildPunchA' });
wildPunchCard({ id: 'wildPunchA', tier: 'A', damage: 13, lifeLoss: 2, ap: 2 });

// 乱拳 C → 雨拳 B → 千手 A → 万手 S（多段链：每段独立结算、独立吃减伤门与触发面。
// 总伤 9/12/16/30）
function flurryCard({ id, name, tier, damage = 3, hits, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
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
flurryCard({ id: 'wildFlurry', name: '乱拳', tier: 'C', damage: 3, hits: 3, promotesTo: 'rainFist' });
flurryCard({ id: 'rainFist', name: '雨拳', tier: 'B', damage: 4, hits: 3, promotesTo: 'thousandHands' });
flurryCard({ id: 'thousandHands', name: '千手', tier: 'A', damage: 4, hits: 4, promotesTo: 'myriadHands' });
flurryCard({ id: 'myriadHands', name: '万手', tier: 'S', damage: 5, hits: 6 });

// 拳压 C→B→A（拳师深入卡，瞬击下游）：1AP 冷却1——6 伤；本回合每打出过 1 张瞬击
// 伤害 +3/+4/+5（基础值对标白板，瞬击引擎是溢价来源——无引擎时近白板，故收进
// 深入门禁：拳师到手前不进任何奖励池。瞬击计数读 history.turn.playedCards 明细）。
const fistPressCard = ({ id, tier, per, promotesTo = null }) => registerSkill({
  id, name: '拳压', type: 'normal', tier, series: 'fist', deep: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, 6 + instantStrikesThisTurn(sctx) * per);
    return true;
  },
  describe: () => `6伤害；本回合每打出过1/card{instantStrike}，+${per}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 6 + instantStrikesThisTurn(sctx) * per)}`
    + `（6+${instantStrikesThisTurn(sctx) * per}）`,
});
fistPressCard({ id: 'fistPressC', tier: 'C', per: 3, promotesTo: 'fistPressB' });
fistPressCard({ id: 'fistPressB', tier: 'B', per: 4, promotesTo: 'fistPressA' });
fistPressCard({ id: 'fistPressA', tier: 'A', per: 5 });
function instantStrikesThisTurn(sctx) {
  return sctx.battleState.history.turn.playedCards.filter(id => id === 'instantStrike').length;
}

// 拆招 C→B→A（手牌补充）：0费 冷却1——抽 1；
// 自由手牌（未激活咏唱的手牌）不超过 2/3/4 张时再抽 1（清手流的续航资源件）。
// 发动卡结算时已离手（pending），自由手牌读其余手牌（激活咏唱豁免判定）。
function counterDrawCard({ id, tier, threshold, extra, promotesTo = null }) {
  registerSkill({
    id, name: '拆招', type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      drawCards(sctx, 1);
      const free = sctx.battleState.zones.hand.filter(c => !c.isActivated).length;
      if (free <= threshold) drawCards(sctx, extra);
      return true;
    },
    describe: () => `抽1；/named{自由}手牌不超过${threshold}张时，再抽${extra}`,
    // 无 battleDescribe：阈值条件比读数更要紧。
  });
}
counterDrawCard({ id: 'counterDrawC', tier: 'C', threshold: 2, extra: 1, promotesTo: 'counterDrawB' });
counterDrawCard({ id: 'counterDrawB', tier: 'B', threshold: 3, extra: 1, promotesTo: 'counterDrawA' });
counterDrawCard({ id: 'counterDrawA', tier: 'A', threshold: 4, extra: 1 });

// 满拳系列 C→B→A（全神一击从「每张手牌+3」收回阈值加成——手牌加成与阈值红利是
// 同一个身份，双轨叠乘会让 A 档失控）：C/B 蓄满一击：6 群伤，手牌不少于 4 张时
// +7/+10；A 全神一击：8 群伤，手牌不少于 4 张时 +13。
// 手牌数按**裸张数**计（卡面写的手牌数量 = 直观张数，激活咏唱算 1 张，不加权
// ——见 battle.md §1 基础约定）。
function fullChargeCard({ id, name, tier, base, bonus, threshold, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    promotesTo,
    use(sctx) {
      const full = sctx.battleState.zones.hand.length >= threshold;
      aoeAttack(sctx, base + (full ? bonus : 0));
      return true;
    },
    describe: () => `${base}群伤。手牌不少于${threshold}张时，+${bonus}`,
    // 无 battleDescribe：阈值条件简单，静态描述即机制。
  });
}
fullChargeCard({ id: 'fullChargeC', name: '蓄满一击', tier: 'C', base: 6, bonus: 7, threshold: 4, promotesTo: 'fullChargeB' });
fullChargeCard({ id: 'fullChargeB', name: '蓄满一击', tier: 'B', base: 6, bonus: 10, threshold: 4, promotesTo: 'fullSpirit' });
fullChargeCard({ id: 'fullSpirit', name: '全神一击', tier: 'A', base: 8, bonus: 13, threshold: 4 });

// 变招/混元 B/A/S（弃牌引擎）：咏唱2/2/1——每弃 3/2/2 张牌，抽 1（太极「每打 N 抽 1」
// 的弃牌镜像；弃牌语言在体修三子系都有：假动作/呼吸/以无胜有）。计数挂
// skillRuntime（跨回合累积，plain data 可序列化）；S 档咏唱 1 的低容量压力。
function discardEngineChant({ id, name, tier, weight, every = 3, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: weight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: DiscardCardInstruction, phase: 'post',
        react: (instr, ctx) => {
          sctx.self.discardCount = (sctx.self.discardCount ?? 0) + 1;
          if (sctx.self.discardCount % every === 0) {
            ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr);
          }
        },
      }],
    },
    describe: () => `每弃${every}张牌，抽1牌`,
    battleDescribe: (sctx) => `每弃${every}张牌，抽1牌（已弃${sctx.self.discardCount ?? 0}）`,
  });
}
discardEngineChant({ id: 'shiftMoveB', name: '变招', tier: 'B', weight: 2, every: 3, promotesTo: 'shiftMoveA' });
discardEngineChant({ id: 'shiftMoveA', name: '变招', tier: 'A', weight: 2, every: 2, promotesTo: 'hunYuanS' });
discardEngineChant({ id: 'hunYuanS', name: '混元', tier: 'S', weight: 1, every: 2 });

// ==== 泛用组件（起始卡组配套，非 §1 系列）====

// 肾上腺素 B/A（通用灰卡，COMMON_CARDS 定稿）：0 开销消耗卡——获得 1AP 并抽 2/3 牌。
// 应急节奏阀，消耗属性保证不沉淀循环。体修基础能力 = 「多获得一张肾上腺素」
// （起始组共两张，见 routes.js 的 body 路线）；本卡仍可经通用注入抽到（pack: 'common'）。
function adrenalineCard({ id, tier, draw, promotesTo = null }) {
  registerSkill({
    id, name: '肾上腺素', type: 'normal', pack: 'common', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      sctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }));
      drawCards(sctx, draw);
      return true;
    },
    describe: () => `获得1行动点，抽${draw}牌`,
  });
}
adrenalineCard({ id: 'adrenalineB', tier: 'B', draw: 2, promotesTo: 'adrenalineA' });
adrenalineCard({ id: 'adrenalineA', tier: 'A', draw: 3 });

// 情况不对（起始套牌泛用保险，等阶记 C）：固有消耗卡——弃全手牌抽等量，
// 鬼抽时的整体重调。「迷你」词条（计 0 张手牌）让这张保险「起手抽到 = 不鬼抽」，
// 确定性兜底。
// 激活的咏唱卡豁免（与 P9 尾弃同一豁免口径——付费点亮的咏唱不被保险卡掐灭），
// 只弃非激活的手牌。固有保证起手必然上手（详见 namedTerms「固有」）；
// 不入奖励池：系统级保险卡，定位同衍生牌（瞬击），重复获取会稀释其「起手必有」的确定性。
registerSkill({
  id: 'badOmen', image: 'badOmen', name: '情况不对', type: 'normal', tier: 'C',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust', 'innate', 'mini'],
  canSpawnAsReward: false,
  use(sctx) {
    // 自身已在结算区（pending），手中即其余卡：弃掉非激活咏唱的全部，抽等量
    const hand = [...sctx.battleState.zones.hand].filter(c => !c.isActivated);
    for (const c of hand) {
      sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: c.uniqueID }));
    }
    drawCards(sctx, hand.length);
    return true;
  },
  describe: () => '弃其余手牌（激活的咏唱卡除外），抽等量卡',
  battleDescribe: () => '弃其余手牌（激活的咏唱卡除外），抽等量卡',
});

// ==== 体修起始卡组（BODY_CULTIVATION_CARDS §0：从基础卡「拳/盾」生长）====
// 拳（C）×5 + 盾（C）×4 + 格挡（C）×1 + 肾上腺素 ×1 + 情况不对 ×1（情况不对仅一张，
// 双份组合逆天；迷你词条保留——计 0 张手牌，抽到不卡手）
//（肾上腺素 ×2 ——第二张由体修基础能力追加，见 routes.js）
// 肾上腺素做节奏阀、情况不对做鬼抽保险。
// 斩不在初始卡组：由开局遗物「大剑」（默认装备、0 槽）在每场战斗开始时洗入 1 张斩
// ——卸下大剑 = 自选不带斩进战。见 relics.js / RELICS.md。
export const BODY_STARTER_DECK = Object.freeze([
  'punch', 'punch', 'punch', 'punch', 'punch',
  'shieldC', 'shieldC', 'shieldC', 'shieldC',
  'blockC',
  'adrenalineB',
  'badOmen',
]);
