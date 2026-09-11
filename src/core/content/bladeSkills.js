// 体修·刀组合（BODY_CULTIVATION_CARDS §2：卡序体系）。
// 体系哲学：全游戏最高单发伤害，代价是手牌与牌库都是棋盘。
//   斩系列 —— 局内进阶链（打出即转化升阶；只在牌库中冷却；不可被焚毁；链首慢热）；
//   花刀   —— 弃牌换护盾（选牌弃 / 弃掉所有无法打出的手牌，2026-09 稿改防御）；
//   回旋斩 —— 牌库末抽牌（与牌库顶抽牌形成规划语言）；
//   飞刀   —— 邻牌献祭（两侧语义统一读「打出那一刻」，helpers.handNeighborsAtPlay）；
//   藏锋   —— 高伤换滞气（stall：无法抽牌）；
//   呼吸   —— 弃牌回补（同名效果承担弃牌监听 + 回合末自清，见 content/effects.js）；
//   培植/开刃（深入卡砺刀系）—— 以 runtime.power / SkillCooldownInstruction 表达的养刀轴；
//   刀法咏唱 —— 抽弃循环的持续引擎。
// 通用约定（与 bodySkills/blockSkills 一致）：
//   * 体修卡全走 AP（无魏启）、type 'normal'（体修灰卡面）、series 'blade'；
//   * 刀法牌 keywords 含 'blade'（cardKit.isBladeCard 判定——培植/开刃/砺刀系的作用域；
//     培植/咏唱等辅件卡不是刀法，不带该关键词）；
//   * 伤害统一「基数 + 攻击面板 + power」（cardKit.attackDamage，battle.md F1）；
//   * 设计稿未写费用的卡按 battle.md 缺省约定视为 0 费（出鞘/砺刀系/回旋飞刀/精致飞刀/
//     完美飞刀/培植咏唱——各自注册处注明）；
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
import { ChantTriggerInstruction, PlayerTurnEndInstruction } from '../instructions/turn.js';
import {
  attackDamage, resolvedDamageText, gainShield, gainBlock, addEffect,
  drawCards, addCard, discardCard, burnCard, moveCardTo,
  returnToDeckAtTurnEnd, requestHandSelection, requestDeckSelection, selected, isBladeCard,
} from './cardKit.js';

// ==== 共享小工具 ===============================================================

// 「无法打出的手牌」（花刀/优雅刀舞的作用域）：canUseSkill 全量口径——
// 费用/充能冷却/咏唱规则/各卡自定义条件一并算入（与拆组【完美】判定同源）。
// 恒排除自身：预览态（battleDescribe）自身尚在手，结算中自身已离手（pending）。
function stuckHandCards(sctx) {
  return sctx.battleState.zones.hand.filter(
    c => c.uniqueID !== sctx.self.uniqueID && !canUseSkill(sctx, c));
}

// 【短暂】非消耗形态：回合结束时若仍滞留手牌，回到牌库（打出走 FIFO 回库底，
// 抽到不打出也不许"攥着过夜"——砺刀/磨锋/展锐用）。消耗+短暂的「焚毁后回库」
// 走 cardKit.returnToDeckAtTurnEnd（开刃/斩灭/呼吸用）。
function leaveHandAtTurnEnd(sctx) {
  const uniqueID = sctx.self.uniqueID;
  return {
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, uniqueID) === 'hand',
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new MoveCardInstruction({ uniqueID, toZone: 'deck' }), instr),
  };
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
        const hand = ctx.battleState.zones.hand;
        if (hand.length === 0) {
          this.result = { discarded: [] };   // 空手（牌库也抽空）：无事发生
          return true;
        }
        this._ask = new AwaitPlayerInputInstruction({
          request: {
            kind: 'selectHandCard', count: Math.min(this.count, hand.length),
            reason: this.reason, candidates: hand.map(c => c.uniqueID),
          },
        });
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

// 斩链（局内进阶链，全链同一张卡经转化逐阶生长）：等阶按设计稿标注——分海斩/断神斩
// 未标注，分别取 A（摧山斩与开天斩之间的阶梯顶）与 S（开天斩之上的特级，Z 是诅咒不作攻击阶）。
// slow：链首「斩」带慢热（keywords 'slowStart'——开局从头冷却，2026-09 设计稿）；
// 进阶卡只经局内转化获得，转化继承充能状态，无需重复慢热。
const SLASH_CHAIN = [
  { id: 'slash', name: '斩', tier: 'D', damage: 16, cd: 2, slow: true },
  { id: 'rockCleave', name: '裂石斩', tier: 'C', damage: 30, cd: 3 },
  { id: 'goldCleave', name: '削金斩', tier: 'B', damage: 57, cd: 4 },
  { id: 'mountainCleave', name: '摧山斩', tier: 'A', damage: 108, cd: 5 },
  { id: 'seaCleave', name: '分海斩', tier: 'A', damage: 205, cd: 6 },
  { id: 'skyCleave', name: '开天斩', tier: 'S', damage: 390, cd: 7 },
  { id: 'godCleave', name: '断神斩', tier: 'S', damage: 741, cd: 8 },
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
// 【斩】（NAMED.md）：不可被焚毁（被焚毁时以回牌库取代之，进入牌库时冷却1）；
// 只在牌库中冷却充能（cooldownZones: ['deck']——手中攥着不回充，砺刀/花刀是唯二
// 的手中处理手段）；发动后进阶（转化到链上下一阶，keepPower 延续强化）。
// 洗入3碎铁是链上每阶共有的效果（设计稿单行表述 + 链条只改伤害/冷却/等阶）。
const slashCard = ({ id, name, tier, damage, cd, slow = false }, nextId) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade', ...(slow ? ['slowStart'] : [])],
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: cd },
  cooldownZones: ['deck'],
  cardMode: 'normal', targetMode: 'enemy',
  // 局内进阶链走 battlePromotesTo（局内转化专用字段）——斩不可局外晋升
  // （营地/训练场的 promoteCard 只认 promotesTo，对斩链天然不可见）
  battlePromotesTo: nextId ?? null,
  // 斩（D）可入池作为链条起点；进阶卡只经局内转化获得，永不洗入奖励卡包
  canSpawnAsReward: tier === 'D',
  use(sctx) {
    // 先进阶后伤害：进阶是结算内的簿记，放前面保证即便伤害击杀终局截断也已落定。
    // 发动卡自身已离手（pending），findSlashCard 看不见它——自我进阶直接对 self 转化。
    transformSlashCard(sctx, sctx.self);
    attackDamage(sctx, damage);
    for (let i = 0; i < 3; i++) addCard(sctx, 'ironShard', { index: 'random' });
    return true;
  },
  subscriptions: (sctx) => [{
    // 【斩】不可焚毁：PRE 否决焚毁，以「回牌库」取代（veto replacements 插入父节点）；
    // 入库代价 = 没收充能并冷却 1（NAMED.md「进入牌库时，冷却1」）。满充能被焚时
    // 计时按 1 重置——enterBattle 对满充能卡也预置 cooldownTurns 计时，那是无意义
    // 残留值；冷却中的卡保持原计时（不低于 1）。
    when: BurnCardInstruction, phase: 'pre',
    filter: (instr) => instr.uniqueID === sctx.self.uniqueID,
    react: (instr, ctx) => {
      const def = getSkillDefinition(sctx.self.defId);
      const max = def.charges?.max ?? Infinity;
      if (sctx.self.remainingUses >= max) {
        sctx.self.remainingUses = 0;
        sctx.self.currentCooldown = 1;
      } else {
        sctx.self.currentCooldown = Math.max(sctx.self.currentCooldown, 1);
      }
      ctx.kernel.veto(instr, '斩：不可焚毁', [
        new MoveCardInstruction({ uniqueID: sctx.self.uniqueID, toZone: 'deck' }),
      ]);
    },
  }],
  describe: () => `${damage}伤害，/named{洗入3}/card{ironShard}${slow ? '，/named{慢热}' : ''}，/named{斩}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，/named{洗入3}/card{ironShard}${slow ? '，/named{慢热}' : ''}，/named{斩}`,
});
for (let i = 0; i < SLASH_CHAIN.length; i++) {
  slashCard(SLASH_CHAIN[i], SLASH_CHAIN[i + 1]?.id);
}

// 碎铁（斩系列衍生牌，D，消耗）：3伤害。斩落下的铁屑而非刀法（培植/砺刀系不作用于
// 它），故不带 blade 关键词；只经 AddCard 入场，不入奖励池。
registerSkill({
  id: 'ironShard', name: '碎铁', type: 'normal', tier: 'D', series: 'blade',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 3);
    return true;
  },
  describe: () => '3伤害',
  battleDescribe: (sctx) => resolvedDamageText(sctx, 3),
});

// ==== 花刀系列（弃牌换护盾，2026-09 设计稿由伤害改防御）======================

// 选牌弃：N 段护盾 + 选 K 张手牌丢弃（结算期选牌：段0请求，段1读应答弃牌）。
// 自身已离手（pending），选牌候选即其余手牌；空手则跳过请求。
// 仍是刀法牌（blade 关键词）——练刀/培植/砺刀系的作用域不变。
const cleaveCard = (id, name, tier, shield, hits, picks) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx, stage) {
    if (stage === 0) {
      for (let i = 0; i < hits; i++) gainShield(sctx, shield);
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
  describe: () => `${shield}护盾${hits > 1 ? `×${hits}` : ''}，选${picks}张手牌丢弃`,
  battleDescribe: (sctx) => `${shield}护盾${hits > 1 ? `×${hits}` : ''}，选${picks}张手牌丢弃`,
});
cleaveCard('handCleave', '花刀', 'C', 8, 1, 1);
cleaveCard('doubleCleave', '二重花刀', 'C', 8, 2, 2);
cleaveCard('perfectCleave', '完美花刀', 'B', 14, 1, 1);

// 乱舞（银刀/风暴）：丢弃所有无法打出的手牌，每张 N 护盾。快照打出那一刻的卡手牌
// （弃牌触发的呼吸抽牌不会中途扩大范围）。
const danceCard = (id, name, tier, per) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    for (const card of stuckHandCards(sctx)) {
      discardCard(sctx, card.uniqueID);
      gainShield(sctx, per);
    }
    return true;
  },
  describe: () => `丢弃所有无法打出的手牌，每张${per}护盾`,
  battleDescribe: (sctx) => {
    const n = stuckHandCards(sctx).length;
    return `丢弃所有无法打出的手牌${n > 0 ? `（当前${n}张）` : ''}，每张${per}护盾`;
  },
});
danceCard('silverDance', '银刀乱舞', 'B', 8);
danceCard('stormDance', '风暴刀舞', 'A', 13);

// 优雅刀舞（B）：丢弃所有无法打出的手牌，每张获得 1 层格挡（伤害换防御的分叉位）。
registerSkill({
  id: 'graceDance', name: '优雅刀舞', type: 'normal', tier: 'B', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    for (const card of stuckHandCards(sctx)) {
      discardCard(sctx, card.uniqueID);
      gainBlock(sctx, 1);
    }
    return true;
  },
  describe: () => '丢弃所有无法打出的手牌，每张/effect{格挡}1',
  battleDescribe: (sctx) => {
    const n = stuckHandCards(sctx).length;
    return `丢弃所有无法打出的手牌${n > 0 ? `（当前${n}张）` : ''}，每张/effect{格挡}1`;
  },
});

// ==== 回旋斩系列（牌库末）======================================================
// 牌库末抽牌（from:'bottom'）：与牌库顶抽牌形成一对规划语言——牌库两头都是取牌口。
const cycloneCard = (id, name, tier, damage, count, cd) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: cd === 0 ? { max: Infinity, cooldownTurns: 0 } : { max: 1, cooldownTurns: cd },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, damage);
    drawCards(sctx, count, { from: 'bottom' });
    return true;
  },
  describe: () => `${damage}伤害，从牌库末抽${count}牌`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，从牌库末抽${count}牌`,
});
cycloneCard('cycloneSlash', '回旋斩', 'C', 7, 1, 1);
cycloneCard('cycloneBurst', '回旋爆斩', 'B', 11, 3, 1);
cycloneCard('perfectCyclone', '完美回斩', 'A', 15, 2, 0);   // 机制跃迁：无冷却

// ==== 飞刀系列（邻牌献祭）======================================================
// 两侧语义统一读「打出那一刻」（handNeighborsAtPlay：结算中自身已离手，按捕获手位
// 换算 left=hand[i-1]、right=hand[i]；canUse 预览态回落实时邻位）。

// 【顽固：两侧有牌】判定
function bothSidesPresent(sctx) {
  const { left, right } = handNeighborsAtPlay(sctx);
  return Boolean(left && right);
}

// 弃两侧基型（飞刀/强力飞刀/绝灭飞刀）：伤害 + 丢弃两侧牌。
const sideDaggerCard = (id, name, tier, damage) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
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
sideDaggerCard('flyingDagger', '飞刀', 'D', 12);
sideDaggerCard('heavyDagger', '强力飞刀', 'C', 20);
sideDaggerCard('annihilateDagger', '绝灭飞刀', 'A', 32);

// 回旋飞刀（B，设计稿未写费用 → 0费，冷却1）：弃两侧牌，抽2牌插回两侧原位。
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
      attackDamage(sctx, 20);
      const { left, right } = handNeighborsAtPlay(sctx);
      if (left) discardCard(sctx, left.uniqueID);
      if (right) discardCard(sctx, right.uniqueID);
      sctx.self._hadSides = { left: Boolean(left), right: Boolean(right) };
      sctx.self._draw = new DrawCardsInstruction({ count: 2 });
      sctx.kernel.submitInstruction(sctx.self._draw);
      return false;
    }
    // 抽牌已落地：把抽到的牌插回两侧原位
    const drawn = sctx.self._draw.result.drawn;
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
  describe: () => '20伤害，弃两侧牌，抽2牌插入两侧',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 20)}，弃两侧牌，抽2牌插入两侧`,
});

// 精致飞刀（B，设计稿未写费用/冷却 → 0费无冷却）：20伤害，仅弃左侧（单侧轻量位）。
registerSkill({
  id: 'fineDagger', name: '精致飞刀', type: 'normal', tier: 'B', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 20);
    const { left } = handNeighborsAtPlay(sctx);
    if (left) discardCard(sctx, left.uniqueID);
    return true;
  },
  describe: () => '20伤害，弃左侧牌',
  battleDescribe: (sctx) => resolvedDamageText(sctx, 20),
});

// 完美飞刀（A，设计稿未写费用/冷却 → 0费无冷却）：20伤害，焚毁两侧牌，
// 寻找2牌插入两侧（结算期牌库选牌：段0焚两侧+请求，段1插回原位）。
// 空牌库时寻找落空，不产生输入请求。
registerSkill({
  id: 'perfectDagger', name: '完美飞刀', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['blade'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx, stage) {
    if (stage === 0) {
      attackDamage(sctx, 20);
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
        reason: '完美飞刀：寻找2牌插入两侧',
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
  describe: () => '20伤害，/named{焚毁}两侧牌，/named{寻找}2牌插入两侧',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 20)}，/named{焚毁}两侧牌，/named{寻找}2牌插入两侧`,
});

// ==== 藏锋系列（高伤换滞气）====================================================
const sheathCard = (id, name, tier, damage, stall) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['blade', 'exhaust'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, damage);
    addEffect(sctx, 'stall', stall);
    return true;
  },
  describe: () => `${damage}伤害，/effect{滞气}${stall}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}，/effect{滞气}${stall}`,
});
sheathCard('storeEdge', '收刃', 'C', 13, 1);
sheathCard('hiddenEdge', '潜锋', 'B', 23, 2);
sheathCard('sheathEdge', '藏锋', 'A', 48, 3);

// ==== 呼吸系列（弃牌回补）======================================================
// 打出即获得同名「呼吸」效果（content/effects.js：弃牌 POST 监听 + 回合末自清，
// 生命周期与效果实例绑定——被清除时监听器一并拆除）。换牌（R3）内部走弃牌指令，
// 同样计入；打出自身不是弃牌（pending→burnt 的消耗路径）。
const breathCard = (id, name, tier, { effectId, block = 0, strength = 0, fleeting = true }) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: fleeting ? ['exhaust', 'transient'] : ['exhaust'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    if (fleeting) returnToDeckAtTurnEnd(sctx);   // 【短暂】：焚毁后回合结束回牌库
    addEffect(sctx, effectId, 1);
    return true;
  },
  describe: () => '本回合每弃1牌：抽1牌'
    + (block > 0 ? '，格挡1' : '')
    + (strength > 0 ? '，力量1' : ''),
  battleDescribe: () => '本回合每弃1牌：抽1牌'
    + (block > 0 ? '，/effect{格挡}1' : '')
    + (strength > 0 ? '，/effect{力量}1' : ''),
});
breathCard('breath', '呼吸', 'C', { effectId: 'breath' });
breathCard('warriorBreath', '武者呼吸', 'B', { effectId: 'warriorBreath', block: 1, strength: 1 });
breathCard('perfectBreath', '完美呼吸', 'A', { effectId: 'perfectBreath', block: 1, strength: 1, fleeting: false });

// ==== 培植系列（养刀）==========================================================
// 数值漂移暂用 runtime.power 表达（SKILL_DESIGN_PRINCIPLES 的 modifier 系统未落地）：
// power 随卡流动、转化 keepPower 延续，是养成轴的近似口径。设计稿未写费用 → 0费。

// 养刀术（C）：咏唱1。激发（发动点亮）时，手中刀法牌伤害 +2（一次性快照——
// 之后抽到的刀不吃本次加成；onEnable 在卡回手点亮时调用，自身非刀法牌不在候选内）。
registerSkill({
  id: 'honeBlade', name: '养刀术', type: 'normal', tier: 'C', series: 'blade',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    onEnable: (sctx) => {
      for (const card of sctx.battleState.zones.hand) {
        if (card.uniqueID !== sctx.self.uniqueID && isBladeCard(card)) card.power += 2;
      }
    },
  },
  describe: () => '激发时手中刀法牌伤害+2',
  battleDescribe: (sctx) => '激发时手中刀法牌伤害+2',
});

// 锻刀术（C）：咏唱1。你打出刀法牌时，手中刀法牌伤害 +1（激活期间的常驻被动；
// 被打出的那张刀已离手，不在加成范围——"手中刀法牌"按字面口径）。
registerSkill({
  id: 'forgingBlade', name: '锻刀术', type: 'normal', tier: 'C', series: 'blade',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: UseSkillInstruction, phase: 'post',
      filter: (instr) => instr.skill.uniqueID !== sctx.self.uniqueID && isBladeCard(instr.skill),
      react: () => {
        for (const card of sctx.battleState.zones.hand) {
          if (isBladeCard(card)) card.power += 1;
        }
      },
    }],
  },
  describe: () => '你打出刀法牌时，手中刀法牌伤害+1',
  battleDescribe: (sctx) => '你打出刀法牌时，手中刀法牌伤害+1',
});

// ==== 开刃系列（斩进阶）========================================================

// 含刃术（C，0费）：咏唱3。咏唱触发（P5）时若手牌少于 2（物理张数——激活咏唱驻手
// 是物理事实，实际含义即"手里只剩它自己"），斩进阶，此卡焚毁（焚毁先经离手熄灭，
// 激活订阅随 owner 注销）。
registerSkill({
  id: 'edgeBreath', name: '含刃术', type: 'normal', tier: 'C', series: 'blade',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      filter: (instr, ctx) => ctx.battleState.zones.hand.length < 2,
      react: (instr, ctx) => {
        advanceSlashChain(sctx, instr);
        ctx.kernel.submitInstruction(
          new BurnCardInstruction({ uniqueID: sctx.self.uniqueID }), instr);
      },
    }],
  },
  describe: () => '手牌少于2时斩进阶，此卡/named{焚毁}',
  battleDescribe: (sctx) => '手牌少于2时斩进阶，此卡/named{焚毁}',
});

// 血激术（C，濒死时斩进阶，此卡焚毁）**暂不实装**——濒死机制未定稿
// （battle.md §12 留白），待设计确认后补回。

// 出鞘（B，2026-09 设计稿 C→B，设计稿未写费用 → 0费，消耗）：斩进阶，
// /named{抽出}斩（进阶后的斩链卡若在牌库，直接移入手牌——满手按 §7.3 落牌库；
// 斩已因耗尽在冷却时，抽出的是一张「按新阶冷却中」的刀——它只在牌库冷却，手中只能
// 靠砺刀/花刀处理，这是出鞘的时机博弈）。无斩可进则无事发生（抽出亦落空）。
registerSkill({
  id: 'unsheathe', name: '出鞘', type: 'normal', tier: 'B', series: 'blade',
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

// ==== 深入卡（砺刀系：手中刀的冷却管理）========================================
// 手中刀法牌冷却 N：SkillCooldownInstruction 定向推进无视 cooldownZones 区域门——
// 这正是斩系列「只在牌库冷却」的唯一手中补救手段；满充能的刀无处推进、静默落空。
// 【短暂】：回合结束时仍滞留手牌则回牌库（打出走 FIFO 回库，抽到不打也不许过夜）。
const whetCard = (id, name, tier, delta) => registerSkill({
  id, name, type: 'normal', tier, series: 'blade',
  keywords: ['transient'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  subscriptions: (sctx) => [leaveHandAtTurnEnd(sctx)],
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
whetCard('whetstone', '砺刀', 'C', 1);
whetCard('honeEdgeMid', '磨锋', 'B', 2);
whetCard('razorEdge', '展锐', 'A', 3);

// 开刃（A，设计稿未写费用 → 0费，短暂+消耗）：所有刀法牌即刻冷却——手牌与牌库中
// 的刀充能回满、计时清零（焚毁区的刀已离场不在范围）。deckCraft.test.js 的原型
// 只作用于手牌，此处按设计稿字面「所有」扩到牌库。直改充能标量与原型同范式。
registerSkill({
  id: 'honeEdge', name: '开刃', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['exhaust', 'transient'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    returnToDeckAtTurnEnd(sctx);   // 短暂+消耗：焚毁后回合结束回牌库
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
  battleDescribe: () => '/named{短暂}。所有刀法牌即刻冷却',
});

// 斩灭（A，2AP，消耗+短暂）：你的下一次刀法牌伤害变为固定伤害（F2：跳过修正与防御）。
// 近似实现（任务口径）：once PRE 订阅把「下一次玩家来源的、发生在刀法牌结算内」的
// 伤害指令直改 instr.fixed = true（fixed 不在 payload 白名单，走指令字段直改；execute
// 读 this.amount = 构造时的完整值，天然丢弃此前 PRE 修饰——与"跳过修正步"语义一致）。
// 刀法牌归属判定走内核栈回溯（DFS 路径上的 ActivateSkillInstruction 是否为刀法卡）。
// 已知局限：若其他 PRE 订阅在 fixed 置位之后才对同一指令 setPayload 会触发白名单抛错
// （现网内容里格挡减半等订阅注册在前、执行在前，不受影响）——modifier 系统落地时应把
// 「伤害类型改写」收编为正式管线。
registerSkill({
  id: 'annihilatingEdge', name: '斩灭', type: 'normal', tier: 'A', series: 'blade',
  keywords: ['exhaust', 'transient'],
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx) {
    returnToDeckAtTurnEnd(sctx);   // 短暂+消耗：焚毁后回合结束回牌库
    sctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', window: 'once',
      filter: (instr, ctx) => instr.source === ctx.player && !instr.fixed
        && ctx.kernel.stack.some(
          i => i instanceof ActivateSkillInstruction && isBladeCard(i.skill)),
      react: (instr) => { instr.fixed = true; },
    });
    return true;
  },
  describe: () => '你的下一次刀法牌伤害变为固定伤害',
  battleDescribe: () => '/named{短暂}。你的下一次刀法牌伤害变为固定伤害',
});

// 练刀（D，1AP，2026-09 稿：去消耗、先抽1）：抽1，选1张手中刀法牌令其伤害+4，
// 并将其弃入牌库（deckCraft 锻刀原型同构；power 漂移口径同培植系列）。
// 无可用性门槛：卡面没写/named{顽固}就不得暗设条件，否则纯负面卡手——
// 抽1后手中无刀法牌时只当白板抽1收场（不产生选牌请求）。
registerSkill({
  id: 'practiceBlade', name: '练刀', type: 'normal', tier: 'D', series: 'blade',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  use(sctx, stage) {
    if (stage === 0) {
      drawCards(sctx, 1);                                  // 先抽1（无消耗，回牌库循环用）
      return false;                                        // 抽牌落地后再选刀
    }
    if (stage === 1) {
      const blades = sctx.battleState.zones.hand.filter(isBladeCard);   // 自身已离手
      if (blades.length === 0) return true;   // 抽1后仍无刀可练：直接收尾
      sctx.self._pick = requestHandSelection(sctx, {
        count: 1, filter: isBladeCard, reason: '练刀：选1张刀法牌',
      });
      return false;
    }
    const [uniqueID] = selected(sctx.self._pick);
    sctx.self._pick = null;
    const blade = uniqueID
      && sctx.battleState.zones.hand.find(c => c.uniqueID === uniqueID);
    if (blade) {
      blade.power += 4;
      discardCard(sctx, uniqueID);
    }
    return true;
  },
  describe: () => '抽1，选1张手中/named{刀法牌}令其伤害+4，并将其弃入牌库',
  battleDescribe: () => '抽1，选1张手中/named{刀法牌}令其伤害+4，并将其弃入牌库',
});

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

// ==== 散卡（2026-09 设计稿新增）================================================

// 快速花刀 C/B（1AP/0AP）：6护盾，/named{换牌}所有无法打出的手牌。
// 换牌 = 弃牌（手→牌库底）+ 抽 1 补位（走指令，呼吸等弃牌联动照常触发）；
// 「原地」按原手位把抽到的牌插回（升序插回精确复原原次序）。满手/空库时
// 抽牌按 DrawCards 管线自然截断，换几张补几张。无卡手牌时护盾照发、换牌空转。
const swapCleaveCard = (id, name, tier, ap, promotesTo) => registerSkill({
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
      if (stuck.length === 0) return true;
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
    const drawn = sctx.self._swapDraw.result.drawn;
    const slots = sctx.self._swapSlots;
    sctx.self._swapDraw = null;
    sctx.self._swapSlots = null;
    drawn.forEach((card, k) => {
      if (slots[k] != null) {
        moveCardTo(sctx, card.uniqueID, 'hand', Math.min(slots[k].index, sctx.battleState.zones.hand.length));
      }
    });
    return true;
  },
  describe: () => `6护盾，/named{换牌}所有无法打出的手牌`,
  battleDescribe: (sctx) => {
    const n = stuckHandCards(sctx).length;
    return `6护盾，/named{换牌}所有无法打出的手牌${n > 0 ? `（当前${n}张）` : ''}`;
  },
});
swapCleaveCard('quickCleave', '快速花刀', 'C', 1, 'quickCleavePlus');
swapCleaveCard('quickCleavePlus', '快速花刀', 'B', 0);

// 快速横刀 C/B（消耗，设计稿未写费用 → 0费）：4/11护盾，/named{抽出}斩。
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
quickDrawShieldCard('quickDrawShield', '快速横刀', 'C', 4, 'quickDrawShieldPlus');
quickDrawShieldCard('quickDrawShieldPlus', '快速横刀', 'B', 11);
