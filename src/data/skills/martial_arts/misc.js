// 一些单卡

import Skill from '@data/skill.js';
import { createAndSubmitLaunchAttack, createAndSubmitDealDamage, createAndSubmitDropSkillCard, createAndSubmitAddEffect } from '@data/battleInstructionHelpers.js';
import {signedNumberString, signedNumberStringW0} from "@/utils/nameUtils";
import {SkillTier} from "@/utils/tierUtils";

// 莽撞攻击（D）（莽撞攻击）
export class CarelessPunch extends Skill {
  constructor() {
    super('莽撞攻击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能（分两阶段）
  use(player, enemy, stage, ctx) {
    if (stage === 0) {
      createAndSubmitLaunchAttack(player, enemy, 10, ctx?.parentInstruction ?? null);
      return false;
    } else {
      createAndSubmitDealDamage(player, player, 3, true, ctx?.parentInstruction ?? null);
      return true;
    }
  }

  regenerateDescription(player) {
    const damage = 10 + (player?.attack ?? 0);
    return `造成${damage}点伤害，受3伤害`;
  }
}

// 狡黠打击（C+）（单卡）
// 造成9伤害，将最左侧牌置入牌堆顶
export class CunningPunch extends Skill {
  constructor() {
    super('狡黠打击', 'normal', SkillTier.C_PLUS, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  get damage() {
    return Math.max(9 + 4 * this.power, 4);
  }
  use(player, enemy, stage, ctx) {
    if (stage === 0) {
      createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      return false;
    } else {
      if (player.frontierSkills.length > 1) {
        const leftSkill = player.frontierSkills[0];
        if (leftSkill && leftSkill.uniqueID !== this.uniqueID) {
          // 放到牌库顶
          createAndSubmitDropSkillCard(player, leftSkill.uniqueID, 0, ctx?.parentInstruction ?? null);
        }
      }
      return true;
    }
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，将最左侧牌置入牌堆顶`;
  }
}

// 试探打击（C-）（单卡）
// 造成5伤害，获得1格挡
export class ProbingPunch extends Skill {
  constructor() {
    super('试探打击', 'normal', SkillTier.C_MINUS, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }
  get damage() {
    return Math.max(8 + 4 * this.power, 4);
  }
  use(player, enemy, stage, ctx) {
    if (stage === 0) {
      createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      return false;
    } else {
      createAndSubmitAddEffect(player, '格挡', 1, ctx?.parentInstruction ?? null);
      return true;
    }
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，获得1/effect{格挡}`;
  }
}

// 断子绝孙脚（C-）
// 造成6伤害，造成生命伤害则赋予虚弱
export class ElegantKick extends Skill {
  constructor() {
    super('断子绝孙脚', 'normal', 1, 0, 2, 1);
    this.baseColdDownTurns = 3;
  }

  get damage () {
    return Math.max(6 + 3 * this.power, 3);
  }

  use(player, enemy, stage, ctx) {
    // 拆成两阶段：阶段0 提交攻击；阶段1 读取攻击结果并按需加 debuff
    if (stage === 0) {
      const inst = createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      // 保存指令句柄到 ctx
      ctx.attackInst = inst;
      return false;
    } else {
      const result = ctx.attackInst?.attackResult;
      if (result && result.hpDamage > 0) {
        createAndSubmitAddEffect(enemy, '虚弱', 1, ctx?.parentInstruction ?? null);
      }
      return true;
    }
  }

  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，造成生命伤害则赋予/effect{虚弱}`;
  }
}
