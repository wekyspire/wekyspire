import Skill from '@data/skill';
import { createAndSubmitLaunchAttack, createAndSubmitDrawSkillCard } from '@data/battleInstructionHelpers.js';
import {SkillTier} from '@/utils/tierUtils';

// 敏捷打击（C+）（敏捷打击）
// 连续攻击，造成伤害则抽牌
export class AgilePunch extends Skill {
  constructor(name = '敏捷打击', tier = SkillTier.C_MINUS, damage = 9, powerMultiplier = 3, times = 1, drawCardCount = 1) {
    super(name, 'normal', tier, 0, 1, 1, '敏捷打击');
    this.baseColdDownTurns = 4;
    this.powerMultiplier = powerMultiplier;
    this.baseDamage = damage;
    this.times = times;
    this.drawCardCount = drawCardCount;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 1);
  }

  get damage() {
    return Math.max(this.baseDamage + this.powerMultiplier * this.power, 4);
  }

  // 多阶段：每两阶段完成一次“打击+按需抽牌”
  use(player, enemy, stage, ctx) {
    if (!ctx.hits) ctx.hits = 0;
    if (ctx.hits >= this.times) return true;

    if (!ctx.phase || ctx.phase === 'attack') {
      // 阶段A：攻击
      const inst = createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      ctx.lastAttackInst = inst;
      ctx.phase = 'draw';
      return false;
    } else {
      // 阶段B：根据命中决定抽牌
      const result = ctx.lastAttackInst?.attackResult;
      if (result && result.passThoughDamage > 0 && this.drawCardCount > 0) {
        createAndSubmitDrawSkillCard(player, this.drawCardCount, ctx?.parentInstruction ?? null);
      }
      ctx.hits += 1;
      ctx.phase = 'attack';
      return ctx.hits >= this.times;
    }
  }

  regenerateDescription(player) {
    const desc =  `造成${this.damage + (player?.attack ?? 0)}点伤害，造成伤害则抽牌`;
    if(this.times > 1) return `${desc}，重复${this.times - 1}次`;
    return desc;
  }
}

// 敏捷连击（C+）（敏捷打击）
// 攻击两次
export class AgileDoublePunch extends AgilePunch {
  constructor() {
    super('敏捷连击', SkillTier.C_PLUS, 8, 3, 2);
    this.precessor = '敏捷打击';
  }
}

// 疾风连击（B）（敏捷打击）
// 攻击三次
export class AgileTriplePunch extends AgilePunch {
  constructor() {
    super('疾风连击', SkillTier.B, 8, 3, 3);
    this.precessor = '敏捷连击';
  }
}

// 闪电连击（B+）（敏捷打击）
// 攻击三次，每次抽2张牌
export class AgileLightningPunch extends AgilePunch {
  constructor() {
    super('闪电连击', SkillTier.B_PLUS, 5, 3, 3, 2);
    this.precessor = '疾风连击';
  }
}

// 暴风连击（B+）（敏捷打击）
// 攻击六次
export class ThunderFist extends AgilePunch {
  constructor() {
    super('奔雷连击', SkillTier.B_PLUS, 8, 3, 6);
    this.precessor = '疾风连击';
  }
}

// 全神击（A-）（敏捷打击）
// 攻击一次，抽3张牌
export class AgileAllPunch extends AgilePunch {
  constructor() {
    super('全神击', SkillTier.A_MINUS, 44, 6, 1, 3);
    this.precessor = ['闪电连击', '暴风连击'];
  }
}

// 闪光连击（A-）（敏捷打击）
// 攻击九次
export class AgileFlashPunch extends AgilePunch {
  constructor() {
    super('闪光连击', SkillTier.A_MINUS, 8, 3, 9);
    this.precessor = ['闪电连击', '暴风连击'];
  }
}