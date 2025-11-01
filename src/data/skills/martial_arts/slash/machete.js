// 刀系列技能
// 丢卡
import Skill from '@data/skill';
import { createAndSubmitDropSkillCard, createAndSubmitLaunchAttack, createAndSubmitAwaitPlayerInput, createAndSubmitSelectCardsFromFrontier } from '@data/battleInstructionHelpers.js';
import backendEventBus, {EventNames} from "@/backendEventBus";
import { backendGameState as gameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";
import {countString, quantifierString} from "@/utils/nameUtils";

// 花刀（C-）（刀系列）
export class Machete extends Skill {
  constructor(
    name = '花刀',
    tier = SkillTier.C_MINUS,
    damage = 11,
    powerMultiplier = 3,
    times = 1,
    breakAtSelf = false,
    selectiveDrop = false) {
    super(name, 'normal', tier, 0, 1, 1, '刀');
    this.baseColdDownTurns = 3; // 基础冷却时间
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.times = times; // 攻击次数
    this.breakAtSelf = breakAtSelf; // 是否在自己位置断开丢卡
    this.selectiveDrop = selectiveDrop;
  }

  get damage() {
    return Math.max(7, this.baseDamage + this.powerMultiplier * this.power);
  }

  use(player, enemy, stage, ctx) {
    if (!ctx.i) ctx.i = 0;
    if (ctx.i >= this.times) return true;

    // 每次循环分两阶段：先攻击，再丢弃
    if (!ctx.phase || ctx.phase === 'attack') {
      createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
      ctx.phase = 'drop';
      return false;
    }

    // 丢弃逻辑
    if(this.selectiveDrop) {
      // 异步选择：排除自身，选择1张
      if (!ctx.awaitInst) {
        ctx.awaitInst = createAndSubmitSelectCardsFromFrontier(player, {
          exclude: [this.uniqueID],
          min: 1,
          max: 1
        }, ctx?.parentInstruction ?? null);
        return false;
      } else {
        const sel = ctx.awaitInst.result;
        const id = sel?.selectedIDs?.[0];
        if (id) createAndSubmitDropSkillCard(player, id, -1, ctx?.parentInstruction ?? null);
        ctx.awaitInst = null;
      }
    } else {
      const selfIndex = gameState.player.frontierSkills.findIndex(skill => skill.uniqueID === this.uniqueID);
      if (selfIndex === -1 || selfIndex !== 0) {
        if (gameState.player.frontierSkills.length > 0) {
          const leftID = gameState.player.frontierSkills[0]?.uniqueID;
          if (leftID && leftID !== this.uniqueID) {
            createAndSubmitDropSkillCard(player, leftID, -1, ctx?.parentInstruction ?? null);
          }
        }
      } else {
        if (this.breakAtSelf) {
          ctx.i = this.times;
          return true;
        }
        if (gameState.player.frontierSkills.length > 1) {
          const rightID = gameState.player.frontierSkills[1]?.uniqueID;
          if (rightID) createAndSubmitDropSkillCard(player, rightID, -1, ctx?.parentInstruction ?? null);
        }
      }
    }

    ctx.i += 1;
    ctx.phase = 'attack';
    return ctx.i >= this.times;
  }

  regenerateDescription(player) {
    if(this.selectiveDrop) {
      return `${this.damage + (player?.attack ?? 0)}伤害，选1手牌丢弃${this.times > 1 ? `，重复${this.times - 1}次` : ''}`;
    } else {
      if (this.breakAtSelf) {
        return `丢弃/named{前方}所有卡，每张造成${this.damage + (player?.attack ?? 0)}伤害`;
      }
      if (this.times > 1) {
        return `${this.damage + (player?.attack ?? 0)}伤害，丢弃最左侧卡，重复${this.times - 1}`;
      }
      return `${this.damage + (player?.attack ?? 0)}伤害，丢弃最前方卡`;
    }
  }
}

// 二重花刀（C+）（刀系列）
export class DoubleMachete extends Machete {
  constructor() {
    super('二重花刀', SkillTier.C_PLUS, 8, 2, 2);
    this.precessor = '花刀';
  }
}

// 快速花刀（B-）（刀系列）
// 冷却降低
export class AgileMachete extends Machete {
  constructor() {
    super('快速花刀', SkillTier.B_MINUS, 14, 2, 1);
    this.precessor = '花刀';
    this.baseColdDownTurns = 1; // 基础冷却时间
  }
}

// 银刀乱舞（B）（刀系列）
// 丢弃此卡前方所有卡
export class DanceMachete extends Machete {
  constructor() {
    super('银刀乱舞', SkillTier.B_PLUS, 10, 3, 100, true);
    this.precessor = '二重花刀';
  }
}

// 风暴刀舞（A-）
// 丢所有卡
export class StormMachete extends Machete {
  constructor() {
    super('风暴刀舞', SkillTier.A_MINUS, 14, 5, 100, false);
    this.precessor = '银刀乱舞';
    this.baseColdDownTurns = 4; // 基础冷却时间
  }
}

// 完美花刀（B+）（刀系列）
// 选牌丢弃
export class PerfectMachete extends Machete {
  constructor() {
    super('完美花刀', SkillTier.B_MINUS, 14, 2, 1, false, true);
    this.precessor = '快速花刀';
    this.baseColdDownTurns = 1; // 基础冷却时间
  }
}