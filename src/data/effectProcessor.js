// 效果处理器
// 将GameApp中所有触发类别的effect的生效和判定逻辑迁移至此文件

import effectDescriptions from '../data/effectDescription.js';
import eventBus from '../eventBus.js';
import { dealDamage } from './battleUtils.js';

/**
 * 处理回合开始时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 */
export function processStartOfTurnEffects(target) {
  // 吸收效果
  if (target.effects['吸收'] > 0) {
    target.mana += target.effects['吸收'];
    eventBus.emit('add-battle-log', `${target.name}\effect{吸收}了${target.effects['吸收']}点魏启！`);
    delete target.effects['吸收'];
  }

  // 处理燃烧效果
  if (target.effects['燃烧'] > 0) {
    const damage = target.effects['燃烧'];
    target.effects['燃烧'] -= 1;
    if(target.effects['燃烧'] <= 0) {
      delete target.effects['燃烧'];
    }
    eventBus.emit('add-battle-log', `${target.name}被烧伤了，受到${damage}伤害！`);
    dealDamage(null, target, damage);
    if (target.hp < 0) target.hp = 0;
  }
  
  // 聚气效果
  if (target.effects['聚气'] > 0) {
    target.mana += target.effects['聚气'];
    eventBus.emit('add-battle-log', `${target.name}通过\effect{聚气}恢复了${target.effects['聚气']}点魏启！`);
    delete target.effects['聚气'];
  }
  
  // 最后再处理眩晕效果
  if (target.effects['眩晕'] > 0) {
    target.effects['眩晕'] -= 1;
    if (target.effects['眩晕'] <= 0) {
      delete target.effects['眩晕'];
    }
    eventBus.emit('add-battle-log', `${target.name}处于眩晕状态，跳过回合！`);
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
    target.mana += target.effects['吸收'];
    eventBus.emit('add-battle-log', `${target.name}通过吸收效果恢复了${target.effects['吸收']}点魏启！`);
  }
  
  // 处理漏气效果
  if (target.effects['漏气'] > 0) {
    target.mana -= target.effects['漏气'];
    if (target.mana < 0) target.mana = 0;
    eventBus.emit('add-battle-log', `${target.name}因漏气效果失去了${target.effects['漏气']}点魏启！`);
  }
  
  // 处理中毒效果
  if (target.effects['中毒'] > 0) {
    const damage = target.effects['中毒'];
    target.hp -= damage;
    if (target.hp < 0) target.hp = 0;
    target.effects['中毒'] -= 1;
    if (target.effects['中毒'] <= 0) {
      delete target.effects['中毒'];
    }
    eventBus.emit('add-battle-log', `${target.name}受到中毒效果影响，失去了${damage}点生命！`);
  }
  
  // 处理再生效果
  if (target.effects['再生'] > 0) {
    const heal = target.effects['再生'];
    target.hp += heal;
    if (target.hp > target.maxHp) target.hp = target.maxHp;
    target.effects['再生'] -= 1;
    if (target.effects['再生'] <= 0) {
      delete target.effects['再生'];
    }
    eventBus.emit('add-battle-log', `${target.name}通过再生效果恢复了${heal}点生命！`);
  }
  
  // 处理超然效果
  if (target.effects['超然'] > 0) {
    const stacks = target.effects['超然'];
    if (target.effects['集中']) {
      target.effects['集中'] += stacks;
    } else {
      target.effects['集中'] = stacks;
    }
    eventBus.emit('add-battle-log', `${target.name}通过超然效果获得了${stacks}层集中！`);
  }
  
  // 处理侵蚀效果
  if (target.effects['侵蚀'] > 0) {
    const stacks = target.effects['侵蚀'];
    if (target.effects['集中']) {
      target.effects['集中'] -= stacks;
      if (target.effects['集中'] <= 0) {
        delete target.effects['集中'];
      }
    }
    eventBus.emit('add-battle-log', `${target.name}受到侵蚀效果影响，失去了${stacks}层集中！`);
  }
  
  // 处理燃心效果
  if (target.effects['燃心'] > 0) {
    if (target.effects['集中']) {
      target.effects['集中'] += 1;
    } else {
      target.effects['集中'] = 1;
    }
    target.effects['燃心'] -= 1;
    if (target.effects['燃心'] <= 0) {
      delete target.effects['燃心'];
    }
    eventBus.emit('add-battle-log', `${target.name}通过燃心效果获得了1层集中！`);
  }
  
  // 处理成长效果
  if (target.effects['成长'] > 0) {
    const stacks = target.effects['成长'];
    if (target.effects['力量']) {
      target.effects['力量'] += stacks;
    } else {
      target.effects['力量'] = stacks;
    }
    eventBus.emit('add-battle-log', `${target.name}通过成长效果获得了${stacks}层力量！`);
  }
  
  // 处理衰败效果
  if (target.effects['衰败'] > 0) {
    const stacks = target.effects['衰败'];
    if (target.effects['力量']) {
      target.effects['力量'] -= stacks;
      if (target.effects['力量'] <= 0) {
        delete target.effects['力量'];
      }
    }
    eventBus.emit('add-battle-log', `${target.name}受到衰败效果影响，失去了${stacks}层力量！`);
  }
  
  // 处理巩固效果
  if (target.effects['巩固'] > 0) {
    const stacks = target.effects['巩固'];
    if (target.effects['坚固']) {
      target.effects['坚固'] += stacks;
    } else {
      target.effects['坚固'] = stacks;
    }
    eventBus.emit('add-battle-log', `${target.name}通过巩固效果获得了${stacks}层坚固！`);
  }
  
  // 处理崩溃效果
  if (target.effects['崩溃'] > 0) {
    const stacks = target.effects['崩溃'];
    if (target.effects['坚固']) {
      target.effects['坚固'] -= stacks;
      if (target.effects['坚固'] <= 0) {
        delete target.effects['坚固'];
      }
    }
    eventBus.emit('add-battle-log', `${target.name}受到崩溃效果影响，失去了${stacks}层坚固！`);
  }
  
  // 处理魏宗圣体效果
  if (target.effects['魏宗圣体'] > 0) {
    const stacks = target.effects['魏宗圣体'];
    if (target.effects['集中']) {
      target.effects['集中'] += stacks;
    } else {
      target.effects['集中'] = stacks;
    }
    if (target.effects['力量']) {
      target.effects['力量'] += stacks;
    } else {
      target.effects['力量'] = stacks;
    }
    if (target.effects['坚固']) {
      target.effects['坚固'] += stacks;
    } else {
      target.effects['坚固'] = stacks;
    }
    eventBus.emit('add-battle-log', `${target.name}通过魏宗圣体效果获得了${stacks}层集中、力量和坚固！`);
  }
  
  // 处理解体效果
  if (target.effects['解体'] > 0) {
    const stacks = target.effects['解体'];
    if (target.effects['集中']) {
      target.effects['集中'] -= stacks;
      if (target.effects['集中'] <= 0) {
        delete target.effects['集中'];
      }
    }
    if (target.effects['力量']) {
      target.effects['力量'] -= stacks;
      if (target.effects['力量'] <= 0) {
        delete target.effects['力量'];
      }
    }
    if (target.effects['坚固']) {
      target.effects['坚固'] -= stacks;
      if (target.effects['坚固'] <= 0) {
        delete target.effects['坚固'];
      }
    }
    eventBus.emit('add-battle-log', `${target.name}受到解体效果影响，失去了${stacks}层集中、力量和坚固！`);
  }
}

/**
 * 处理发动技能时触发的效果
 * @param {Object} target - 目标对象（玩家或敌人）
 */
export function processSkillActivationEffects(target) {
  // 处理连发效果
  if (target.effects['连发'] > 0) {
    target.actionPoints += 1;
    target.effects['连发'] -= 1;
    if (target.effects['连发'] <= 0) {
      delete target.effects['连发'];
    }
    eventBus.emit('add-battle-log', `${target.name}通过连发效果获得了1点行动力！`);
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
    eventBus.emit('add-battle-log', `${target.name}通过格挡效果将伤害减半！`);
  }
  
  // 处理闪避效果
  if (target.effects['闪避'] > 0) {
    finalDamage = 0;
    target.addEffect('闪避', -1);
    eventBus.emit('add-battle-log', `${target.name}通过闪避效果完全回避了攻击！`);
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
    eventBus.emit('add-battle-log', `${target.name}通过暴怒效果获得了${stacks}层力量！`);
  }
  
  // 处理执着效果
  if (target.effects['执着'] > 0) {
    const stacks = target.effects['执着'];
    target.addEffect('集中', stacks);
    eventBus.emit('add-battle-log', `${target.name}通过执着效果获得了${stacks}层集中！`);
  }

  // 处理灼烧效果，受到攻击后有50%概率获得1层燃烧
  if (target.effects['灼烧'] > 0) {
    // 50%概率获得1层燃烧 
    if (Math.random() < 0.5) {
      target.addEffect('燃烧', target.effects['灼烧']);
      eventBus.emit('add-battle-log', `${target.name}被灼烧，获得了${target.effects['灼烧']}层燃烧！`);
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
  
  // 处理超频效果
  if (attacker.effects['超频'] > 0) {
    // 10%概率双倍伤害
    if (Math.random() < 0.1) {
      finalDamage *= 2;
      eventBus.emit('add-battle-log', `${attacker.name}的攻击触发了超频效果，伤害翻倍！`);
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
      eventBus.emit('add-battle-log', `${target.name}被灼热的攻击烫伤，获得了${Math.floor(burnLevel)}层燃烧！`);
    }
  }
}