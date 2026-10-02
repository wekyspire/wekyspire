// 体修·刀组合（BODY_CULTIVATION_CARDS §2：卡序体系）。
// 体系哲学：全游戏最高单发伤害，代价是手牌与牌库都是棋盘。
//   斩系列 —— 局内进阶链（打出即转化升阶；只在牌库中冷却；不可被焚毁；链首慢热）；
//   花刀   —— 弃牌换护盾（选牌弃 / 弃掉所有无法打出的手牌）；
//   回旋斩 —— 牌库末抽牌（与牌库顶抽牌形成规划语言）；
//   横劈   —— 真群伤（刀组的群伤答案：纯伤害无附加，数字带体系溢价）；
//   飞刀   —— 邻牌献祭（两侧语义统一读「打出那一刻」，helpers.handNeighborsAtPlay）；
//   藏锋   —— 高伤换滞气（stall：无法抽牌）；
//   呼吸   —— 弃牌回补（同名效果承担弃牌监听 + 回合末自清，见 content/effects.js）；
//   培植/开刃（深入卡磨刀系）—— 以 runtime.power / SkillCooldownInstruction 表达的养刀轴；
//   刀法咏唱 —— 抽弃循环的持续引擎。
// 通用约定（与 bodySkills/blockSkills 一致）：
//   * 体修卡全走 AP（无魏启）、type 'normal'（体修灰卡面）、series 'blade'；
//   * 刀法牌 keywords 含 'blade'（cardKit.isBladeCard 判定——培植/开刃/磨刀系的作用域；
//     培植/咏唱等辅件卡不是刀法，不带该关键词）；
//   * 伤害统一「基数 + 攻击面板 + power」（cardKit.attackDamage，battle.md F1）；
//   * 无冷却 = { max: Infinity, cooldownTurns: 0 }；冷却N = { max: 1, cooldownTurns: N }。
// 注：刀背打击系列（knifeBack/knifeBackHeavy）已从新设计稿移除，不再实现。
// 新稿不再提「衰败」（在手反向冷却），斩系列的苛刻收窄为「只在牌库中冷却」一点。

import { registerSkill, getSkillDefinition } from '../skills/registry.js';
import { zoneOf } from '../state/battleState.js';
import { canUseSkill, handNeighborsAtPlay, handIndexAtPlay } from '../skills/helpers.js';
import BattleInstruction from '../kernel/BattleInstruction.js';
import AwaitPlayerInputInstruction from '../instructions/input.js';
import {
  SkillCooldownInstruction, ActivateSkillInstruction, UseSkillInstruction,
} from '../instructions/skill.js';
import {
  DrawCardsInstruction, DiscardCardInstruction, BurnCardInstruction, MoveCardInstruction,
  TransformCardInstruction,
} from '../instructions/cards.js';
import { DealDamageInstruction } from '../instructions/combat.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import {
  attackDamage, resolvedDamageText, gainShield, addEffect, gainPower, aoeAttackProbes,
  damageLandedCount,
  drawCards, addCard, discardCard, burnCard, moveCardTo,
  leaveHandAtTurnEnd, requestHandSelection, requestDeckSelection,
  buildCardSelectionRequest, selected, isBladeCard,
} from './cardKit.js';

// ==== 共享小工具 ===============================================================

// 「无法打出的手牌」（花刀/优雅刀舞的作用域）：canUseSkill 全量口径——
// 费用/充能冷却/咏唱规则/各卡自定义条件一并算入（与拆组【完美】判定同源）。
// 恒排除自身：预览态（battleDescribe）自身尚在手，结算中自身已离手（pending）。
function stuckHandCards(sctx) {
  return sctx.battleState.zones.hand.filter(
    c => c.uniqueID !== sctx.self.uniqueID && !canUseSkill(sctx, c));
}

// 咏唱触发段的「抽N → 选N弃」链（刀法/刃心）。订阅触发里无法走技能 use 多阶段
// （test/asyncInput.test.js 反制架势同范式：输入指令子类化挂后续动作）：
// 段 0 抽牌（子节点），段 1 按抽牌后的手牌请求选牌（WAIT 挂在子输入指令上），
// 应答后在自身子节点逐张提交弃牌。
class ChantDrawDiscardInstruction extends BattleInstruction {
  constructor({ count = 1, reason = null } = {}, opts = {}) {
    super(opts);
    this.count = count;
    this.reason = reason;
  }

  execute(ctx) {
    switch (this._stage) {
      case 0:
        ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: this.count }), this);
        return false;
      case 1: {
        // 选牌请求走 cardKit 的**唯一形状**（min/max + picker 规则）：多选自动进覆盖层卡阵，
        // 不再手搓 { count } 旧口径（前端只认旧字段的那套交互已删，见 cardKit 注释）。
        const request = buildCardSelectionRequest(ctx, {
          source: 'hand', min: this.count, max: this.count, reason: this.reason,
        });
        if (!request) {
          this.result = { discarded: [] };   // 空手（牌库也抽空）：无事发生
          return true;
        }
        this._ask = new AwaitPlayerInputInstruction({ request });
        ctx.kernel.submitInstruction(this._ask, this);
        return false;
      }
      default: {
        const ids = this._ask.result?.selection ?? [];
        for (const id of ids) {
          ctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: id }), this);
        }
        this.result = { discarded: ids };
        return true;
      }
    }
  }
}

// ==== 斩进阶（开刃系列共用）====================================================

// 斩链（局内进阶链，全链同一张卡经转化逐阶生长）：等阶按设计稿标注
//（斩 C、裂石 B；分海/断神取 A/S，Z 是诅咒不作攻击阶）。
// slow：链首「斩」带慢热（keywords 'slowStart'——开局从头冷却）；
// 进阶卡只经局内转化获得，转化继承充能状态，无需重复慢热。
const SLASH_CHAIN = [
  { id: 'slash', name: '斩', tier: 'C', damage: 17, cd: 3 },
  { id: 'rockCleave', name: '裂石斩', tier: 'B', damage: 30, cd: 4 },
  { id: 'goldCleave', name: '削金斩', tier: 'B', damage: 57, cd: 5 },
  { id: 'mountainCleave', name: '摧山斩', tier: 'A', damage: 108, cd: 6 },
  { id: 'seaCleave', name: '分海斩', tier: 'A', damage: 205, cd: 7 },
  { id: 'skyCleave', name: '开天斩', tier: 'S', damage: 390, cd: 8 },
  { id: 'godCleave', name: '断神斩', tier: 'X', damage: 9999, cd: 9, overwriteDesc: '斩' },
];
const SLASH_IDS = new Set(SLASH_CHAIN.map(x => x.id));

function isSlashCard(card) {
  return SLASH_IDS.has(card.defId);
}

// 找到手中/牌库中的第一张斩链卡（手中优先——进阶看得见；pending 是结算中的它自己，
// 由打出路径自行处理）。找不到返回 null。
function findSlashCard(sctx) {
  const zones = sctx.battleState.zones;
  for (const zoneName of ['hand', 'deck']) {
    const card = zones[zoneName].find(isSlashCard);
    if (card) return card;
  }
  return null;
}

// 斩链单卡进阶：把指定斩链卡转化到下一阶（TransformCardInstruction：身份/区域/
// 位置/power 延续）。充能延续修正：battle.md 转化只承诺身份/区域/位置/威力延续
// （充能按新 def 重置），而斩链的冷却节奏是核心机制——转化前已耗尽的卡，转化后
// 必须仍是「耗尽、按新阶冷却」，否则打出进阶/出鞘进阶都会白送一轮满充能，cd 递增
// 的链条设计完全失效；反之链首「斩」带慢热（enterBattle 起手 0 充能），出鞘进阶一张
// **满充能**的斩时不能把慢热重新吃一遍——满充能必须保持满充能。两类修正在转化的
// POST（once 订阅）里做：充能标量是 runtime 数据而非 zone/资源指令域（与 deckCraft
// 开刃原型的直改同范式）。已是链尾返回 false。
function transformSlashCard(sctx, card, parentInstr = null) {
  const def = getSkillDefinition(card.defId);
  if (!def.battlePromotesTo) return false;   // 链尾（断神斩）：已无可进之阶
  const wasExhausted = card.remainingUses <= 0;
  const nextId = def.battlePromotesTo;
  sctx.kernel.addSubscription({
    when: TransformCardInstruction, phase: 'post', window: 'once',
    filter: (instr) => instr.uniqueID === card.uniqueID && instr.result?.toDefId === nextId,
    react: () => {
      const nextDef = getSkillDefinition(card.defId);
      const max = nextDef.charges?.max ?? Infinity;
      if (wasExhausted) {
        card.remainingUses = 0;
        card.currentCooldown = nextDef.charges.cooldownTurns;
      } else {
        card.remainingUses = max;
        card.currentCooldown = 0;
      }
    },
  });
  const transform = new TransformCardInstruction({
    uniqueID: card.uniqueID, toDefId: nextId, keepPower: true,
  });
  // 显式父节点（订阅反应里提交）或当前指令（use 阶段里提交）
  if (parentInstr) sctx.kernel.submitInstruction(transform, parentInstr);
  else sctx.kernel.submitInstruction(transform);
  return true;
}

// 斩进阶（开刃系列入口）：找到手中/牌库中的第一张斩链卡并转化到下一阶。
// 无目标或已是链尾返回 null（无事发生）。
function advanceSlashChain(sctx, parentInstr = null) {
  const card = findSlashCard(sctx);
  if (!card) return null;
  return transformSlashCard(sctx, card, parentInstr) ? card : null;
}

// ==== 斩系列（局内进阶链，全游戏最高单伤）======================================
// 【斩】（NAMED.md）：不可被焚毁（被焚毁时以回牌库取代之）；发动后进阶（转化到链上
//   下一阶，keepPower 延续强化）。冷却 = 全局回合扫掠（P2 每回合 1 拍）+ **斩专属
//   词条特效「此卡入库时冷却」**（cooldownOnEnterDeck：打出回牌库底 / 弃回 /
//   焚毁 veto 回库，每次入库额外推进 1 拍）。磨刀/花刀是手中
//   直达加速手段。洗入2碎铁是链上每阶共有的效果（设计稿单行表述 + 链条只改
//   伤害/冷却/等阶）。
const slashCard = ({ id, name, tier, damage, cd, slow = true, overwriteDesc = null }, nextId) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade', ...(slow ? ['slowStart'] : [])],
  overwriteDesc: overwriteDesc,
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: cd },
  // 斩专属词条特效：每次进入牌库时冷却推进 1 拍（skill.js tickCooldownOnEnterDeck 只认此旗标）
  cooldownOnEnterDeck: true,
  cardMode: 'normal', targetMode: 'enemy',
  // 局内进阶链走 battlePromotesTo（局内转化专用字段）——斩不可局外晋升
  // （营地/训练场的 promoteCard 只认 promotesTo，对斩链天然不可见）
  battlePromotesTo: nextId ?? null,
  // 全链（含链首斩）不进奖励卡包（斩不进构筑位：开局遗物「大剑」在每场战斗开始时
  // 洗入 1 张斩，装卸大剑 = 自选是否带斩进战；进阶卡只经局内转化获得）。
  // canSpawnAsReward 同时被奖励池/种子包/古尔帕斯货架排除
  canSpawnAsReward: false,
  use(sctx) {
    // 先进阶后伤害：进阶是结算内的簿记，放前面保证即便伤害击杀终局截断也已落定。
    // 发动卡自身已离手（pending），findSlashCard 看不见它——自我进阶直接对 self 转化。
    // 伤害归属用打出时点的本阶名（skillDefId 覆写）：变身先落定，self.defId 已是下一阶，
    // 不覆写的话日志会打出「[削金斩] 30伤」这类名数错位（r22-a2 实报）。
    transformSlashCard(sctx, sctx.self);
    attackDamage(sctx, damage, { skillDefId: id });
    for (let i = 0; i < 2; i++) addCard(sctx, 'ironShard', { index: 'random' });
    return true;
  },
  subscriptions: (sctx) => [{
    // 【斩】不可焚毁：PRE 否决焚毁，以「回牌库」取代（veto replacements 插入父节点）；
    // 入库代价 = 没收充能、重新全程冷却；斩的词条特效让 veto 带出的 MoveCard 入库那拍
    // 立即推进 1 拍；冷却中的卡保持原计时（钩子照走那 1 拍）。
    when: BurnCardInstruction, phase: 'pre',
    filter: (instr) => instr.uniqueID === sctx.self.uniqueID,
    react: (instr, ctx) => {
      const def = getSkillDefinition(sctx.self.defId);
      const max = def.charges?.max ?? Infinity;
      if (sctx.self.remainingUses >= max) {
        sctx.self.remainingUses = 0;
        sctx.self.currentCooldown = def.charges?.cooldownTurns ?? 0;
      }
      ctx.kernel.veto(instr, '斩：不可焚毁', [
        new MoveCardInstruction({ uniqueID: sctx.self.uniqueID, toZone: 'deck' }),
      ]);
    },
  }],
  describe: () => overwriteDesc || `${damage}伤害，/named{洗入2}/card{ironShard}${slow ? '，/named{慢热}' : ''}，/named{斩}`,
  battleDescribe: (sctx) => overwriteDesc || `${resolvedDamageText(sctx, damage)}，/named{洗入2}/card{ironShard}${slow ? '，/named{慢热}' : ''}，/named{斩}`,
});
for (let i = 0; i < SLASH_CHAIN.length; i++) {
  slashCard(SLASH_CHAIN[i], SLASH_CHAIN[i + 1]?.id);
}

// 碎铁（斩系列衍生牌，消耗）：5伤害，灵活：抽2。
// 仍是刀法牌：判据走 series 'blade'（cardKit.isBladeCard），keywords 不带 'blade'
// （页脚不多一个词条）。只经 AddCard 入场，不入奖励池。
// 【灵活】= 卡级常驻订阅（AddCard 入场随 enterBattle 注册）：弃牌 POST 认
// result.card（落空的弃牌不计，呼吸同款口径）。
registerSkill({
  id: 'ironShard', name: '碎铁', type: 'normal', tier: 'C', series: 'blade',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 5);
    return true;
  },
  subscriptions: (sctx) => [{
    when: DiscardCardInstruction, phase: 'post',
    filter: (instr) => instr.result?.card?.uniqueID === sctx.self.uniqueID,
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new DrawCardsInstruction({ count: 2 }), instr),
  }],
  describe: () => '5伤害，/named{灵活}：抽2',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 5)}，/named{灵活}：抽2`,
});

// ==== 花刀系列（弃牌换护盾）====================================================

// 选牌弃：护盾 + 选 K 张手牌丢弃（结算期选牌：段0请求，段1读应答弃牌）。
// 自身已离手（pending），选牌候选即其余手牌；空手则跳过请求。
// 仍是刀法牌（blade 关键词）——练刀/培植/磨刀系的作用域不变。
// 阶梯：花刀 C 8选1 → 花刀 B 11选1 → 蔽目花刀 A 14选1；
// 完美花刀（A，11盾选2）是分叉散卡不进链。
const cleaveCard = (id, name, tier, shield, picks, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx, stage) {
    if (stage === 0) {
      gainShield(sctx, shield);
      const hand = sctx.battleState.zones.hand;
      if (hand.length === 0) return true;   // 无牌可选：直接收尾
      sctx.self._pick = requestHandSelection(sctx, {
        count: Math.min(picks, hand.length),
        reason: `${name}：选${picks}张手牌丢弃`,
      });
      return false;
    }
    const ids = selected(sctx.self._pick);
    sctx.self._pick = null;
    for (const uniqueID of ids) discardCard(sctx, uniqueID);
    return true;
  },
  describe: () => `${shield}护盾，选${picks}张手牌丢弃`,
  battleDescribe: (sctx) => `${shield}护盾，选${picks}张手牌丢弃`,
});
cleaveCard('flourishC', '花刀', 'C', 8, 1, 'flourishB');
cleaveCard('flourishB', '花刀', 'B', 11, 1, 'veilCleave');   // id 沿用原二重花刀位
cleaveCard('veilCleave', '蔽目花刀', 'A', 14, 1);
cleaveCard('perfectCleave', '完美花刀', 'A', 11, 2);            // 分叉散卡：选 2 弃

// 刀舞系列：丢弃所有手牌，每张 N 护盾（快照打出时点的手牌；弃牌联动的抽牌不进范围）。
const danceCard = (id, name, tier, per, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    // 快照手牌（自身已离手在 pending；弃牌联动的抽牌不进范围——打出时点口径）
    for (const card of [...sctx.battleState.zones.hand]) {
      discardCard(sctx, card.uniqueID);
      gainShield(sctx, per);
    }
    return true;
  },
  describe: () => `丢弃所有手牌，每张${per}护盾`,
  battleDescribe: (sctx) => {
    const n = sctx.battleState.zones.hand.length;
    return `丢弃所有手牌${n > 0 ? `（当前${n}张）` : ''}，每张${per}护盾`;
  },
});
danceCard('bladeDanceC', '刀舞', 'C', 5, 'bladeDanceB');
danceCard('bladeDanceB', '刀舞', 'B', 7, 'bladeDanceA');
danceCard('bladeDanceA', '刀舞', 'A', 9);

// 优雅刀舞（分支 A）：只弃「无法打出的」手牌，每张 10 护盾。
registerSkill({
  id: 'graceDance', name: '优雅刀舞', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (const card of stuckHandCards(sctx)) {
      discardCard(sctx, card.uniqueID);
      gainShield(sctx, 10);
    }
    return true;
  },
  describe: () => '丢弃所有无法打出的手牌，每张10护盾',
  battleDescribe: (sctx) => {
    const n = stuckHandCards(sctx).length;
    return `丢弃所有无法打出的手牌${n > 0 ? `（当前${n}张）` : ''}，每张10护盾`;
  },
});

// ==== 回旋斩系列（牌库末）======================================================
// 牌库末抽牌（from:'bottom'）：与牌库顶抽牌形成一对规划语言——牌库两头都是取牌口。
const cycloneCard = (id, name, tier, damage, count, cd, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: cd === 0 ? { max: Infinity, cooldownTurns: 0 } : { max: 1, cooldownTurns: cd },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, damage);
    drawCards(sctx, count, { from: 'bottom' });
    return true;
  },
  describe: () => `${damage}伤害，从牌库末抽${count}牌`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，从牌库末抽${count}牌`,
});
cycloneCard('cycloneSlashC', '回旋斩', 'C', 10, 1, 1, 'cycloneSlashB');
cycloneCard('cycloneSlashB', '回旋斩', 'B', 12, 1, 1, 'cycloneSlashA');
cycloneCard('cycloneSlashA', '回旋斩', 'A', 14, 1, 0);   // 机制跃迁：无冷却

// ==== 横劈系列（真群伤）========================================================
// 刀组的群伤答案：「命中：洗入碎铁」补碎铁经济（AOE 每命中 1 敌人洗入 1 碎铁——
// 「每命中1敌人」与扫腿同口径，读 aoeAttack 命中数）。冷却1 是刀组攻击卡的常规节拍，
// 全链吃养刀/锻刀/练刀/刀圣的刀法加成。
// 阶梯：横劈 C 7 / 强力劈 B 10 / 裂空劈 A 13（带碎铁联动）。
// ⚠ id 不得撞斩链（S「开天斩」skyCleave——裂空劈不得复用该 id，否则静默覆盖）。
const horizontalCleave = (id, name, tier, damage, shards = 0, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._hitProbes = aoeAttackProbes(sctx, damage);
      return shards > 0 ? false : true; // 有碎铁联动才需挂起一拍读命中数
    }
    const landed = damageLandedCount(sctx.self._hitProbes);
    sctx.self._hitProbes = null;
    for (let i = 0; i < shards * landed; i++) addCard(sctx, 'ironShard', { index: 'random' });
    return true;
  },
  describe: () => `群伤${damage}${shards > 0 ? `，/named{命中}：/named{洗入}/card{ironShard}` : ''}`,
  battleDescribe: (sctx) => `群伤${resolvedDamageText(sctx, damage).replace('伤害', '')}`
    + (shards > 0 ? `，/named{命中}：/named{洗入}/card{ironShard}` : ''),
});
horizontalCleave('cleave', '横劈', 'C', 7, 1, 'powerCleave');
horizontalCleave('powerCleave', '强力劈', 'B', 10, 1, 'riftCleave');
horizontalCleave('riftCleave', '裂空劈', 'A', 13, 1);

// ==== 飞刀系列（邻牌献祭）======================================================
// 两侧语义统一读「打出那一刻」（handNeighborsAtPlay：结算中自身已离手，按捕获手位
// 换算 left=hand[i-1]、right=hand[i]；canUse 预览态回落实时邻位）。

// 【顽固：两侧有牌】判定
function bothSidesPresent(sctx) {
  const { left, right } = handNeighborsAtPlay(sctx);
  return Boolean(left && right);
}

// 弃两侧基型（飞刀链 C/B/A）：伤害 + 丢弃两侧牌。
const sideDaggerCard = (id, name, tier, damage, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  canUse: bothSidesPresent,
  use(sctx) {
    attackDamage(sctx, damage);
    const { left, right } = handNeighborsAtPlay(sctx);
    if (left) discardCard(sctx, left.uniqueID);
    if (right) discardCard(sctx, right.uniqueID);
    return true;
  },
  describe: () => `${damage}伤害，弃两侧牌；/named{顽固}：两侧有牌`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，弃两侧牌；/named{顽固}：两侧有牌`,
});
sideDaggerCard('flyingDaggerC', '飞刀', 'C', 13, 'flyingDaggerB');
sideDaggerCard('flyingDaggerB', '飞刀', 'B', 17, 'flyingDaggerA');
sideDaggerCard('flyingDaggerA', '飞刀', 'A', 21);

// 回旋飞刀（B，设计稿未写费用 → 0费，冷却1）：13伤害，弃两侧牌，抽2牌插回两侧原位。
// 两侧槽位按打出时点手位 i 计算（左=i-1、右=i）；原本无牌的一侧不凭空造位，
// 对应抽到的牌留手牌末尾。
registerSkill({
  id: 'returningDagger', name: '回旋飞刀', type: 'normal', tier: 'B', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx, stage) {
    if (stage === 0) {
      attackDamage(sctx, 13);
      const { left, right } = handNeighborsAtPlay(sctx);
      if (left) discardCard(sctx, left.uniqueID);
      if (right) discardCard(sctx, right.uniqueID);
      sctx.self._hadSides = { left: Boolean(left), right: Boolean(right) };
      sctx.self._draw = new DrawCardsInstruction({ count: 2 });
      sctx.kernel.submitInstruction(sctx.self._draw);
      return false;
    }
    // 抽牌已落地：把抽到的牌插回两侧原位
    const drawn = sctx.self._draw?.result?.drawn ?? []; // 抽牌可能被否决（滞气等）→ 结果为空
    sctx.self._draw = null;
    const { left: hadLeft, right: hadRight } = sctx.self._hadSides;
    sctx.self._hadSides = null;
    const i = handIndexAtPlay(sctx);
    const slots = [];
    if (hadLeft) slots.push(i - 1);
    if (hadRight) slots.push(i);
    drawn.forEach((card, k) => {
      if (slots[k] != null) moveCardTo(sctx, card.uniqueID, 'hand', slots[k]);
    });
    return true;
  },
  describe: () => '13伤害，弃两侧牌，抽2牌插入两侧',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 13)}，弃两侧牌，抽2牌插入两侧`,
});

// 精致飞刀（B，设计稿未写费用/冷却 → 0费无冷却）：15伤害，仅弃左侧（单侧轻量位）。
registerSkill({
  id: 'fineDagger', name: '精致飞刀', type: 'normal', tier: 'B', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 15);
    const { left } = handNeighborsAtPlay(sctx);
    if (left) discardCard(sctx, left.uniqueID);
    return true;
  },
  describe: () => '15伤害，弃左侧牌',
  battleDescribe: (sctx) => resolvedDamageText(sctx, 15),
});

// 绝灭飞刀（A，设计稿未写费用/冷却 → 0费无冷却）：17伤害，焚毁两侧牌，
// 寻找2牌插入两侧（结算期牌库选牌：段0焚两侧+请求，段1插回原位）。
// 空牌库时寻找落空，不产生输入请求。
registerSkill({
  id: 'perfectDagger', name: '绝灭飞刀', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx, stage) {
    if (stage === 0) {
      attackDamage(sctx, 17);
      const { left, right } = handNeighborsAtPlay(sctx);
      if (left) burnCard(sctx, left.uniqueID);
      if (right) burnCard(sctx, right.uniqueID);
      sctx.self._hadSides = { left: Boolean(left), right: Boolean(right) };
      if (sctx.battleState.zones.deck.length === 0) {
        sctx.self._hadSides = null;
        return true;   // 空牌库：寻找无事发生
      }
      sctx.self._find = requestDeckSelection(sctx, {
        count: Math.min(2, sctx.battleState.zones.deck.length),
        reason: '绝灭飞刀：寻找2牌插入两侧',
      });
      return false;
    }
    const ids = selected(sctx.self._find);
    sctx.self._find = null;
    const { left: hadLeft, right: hadRight } = sctx.self._hadSides;
    sctx.self._hadSides = null;
    const i = handIndexAtPlay(sctx);
    const slots = [];
    if (hadLeft) slots.push(i - 1);
    if (hadRight) slots.push(i);
    ids.forEach((uniqueID, k) => {
      if (slots[k] != null) moveCardTo(sctx, uniqueID, 'hand', slots[k]);
    });
    return true;
  },
  describe: () => '17伤害，/named{焚毁}两侧牌，/named{寻找}2牌插入两侧',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 17)}，/named{焚毁}两侧牌，/named{寻找}2牌插入两侧`,
});

// ==== 藏锋系列（斩杀）==========================================================
// 收刃 C/B/A → 藏锋 S：滞气2 + 高伤，0费无消耗无冷却。
const sheathCard = (id, name, tier, damage, stall, promotesTo = null) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    attackDamage(sctx, damage);
    addEffect(sctx, 'stall', stall);
    return true;
  },
  describe: () => `/effect{滞气}${stall}，${damage}伤害`,
  battleDescribe: (sctx) => `/effect{滞气}${stall}，${resolvedDamageText(sctx, damage)}`,
});
sheathCard('sheatheC', '收刃', 'C', 11, 2, 'sheatheB');
sheathCard('sheatheB', '收刃', 'B', 14, 2, 'sheatheA');
sheathCard('sheatheA', '收刃', 'A', 17, 2, 'concealEdge');
sheathCard('concealEdge', '藏锋', 'S', 27, 2);

// ==== 呼吸系列（弃牌回补）======================================================
// B 消耗 / A 去消耗。打出即获得「呼吸」效果（content/effects.js：弃牌 POST 监听 +
// 回合末自清，生命周期与效果实例绑定）。换牌（R3）内部走弃牌指令，同样计入；
// 打出自身不是弃牌（pending→burnt 的消耗路径）。
const breathCard = (id, name, tier, { exhaust = true, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  ...(exhaust ? { keywords: ['exhaust'] } : {}),
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    addEffect(sctx, 'breath', 1);
    return true;
  },
  describe: () => '本回合每弃1牌：抽1牌',
  battleDescribe: () => '本回合每弃1牌：抽1牌',
});
breathCard('breathB', '呼吸', 'B', { promotesTo: 'breathA' });
breathCard('breathA', '呼吸', 'A', { exhaust: false });

// ==== 归来系列（速冷）==========================================================
// 护盾 + 所有自由手牌（未激活咏唱，背水一战/情况不对同口径）冷却 N。
// S 归来带【迷你】。满充能的卡无处推进，SkillCooldownInstruction 静默落空（磨刀同口径）。
const reminiscenceCard = (id, name, tier, shield, cd, { promotesTo = null, mini = false } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  ...(mini ? { keywords: ['mini'] } : {}),
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    gainShield(sctx, shield);
    for (const card of sctx.battleState.zones.hand) {
      if (card.isActivated) continue;
      sctx.kernel.submitInstruction(new SkillCooldownInstruction({ skill: card, delta: cd }));
    }
    return true;
  },
  describe: () => `${shield}护盾，所有自由手牌冷却${cd}`,
  battleDescribe: (sctx) => {
    const n = sctx.battleState.zones.hand.filter(c => !c.isActivated && c.currentCooldown > 0).length;
    return `${shield}护盾，所有自由手牌冷却${cd}${n > 0 ? `（冷却中${n}张）` : ''}`;
  },
});
reminiscenceCard('reminiscenceC', '怀念', 'C', 10, 2, { promotesTo: 'reminiscenceB' });
reminiscenceCard('reminiscenceB', '怀念', 'B', 13, 2, { promotesTo: 'reminiscenceA' });
reminiscenceCard('reminiscenceA', '怀念', 'A', 16, 3, { promotesTo: 'homecoming' });
reminiscenceCard('homecoming', '归来', 'S', 16, 4, { mini: true });

// ==== 培植系列（养刀，C/B/A 三阶）==============================================
// 数值漂移暂用 runtime.power 表达（SKILL_DESIGN_PRINCIPLES 的 modifier 系统未落地）：
// power 随卡流动、转化 keepPower 延续，是养成轴的近似口径。设计稿未写费用 → 0费。

// 养刀术 C/B/A：咏唱1/1/0。咏唱触发（P5）时**所有刀法牌**（手牌+牌库，与锻刀术同口径）
// 伤害 +2/+3/+3（阶差全在咏唱负担）。
function honeBladeCard({ id, tier, bonus, chantWeight = 1, promotesTo = null }) {
  registerSkill({
    id, name: '养刀术', type: 'normal', tier, series: 'blade',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ChantTriggerInstruction, phase: 'post',
        react: () => {
          for (const zone of ['hand', 'deck']) {
            for (const card of sctx.battleState.zones[zone]) {
              if (card.uniqueID !== sctx.self.uniqueID && isBladeCard(card)) gainPower(sctx, card, bonus);
            }
          }
        },
      }],
    },
    describe: () => `触发时所有刀法牌伤害+${bonus}`,
    battleDescribe: () => `触发时所有刀法牌伤害+${bonus}`,
  });
}
honeBladeCard({ id: 'honeBladeC', tier: 'C', bonus: 2, promotesTo: 'honeBladeB' });
honeBladeCard({ id: 'honeBladeB', tier: 'B', bonus: 3, promotesTo: 'honeBladeA' });
honeBladeCard({ id: 'honeBladeA', tier: 'A', bonus: 3, chantWeight: 0 });

// 锻刀术 C/B/A：咏唱1（C）/ 咏唱0（B 起）。你打出刀法牌时，**所有刀法牌**伤害
// +1/+1/+2（手牌与牌库一起加——口径同开刃；打出的那张已离手不在区内）。
function forgingBladeCard({ id, tier, weight, bonus, promotesTo = null }) {
  registerSkill({
    id, name: '锻刀术', type: 'normal', tier, series: 'blade',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: weight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: UseSkillInstruction, phase: 'post',
        filter: (instr) => instr.skill.uniqueID !== sctx.self.uniqueID && isBladeCard(instr.skill),
        react: () => {
          for (const zone of ['hand', 'deck']) {
            for (const card of sctx.battleState.zones[zone]) {
              if (isBladeCard(card)) gainPower(sctx, card, bonus);
            }
          }
        },
      }],
    },
    describe: () => `你打出刀法牌时，所有刀法牌伤害+${bonus}`,
    battleDescribe: () => `你打出刀法牌时，所有刀法牌伤害+${bonus}`,
  });
}
forgingBladeCard({ id: 'forgingBladeC', tier: 'C', weight: 1, bonus: 1, promotesTo: 'forgingBladeB' });
forgingBladeCard({ id: 'forgingBladeB', tier: 'B', weight: 0, bonus: 1, promotesTo: 'forgingBladeA' });
forgingBladeCard({ id: 'forgingBladeA', tier: 'A', weight: 0, bonus: 2 });

// ==== 开刃系列（斩进阶）========================================================

// 含刃术 C/B/A（0费，咏唱3 全阶同担）：咏唱触发（P5）时若手牌少于 2/3/4（物理张数），
// 斩进阶，此卡焚毁（焚毁先经离手熄灭，激活订阅随 owner 注销）。
// 条件阈值即阶差；C 档「少于 2」是空手搏命位（P5 在回合抽牌**之后**判定，
// 库空抽不上牌时才会命中）。
const edgeBreathCard = ({ id, tier, threshold, promotesTo = null }) => registerSkill({
  id, name: '含刃术', type: 'normal', tier, series: 'blade',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      filter: (instr, ctx) => ctx.battleState.zones.hand.length < threshold,
      react: (instr, ctx) => {
        advanceSlashChain(sctx, instr);
        ctx.kernel.submitInstruction(
          new BurnCardInstruction({ uniqueID: sctx.self.uniqueID }), instr);
      },
    }],
  },
  describe: () => `手牌少于${threshold}时斩进阶，此卡/named{焚毁}`,
  battleDescribe: () => `手牌少于${threshold}时斩进阶，此卡/named{焚毁}`,
});
edgeBreathCard({ id: 'edgeBreathC', tier: 'C', threshold: 2, promotesTo: 'edgeBreathB' });
edgeBreathCard({ id: 'edgeBreathB', tier: 'B', threshold: 3, promotesTo: 'edgeBreathA' });
edgeBreathCard({ id: 'edgeBreathA', tier: 'A', threshold: 4 });

// 血激术（C，濒死时斩进阶，此卡焚毁）**暂不实装**——濒死机制未定稿
// （battle.md §12 留白），待设计确认后补回。

// 出鞘（A，设计稿未写费用 → 0费，消耗）：斩进阶，
// /named{抽出}斩（进阶后的斩链卡若在牌库，直接移入手牌——满手按 §7.3 落牌库；
// 斩已因耗尽在冷却时，抽出的是一张「按新阶冷却中」的刀——它只在牌库冷却，手中只能
// 靠磨刀/花刀处理，这是出鞘的时机博弈）。无斩可进则无事发生（抽出亦落空）。
registerSkill({
  id: 'unsheathe', name: '出鞘', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx, stage) {
    if (stage === 0) {
      const card = advanceSlashChain(sctx);
      if (!card) return true;
      return false;   // 转化在子节点完成后，下一阶段再抽出
    }
    const card = findSlashCard(sctx);
    if (card && zoneOf(sctx.battleState, card.uniqueID) === 'deck') {
      moveCardTo(sctx, card.uniqueID, 'hand');
    }
    return true;
  },
  describe: () => '斩进阶，/named{抽出}斩',
  battleDescribe: (sctx) => `斩进阶，/named{抽出}斩（牌库中${findSlashCard(sctx) ? '有' : '无'}斩）`,
});

// ==== 深入卡（磨刀系：手中刀的冷却管理，需精英能力「刀客」）=====================
// 手中刀法牌冷却 N：SkillCooldownInstruction 定向直达，不等回合扫掠——刀法体系的
// 手中加速手段；满充能的刀无处推进、静默落空。
// 磨刀 C 带【短暂】（回合结束时仍滞留手牌则回牌库）；B/A 无【短暂】（可过夜）。
const whetCard = (id, name, tier, delta, { promotesTo = null, transient = false } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade', deep: 'blade',
  ...(transient ? { keywords: ['transient'] } : {}),
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo,
  ...(transient ? { subscriptions: (sctx) => [leaveHandAtTurnEnd(sctx)] } : {}),
  use(sctx) {
    for (const card of sctx.battleState.zones.hand) {
      if (isBladeCard(card)) {
        sctx.kernel.submitInstruction(new SkillCooldownInstruction({ skill: card, delta }));
      }
    }
    return true;
  },
  describe: () => `手中刀法牌冷却${delta}`,
  battleDescribe: (sctx) => {
    const cooling = sctx.battleState.zones.hand.filter(
      c => c.uniqueID !== sctx.self.uniqueID && isBladeCard(c) && c.currentCooldown > 0);
    return `手中刀法牌冷却${delta}${cooling.length > 0 ? `（冷却中${cooling.length}张）` : ''}`;
  },
});
whetCard('sharpenC', '磨刀', 'C', 2, { promotesTo: 'sharpenB', transient: true });
whetCard('sharpenB', '磨刀', 'B', 2, { promotesTo: 'sharpenA' });
whetCard('sharpenA', '磨刀', 'A', 3);

// 开刃（A，设计稿未写费用 → 0费，消耗）：所有刀法牌即刻冷却——手牌与牌库中
// 的刀充能回满、计时清零（焚毁区的刀已离场不在范围）。deckCraft.test.js 的原型
// 只作用于手牌，此处按设计稿字面「所有」扩到牌库。直改充能标量与原型同范式。
registerSkill({
  id: 'honeEdge', name: '开刃', type: 'normal', tier: 'A', series: 'blade', deep: 'blade',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    for (const zoneName of ['hand', 'deck']) {
      for (const card of sctx.battleState.zones[zoneName]) {
        if (!isBladeCard(card)) continue;
        card.currentCooldown = 0;
        card.remainingUses = getSkillDefinition(card.defId).charges?.max ?? card.remainingUses;
      }
    }
    return true;
  },
  describe: () => '所有刀法牌即刻冷却',
  battleDescribe: () => '所有刀法牌即刻冷却',
});

// 斩灭 A/S（全链 1AP，S 档不消耗）：下一次刀法牌伤害翻倍，不可叠加。
// 挂起标记 bladeDoubleArmed（battleState）承载不可叠加；once 窗口 PRE 订阅把
// 「下一次玩家来源的、发生在刀法牌结算内」的伤害 payload 翻倍。刀法牌归属判定走
// 内核栈回溯（DFS 路径上的 ActivateSkillInstruction 是否为刀法卡）。
function annihilatingEdgeCard({ id, tier, ap, exhaust, promotesTo = null }) {
  registerSkill({
    id, name: '斩灭', type: 'normal', tier, series: 'blade', deep: 'blade',
    ...(exhaust ? { keywords: ['exhaust'] } : {}),
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      if (sctx.battleState.bladeDoubleArmed) return true;   // 不可叠加：已挂起则空转
      sctx.battleState.bladeDoubleArmed = true;
      sctx.kernel.addSubscription({
        when: DealDamageInstruction, phase: 'pre', window: 'once',
        filter: (instr, ctx) => instr.source === ctx.player && !instr.fixed
          && instr.type === 'major'
          && ctx.kernel.stack.some(
            i => i instanceof ActivateSkillInstruction && isBladeCard(i.skill)),
        react: (instr, ctx) => {
          instr.setPayload('damage', instr.payload.damage * 2);
          ctx.battleState.bladeDoubleArmed = false;
        },
      });
      return true;
    },
    describe: () => '下一次刀法牌伤害翻倍，不可叠加',
    battleDescribe: () => '你的下一次刀法牌伤害翻倍，不可叠加',
  });
}
annihilatingEdgeCard({ id: 'annihilatingEdgeA', tier: 'A', ap: 1, exhaust: true, promotesTo: 'annihilatingEdgeS' });
annihilatingEdgeCard({ id: 'annihilatingEdgeS', tier: 'S', ap: 1, exhaust: false });

// 练刀 C/B/A：抽2/2/3，**将手中所有刀法牌洗回牌库底**，并令它们**本战斗中**伤害 +3/+4/+5。费用 1AP（B 起 0AP），无冷却。
// 「本战斗中」= runtime.power（跨 zone 持续、战斗结束随 runtime 一起丢弃），
// 洗回走 FIFO 回牌库底——下回合抽回来仍是强化过的刀，这是主要的正反馈环。
// 卡面写「洗回牌库底」而非「弃掉」：回库正是本卡的收益环（P0 实锤：读「弃掉」以为永久失去，
// 把主力斩当废牌丢了两次，R8-A）。
// 无可用性门槛（卡面没写/named{顽固} 就不得暗设条件）：抽完手中无刀时纯白板收场。
const practiceBladeCard = (id, tier, ap, power, draw, { promotesTo = null } = {}) => registerSkill({
  id, name: '练刀', type: 'normal', tier, series: 'blade', deep: 'blade',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  promotesTo,
  use(sctx, stage) {
    if (stage === 0) {
      drawCards(sctx, draw);                               // 先抽（抽到的刀也在强化范围内）
      return false;                                        // 抽牌落地后再处理刀法牌
    }
    // 快照手牌再逐张处理（弃牌会改动手牌数组，边遍历边弃会错位）
    const blades = sctx.battleState.zones.hand.filter(isBladeCard);   // 自身已离手
    for (const blade of blades) {
      gainPower(sctx, blade, power);
      discardCard(sctx, blade.uniqueID);
    }
    return true;
  },
  // 卡面写「洗回牌库底」而非「弃掉」——回库正是本卡的收益环（P0 实锤：读「弃掉」
  // 以为永久失去，把主力斩当废牌丢了两次，R8-A）。动词与本卡语义对齐，不依赖术语表。
  describe: () => `抽${draw}，将手中所有/named{刀法牌}洗回牌库底，令其本战斗伤害+${power}`,
  battleDescribe: () => `抽${draw}，将手中所有/named{刀法牌}洗回牌库底，令其本战斗伤害+${power}`,
});
practiceBladeCard('practiceBladeC', 'C', 1, 3, 2, { promotesTo: 'practiceBladeB' });
practiceBladeCard('practiceBladeB', 'B', 0, 4, 2, { promotesTo: 'practiceBladeA' });
practiceBladeCard('practiceBladeA', 'A', 0, 5, 3);

// ==== 咏唱（刀法/刃心：抽弃循环引擎）===========================================
// 咏唱1，P5 ：抽 N 牌，选 N 张手牌丢弃（结算期选牌经
// ChantDrawDiscardInstruction 链式挂在触发指令树下）。设计稿未写费用——刀法 B 按
// 表头 1AP；刃心是深入分支、同样按 1AP 落地。
const bladeArtCard = (id, name, tier, n) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new ChantDrawDiscardInstruction({ count: n, reason: `${name}：选${n}张手牌丢弃` }), instr),
    }],
  },
  describe: () => `抽${n}牌，选${n}张手牌丢弃`,
  battleDescribe: (sctx) => `抽${n}牌，选${n}张手牌丢弃`,
});
bladeArtCard('bladeArt', '刀法', 'B', 1);
bladeArtCard('bladeHeart', '刃心', 'A', 2);

// ==== 散卡 =====================================================================

// 快速花刀 C/B/A（1AP/0AP/0AP）：6护盾，/named{换牌}所有无法打出的手牌，A 档再抽 1。
// 换牌 = 弃牌（手→牌库底）+ 抽 1 补位（走指令，呼吸等弃牌联动照常触发）；
// 「原地」按原手位把抽到的牌插回（升序插回精确复原原次序）。满手/空库时
// 抽牌按 DrawCards 管线自然截断，换几张补几张。无卡手牌时护盾照发、换牌空转。
const swapCleaveCard = (id, name, tier, ap, { promotesTo = null, draw = 0 } = {}) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx, stage) {
    if (stage === 0) {
      gainShield(sctx, 6);
      const hand = sctx.battleState.zones.hand;
      const stuck = stuckHandCards(sctx);
      if (stuck.length === 0) {
        if (draw > 0) drawCards(sctx, draw);
        return true;
      }
      sctx.self._swapSlots = stuck.map(c => ({
        uniqueID: c.uniqueID,
        index: hand.findIndex(h => h.uniqueID === c.uniqueID),
      }));
      for (const slot of sctx.self._swapSlots) {
        sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: slot.uniqueID }));
      }
      sctx.self._swapDraw = new DrawCardsInstruction({ count: sctx.self._swapSlots.length, reason: 'swap' });
      sctx.kernel.submitInstruction(sctx.self._swapDraw);
      return false;
    }
    // 抽牌落地：把抽到的牌按原手位升序插回（精确复原换牌前的手牌次序）
    const drawn = sctx.self._swapDraw?.result?.drawn ?? []; // 同上：被「滞气」否决时无结果
    const slots = sctx.self._swapSlots;
    sctx.self._swapDraw = null;
    sctx.self._swapSlots = null;
    drawn.forEach((card, k) => {
      if (slots[k] != null) {
        moveCardTo(sctx, card.uniqueID, 'hand', Math.min(slots[k].index, sctx.battleState.zones.hand.length));
      }
    });
    if (draw > 0) drawCards(sctx, draw); // A 档尾抽：换牌结算完再补 1（不参与插回）
    return true;
  },
  describe: () => `6护盾，/named{换牌}所有无法打出的手牌${draw > 0 ? '，抽1' : ''}`,
  battleDescribe: (sctx) => {
    const n = stuckHandCards(sctx).length;
    return `6护盾，/named{换牌}所有无法打出的手牌${n > 0 ? `（当前${n}张）` : ''}${draw > 0 ? '，抽1' : ''}`;
  },
});
swapCleaveCard('quickCleaveC', '快速花刀', 'C', 1, { promotesTo: 'quickCleaveB' });
swapCleaveCard('quickCleaveB', '快速花刀', 'B', 0, { promotesTo: 'quickCleaveA' });
swapCleaveCard('quickCleaveA', '快速花刀', 'A', 0, { draw: 1 });

// 铁雨 B/A（消耗，B 档；设计稿未写费用 → 0费；深入卡，归刀客门禁；A 档去除消耗词条）：
// **打出所有碎铁**（手牌+牌库——只打包手中碎铁零增量，碎铁 0 费自带抽 1；把斩链
// 洗进牌库的碎铁全部拉出来打，才是真正的碎铁爆发件）。
// 口径：逐张**嵌套出牌**（UseSkillInstruction —— skill.js 头注声明的能力：技能逻辑直接提交，
// 不经 playerUseSkill 的可用性检查；碎铁 0 费，无需 costOverride；其 moveCard 不要求来源
// 是手牌，牌库碎铁直接进结算）。先快照（手牌+牌库）再逐张打：打出的会离手/离库，
// 边遍历边打会错位；碎铁自带抽 1 翻上来的新碎铁不在快照内、不打（快照口径同 pending 惯例）。
const ironRainCard = (id, tier, { promotesTo = null, exhaust = true } = {}) => registerSkill({
  id, name: '铁雨', type: 'normal', tier, series: 'blade', deep: 'blade',
  ...(exhaust ? { keywords: ['exhaust'] } : {}),
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    const bs = sctx.battleState;
    const shards = [
      ...bs.zones.hand.filter(c => c.defId === 'ironShard'),
      ...bs.zones.deck.filter(c => c.defId === 'ironShard'),
    ];
    for (const shard of shards) {
      sctx.kernel.submitInstruction(new UseSkillInstruction({ skill: shard }));
    }
    return true;
  },
  describe: () => `打出所有/card{ironShard}（含牌库）${exhaust ? '' : '；可反复打出'}`,
  battleDescribe: (sctx) => {
    const bs = sctx.battleState;
    const n = [...bs.zones.hand, ...bs.zones.deck].filter(c => c.defId === 'ironShard').length;
    return `打出所有/card{ironShard}（含牌库，共${n}张）`;
  },
});
ironRainCard('ironRainB', 'B', { promotesTo: 'ironRainA' });
ironRainCard('ironRainA', 'A', { exhaust: false });

// 快速横刀 C/B/A（消耗，设计稿未写费用 → 0费；6/9/12 护盾）：/named{抽出}斩。
// 斩系列的前排防御位搭档：护盾的同时把牌库里的斩链卡拽上手（无斩则抽不出，
// 护盾照发——与出鞘的「无斩无事发生」同口径）。
const quickDrawShieldCard = (id, name, tier, shield, promotesTo) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    gainShield(sctx, shield);
    const card = findSlashCard(sctx);
    if (card && zoneOf(sctx.battleState, card.uniqueID) === 'deck') {
      moveCardTo(sctx, card.uniqueID, 'hand');
    }
    return true;
  },
  describe: () => `${shield}护盾，/named{抽出}/card{slash}`,
  battleDescribe: (sctx) => `${shield}护盾，/named{抽出}/card{slash}（牌库中${findSlashCard(sctx) ? '有' : '无'}）`,
});
quickDrawShieldCard('quickCrossC', '快速横刀', 'C', 6, 'quickCrossB');
quickDrawShieldCard('quickCrossB', '快速横刀', 'B', 9, 'quickCrossA');
quickDrawShieldCard('quickCrossA', '快速横刀', 'A', 12);
