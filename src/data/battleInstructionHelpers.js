/**
 * battleInstructionHelpers.js - 战斗元语辅助函数库
 * 
 * 提供便捷的元语创建和提交函数，简化技能设计者的使用。
 * 
 * 函数命名规范：createAndSubmit{ElementType}
 * 参数顺序约定：主体单位 → 目标单位 → 数值参数 → 配置对象
 * 返回值：返回创建的元语实例，供调用者保存引用以读取结果
 */

import { submitInstruction, getCurrentInstruction } from './battleInstructions/globalExecutor.js';

// 导入所有元语类
import { LaunchAttackInstruction } from './battleInstructions/combat/LaunchAttackInstruction.js';
import { DealDamageInstruction } from './battleInstructions/combat/DealDamageInstruction.js';
import { GainShieldInstruction } from './battleInstructions/combat/GainShieldInstruction.js';
import { ApplyHealInstruction } from './battleInstructions/combat/ApplyHealInstruction.js';
import { AddEffectInstruction } from './battleInstructions/effect/AddEffectInstruction.js';
import { DrawSkillCardInstruction } from './battleInstructions/card/DrawSkillCardInstruction.js';
import { DropSkillCardInstruction } from './battleInstructions/card/DropSkillCardInstruction.js';
import { BurnSkillCardInstruction } from './battleInstructions/card/BurnSkillCardInstruction.js';
import { DiscoverSkillCardInstruction } from './battleInstructions/card/DiscoverSkillCardInstruction.js';
import { AwaitPlayerInputInstruction } from './battleInstructions/async/AwaitPlayerInputInstruction.js';
import { DrawSelectedSkillCardInstruction } from './battleInstructions/card/DrawSelectedSkillCardInstruction.js';
import { SkillLeaveBattleInstruction } from './battleInstructions/card/SkillLeaveBattleInstruction.js';
import { SkillCoolDownInstruction } from './battleInstructions/skill/SkillCoolDownInstruction.js';
import { GainManaInstruction } from './battleInstructions/state/GainManaInstruction.js';
import { ConsumeManaInstruction } from './battleInstructions/state/ConsumeManaInstruction.js';
import { LambdaInstruction } from './battleInstructions/misc/LambdaInstruction.js';
import { addEffectLog } from './battleLogUtils.js';

// ==================== 战斗相关元语辅助函数 ====================

/**
 * 创建并提交发动攻击元语
 * @param {Unit} attacker - 攻击者
 * @param {Unit} target - 目标
 * @param {number} damage - 基础伤害值
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {LaunchAttackInstruction} 攻击元语实例
 */
export function createAndSubmitLaunchAttack(attacker, target, damage, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new LaunchAttackInstruction({
    attacker,
    target,
    baseDamage: damage,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交伤害结算元语（直接伤害，跳过攻击流程）
 * @param {Unit|null} source - 伤害来源（可为null）
 * @param {Unit} target - 目标
 * @param {number} damage - 伤害值
 * @param {boolean} penetrateDefense - 是否穿透防御（默认false）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DealDamageInstruction} 伤害元语实例
 */
export function createAndSubmitDealDamage(source, target, damage, penetrateDefense = false, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new DealDamageInstruction({
    source,
    target,
    damage,
    penetrateDefense,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交获得护盾元语
 * @param {Unit} caster - 施法者
 * @param {Unit} target - 目标
 * @param {number} shieldAmount - 护盾值
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {GainShieldInstruction} 护盾元语实例
 */
export function createAndSubmitGainShield(caster, target, shieldAmount, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new GainShieldInstruction({
    caster,
    target,
    shieldAmount,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交治疗元语
 * @param {Unit} target - 目标
 * @param {number} healAmount - 治疗量
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {ApplyHealInstruction} 治疗元语实例
 */
export function createAndSubmitApplyHeal(target, healAmount, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new ApplyHealInstruction({
    target,
    healAmount,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

// ==================== 效果相关元语辅助函数 ====================

/**
 * 创建并提交添加效果元语
 * @param {Unit} target - 目标单位
 * @param {string} effectName - 效果名称
 * @param {number} stacks - 层数（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {AddEffectInstruction} 效果元语实例
 */
export function createAndSubmitAddEffect(target, effectName, stacks = 1, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new AddEffectInstruction({
    target,
    effectName,
    stacks,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交移除效果元语（添加负数层数）
 * @param {Unit} target - 目标单位
 * @param {string} effectName - 效果名称
 * @param {number} stacks - 移除层数（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {AddEffectInstruction} 效果元语实例
 */
export function createAndSubmitRemoveEffect(target, effectName, stacks = 1, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  return createAndSubmitAddEffect(target, effectName, -stacks, parent);
}

// ==================== 卡牌操作元语辅助函数 ====================

/**
 * 创建并提交抽卡元语
 * @param {Player} player - 玩家对象
 * @param {number} count - 抽卡数量（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DrawSkillCardInstruction} 抽卡元语实例
 */
export function createAndSubmitDrawSkillCard(player, count = 1, parentInstruction = null, insertAt = null, insertRelative = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new DrawSkillCardInstruction({
    player,
    count,
    insertAt,
    parentInstruction: parent,
    insertRelative
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 按目标手牌索引插入抽到的牌
 */
export function createAndSubmitDrawAt(player, insertAt, count = 1, parentInstruction = null) {
  return createAndSubmitDrawSkillCard(player, count, parentInstruction, insertAt, null);
}

/**
 * 按锚点卡牌（uniqueID）相对位置插入抽到的牌
 * insertRelative: {anchorId, mode: 'before'|'after'} 或数组
 */
export function createAndSubmitDrawRelative(player, insertRelative, count = 1, parentInstruction = null) {
  return createAndSubmitDrawSkillCard(player, count, parentInstruction, null, insertRelative);
}

/**
 * 创建并提交弃卡元语
 * @param {Player} player - 玩家对象
 * @param {string} skillID - 卡牌唯一ID
 * @param {number} deckPosition - 插入牌库的位置（-1表示牌库底，默认-1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DropSkillCardInstruction} 弃卡元语实例
 */
export function createAndSubmitDropSkillCard(player, skillID, deckPosition = -1, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new DropSkillCardInstruction({
    player,
    skillID,
    deckPosition,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交焚毁卡牌元语
 * @param {Player} player - 玩家对象
 * @param {string} skillID - 卡牌唯一ID
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {BurnSkillCardInstruction} 焚毁元语实例
 */
export function createAndSubmitBurnSkillCard(player, skillID, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new BurnSkillCardInstruction({
    player,
    skillID,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交发现卡牌元语
 * @param {Player} player - 玩家对象
 * @param {Skill} skill - 新卡牌对象
 * @param {string} destination - 目标位置（'skills-hand'或'deck'，默认'skills-hand'）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DiscoverSkillCardInstruction} 发现卡牌元语实例
 */
export function createAndSubmitDiscoverSkillCard(player, skill, destination = 'skills-hand', parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new DiscoverSkillCardInstruction({
    player,
    skill,
    destination,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交根据技能ID抽取卡牌元语
 * @param {Player} player - 玩家对象
 * @param {string} skillID - 卡牌唯一ID
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DrawSelectedSkillCardInstruction} 抽取指定卡牌元语实例
 */
export function createAndSubmitDrawSelectedSkillCard(player, skillID, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new DrawSelectedSkillCardInstruction({
    player,
    skillID,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

// ==================== 异步元语辅助函数 ====================

/**
 * 创建并提交等待玩家输入元语
 * @param {string} inputType - 输入类型（'selectCard'、'selectTarget'、'confirm'）
 * @param {Object} options - 输入选项配置
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {AwaitPlayerInputInstruction} 等待输入元语实例
 */
export function createAndSubmitAwaitPlayerInput(inputType, options = {}, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new AwaitPlayerInputInstruction({
    inputType,
    options,
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交从前线选择卡牌的等待输入元语
 * @param {Player} player - 玩家对象
 * @param {Object} options - 选择配置
 * @param {Array<string>} options.exclude - 排除的卡牌ID列表
 * @param {number} options.min - 最小选择数量（默认1）
 * @param {number} options.max - 最大选择数量（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {AwaitPlayerInputInstruction} 等待输入元语实例
 */
export function createAndSubmitSelectCardsFromFrontier(player, { exclude = [], min = 1, max = 1} = {}, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new AwaitPlayerInputInstruction({
    inputType: 'selectCard',
    options: {
      scope: 'frontier',
      exclude,
      min,
      max,
      canCancel: false
    },
    parentInstruction: parent
  });
  submitInstruction(instruction);
  return instruction;
}

// ==================== 便捷组合函数 ====================

/**
 * 攻击并根据伤害结果添加效果
 * @param {Unit} attacker - 攻击者
 * @param {Unit} target - 目标
 * @param {number} damage - 基础伤害
 * @param {string} effectName - 效果名称
 * @param {number} effectStacks - 效果层数
 * @param {boolean} onlyOnHit - 是否仅在造成伤害时添加效果（默认true）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {LaunchAttackInstruction} 攻击元语实例
 * 
 * 注意：此函数返回攻击元语，调用者需要在后续检查attackResult并手动添加效果
 * 因为元语系统是异步的，无法在此函数内直接检查结果
 */
export function attackWithEffect(attacker, target, damage, effectName, effectStacks, onlyOnHit = true, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  // 这是一个示例，实际使用时需要在技能的多阶段逻辑中实现
  // 阶段1：攻击
  // 阶段2：检查attackResult.hpDamage > 0，然后添加效果
  const attackInst = createAndSubmitLaunchAttack(attacker, target, damage, parent);
  return attackInst;
}

/**
 * 创建并提交离场元语
 * @param {Player} player - 玩家对象
 * @param {string} skillID - 卡牌唯一ID
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {SkillLeaveBattleInstruction} 离场元语实例
 */
export function createAndSubmitSkillLeaveBattle(player, skillID, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new SkillLeaveBattleInstruction({ player, skillID, parentInstruction: parent });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交技能冷却元语
 * @param {Skill} skill - 技能对象
 * @param {number} deltaStacks - 冷却层数变化（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {SkillCoolDownInstruction} 冷却元语实例
 */
export function createAndSubmitSkillCoolDown(skill, deltaStacks = 1, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new SkillCoolDownInstruction({ skill, deltaStacks, parentInstruction: parent });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 批量创建并提交技能冷却元语
 * @param {Array<Skill>} skills - 技能对象数组
 * @param {number} deltaStacks - 冷却层数变化（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 */
export function createAndSubmitSkillListCoolDown(skills, deltaStacks = 1, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const list = Array.isArray(skills) ? skills : [];
  for (const sk of list) {
    const inst = new SkillCoolDownInstruction({ skill: sk, deltaStacks, parentInstruction: parent });
    submitInstruction(inst);
  }
}

/**
 * 创建并提交获得魔法元语
 * @param {Unit} target - 目标单位
 * @param {number} amount - 魔法值
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {GainManaInstruction} 获得魔法元语实例
 */
export function createAndSubmitGainMana(target, amount, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new GainManaInstruction({ target, amount, parentInstruction: parent });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交消耗魔法元语
 * @param {Unit} target - 目标单位
 * @param {number} amount - 魔法值
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {ConsumeManaInstruction} 消耗魔法元语实例
 */
export function createAndSubmitConsumeMana(target, amount, parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const instruction = new ConsumeManaInstruction({ target, amount, parentInstruction: parent });
  submitInstruction(instruction);
  return instruction;
}

/**
 * 创建并提交Lambda元语
 * @param {Function} fn - 要执行的函数
 * @param {string} description - 描述信息（默认'lambda'）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {LambdaInstruction} Lambda元语实例
 */
export function createAndSubmitLambda(fn, description = 'lambda', parentInstruction = null) {
  const parent = parentInstruction ?? getCurrentInstruction();
  const inst = new LambdaInstruction({ fn, description, parentInstruction: parent });
  submitInstruction(inst);
  return inst;
}

/**
 * 创建并提交添加效果日志的Lambda元语
 * @param {string} text - 日志文本
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {LambdaInstruction} 添加效果日志的Lambda元语实例
 */
export function createAndSubmitAddEffectLog(text, parentInstruction = null) {
  return createAndSubmitLambda(() => addEffectLog(text), `addEffectLog:${text}`, parentInstruction);
}
