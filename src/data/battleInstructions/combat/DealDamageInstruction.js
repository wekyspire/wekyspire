/**
 * DealDamageInstruction - 伤害结算元语
 * 
 * 直接造成伤害（跳过攻击流程），用于：
 * - 技能直接伤害
 * - 持续伤害效果（如燃烧）
 * - 其他非攻击类伤害
 * 
 * 与LaunchAttackInstruction的区别：
 * - DealDamage: 跳过攻击前/攻击后效果，直接结算伤害
 * - LaunchAttack: 完整的攻击流程（攻击力加成、防御减免、攻击特效等）
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { processDamageTakenEffects } from '../../effectProcessor.js';
import { addDamageLog, addDeathLog, addBattleLog } from '../../battleLogUtils.js';
import { enqueueHurtAnimation, enqueueUnitDeath } from '../../animationInstructionHelpers.js';

export class DealDamageInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Unit|null} config.source - 伤害来源（可为null）
   * @param {Unit} config.target - 目标单位
   * @param {number} config.damage - 伤害值
   * @param {boolean} config.penetrateDefense - 是否穿透防御（默认false）
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ source = null, target, damage, penetrateDefense = false, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!target) {
      throw new Error('DealDamageInstruction: target is required');
    }
    if (typeof damage !== 'number' || damage < 0) {
      throw new Error('DealDamageInstruction: damage must be a non-negative number');
    }
    
    this.source = source;
    this.target = target;
    this.damage = damage;
    this.penetrateDefense = penetrateDefense;
    
    /**
     * 结算结果
     * @type {{passThoughDamage: number, hpDamage: number, dead: boolean}|null}
     */
    this.result = null;
  }

  /**
   * 执行伤害结算
   * 
   * 流程：
   * 1. 计算最终伤害（是否减去防御）
   * 2. 计算护盾/生命损耗
   * 3. 更新目标状态
   * 4. 入队受伤动画
   * 5. 添加战斗日志
   * 6. 调用受到伤害效果处理
   * 7. 检查死亡并入队死亡动画
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    let finalDamage = this.damage;
    
    // 固定防御减免（如果不穿透防御）
    if (!this.penetrateDefense) {
      finalDamage = Math.max(finalDamage - this.target.defense, 0);
    }
    
    // 计算护盾和生命损耗
    const passThoughDamage = finalDamage;
    let hpDamage = 0;
    
    if (finalDamage > 0) {
      // 先打护盾
      const shieldDamage = Math.min(this.target.shield, finalDamage);
      finalDamage -= shieldDamage;
      hpDamage = finalDamage;
      
      // 更新目标状态
      this.target.shield -= shieldDamage;
      this.target.hp = Math.max(this.target.hp - finalDamage, 0);
      
      // 入队受伤动画
      enqueueHurtAnimation({
        unitId: this.target.uniqueID,
        hpDamage: hpDamage,
        passThroughDamage: passThoughDamage
      });
      
      // 添加战斗日志
      if (finalDamage > 0) {
        const sourceName = this.source ? this.source.name : '';
        if (sourceName) {
          addDamageLog(`${this.target.name}从${sourceName}受到${finalDamage}点伤害！`);
        } else {
          addDamageLog(`${this.target.name}受到${finalDamage}点伤害！`);
        }
      } else {
        // 伤害全被护盾挡下
        const sourceName = this.source ? `自${this.source.name}` : '';
        addBattleLog(`${this.target.name}的护盾挡下${sourceName}的伤害。`);
      }
    } else {
      // 伤害为0（被防御 / 完全减免）
      enqueueHurtAnimation({
        unitId: this.target.uniqueID,
        hpDamage: 0,
        passThroughDamage: 0
      });
      
      const sourceName = this.source ? `从${this.source.name}` : '';
      addBattleLog(`${this.target.name}${sourceName}受到伤害，但不起作用！`);
    }
    
    // 处理受到伤害时的效果
    processDamageTakenEffects(this.target, passThoughDamage, hpDamage);
    
    // 检查死亡
    const dead = this.target.hp <= 0;
    if (dead) {
      addDeathLog(`${this.target.name} 被击败了！`);
      try {
        enqueueUnitDeath({ unitId: this.target.uniqueID });
      } catch (error) {
        console.warn(`Failed to enqueue death animation for ${this.target.name}:`, error);
      }
    }
    
    // 保存结算结果
    this.result = {
      passThoughDamage: passThoughDamage,
      hpDamage: hpDamage,
      dead: dead
    };
    
    // 一次性完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    const sourceName = this.source ? this.source.name : 'null';
    return `${super.getDebugInfo()} Source:${sourceName} Target:${this.target.name} Damage:${this.damage} Penetrate:${this.penetrateDefense}`;
  }
}
