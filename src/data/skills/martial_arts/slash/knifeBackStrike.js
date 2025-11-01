// 刀背打击系列：从右手边丢牌
import Skill from '@data/skill';
import { createAndSubmitDropSkillCard, createAndSubmitLaunchAttack } from '@data/battleInstructionHelpers.js';
import { backendGameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";

export class BaseKnifeBackStrike extends Skill {
  constructor(name = '刀背打击', tier = SkillTier.C_MINUS, damage = 12, drops = 1) {
    super(name, 'normal', tier, 0, 1, 1, '刀背打击');
    this.baseColdDownTurns = 2;
    this.baseDamage = damage;
    this.drops = drops;
  }
  get damage() { return Math.max(this.baseDamage + 3 * this.power, 6); }
  use(player, enemy, stage, ctx) {
    // 先攻击，再从右侧依次丢弃 drops 张
    if (!ctx.phase || ctx.phase === 'attack') {
      createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      ctx.phase = 'drop';
      return false;
    } else {
      let removed = 0;
      for (let i = 1; i <= backendGameState.player.frontierSkills.length; i++) {
        const rightMost = backendGameState.player.frontierSkills[backendGameState.player.frontierSkills.length - i];
        if (rightMost && rightMost.uniqueID && rightMost.uniqueID !== this.uniqueID) {
          createAndSubmitDropSkillCard(player, rightMost.uniqueID, -1, ctx?.parentInstruction ?? null);
          removed += 1;
        }
        if (removed >= this.drops) break;
      }
      ctx.phase = 'attack';
      return true;
    }
  }
  regenerateDescription(player) { return `造成${this.damage + (player?.attack ?? 0)}伤害，丢最右${this.drops}牌`; }
}

export class KnifeBackStrike extends BaseKnifeBackStrike {
  constructor(){
    super('刀背强击', SkillTier.C_PLUS, 12, 1);
    this.precessor = '刀背打击';
  }
}
export class KnifeBackCleave extends BaseKnifeBackStrike {
  constructor(){
    super('刀背破击', SkillTier.B_MINUS, 18, 1);
    this.precessor = '刀背打击';
  }
}
export class KnifeBackSmash extends BaseKnifeBackStrike {
  constructor(){
    super('刀背碎击', SkillTier.B, 25, 2);
    this.precessor = '刀背强击';
  }
}

