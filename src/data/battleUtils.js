// battleUtil.js - 提供战斗中的攻击结算、治疗结算等修改战斗状态相关助手函数，以供技能、敌人和效果结算逻辑调用

import eventBus from '../eventBus.js';
import { processPostAttackEffects, processDamageTakenEffects } from './effectProcessor.js';

// 从任意地方增添battleLog
export function addBattleLog (log) {
  eventBus.emit('add-battle-log', log);
}

// 任意攻击的结算逻辑（由skill、enemy和effect结算调用）
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function launchAttack (attacker, target, damage) {
  
  // 攻击者对攻击的后处理
  let finalDamage = damage;
  if (attacker) {
    finalDamage = processPostAttackEffects(attacker, target, damage);
  }
  // 处理受到伤害时的效果
  finalDamage = processDamageTakenEffects(target, finalDamage);
  // 固定防御减免
  finalDamage = Math.max(finalDamage - target.defense, 0);
  const passThoughDamage = finalDamage;
  let hpDamage = 0;
  
  if (finalDamage > 0) {
    // 优先伤害护盾（如果有）
    const shieldDamage = Math.min(target.shield, finalDamage);
    target.shield -= shieldDamage;
    finalDamage -= shieldDamage;
    hpDamage = finalDamage;
    target.hp = Math.max(target.hp - finalDamage, 0);
    if(finalDamage > 0) {
      eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，造成 /red{${finalDamage}} 点伤害！`);
    } else {
      eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，被护盾拦下了！`);
    }
  } else {
    eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，但不起作用！`);
  }
  
  // 检查目标是否死亡
  if (target.hp <= 0) {
    eventBus.emit('add-battle-log', `${target.name} 被击败了！`);
    return {dead: true, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
  }
  
  // 结算完成，发射受伤事件，用于通知UI播放动画、dialogue播放等
  eventBus.emit('unit-hurt', {target: target, passThoughDamage: passThoughDamage, hpDamage: hpDamage});

  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
  
  return {dead: false, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
}

// 造成伤害的结算逻辑（由skill和enemy调用），和发动攻击不同，跳过攻击方攻击发动结算。
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function dealDamage (attacker, target, damage) {
  return launchAttack(null, target, damage);
}

// 任意获得护盾的结算逻辑
export function gainShield (caster, target, shield) {
  target.shield += shield;
  if(caster === target) {
    eventBus.emit('add-battle-log', `${target.name}获得了${shield}点护盾！`);
  } else {
    eventBus.emit('add-battle-log', `${target.name}从${caster.name}获得了${shield}点护盾！`);
  }
  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
}