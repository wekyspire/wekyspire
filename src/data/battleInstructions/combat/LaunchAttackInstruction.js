/**
 * LaunchAttackInstruction - 发动攻击元语
 * 
 * 处理完整的攻击流程：
 * 1. 计算最终伤害（基础伤害 + 攻击力 + 攻击后效果处理 + 受到攻击效果处理 + 防御减免）
 * 2. 创建并执行DealDamageInstruction进行伤害结算
 * 3. 处理攻击完成效果
 * 
 * 与DealDamageInstruction的区别：
 * - LaunchAttack: 完整攻击流程，包含攻击力加成和攻击特效
 * - DealDamage: 直接伤害，跳过攻击流程
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { DealDamageInstruction } from './DealDamageInstruction.js';
import { processPostAttackEffects, processAttackTakenEffects, processAttackFinishEffects } from '../../effectProcessor.js';
import { submitInstruction } from '../globalExecutor.js';

export class LaunchAttackInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Unit} config.attacker - 攻击者
   * @param {Unit} config.target - 目标
   * @param {number} config.baseDamage - 基础伤害值
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ attacker, target, baseDamage, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!attacker) {
      throw new Error('LaunchAttackInstruction: attacker is required');
    }
    if (!target) {
      throw new Error('LaunchAttackInstruction: target is required');
    }
    if (typeof baseDamage !== 'number' || baseDamage < 0) {
      throw new Error('LaunchAttackInstruction: baseDamage must be a non-negative number');
    }
    
    this.attacker = attacker;
    this.target = target;
    this.baseDamage = baseDamage;
    
    /**
     * 执行阶段
     * 0: 初始状态，需要计算伤害并创建DealDamageInstruction
     * 1: 伤害结算完成，需要处理攻击完成效果
     */
    this.executionStage = 0;
    
    /**
     * 伤害结算元语引用
     * @type {DealDamageInstruction|null}
     */
    this.damageInstruction = null;
    
    /**
     * 攻击结果
     * @type {{passThoughDamage: number, hpDamage: number, dead: boolean}|null}
     */
    this.attackResult = null;
  }

  /**
   * 执行攻击（多阶段）
   * 
   * 阶段0：
   * 1. 计算最终伤害
   * 2. 创建DealDamageInstruction并提交
   * 3. 保存伤害元语引用
   * 4. 返回false（继续执行）
   * 
   * 阶段1：
   * 1. 从damageInstruction读取结果
   * 2. 如果目标未死亡，处理攻击完成效果
   * 3. 返回true（完成）
   * 
   * @returns {Promise<boolean>}
   */
  async execute() {
    if (this.executionStage === 0) {
      // 阶段0: 计算伤害并提交伤害结算元语
      
      // 计算最终伤害
      let finalDamage = this.baseDamage + this.attacker.attack;
      
      // 处理攻击者的攻击后效果（力量、虚弱、超频等）
      finalDamage = processPostAttackEffects(this.attacker, this.target, finalDamage);
      
      // 处理目标的受到攻击效果（格挡、闪避、易伤等）
      finalDamage = processAttackTakenEffects(this.target, finalDamage);
      
      // 固定防御减免
      finalDamage = Math.max(finalDamage - this.target.defense, 0);
      
      // 创建伤害结算元语
      this.damageInstruction = new DealDamageInstruction({
        source: this.attacker,
        target: this.target,
        damage: finalDamage,
        penetrateDefense: true, // 伤害已经计算过防御，所以设置为穿透防御
        parentInstruction: this
      });
      
      // 提交到执行器
      submitInstruction(this.damageInstruction);
      
      // 进入下一阶段
      this.executionStage = 1;
      return false; // 未完成，保留在栈顶
    }
    
    if (this.executionStage === 1) {
      // 阶段1: 读取伤害结算结果并处理攻击完成效果
      
      // 从伤害元语读取结果
      this.attackResult = this.damageInstruction.result;
      
      // 如果目标未死亡，处理攻击完成效果
      if (!this.attackResult.dead) {
        processAttackFinishEffects(
          this.attacker,
          this.target,
          this.attackResult.hpDamage,
          this.attackResult.passThoughDamage
        );
      }
      
      // 攻击完成
      return true;
    }
    
    // 不应该到达这里
    console.error(`LaunchAttackInstruction: Unexpected executionStage ${this.executionStage}`);
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Attacker:${this.attacker.name} Target:${this.target.name} BaseDmg:${this.baseDamage} Stage:${this.executionStage}`;
  }
}
