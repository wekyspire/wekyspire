// 效果处理器
// 将GameApp中所有触发类别的effect的生效和判定逻辑迁移至此文件

import effectDescriptions from '../data/effectDescription.js';
import eventBus from '../eventBus.js';
import { dealDamage } from './battleUtils.js';
import { addEffectLog, addBattleLog } from './battleLogUtils.js';

/**
 * 处理回合开始时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 */
export function processStartOfTurnEffects(target) {

  // 摧毁护盾
  if(target.effects['警戒'] > 0) {
    target.addEffect('警戒', -1);
  } else {
    target.shield = 0;
  }

  // 吸收效果
  if (target.effects['吸收'] > 0) {
    target.mana += target.effects['吸收'];
    addEffectLog(`${target.name}/effect{吸收}了${target.effects['吸收']}点魏启！`);
    delete target.effects['吸收'];
  }

  // 处理燃烧效果
  if (target.effects['燃烧'] > 0) {
    const damage = target.effects['燃烧'];
    target.addEffect('燃烧', -1);
    addEffectLog(`${target.name}被烧伤了，受到${damage}伤害！`);
    dealDamage(null, target, damage);
  }
  
  // 聚气效果
  if (target.effects['聚气'] > 0) {
    if (typeof target.gainMana === 'function') {
      target.gainMana(target.effects['聚气']);
      addEffectLog(`${target.name}通过/effect{聚气}恢复了${target.effects['聚气']}点魏启！`);
    }
    target.addEffect('聚气', -target.effects['聚气']);
  }
  
  // 最后再处理眩晕效果
  if (target.effects['眩晕'] > 0) {
    target.addEffect('眩晕', -1);
    addEffectLog(`${target.name}处于眩晕状态，跳过回合！`);
    return true; // 返回true表示需要跳过回合
  }

  return false; // 返回false表示不需要跳过回合
}

/**
 * 处理回合结束时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 */
export function processEndOfTurnEffects(target) {
  // 处理吸收效果
  if (target.effects['吸收'] > 0) {
    if (typeof target.gainMana === 'function') {
      target.gainMana(target.effects['吸收']);
    }
    addEffectLog(`${target.name}通过/effect{吸收}恢复了${target.effects['吸收']}点魏启！`);
  }
  
  // 处理漏气效果
  if (target.effects['漏气'] > 0) {
    if (typeof target.consumeMana === 'function') {
      target.consumeMana(target.effects['漏气']);
    }
    addEffectLog(`${target.name}因/effect{漏气}失去了${target.effects['漏气']}点魏启！`);
  }
  
  // 处理中毒效果
  if (target.effects['中毒'] > 0) {
    const damage = target.effects['中毒'];
    dealDamage(null, target, damage, false);
    target.addEffect('中毒', -1);
    addEffectLog(`${target.name}受到/effect{中毒}影响，受到${damage}伤害！`);
  }
  
  // 处理再生效果
  if (target.effects['再生'] > 0) {
    const heal = target.effects['再生'];
    target.applyHeal(heal);
    target.addEffect('再生', -1);
    addEffectLog(`${target.name}通过/effect{再生}恢复了${heal}点/named{生命}！`);
  }
  
  // 处理超然效果
  if (target.effects['超然'] > 0) {
    const stacks = target.effects['超然'];
    target.addEffect('集中', stacks);
    addEffectLog(`${target.name}通过/effect{超然}获得了${stacks}层/effect{集中}！`);
  }
  
  // 处理侵蚀效果
  if (target.effects['侵蚀'] > 0) {
    const stacks = target.effects['侵蚀'];
    target.addEffect('集中', -stacks);
    addEffectLog(`${target.name}受到/effect{侵蚀}影响，失去了${stacks}层/effect{集中}！`);
  }
  
  // 处理燃心效果
  if (target.effects['燃心'] > 0) {
    const amount = 3 * target.effects['燃心'];
    target.addEffect('集中', amount);
    addEffectLog(`${target.name}通过/effect{燃心}获得了${amount}层/effect{集中}！`);
    const burnAmount = 8 * target.effects['燃心'];
    target.addEffect('燃烧', burnAmount);
    addEffectLog(`${target.name}通过/effect{燃心}获得了${burnAmount}层/effect{燃烧}！`);
  }
  
  // 处理成长效果
  if (target.effects['成长'] > 0) {
    const stacks = target.effects['成长'];
    target.addEffect('力量', stacks);
    addEffectLog(`${target.name}通过/effect{成长}获得了${stacks}层/effect{力量}！`);
  }
  
  // 处理衰败效果
  if (target.effects['衰败'] > 0) {
    const stacks = target.effects['衰败'];
    target.addEffect('力量', -stacks);
    addEffectLog(`${target.name}受到/effect{衰败}影响，失去了${stacks}层/effect{力量}！`);
  }
  
  // 处理巩固效果
  if (target.effects['巩固'] > 0) {
    const stacks = target.effects['巩固'];
    target.addEffect('坚固', stacks);
    addEffectLog(`${target.name}通过/effect{巩固}获得了${stacks}层/effect{坚固}！`);
  }
  
  // 处理崩溃效果
  if (target.effects['崩溃'] > 0) {
    const stacks = target.effects['崩溃'];
    target.addEffect('坚固', -stacks);
    addEffectLog(`${target.name}受到/effect{崩溃}影响，失去了${stacks}层/effect{坚固}！`);
  }
  
  // 处理魏宗圣体效果
  if (target.effects['魏宗圣体'] > 0) {
    const stacks = target.effects['魏宗圣体'];
    target.addEffect('集中', stacks);
    target.addEffect('力量', stacks);
    target.addEffect('坚固', stacks);
    addEffectLog(`${target.name}通过/effect{魏宗圣体}获得了${stacks}层/effect{集中}、/effect{力量}和/effect{坚固}！`);
  }
  
  // 处理解体效果
  if (target.effects['解体'] > 0) {
    const stacks = target.effects['解体'];
    target.addEffect('集中', -stacks);
    target.addEffect('力量', -stacks);
    target.addEffect('坚固', -stacks);
    addEffectLog(`${target.name}受到/effect{解体}影响，失去了${stacks}层/effect{集中}、/effect{力量}和/effect{坚固}！`);
  }

  // 易伤效果
  if (target.effects['易伤'] > 0) {
    target.addEffect('易伤', -1);
  }
}

/**
 * 处理发动技能时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 */
export function processSkillActivationEffects(target) {
  // 处理连发效果
  if (target.effects['连发'] > 0) {
    target.gainActionPoint(1);
    target.addEffect('连发', -1);
    addEffectLog(`${target.name}通过/effect{连发}效果获得了1点/named{行动力}！`);
  }
}

/**
 * 处理受到攻击时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 * @param {number} damage - 攻击伤害值
 * @returns {number} 处理后的伤害值
 */
export function processAttackTakenEffects(target, damage) {
  let finalDamage = damage;
  
  // 处理格挡效果
  if (target.effects['格挡'] > 0) {
    finalDamage = Math.floor(finalDamage / 2);
    target.addEffect('格挡', -1);
    addEffectLog(`${target.name}通过/effect{格挡}效果将伤害减半！`);
  }
  
  // 处理闪避效果
  if (target.effects['闪避'] > 0) {
    finalDamage = 0;
    target.addEffect('闪避', -1);
    addEffectLog(`${target.name}通过/effect{闪避}效果完全回避了攻击！`);
  }

  // 易伤，伤害乘以150%
  if (target.effects['易伤'] > 0) {
    finalDamage = Math.floor(finalDamage * 1.5);
  }
  
  return finalDamage;
}

/**
 * 处理受到伤害时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 * @param {number} damage - 伤害值
 * @returns {number} 处理后的伤害值
 */
export function processDamageTakenEffects(target, damage) {
  let finalDamage = damage;
  
  return finalDamage;
}

/**
 * 处理受到伤害时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 * @param {number} damage - 伤害值
 */
export function processDamageDealtEffects(target, damage) {
  // 处理暴怒效果
  if (target.effects['暴怒'] > 0) {
    const stacks = target.effects['暴怒'];
    target.addEffect('力量', stacks);
    addEffectLog(`${target.name}通过/effect{暴怒}效果获得了${stacks}层/effect{力量}！`);
  }
  
  // 处理执着效果
  if (target.effects['执着'] > 0) {
    const stacks = target.effects['执着'];
    target.addEffect('集中', stacks);
    addEffectLog(`${target.name}通过/effect{执着}效果获得了${stacks}层/effect{集中}！`);
  }

  // 处理灼烧效果，受到攻击后有50%概率获得1层燃烧
  if (target.effects['灼烧'] > 0) {
    // 50%概率获得1层燃烧 
    if (Math.random() < 0.5) {
      target.addEffect('燃烧', target.effects['灼烧']);
      addEffectLog(`${target.name}被灼烧，获得了${target.effects['灼烧']}层燃烧！`);
    }
  }
}

/**
 * 处理攻击结算后触发的效果
 * @param {Object} attacker - 攻击者对象
 * @param {Object} target - 目标对象
 * @param {number} damage - 伤害值
 * @returns {number} 处理后的伤害值
 */
export function processPostAttackEffects(attacker, target, damage) {
  let finalDamage = damage;
  // 力量效果
  finalDamage += (attacker.effects['力量'] || 0);
  

  // 处理超频效果
  if (attacker.effects['超频'] > 0) {
    // 10%概率双倍伤害
    if (Math.random() < 0.1) {
      finalDamage *= 2;
      addEffectLog(`${attacker.name}的攻击触发了超频效果，伤害翻倍！`);
    }
  }
  return finalDamage;
}

export function processAttackFinishEffects(attacker, target, hpDamage, passthroughDamage) {
  // 处理高燃弹药效果
  if (attacker.effects['高燃弹药'] > 0 && passthroughDamage > 0) {
    const burnLevel = (attacker.effects['高燃弹药'] * 2 || 0);
    // 100%概率让敌人获得2层燃烧
    if (Math.random() < 1) {
      target.addEffect('燃烧', Math.floor(burnLevel));
      addEffectLog(`${target.name}被灼热的攻击烫伤，获得了${Math.floor(burnLevel)}层燃烧！`);
    }
  }
}