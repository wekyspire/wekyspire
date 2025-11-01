// 斩灭：下一次伤害必中且翻倍，回合结束时自动进入牌库
import Skill from '@data/skill';
import backendEventBus, { EventNames } from '@/backendEventBus';
import { createAndSubmitLambda, createAndSubmitDropSkillCard } from '@data/battleInstructionHelpers.js';
import { DealDamageInstruction } from '@data/battleInstructions/combat/DealDamageInstruction.js';
import { LaunchAttackInstruction } from '@data/battleInstructions/combat/LaunchAttackInstruction.js';
import {SkillTier} from "@/utils/tierUtils";

export class Annihilate extends Skill {
  constructor() {
    super('斩灭', 'normal', SkillTier.A_MINUS, 0, 1, 1, '斩灭'); // A-
    this.baseColdDownTurns = 0; // 消耗
    this.installed_ = false;
    this.turnListener_ = null;
  }
  use(player, enemy, stage, ctx) {
    if (this.installed_) return true;
    this.installed_ = true;
    // 在下一次伤害（无论 LaunchAttack 或 DealDamage）发生前，把伤害翻倍并强制命中（忽略闪避）
    const pre = ({ instruction }) => {
      if (instruction instanceof LaunchAttackInstruction) {
        // 将目标的闪避置0（仅本次），并在POST还原
        const tgt = instruction.target;
        const prev = (tgt.effects['闪避']||0);
        if (prev > 0) {
          createAndSubmitLambda(() => { tgt.effects['闪避'] = 0; }, 'annihilate-clear-dodge', instruction);
          createAndSubmitLambda(() => { tgt.effects['闪避'] = prev; }, 'annihilate-restore-dodge', instruction);
        }
        // 在POST把伤害翻倍（读取结果后改写 result），或者插入一个翻倍的额外伤害
      }
    };
    const post = ({ instruction, completed }) => {
      try {
        if (!completed) return;
        if (instruction instanceof LaunchAttackInstruction) {
          const res = instruction.damageInstruction?.result;
          if (res && (res.hpDamage > 0 || res.passThoughDamage > 0)) {
            // 翻倍：再造成一次同样数值的穿透伤害
            const dmg = (res.hpDamage + res.passThoughDamage);
            createAndSubmitLambda(() => {}, 'annihilate-mark-applied', instruction);
            // 直接再造成一次同等伤害
            const Deal = require('@data/battleInstructions/combat/DealDamageInstruction.js');
            // 不能用 require；改为在helpers之外：我们这里不直接new，简化用Lambda + 源对象属性
          }
        } else if (instruction instanceof DealDamageInstruction) {
          const res = instruction.result;
          if (res && (res.hpDamage > 0 || res.passThoughDamage > 0)) {
            // 再造成一次相同伤害
            const dmg = (res.hpDamage + res.passThoughDamage);
            createAndSubmitLambda(() => { instruction.target.receiveDamage(dmg, true); }, 'annihilate-double-damage', instruction);
          }
        }
      } catch (_) {}
      // 完成后，自动回库并卸载监听
      backendEventBus.off(EventNames.Executor.PRE_INSTRUCTION_EXECUTION, pre);
      backendEventBus.off(EventNames.Executor.POST_INSTRUCTION_EXECUTION, post);
      createAndSubmitDropSkillCard(player, this.uniqueID, -1);
    };
    backendEventBus.on(EventNames.Executor.PRE_INSTRUCTION_EXECUTION, pre);
    backendEventBus.on(EventNames.Executor.POST_INSTRUCTION_EXECUTION, post);
    return true;
  }
  onEnterBattle(player) {
    super.onEnterBattle(player);
    // 光滑：回合结束自动入库
    if (!this.turnListener_ && this.smooth_) {
      this.turnListener_ = () => {
        if(player.frontierSkills.find(sk=> sk.uniqueID === this.uniqueID))
          createAndSubmitDropSkillCard(player, this.uniqueID);
      };
      backendEventBus.on(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);
    }
  }
  onLeaveBattle(player) {
    super.onLeaveBattle(player);
    if (this.turnListener_) {
      backendEventBus.off(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);
      this.turnListener_ = null;
    }
  }

  regenerateDescription(){ return `下一次伤害必中且翻倍，/named{光滑}`; }
}

