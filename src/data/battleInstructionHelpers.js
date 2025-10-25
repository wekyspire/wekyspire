/**
 * battleInstructionHelpers.js - 战斗元语辅助函数库
 * 
 * 提供便捷的元语创建和提交函数，简化技能设计者的使用。
 * 
 * 函数命名规范：createAndSubmit{ElementType}
 * 参数顺序约定：主体单位 → 目标单位 → 数值参数 → 配置对象
 * 返回值：返回创建的元语实例，供调用者保存引用以读取结果
 */

import { submitInstruction } from './battleInstructions/globalExecutor.js';

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
  const instruction = new LaunchAttackInstruction({
    attacker,
    target,
    baseDamage: damage,
    parentInstruction
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
  const instruction = new DealDamageInstruction({
    source,
    target,
    damage,
    penetrateDefense,
    parentInstruction
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
  const instruction = new GainShieldInstruction({
    caster,
    target,
    shieldAmount,
    parentInstruction
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
  const instruction = new ApplyHealInstruction({
    target,
    healAmount,
    parentInstruction
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
  const instruction = new AddEffectInstruction({
    target,
    effectName,
    stacks,
    parentInstruction
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
  return createAndSubmitAddEffect(target, effectName, -stacks, parentInstruction);
}

// ==================== 卡牌操作元语辅助函数 ====================

/**
 * 创建并提交抽卡元语
 * @param {Player} player - 玩家对象
 * @param {number} count - 抽卡数量（默认1）
 * @param {BattleInstruction|null} parentInstruction - 父元语引用（默认null）
 * @returns {DrawSkillCardInstruction} 抽卡元语实例
 */
export function createAndSubmitDrawSkillCard(player, count = 1, parentInstruction = null) {
  const instruction = new DrawSkillCardInstruction({
    player,
    count,
    parentInstruction
  });
  submitInstruction(instruction);
  return instruction;
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
  const instruction = new DropSkillCardInstruction({
    player,
    skillID,
    deckPosition,
    parentInstruction
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
  const instruction = new BurnSkillCardInstruction({
    player,
    skillID,
    parentInstruction
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
  const instruction = new DiscoverSkillCardInstruction({
    player,
    skill,
    destination,
    parentInstruction
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
  const instruction = new AwaitPlayerInputInstruction({
    inputType,
    options,
    parentInstruction
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
  // 这是一个示例，实际使用时需要在技能的多阶段逻辑中实现
  // 阶段1：攻击
  // 阶段2：检查attackResult.hpDamage > 0，然后添加效果
  const attackInst = createAndSubmitLaunchAttack(attacker, target, damage, parentInstruction);
  return attackInst;
}
