// battleUtil.js - 提供战斗中的攻击结算、治疗结算等修改战斗状态相关助手函数，以供技能、敌人和效果结算逻辑调用

import eventBus from '../eventBus.js';
import { processPostAttackEffects, processAttackTakenEffects, processDamageTakenEffects, processAttackFinishEffects } from './effectProcessor.js';

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
  // 处理受到攻击时的效果
  finalDamage = processAttackTakenEffects(target, finalDamage);
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
      if(attacker) {
        eventBus.emit('add-battle-log', `${attacker.name} 攻击了 ${target.name}，造成 /red{${finalDamage}} 点伤害！`);
      } else {
        eventBus.emit('add-battle-log', `你受到${finalDamage}点伤害！`);
      }
    } else {
      if(attacker) eventBus.emit('add-battle-log', `${attacker.name} 攻击了 ${target.name}，被护盾拦下了！`);
      else eventBus.emit('add-battle-log', `你的护盾挡下伤害！`);
    }
  } else {
    if(attacker) eventBus.emit('add-battle-log', `${attacker.name} 攻击了 ${target.name}，但不起作用！`);
    else eventBus.emit('add-battle-log', `你被攻击，但没有作用！`);
  }
  
  // 检查目标是否死亡
  if (target.hp <= 0) {
    eventBus.emit('add-battle-log', `${target.name} 被击败了！`);
    // 发射事件，用于结算死亡
    eventBus.emit('unit-dead-event', target);
    return {dead: true, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
  }

  // 发射攻击完成事件，用于结算攻击特效等
  processAttackFinishEffects(attacker, target, hpDamage, passThoughDamage);
  
  // 结算完成，发射受伤事件，用于通知UI播放动画、dialogue播放等
  eventBus.emit('unit-hurt', {target: target, passThoughDamage: passThoughDamage, hpDamage: hpDamage});

  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
  
  return {dead: false, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
}

// 造成伤害的结算逻辑（由skill和enemy调用），和发动攻击不同，跳过攻击方攻击相关结算。
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function dealDamage (source, target, damage, penetrateDefense = false) {
  let finalDamage = damage;
  // 处理受到伤害时的效果
  finalDamage = processDamageTakenEffects(target, finalDamage);
  // 固定防御减免
  if(!penetrateDefense) finalDamage = Math.max(finalDamage - target.defense, 0);
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
      eventBus.emit('add-battle-log', `你${source ? `从${source.name}受到` : '受到'}${finalDamage}点伤害！`);
    } else {
      eventBus.emit('add-battle-log', `你的护盾挡下${source ? `自${source.name}` : ''}的伤害。`);
    }
  } else {
    eventBus.emit('add-battle-log', `你${source ? `从${source.name}受到` : '受到'}伤害，但不起作用！`);
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

// 任意获得护盾的结算逻辑
export function gainShield (caster, target, shield) {
  target.shield += shield;
  if(caster === target) {
    eventBus.emit('add-battle-log', `${target.name}获得了${shield}点护盾！`);
  } else {
    eventBus.emit('add-battle-log', `${target.name}从${caster.name}获得了${shield}点护盾！`);
  }
  // 发送事件通知UI更新
  eventBus.emit('unit-shield-change', {target: target, deltaShield: shield});
  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
}

// 手动更新所有技能描述
export function updateSkillDescriptions() {
  eventBus.emit('update-skill-descriptions');
}