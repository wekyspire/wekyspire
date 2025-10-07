// battleUtil.js - 提供战斗中的攻击结算、治疗结算等修改战斗状态相关助手函数，以供技能、敌人和效果结算逻辑调用

import {
  processPostAttackEffects, processAttackTakenEffects, processDamageTakenEffects, processAttackFinishEffects
} from './effectProcessor.js';
import { addBattleLog, addDamageLog, addDeathLog, addHealLog } from './battleLogUtils.js';
import {captureSnapshot, enqueueAnimateCardById, enqueueState} from "./animationInstructionHelpers";
import {enqueueHurtAnimation, enqueueUnitDeath} from "./animationInstructionHelpers";
import backendEventBus, {EventNames} from "../backendEventBus";

// 将护盾/生命结算 + 日志输出 + 死亡判定抽象为通用助手
function applyDamageAndLog(target, mitigatedDamage, { mode = 'attack', attacker = null, source = null } = {}) {
  const passThoughDamage = mitigatedDamage;
  let hpDamage = 0;

  if (mitigatedDamage > 0) {
    // 先打护盾
    const shieldDamage = Math.min(target.shield, mitigatedDamage);
    mitigatedDamage -= shieldDamage;
    hpDamage = mitigatedDamage;

    // 入队受伤/治疗动画指令（通过前端事件驱动实际播放）
    enqueueHurtAnimation({
      unitId: target.uniqueID, hpDamage: hpDamage, passThroughDamage: passThoughDamage
    });

    // 更新生命值状态
    target.shield -= shieldDamage;
    target.hp = Math.max(target.hp - mitigatedDamage, 0);

    if (mitigatedDamage > 0) {
      if (mode === 'attack') {
        if (attacker) {
          addDamageLog(`${attacker.name} 攻击了 ${target.name}，造成 /red{${mitigatedDamage}} 点伤害！`);
        } else {
          addDamageLog(`你受到${mitigatedDamage}点伤害！`);
        }
      } else {
        // direct（dealDamage）风格
        addDamageLog(`你${source ? `从${source.name}受到` : '受到'}${mitigatedDamage}点伤害！`);
      }
    } else {
      if (mode === 'attack') {
        if (attacker) addBattleLog(`${attacker.name} 攻击了 ${target.name}，被护盾拦下了！`);
        else addBattleLog(`你的护盾挡下伤害！`);
      } else {
        addBattleLog(`你的护盾挡下${source ? `自${source.name}` : ''}的伤害。`);
      }
    }
  } else {
    // 入队闪避动画指令（通过前端事件驱动实际播放）
    enqueueHurtAnimation({
      unitId: target.uniqueID, hpDamage: 0, passThroughDamage: 0
    });
    if (mode === 'attack') {
      if (attacker) addBattleLog(`${attacker.name} 攻击了 ${target.name}，但不起作用！`);
      else addBattleLog(`你被攻击，但没有作用！`);
    } else {
      addBattleLog(`你${source ? `从${source.name}受到` : '受到'}伤害，但不起作用！`);
    }
  }

  // 所有伤害结算完毕，处理受到伤害时的效果
  processDamageTakenEffects(target, passThoughDamage, hpDamage)

  if (target.hp <= 0) {
    addDeathLog(`${target.name} 被击败了！`);
    return { dead: true, passThoughDamage, hpDamage };
  }

  return { dead: false, passThoughDamage, hpDamage };
}

// 任意攻击的结算逻辑（由skill、enemy和effect结算调用）
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function launchAttack (attacker, target, damage) {

  // 攻击者对攻击的后处理
  let finalDamage = damage + attacker.attack;
  if (attacker) {
    finalDamage = processPostAttackEffects(attacker, target, damage);
  }
  // 处理受到攻击时的效果
  finalDamage = processAttackTakenEffects(target, finalDamage);
  // 固定防御减免
  finalDamage = Math.max(finalDamage - target.defense, 0);

  const result = applyDamageAndLog(target, finalDamage, { mode: 'attack', attacker });

  if (!result.dead) {
    // 发射攻击完成事件，用于结算攻击特效等
    processAttackFinishEffects(attacker, target, result.hpDamage, result.passThoughDamage);
  } else {
    try { enqueueUnitDeath({ unitId: target.uniqueID }); } catch (_) {}
  }

  return result;
}

// 造成伤害的结算逻辑（由skill和enemy调用），和发动攻击不同，跳过攻击方攻击相关结算。
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function dealDamage (source, target, damage, penetrateDefense = false) {
  let finalDamage = damage;
  // 固定防御减免
  if(!penetrateDefense) finalDamage = Math.max(finalDamage - target.defense, 0);

  const result = applyDamageAndLog(target, finalDamage, { mode: 'direct', source });
  if (result.dead) {
    try { enqueueUnitDeath({ unitId: target.uniqueID }); } catch (_) {}
  }
  return result;
}

// 任意获得护盾的结算逻辑
export function gainShield (caster, target, shield) {
  target.shield += shield;
  if(caster === target) {
    addHealLog(`${target.name}获得了${shield}点护盾！`);
  } else {
    addHealLog(`${target.name}从${caster.name}获得了${shield}点护盾！`);
  }
  // 移除事件通知，改由状态变化驱动UI
}

// 统一的效果添加入口（通过动画队列事件）
export function addEffect(target, effectName, stacks = 1) {
  if (stacks === 0) return;
  if (target.effects[effectName]) {
    target.effects[effectName] += stacks;
  } else {
    target.effects[effectName] = stacks;
  }
}

// 统一的效果移除入口
export function removeEffect(target, effectName, stacks = 1) {
  addEffect(target, effectName, -stacks);
}
// 统一的治疗入口（通过 changeHp，考虑到上限）
export function applyHeal(target, heal) {
  // 统一的治疗入口
  const canHeal = Math.max(0, target.maxHp - target.hp);
  const delta = Math.min(canHeal, heal);
  target.hp += heal;
  if (target.hp > target.maxHp) target.hp = target.maxHp;
  // 入队治疗动画指令（hpDamage 传负值表示治疗）
  try { enqueueHurtAnimation({ unitId: target.uniqueID, hpDamage: -Math.abs(delta), passThroughDamage: 0 }); } catch (_) {}
}

export function drawSkillCard(player, number = 1) {
  let returnSkill = null;
  let ids = [];
  for (let i = 0; i < number; i++) {
    if (player.frontierSkills.length >= player.maxHandSize) {
      // addBattleLog('你的手牌已满，无法抽取更多卡牌！');
      break;
    }
    if (player.backupSkills.length === 0) {
      // addBattleLog('你的后备技能已空，无法抽取更多卡牌！');
      break;
    }
    // 对于入手而言，动画由后端统一触发
    const firstSkill = player.backupSkills.shift();

    // 手动触发入手动画，与其他卡牌动画保持一致（等待前序动画完成）
    if (firstSkill && firstSkill.uniqueID) {
      player.frontierSkills.push(firstSkill);
      ids.push(firstSkill.uniqueID);
    }
    if(i === 0) {
      returnSkill = firstSkill;
    }
  }
  enqueueState({snapshot: captureSnapshot(), durationMs: 0});
  ids.forEach((id) => {
    enqueueAnimateCardById(
      {id: id, kind: 'appearFromAnchor', options: {anchor: 'deck', durationMs: 500, startScale: 0.6, fade: true}},
      {waitTags: ['state', 'ui'], durationMs: 200}
    );
  });
  return returnSkill;
}

export function dropSkillCard(player, skillID) {
  const index = player.frontierSkills.findIndex(skill => skill.uniqueID === skillID);
  if (index !== -1) {
    // 播放动画
    enqueueAnimateCardById( {id: skillID, kind: 'drop'});
    // 执行逻辑
    const [droppedSkill] = player.frontierSkills.splice(index, 1);
    player.backupSkills.push(droppedSkill);
    // 触发技能丢弃事件
    backendEventBus.emit(EventNames.Player.SKILL_DROPPED, { skill: droppedSkill });
  } else {
    // 尝试从咏唱位丢弃
    const activatedIndex = Array.isArray(player.activatedSkills) ? player.activatedSkills.findIndex(skill => skill.uniqueID === skillID) : -1;
    if(activatedIndex !== -1) {
      enqueueAnimateCardById( {
        id: skillID,
        kind: 'drop',
        transfer: { type: 'deactivate', from: 'activated-bar', to: 'deck' }
      });
      const [droppedSkill] = player.activatedSkills.splice(activatedIndex, 1);
      player.backupSkills.push(droppedSkill);
      backendEventBus.emit(EventNames.Player.SKILL_DROPPED, { skill: droppedSkill });
    } else {
      console.warn(`技能ID为 ${skillID} 的技能不在前台/咏唱位列表中，无法丢弃。`);
    }
  }
}

export function burnSkillCard(player, skillID) {
  if(!skillID) {
    console.warn('未指定技能ID，无法焚烧技能。');
    return;
  }
  const frontierIndex = player.frontierSkills.findIndex(skill => skill.uniqueID === skillID);
  const backupIndex = player.backupSkills.findIndex(skill => skill.uniqueID === skillID);
  const activatedIndex = Array.isArray(player.activatedSkills) ? player.activatedSkills.findIndex(skill => skill.uniqueID === skillID) : -1;
  if(frontierIndex === -1 && backupIndex === -1 && activatedIndex === -1) {
    console.warn(`技能ID为 ${skillID} 的技能不在前台/后备/咏唱位列表中，无法焚烧。`);
    return;
  }
  // 判定来源容器，用于动画 transfer
  let fromContainer = 'unknown';
  if (activatedIndex !== -1) fromContainer = 'activated-bar';
  else if (frontierIndex !== -1) fromContainer = 'skills-hand';
  else if (backupIndex !== -1) fromContainer = 'deck';

  // 动画（先播动画再修改逻辑，以便 orchestrator 拿到当前位置 DOM）
  enqueueAnimateCardById( {id: skillID, kind: 'burn', transfer: { type: 'burn', from: fromContainer, to: 'graveyard' }});

  let exhaustedSkill = null;
  if (activatedIndex !== -1) {
    exhaustedSkill = player.activatedSkills.splice(activatedIndex, 1)[0];
    // 从总技能数组移除
    const skillListIndex = player.skills.findIndex(skill => skill === exhaustedSkill);
    if (skillListIndex !== -1) player.skills.splice(skillListIndex, 1);
    player.burntSkills.push(exhaustedSkill);
  } else if (frontierIndex !== -1) {
    exhaustedSkill = player.frontierSkills.splice(frontierIndex, 1)[0];
    const skillListIndex = player.skills.findIndex(skill => skill === exhaustedSkill);
    if (skillListIndex !== -1) {
      const burnt = player.skills.splice(skillListIndex, 1);
      player.burntSkills.push(burnt[0]);
    }
  } else if (backupIndex !== -1) {
    exhaustedSkill = player.backupSkills.splice(backupIndex, 1)[0];
    const skillListIndex = player.skills.findIndex(skill => skill === exhaustedSkill);
    if (skillListIndex !== -1) player.skills.splice(skillListIndex, 1);
    player.burntSkills.push(exhaustedSkill);
  }
  backendEventBus.emit(EventNames.Player.SKILL_BURNT, { skill: exhaustedSkill });
  enqueueState({ snapshot: captureSnapshot(), durationMs: 0 });
}

export function willSkillBurn(skill) {
  if (!skill) return false; // default safe
  // 返回 true 表示应该焚毁（不可再返回后备）
  // 与之前逻辑： (coldDownTurns !== 0 || maxUses === Infinity || remainingUses > 0) 则不 burn 相反
  const canReturn = (skill.coldDownTurns !== 0) || (skill.maxUses === Infinity) || (skill.remainingUses > 0);
  return !canReturn;
}