// 精准系列
// 高要求、高伤害

import Skill from "@data/skill";
import { createAndSubmitDealDamage, createAndSubmitLaunchAttack, createAndSubmitDrawSkillCard, createAndSubmitAddEffect } from '@data/battleInstructionHelpers.js';
import {enqueueDelay} from '@data/animationInstructionHelpers';
import {SkillTier} from '@/utils/tierUtils';
import enemy from '@data/enemy';

// 精准一击（D）（精准）
// 此技能只有当此技能前方所有技能都可用时才可用，造成13伤害
export class PreciseAttack extends Skill {
  constructor(name = '精心一击', tier = 0, baseDamage = 13, powerMultiplier = 5, times = 1, directDamage = true) {
    super(name, 'normal', tier, 0, 2, 1, '精准');
    this.baseColdDownTurns = 1;
    this.baseDamage = baseDamage;
    this.powerMultiplier = powerMultiplier;
    this.times = times;
    this.directDamage = directDamage;
    this.postEffect = null;
  }

  get damage () {
    return Math.max(this.baseDamage + this.powerMultiplier * this.power, 6);
  }

  getDamage(enemy) {
    return this.damage;
  }

  canUse (player) {
    const forwardSkills = player.frontierSkills.slice(0, this.getInBattleIndex(player));
    return super.canUse(player) && forwardSkills.every(skill => skill.canUse(player));
  }

  use(player, enemy, stage, ctx) {
    if (!ctx.i) ctx.i = 0;
    if (ctx.i >= this.times) return true;

    // 逐次结算；命中结果用于 postEffect
    let inst = null;
    if (!this.directDamage) inst = createAndSubmitLaunchAttack(player, enemy, this.getDamage(enemy), ctx?.parentInstruction ?? null);
    else inst = createAndSubmitDealDamage(player, enemy, this.getDamage(enemy), false, ctx?.parentInstruction ?? null);

    // 如果有后置效果需求，保存本次指令结果句柄
    ctx.lastInst = inst;
    ctx.i += 1;
    enqueueDelay(300);

    // 如果定义了 postEffect，在下一个阶段执行（或也可以即时执行；此处统一延一拍）
    if (this.postEffect) {
      if (!ctx.pendingPost) ctx.pendingPost = [];
      ctx.pendingPost.push(inst);
    }

    // 在每两阶段里处理：奇数阶段为后置效果
    if (!ctx.phase || ctx.phase === 'effect') {
      ctx.phase = 'attack';
      return false;
    } else {
      // 处理累计的后置
      if (this.postEffect && ctx.pendingPost?.length) {
        const last = ctx.pendingPost.shift();
        const res = last?.attackResult ?? last?.result;
        try { this.postEffect(player, enemy, res); } catch (_) {}
      }
      ctx.phase = 'effect';
      return ctx.i >= this.times && (!ctx.pendingPost || ctx.pendingPost.length === 0);
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(this.times > 1) {
      return `${this.times}次${this.damage + (player?.attack ?? 0)}伤害，/named{前方}牌可用时可用`;
    }
    return `${this.damage + (player?.attack ?? 0)}伤害，/named{前方}牌可用时可用`;
  }
}

// 精准一击（C-）（精准）
// 造成19伤害
export class PreciseSingleAttack extends PreciseAttack {
  constructor() {
    super('精心一击', 1, 19, 6, 1);
    this.precessor = null;
  }
}

// 精心二击（C+）（精心一击延伸卡）
// 造成11伤害2次
export class PreciseDoubleAttack extends PreciseAttack {
  constructor() {
    super('精心二击', 2, 11, 3, 2);
    this.precessor = '精心一击';
  }
}

// 掌击（B-）（精准一击延伸卡）
// 造成25伤害，抽一张卡
export class PalmStrike extends PreciseAttack {
  constructor() {
    super('掌击', 3, 25, 7, 1, false);
    this.precessor = '精准一击';
  }

  use(player, enemy, stage, ctx) {
    // 一次性：伤害后抽1张
    const done = super.use(player, enemy, stage, ctx);
    if (done) {
      createAndSubmitDrawSkillCard(player, 1, ctx?.parentInstruction ?? null);
    }
    return done;
  }

  regenerateDescription(player) {
    if (player) {
      return `${this.damage + (player?.attack ?? 0)}伤害，抽1张牌，/named{前方}牌可用时可用`;
    }
    return `${this.damage}伤害，抽1张牌，/named{前方}牌可用时可用`;
  }
}

// 弱点攻击（B-）（精准一击衍生卡）
// 造成23伤害，敌人虚弱则额外造成16伤害
export class WeakPointAttack extends PreciseAttack {
  constructor(name = '弱点攻击', tier = 3) {
    super(name, tier, 23, 8, 1);
    this.precessor = '精准一击';
  }

  get extraDamage() {
    return 16 + this.power * 4;
  }

  shouldApplyExtraDamage(enemy) {
    return enemy.effects['虚弱'] > 0;
  }

  getDamage(enemy) {
    let extraDamage = 0;
    if(this.shouldApplyExtraDamage(enemy)) {
      extraDamage = this.extraDamage;
    }
    return this.damage + extraDamage;
  }

  regenerateDescription(player) {
    if (player) {
      return `${this.damage + (player?.attack ?? 0)}伤害，敌人/effect{虚弱}则伤害增${this.extraDamage}，/named{前方}牌可用时可用`;
    }
    return `${this.damage}伤害，敌人/effect{虚弱}则伤害增${this.extraDamage}，/named{前方}牌可用时可用`;
  }
}

// 折杨手（B-）（精准）
// 造成23伤害，命中则获得格挡
export class SwiftHandAttack extends PreciseAttack {
  constructor(name = '折杨手', tier = SkillTier.B_MINUS, damage = 23) {
    super(name, tier, damage, 8, 1);
    this.precessor = '精准一击';
  }

  onEnterBattle(player) {
    super.onEnterBattle(player);
    this.postEffect = (player, enemy, attackResult) => {
      if(attackResult && (attackResult.passThoughDamage > 0 || attackResult.hpDamage > 0)) {
        player.addEffect('格挡', 1);
      }
    };
  }

  onLeaveBattle(player) {
    super.onLeaveBattle(player);
    this.postEffect = null;
  }

  use(player, enemy, stage, ctx) {
    return super.use(player, enemy, stage, ctx);
  }

  regenerateDescription(player) {
    if (player) {
      return `${this.damage + (player?.attack ?? 0)}伤害，命中则获得/effect{格挡}，/named{前方}牌可用时可用`;
    }
    return `${this.damage}伤害，命中则获得/effect{格挡}，/named{前方}牌可用时可用`;
  }
}

// 揽云手（B+）（精准）
// 造成23伤害2次，命中则获得格挡
export class CloudHandAttack extends SwiftHandAttack {
  constructor() {
    super('摘云手', SkillTier.B_PLUS);
    this.times = 2;
    this.precessor = '弱点攻击';
  }
}

// 摘星手（A-）（精准）
// 造成23伤害3次，命中则获得格挡
export class StarHandAttack extends SwiftHandAttack {
  constructor() {
    super('摘星手', SkillTier.A_MINUS);
    this.times = 3;
    this.precessor = '摘云手';
  }
}