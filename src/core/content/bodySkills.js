// 体修·拳组合（BODY_CULTIVATION_CARDS §1：过牌体系）。
// 刀组合见 bladeSkills.js、拆组合见 blockSkills.js——三子体系分文件维护。
// 设计约定：
//   * 体修卡全走 AP（无魏启），type 'normal'（体修灰卡面）；
//   * 伤害统一走「基数 + 攻击面板 + power」语言（cardKit.attackAmount / attackDamage）；
//   * 设计稿费用栏留空的卡按 battle.md 费用缺省约定免费（0 费）；
//   * 【后手】= 手牌最后的非激活卡打出（激活咏唱驻手不挡，2026-09-13 用户定），
//     判定统一走 cardKit.isLastHandCardAtPlay；
//   * 【先手】= 本回合打出的第一张牌（敏捷连击系判据），判定统一走 cardKit.isFirstPlayThisTurn；
//   * 咏唱触发效果 = activated.subscriptions 订阅 ChantTriggerInstruction(post)（P5 挂载点）。

import { registerSkill } from '../skills/registry.js';
import { zoneOf } from '../state/battleState.js';
import { UseSkillInstruction, SkillCooldownInstruction } from '../instructions/skill.js';
import { ConsumeActionPointsInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { DrawCardsInstruction, DiscardCardInstruction } from '../instructions/cards.js';
import { DealDamageInstruction, previewDamage } from '../instructions/combat.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { effectiveHandCount } from '../skills/helpers.js';
import {
  attackAmount, attackDamage, resolvedDamageText, enemyTarget,
  dealDamage, drawCards, drawToHandLimit, addCard, randomAliveEnemy,
  isLastHandCardAtPlay, isFirstPlayThisTurn,
} from './cardKit.js';

// ==== 1. 真拳系列（基石：纯伤害直线升级，A 阶跃迁为无任何资源消耗）====
// 拳 D（6 伤）在 skills.js，是全系列链首；此处补 C/B/A 三阶。
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

// 快拳（真拳系列 C）：1AP 9 伤。
registerPureFist({
  id: 'fastPunch', name: '快拳', tier: 'C', damage: 9,
  cost: { mana: 0, actionPoint: 1 }, promotesTo: 'cannonFist',
});

// 炮拳（真拳系列 B）：1AP 12 伤。
registerPureFist({
  id: 'cannonFist', name: '炮拳', tier: 'B', damage: 12,
  cost: { mana: 0, actionPoint: 1 }, promotesTo: 'trueFist',
});

// 真拳（真拳系列 A）：0费0AP 15 伤——设计稿明示「无任何资源消耗的伤害卡」，
// 是全库少见的白嫖伤害位（强度由等阶门槛把关）。
registerPureFist({
  id: 'trueFist', name: '真拳', tier: 'A', damage: 15,
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
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new SkillCooldownInstruction({ skill: sctx.self, delta: 1 }), instr),
    }],
    describe: () => `${damage}伤害；在手时每打出1牌冷却1`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}；在手时每打出1牌冷却1`,
  });
}

// 猛拳（崩拳系列 C）
registerCollapseFist({ id: 'fierceFist', name: '猛拳', tier: 'C', damage: 14, promotesTo: 'boomFist' });
// 轰拳（崩拳系列 B）
registerCollapseFist({ id: 'boomFist', name: '轰拳', tier: 'B', damage: 24, promotesTo: 'collapseFist' });
// 崩拳（崩拳系列 A）
registerCollapseFist({ id: 'collapseFist', name: '崩拳', tier: 'A', damage: 36 });

// ==== 3. 敏捷连击系列（先手抽牌：本回合第一张打出 = 领跑奖励）====
// 2026-09-13 改版：判据从「最左端打出」改为【先手】——最左端被抽牌顺序与激活咏唱驻左
// 卡死（玩家不可控），先手是时序判据完全可控；且每回合天然限触发一次（第一张只有一张），
// 数值因此不动。咏唱发动也是一次打出、会抢先手位 = 真实顺序抉择。

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
    battleDescribe: (sctx) => (isFirstPlayThisTurn(sctx)
      ? `${resolvedDamageText(sctx, damage)}，抽${draw}牌`
      : resolvedDamageText(sctx, damage)),
  });
}

// 敏捷连击（D）——8 起步（2026-09-14 用户定正常 D 伤害底线）
registerAgileCombo({ id: 'agileCombo', name: '敏捷连击', tier: 'D', damage: 8, draw: 1, promotesTo: 'rapidCombo' });
// 疾速连击（C）
registerAgileCombo({ id: 'rapidCombo', name: '疾速连击', tier: 'C', damage: 8, draw: 2, promotesTo: 'stormCombo' });
// 暴风连击（B）
registerAgileCombo({ id: 'stormCombo', name: '暴风连击', tier: 'B', damage: 11, draw: 3 });

// ==== 4. 虚形拳系列（后手：清手奖励——最后一张打出时质变）====
// 两条分叉线：伤害线（仿形→豹形→虎形→空形）与抽牌线（蛇形→龙形→虚形）。

// 常规档：基础 7 伤；后手 +bonus 且抽 draw 张（结算读 isLastHandCardAtPlay 出牌时点口径）
function registerShadowFist({ id, name, tier, bonus, draw = 0, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const last = isLastHandCardAtPlay(sctx);
      attackDamage(sctx, last ? 7 + bonus : 7);
      if (last && draw > 0) drawCards(sctx, draw);
      return true;
    },
    describe: () => `7伤害；/named{后手}：+${bonus}${draw > 0 ? `，抽${draw}` : ''}`,
    battleDescribe: (sctx) => (isLastHandCardAtPlay(sctx)
      ? `${resolvedDamageText(sctx, 7 + bonus)}${draw > 0 ? `，抽${draw}牌` : ''}`
      : resolvedDamageText(sctx, 7)),
  });
}

// 仿形拳（C）：链首——晋升在此分叉（用户定 2026-09-13：升级必须提升等阶，
// C→B 的两个同族成员都是合法方向；抉择走升级子面板，随机升级随机取）
registerShadowFist({ id: 'mimicFist', name: '仿形拳', tier: 'C', bonus: 7, promotesTo: ['leopardFist', 'snakeFist'] });
// 豹形拳（B）：伤害线
registerShadowFist({ id: 'leopardFist', name: '豹形拳', tier: 'B', bonus: 15, promotesTo: 'tigerFist' });
// 蛇形拳（B）：抽牌分叉线（可由仿形拳晋升分岔而来，也可奖励直取）
registerShadowFist({ id: 'snakeFist', name: '蛇形拳', tier: 'B', bonus: 7, draw: 2, promotesTo: 'dragonFist' });
// 虎形拳（A）：伤害线
registerShadowFist({ id: 'tigerFist', name: '虎形拳', tier: 'A', bonus: 27 });
// 龙形拳（A）：抽牌线
registerShadowFist({ id: 'dragonFist', name: '龙形拳', tier: 'A', bonus: 7, draw: 4 });

// 虚形拳（S，抽牌线顶点）：无基础伤害——后手：抽满手牌（drawToHandLimit 按加权口径补差）。
// S 为阶梯外等阶，不设 promotesTo。
registerSkill({
  id: 'voidFist', name: '虚形拳', type: 'normal', tier: 'S', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    if (isLastHandCardAtPlay(sctx)) drawToHandLimit(sctx);
    return true;
  },
  describe: () => '/named{后手}：抽满手牌',
  battleDescribe: (sctx) => (isLastHandCardAtPlay(sctx) ? '抽满手牌' : '无效果'),
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
  battleDescribe: (sctx) => (isLastHandCardAtPlay(sctx) ? resolvedDamageText(sctx, 55) : '无效果'),
});

// ==== 5. 蓄力系列（向牌库注入价值：瞬击 = 0 费即抛型过牌弹药）====

// 洗入档（D/C/B）：向牌库随机位插入 count 张「瞬击」。
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

// 蓄力（D）
registerChargeShuffle({ id: 'chargeUp', name: '蓄力', tier: 'D', count: 2, promotesTo: 'comboStrike' });
// 连击（C）
registerChargeShuffle({ id: 'comboStrike', name: '连击', tier: 'C', count: 3, promotesTo: 'quadrupleHit' });
// 四重击（B）
registerChargeShuffle({ id: 'quadrupleHit', name: '四重击', tier: 'B', count: 4, promotesTo: 'instantThousand' });

// 无限连击（A）：1AP 消耗 + 咏唱3（2026-09-13 权重分档：少量强卡 3-4 咏）——
// 发动后驻手，每次咏唱触发洗入 4 张瞬击（常驻引擎）；再次打出免费解除，因消耗焚毁离场。
// 高咏唱值即代价：激活后手牌抽取明显受限，引擎与手牌压力对赌。
registerSkill({
  id: 'endlessCombo', name: '无限连击', type: 'normal', tier: 'A', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  keywords: ['exhaust'],
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: () => {
        for (let i = 0; i < 4; i++) addCard(sctx, 'instantStrike', { index: 'random' });
      },
    }],
  },
  describe: () => '/named{洗入4}/card{instantStrike}',
  battleDescribe: (sctx) => '/named{洗入4}/card{instantStrike}',
});

// 一瞬千击（A）：1AP 消耗——发现 5 张瞬击（直接进手牌；满手按 §7.3 溢入牌库）。
registerSkill({
  id: 'instantThousand', name: '一瞬千击', type: 'normal', tier: 'A', series: 'fist',
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

// 瞬击（蓄力系列衍生牌）：0 费即抛——7 伤 + 抽 1，打出即焚毁。
// 只经造牌指令入场，不入奖励池。
registerSkill({
  id: 'instantStrike', name: '瞬击', type: 'normal', tier: 'D', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 7);
    drawCards(sctx, 1);
    return true;
  },
  describe: () => '7伤害，抽1牌',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 7)}，抽1牌`,
});

// ==== 6. 肘击系列（朴素P5 节拍伤害，牢大做乘区）====

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

// 肘击/猛烈肘击：咏唱1（轻压力），每次咏唱触发（每回合 P5）造成 damage 伤。
// 伤害打 tags:['elbow']——牢大以此识别「肘击卡伤害」。
// ap/spawnable 可覆写：`fierceElbowFree`（HeLiCoPtEr 变换出来的 0 费形态）用 0 费 +
// 不进奖励池（只经局内转化获得，同碎铁口径）。
function registerElbow({ id, name, tier, damage, promotesTo = null, ap = 1, spawnable = true }) {
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
        },
      }],
    },
    describe: () => `随机${damage}伤害`,
    battleDescribe: (sctx) => `随机${elbowDamageText(sctx, damage)}`,
  });
}

// 肘击（D）
registerElbow({ id: 'elbowStrike', name: '肘击', tier: 'D', damage: 4, promotesTo: 'fierceElbow' });
// 猛烈肘击（C）
registerElbow({ id: 'fierceElbow', name: '猛烈肘击', tier: 'C', damage: 5 });
// 猛烈肘击·0 费形态（2026-09-12）：HeLiCoPtEr（COMMON_CARDS「将所有手牌变换为0开销猛烈肘击」）
// 的变换目标——同名同形态、只是免费（0AP），且**只经局内转化获得**（不进奖励池/不进抽选）。
registerElbow({ id: 'fierceElbowFree', name: '猛烈肘击', tier: 'C', damage: 5, ap: 0, spawnable: false });

// 牢大（B）：咏唱1——你的肘击卡伤害翻倍。设计稿费用栏留空 → 费用缺省约定 0 费
// （代价全部押在咏唱手牌压力与构建上）。实现：PRE 修饰 tags 含 elbow 的伤害 payload。
registerSkill({
  id: 'elbowMaster', name: '牢大', type: 'normal', tier: 'B', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: DealDamageInstruction, phase: 'pre',
      filter: (instr) => instr.tags?.includes('elbow') === true && !instr.fixed
        && instr.type === 'major',
      react: (instr) => instr.setPayload('damage', instr.payload.damage * 2),
    }],
  },
  describe: () => '你的肘击卡伤害翻倍',
  battleDescribe: (sctx) => '你的肘击卡伤害翻倍',
});

// ==== 7. 太极系列（打出牌数 → 抽牌，跨回合计数）====
// 计数器放 skillRuntime（chantCount，plain data 可序列化），跨回合累积不清零；
// 自身发动/解除不计入（filter 按 uniqueID 排除）。

// weight 全链统一 3（2026-09-13 用户定：升级链路上咏唱压力应一致或减少，否则升级会变成
// 负面事件；太极作为 A 阶跨回合抽牌引擎是超模卡，3 也是尊重到位）。
function registerPlayCountChant({ id, name, tier, every, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 3,
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

// 借力（C）——第 7 轮裁决：每 6→5 张抽 1（权重 3 的代价下每 6 张抽 1 纯亏，无人点亮）
registerPlayCountChant({ id: 'leverage', name: '借力', tier: 'C', every: 5, promotesTo: 'redirect' });
// 化劲（B）
registerPlayCountChant({ id: 'redirect', name: '化劲', tier: 'B', every: 4, promotesTo: 'taiji' });
// 太极（A）——第 8 轮裁决（用户 2026-09-13 定调）：进阶链区分点 = **触发频次阶梯 5/4/3**。
// 此前太极与化劲同 every 4、同工厂同参，A 阶身份零兑现（R8-E 代码级实锤，且太极与自家
// 化劲互斥一次都没点亮）；every 3 后按 E 的账：好回合（5 出牌）净 −0.33（带共鸣石）、
// 爆发回合（7 出牌）转正 +2.33——真正的 A 阶跨回合抽牌引擎。weight 全链统一 3 不动
//（升级链咏唱压力一致是上一条用户定调，两条定调正交）。
registerPlayCountChant({ id: 'taiji', name: '太极', tier: 'A', every: 3 });

// ==== 8. 武学系列（抽牌 → 伤害，与太极互为引擎）====
// 每抽 1 张牌（一切抽牌来源：回合开始/技能/造牌连锁）对随机敌人 damage 伤，
// 每张独立随机选靶（多敌时伤害散步）；无存活敌人（战斗收尾）静默落空。

function registerDrawDamageChant({ id, name, tier, damage, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: DrawCardsInstruction, phase: 'post',
        react: (instr) => {
          for (let i = 0; i < (instr.result?.drawn?.length ?? 0); i++) {
            const target = randomAliveEnemy(sctx);
            if (!target) break; // 敌已死光（收尾期）：伤害落空
            // 附级伤害（2026-09-15 用户定）：被动触发的抽卡伤害不是攻击——不吃任何
            // 加成（武术姿态×精通=一回合上百爆炸伤的病灶）、不上燃、不触发受击响应。
            dealDamage(sctx, attackAmount(sctx, damage), { target, type: 'minor' });
          }
        },
      }],
    },
    describe: () => `每抽1牌，随机${damage}伤害`,
    battleDescribe: (sctx) => `每抽1牌，随机${resolvedDamageText(sctx, damage)}`,
  });
}

// 入门（C）
registerDrawDamageChant({ id: 'novice', name: '入门', tier: 'C', damage: 2, promotesTo: 'adept' });
// 精通（B）
registerDrawDamageChant({ id: 'adept', name: '精通', tier: 'B', damage: 4, promotesTo: 'peerless' });
// 无双（A）
registerDrawDamageChant({ id: 'peerless', name: '无双', tier: 'A', damage: 6 });

// ==== 9. 深入卡（需精英能力「拳师」）====

// 万变拳（B）：1AP 冷却2——下张打出的牌 AP 费用为 0。
// 实现：打出时注册 once PRE 订阅，把下一次「卡牌打出树内」的 AP 消耗指令 payload 置 0。
// filter 校验结算栈中存在 UseSkillInstruction：只对打出的卡生效，弃牌动作
// （DumpCardsInstruction 树）不吃这份免费；打出 0AP 卡不产生消耗指令，免费保留至
// 下一张有费用的卡（宽容口径）。
registerSkill({
  id: 'wildFist', name: '万变拳', type: 'normal', tier: 'B', series: 'fist', deep: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 2 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.addSubscription({
      when: ConsumeActionPointsInstruction, phase: 'pre', window: 'once',
      filter: (_instr, ctx) => ctx.kernel.stack.some(i => i instanceof UseSkillInstruction),
      react: (instr) => instr.setPayload('amount', 0),
    });
    return true;
  },
  describe: () => '下张打出的牌AP费用为0',
});

// 假动作系列（D→C→B，2026-09 稿：消耗，未写费用 → 0费）——抽 2/3/4 牌，
// 洗入 2 「虚无」（升阶只涨抽牌数，噪音量不变）。
// 过牌换稀释：短期手牌质量提升，牌库被虚无污染（虚无 0 费打出即焚，白吃一手节奏）。
const feintCard = ({ id, tier, draw, promotesTo }) => registerSkill({
  id, name: '假动作', type: 'normal', tier, series: 'fist', deep: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    drawCards(sctx, draw);
    for (let i = 0; i < 2; i++) addCard(sctx, 'voidCard', { index: 'random' });
    return true;
  },
  describe: () => `抽${draw}牌，/named{洗入}2/card{voidCard}`,
});
feintCard({ id: 'feint', tier: 'D', draw: 2, promotesTo: 'feintPlus' });
feintCard({ id: 'feintPlus', tier: 'C', draw: 3, promotesTo: 'feintMaster' });
feintCard({ id: 'feintMaster', tier: 'B', draw: 4 });

// 虚无（假动作衍生牌）：0 费无效果消耗牌——纯粹的牌库噪音，只经造牌入场。
registerSkill({
  id: 'voidCard', name: '虚无', type: 'normal', tier: 'D', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use() { return true; },
  describe: () => '无效果',
});

// ==== 10. 扩容批（2026-09-14 用户审查定稿：「D-C 扩容 + D 卡全部接链」）====
// 五个新维度补拳组合的机制空白，全部用体修现有语言（过牌/先手后手/瞬击/咏唱/打出计数）：
//   * 卖血爆发（狂拳链，设计稿欠账实装）——HP 一次性代价换高伤+抽牌；
//   * 多段连击（乱拳链）——「连击」主题终于有 ×N 段，吃快如雨/拳师/灼类「每段触发」；
//   * 群伤 AOE（重踏链）——拳组合此前零 AOE（武学只是随机散步）；
//   * 瞬击下游（拳压，拳师深入卡）——蓄力系造的瞬击终于有「吃瞬击」的加成件；
//   * 弃牌引擎（混元，设计稿欠账实装）——弃牌语言（呼吸/假动作/以无胜有）的消费端。
// 数值对标：无条件部分 = 同阶白板（乱拳 6=拳、密雨 9=快拳、千手 12=炮拳），
// 多段/条件加成才是体系溢价。失去生命 = 无来源固定伤害（跳修正、护盾可吸收、
// 不触发荆棘/忍耐类反制——纯代价语义）。

// 群伤原语（bodyAoe）与扫腿链已于 2026-09-14 迁入拆组合（blockSkills.js，series 'block'）
// ——扫腿线重做为多敌防卡后归属拆；群伤原语上移 cardKit.aoeAttack 共用。

// 狂拳 D → 血怒 C → 亡命 B（卖血链）
function wildPunchCard({ id, name, tier, damage, lifeLoss, draw, promotesTo = null }) {
  registerSkill({
    id, name, type: 'normal', tier, series: 'fist',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      attackDamage(sctx, damage);
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: sctx.player, amount: lifeLoss, fixed: true, tags: ['selfcost'],
      }));
      if (draw > 0) drawCards(sctx, draw);
      return true;
    },
    describe: () => `${damage}伤害，失去${lifeLoss}生命${draw ? `，抽${draw}` : ''}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，失去${lifeLoss}生命${draw ? `，抽${draw}` : ''}`,
  });
}
wildPunchCard({ id: 'wildPunch', name: '狂拳', tier: 'D', damage: 12, lifeLoss: 3, promotesTo: 'bloodRage' });
wildPunchCard({ id: 'bloodRage', name: '血怒', tier: 'C', damage: 15, lifeLoss: 5, draw: 1, promotesTo: 'lastGasp' });
wildPunchCard({ id: 'lastGasp', name: '亡命', tier: 'B', damage: 20, lifeLoss: 7, draw: 2 });

// 乱拳 D → 密雨拳 C → 千手 B（多段链：每段独立结算、独立吃减伤门与触发面。
// D 段伤 4 对齐「正常 D 伤害 8 起步」（2026-09-14 用户定底线）；C/B 总伤钉白板 9/12）
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
flurryCard({ id: 'wildFlurry', name: '乱拳', tier: 'D', damage: 4, hits: 2, promotesTo: 'rainFist' });
flurryCard({ id: 'rainFist', name: '密雨拳', tier: 'C', hits: 3, promotesTo: 'thousandHands' });
flurryCard({ id: 'thousandHands', name: '千手', tier: 'B', hits: 4 });

// 拳压 C→B（拳师深入卡，瞬击下游）：1AP 9/11 伤；本回合每打出过 1 张瞬击，伤害 +3/+4
// （基础值对齐 快拳9/炮拳12 白板口径，瞬击引擎是溢价来源——无引擎时近白板，故收进
// 深入门禁：拳师到手前不进任何奖励池。瞬击计数读 history.turn.playedCards 明细）。
const fistPressCard = ({ id, tier, damage, per, promotesTo = null }) => registerSkill({
  id, name: '拳压', type: 'normal', tier, series: 'fist', deep: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, damage + instantStrikesThisTurn(sctx) * per);
    return true;
  },
  describe: () => `${damage}伤害；本回合每打出过1/card{instantStrike}，伤害+${per}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage + instantStrikesThisTurn(sctx) * per)}`
    + `（${damage}+${instantStrikesThisTurn(sctx) * per}）`,
});
fistPressCard({ id: 'fistPress', tier: 'C', damage: 9, per: 3, promotesTo: 'fistPressPlus' });
fistPressCard({ id: 'fistPressPlus', tier: 'B', damage: 11, per: 4 });
function instantStrikesThisTurn(sctx) {
  return sctx.battleState.history.turn.playedCards.filter(id => id === 'instantStrike').length;
}

// 拆招 D（低手牌过牌）：0费 冷却1——抽 1；打出后手牌只剩 2 张或更少时再抽 1
// （后手场景的资源件——清手流的续航，与虚形拳同一时序语言）。
registerSkill({
  id: 'counterDraw', name: '拆招', type: 'normal', tier: 'D', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'rapidCombo',
  use(sctx) {
    drawCards(sctx, 1);
    if (sctx.battleState.zones.hand.length <= 2) drawCards(sctx, 1);
    return true;
  },
  describe: () => '抽1牌；若手牌只剩2张或更少，再抽1',
  battleDescribe: (sctx) => `抽1牌（当前手牌${sctx.battleState.zones.hand.length}张）`,
});

// 蓄满 C（手牌条件攻击）：1AP 9伤；加权手牌不少于 5 张时 +5
// （基础 = 快拳白板；「手多势众」的条件溢价——囤牌流的输出位，与以有胜无同口径）。
registerSkill({
  id: 'fullCharge', name: '蓄满', type: 'normal', tier: 'C', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo: 'cannonFist',
  use(sctx) {
    attackDamage(sctx, effectiveHandCount(sctx) >= 5 ? 14 : 9);
    return true;
  },
  describe: () => '9伤害；若你的手牌不少于5张，+5',
  battleDescribe: (sctx) => resolvedDamageText(sctx, effectiveHandCount(sctx) >= 5 ? 14 : 9),
});

// 混元 C（弃牌引擎，设计稿欠账实装）：1AP 咏唱3——每弃 3 张牌，抽 1 张
// （太极「每打 5 抽 1」的弃牌镜像；弃牌语言在体修三子系都有：假动作/呼吸/以无胜有）。
// 计数挂 skillRuntime（跨回合累积，plain data 可序列化）。
registerSkill({
  id: 'hunYuan', name: '混元', type: 'normal', tier: 'C', series: 'fist',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  promotesTo: 'redirect',
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: DiscardCardInstruction, phase: 'post',
      react: (instr, ctx) => {
        sctx.self.discardCount = (sctx.self.discardCount ?? 0) + 1;
        if (sctx.self.discardCount % 3 === 0) {
          ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }), instr);
        }
      },
    }],
  },
  describe: () => '每弃3张牌，抽1牌',
  battleDescribe: (sctx) => `每弃3张牌，抽1牌（已弃${sctx.self.discardCount ?? 0}）`,
});

// ==== 泛用组件（起始卡组配套，非 §1 系列）====

// 肾上腺素（体修套牌 C，2026-09-13 稿）：0 开销消耗卡——获得 1AP 并抽 **2** 牌（原抽 1）。
// 应急节奏阀，消耗属性保证不沉淀循环（打出即焚，套牌越打越薄）。
// **兼列通用卡**（`pack: 'common'`，见 COMMON_CARDS.md）：体修基础能力白送 1 张（在起始卡组里），
// 之后可经通用注入再抽到——基础能力「获得1张额外肾上腺素」里的"额外"指的就是这张。
registerSkill({
  id: 'adrenaline', name: '肾上腺素', type: 'normal', pack: 'common', tier: 'C', series: 'fist',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }));
    drawCards(sctx, 2);
    return true;
  },
  describe: () => '获得1行动点，抽2牌',
});

// 情况不对（起始套牌泛用保险 D）：固有消耗卡——弃全手牌抽等量，鬼抽时的整体重调。
// 2026-09-13 用户定：激活的咏唱卡豁免（与 P9 尾弃同一豁免口径——付费点亮的咏唱不被
// 保险卡掐灭），只弃非激活的手牌。固有保证起手必然上手（详见 namedTerms「固有」）；
// 不入奖励池：系统级保险卡，定位同衍生牌（瞬击），重复获取会稀释其「起手必有」的确定性。
registerSkill({
  id: 'badOmen', name: '情况不对', type: 'normal', tier: 'D',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust', 'innate'],
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
// 拳（真拳系列 D，skills.js）×3 + 盾（盾系列 D，skills.js）×3 + 抱头（格挡系列 D，
// blockSkills.js）×1 + 肾上腺素（C）×1 + 情况不对（D）×1：三系种子齐备
// （拳的出牌、盾的自保、拆的格挡），肾上腺素做节奏阀、情况不对做鬼抽保险。
export const BODY_STARTER_DECK = Object.freeze([
  'punch', 'punch', 'punch',
  'guard', 'guard', 'guard',
  'duckHead',
  'adrenaline',
  'badOmen',
  'slash', // 斩链起点（2026-09）：开局自带进阶引擎，靠局内打出逐阶生长
]);
