// 战斗内调试原语：**全部走既有指令**（不直改战斗状态）。
//
// 为什么坚持指令化：调试时看到的必须是"正式结算路径"——秒杀要走完伤害管线（护盾吸收、
// 死亡结算、胜利判定、战后清理），演示/复现 bug 才有意义；直写 hp=0 会让 PostBattle 的
// 记账、遗物钩子（onBattleVictory）、bridge 的投影全部走样，等于白调。
//
// 提交纪律：指令一律挂在**当前玩家回合**下（与 playerUseSkill 同路），提交后 resume 恢复泵；
// 不在玩家回合（敌方回合/演出中/未开战）→ 抛错（面板据此提示"等回合"）。

import { currentPlayerTurn } from '../flow/battle.js';
import { aliveEnemies } from '../state/battleState.js';
import { DealDamageInstruction, ApplyHealInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { AddCardInstruction, DrawCardsInstruction } from '../instructions/cards.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { getEffectDefinition } from '../effects/registry.js';
import { getSkillDefinition } from '../skills/registry.js';

// 调试伤害：fixed（不吃 PRE 修饰）+ pierce（无视护盾/防御）——保证一击必杀
const DEBUG_DAMAGE = 99999;

/** 取当前可提交指令的玩家回合（不在 = 抛错，调用方把话递给玩家）。 */
function waitingTurn(battle) {
  const turn = currentPlayerTurn(battle);
  if (!turn || !turn._waiting) throw new Error('当前不在玩家回合（等演出/敌方回合结束再试）');
  return turn;
}

/** 提交一组指令：挂当前玩家回合 → 恢复泵（与 playerUseSkill 同节拍）。 */
function submit(battle, instrs) {
  const turn = waitingTurn(battle);
  for (const instr of instrs) battle.kernel.submitInstruction(instr, turn);
  battle.kernel.resume(turn, battle.ctx);
  return true;
}

/** 秒杀全部敌人（走伤害管线：死亡/胜利/战后清理全按正式路径）。 */
export function killAllEnemies(battle) {
  const targets = aliveEnemies(battle.ctx.battleState);
  if (!targets.length) throw new Error('场上没有存活的敌人');
  submit(battle, targets.map(target => new DealDamageInstruction({
    source: null, target, amount: DEBUG_DAMAGE, fixed: true, pierce: true, type: 'minor',
  })));
  return `秒杀 ${targets.length} 个敌人`;
}

/** 秒杀单个敌人（按 uniqueID 或索引）。 */
export function killEnemy(battle, key) {
  const list = aliveEnemies(battle.ctx.battleState);
  const target = list.find(e => e.uniqueID === key) ?? list[Number(key)];
  if (!target) throw new Error(`找不到这个敌人：${key}`);
  submit(battle, [new DealDamageInstruction({
    source: null, target, amount: DEBUG_DAMAGE, fixed: true, pierce: true, type: 'minor',
  })]);
  return `秒杀 ${target.name ?? target.defId ?? '敌人'}`;
}

/** 玩家回满血 / 给盾 / 加魏启 / 加 AP（战斗内资源走指令，投影与演出同正式路径）。 */
export function healPlayerFull(battle) {
  const p = battle.ctx.player;
  const amount = Math.max(1, p.maxHp - p.hp);
  submit(battle, [new ApplyHealInstruction({ target: p, amount })]);
  return `回满生命（+${amount}）`;
}
export function gainShield(battle, amount) {
  submit(battle, [new GainShieldInstruction({ target: battle.ctx.player, amount: Number(amount) || 0 })]);
  return `玩家护盾 +${amount}`;
}
export function gainMana(battle, amount) {
  submit(battle, [new GainManaInstruction({ amount: Number(amount) || 0 })]);
  return `魏启 +${amount}`;
}
export function gainActionPoints(battle, amount) {
  submit(battle, [new GainActionPointsInstruction({ amount: Number(amount) || 0 })]);
  return `行动力 +${amount}`;
}

/** 造一张卡进手牌（走 AddCardInstruction：充能初始化 + 常驻订阅注册照走）。 */
export function addCardToHand(battle, defId) {
  const def = getSkillDefinition(defId); // 未注册抛错
  submit(battle, [new AddCardInstruction({ defId, toZone: 'hand' })]);
  return `手牌加入「${def.name}」`;
}

/** 抽 N 张（走抽牌指令：手牌上限/牌库空等规则照走）。 */
export function drawCards(battle, count = 5) {
  const n = Math.max(1, Math.floor(Number(count) || 5));
  submit(battle, [new DrawCardsInstruction({ count: n })]);
  return `抽 ${n} 张`;
}

/** 给单位加效果层数（target: 'player' | 'enemy:<uniqueID|索引>'）。 */
export function addEffect(battle, targetKey, effectId, stacks = 1) {
  getEffectDefinition(effectId); // 未注册抛错
  const target = resolveUnit(battle, targetKey);
  submit(battle, [new AddEffectInstruction({ target, effectId, stacks: Number(stacks) || 1 })]);
  return `${target.name ?? targetKey} 获得效果 ${effectId} ×${stacks}`;
}

/** 解析单位：'player' / 'enemy:0' / 'enemy'（第一个存活敌人）/ uniqueID。 */
export function resolveUnit(battle, key) {
  const bs = battle.ctx.battleState;
  const k = String(key ?? 'player');
  if (k === 'player' || k === 'p') return battle.ctx.player;
  const rest = k.startsWith('enemy') ? k.slice(k.indexOf(':') + 1) : k;
  const list = aliveEnemies(bs);
  const unit = list.find(e => e.uniqueID === rest) ?? list[Number(rest)] ?? (rest === 'enemy' ? list[0] : null);
  if (!unit) throw new Error(`找不到单位：${key}`);
  return unit;
}

/** 场上敌人快照（面板列用；纯读）。 */
export function enemyViews(battle) {
  return battle.ctx.battleState.enemies.map((e, i) => ({
    index: i, uniqueID: e.uniqueID, name: e.name ?? e.defId,
    hp: e.hp, maxHp: e.maxHp, shield: e.shield ?? 0, dead: !!e.isDead?.(),
  }));
}
