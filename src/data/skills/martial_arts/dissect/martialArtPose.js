// 武术姿态
// 格挡和格挡转换
import Skill from "@data/skill";
import {backendGameState} from '@data/gameState';
import backendEventBus, {EventNames} from '@/backendEventBus';
import {SkillTier} from '@/utils/tierUtils';
import {modifiedNumberString} from '@/utils/nameUtils';

// 防御准备（C-）（姿态）
// 回合开始获得格挡，最多1层
export class BasicDefensePose extends Skill {
  constructor(
    name = '防御准备', tier = SkillTier.C_PLUS,
    coldDown = 0, apCost = 3, maxStack = 1, stackRecovery = 1
  ) {
    super(name, 'normal', tier, 0, apCost, 1, '姿态');
    this.baseColdDownTurns = coldDown;
    this.maxStack = maxStack;
    this.cardMode = 'chant';
    this.stackRecovery = stackRecovery;
    this.listener_ = null;
    this.extra_func_ = null;
  }

  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 0);
  }

  onEnable(player) {
    super.onEnable(player);
    this.listener_ = () => {
      const player = backendGameState.player.getModifiedPlayer();
      if(this.extra_func_) {
        this.extra_func_(player);
      }
      if((player.effects['格挡'] || 0) < this.maxStack) {
        const deltaStack = Math.min(this.stackRecovery, this.maxStack - (player.effects['格挡'] || 0));
        player.addEffect('格挡', deltaStack);
      }
    };
    backendEventBus.on(EventNames.Battle.PLAYER_TURN, this.listener_);
  }

  onDisable(player) {
    super.onDisable(player);
    if(this.listener_) {
      backendEventBus.off(EventNames.Battle.PLAYER_TURN, this.listener_);
      this.listener_ = null;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `回合开始获得/effect{格挡}，最多${this.maxStack}层`;
  }
}

// 防御姿态（C+）（姿态）
// 不再是消耗卡
export class DefensePose extends BasicDefensePose {
  constructor() {
    super('防御姿态', SkillTier.C_PLUS, 3, 3, 1);
    this.precessor = '防御准备';
  }
}

// 武术准备（C+）（姿态）
// 攻击提升格挡+1
export class BasicFightPose extends Skill {
  constructor(
    name = '武术准备', tier = SkillTier.C_PLUS,
    coldDown = 0, apCost = 2, multiplier = 1, powerUpMultiplier = 0
  ) {
    super(name, 'normal', tier, 0, apCost, 1, '姿态');
    this.baseColdDownTurns = coldDown;
    this.cardMode = 'chant';
    this.multiplier = multiplier;
    this.powerUpMultiplier = powerUpMultiplier; // 获得格挡时提升力量
    this.listener_ = null;
    this.modifier_ = null;
  }

  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 0);
  }

  onEnable(player) {
    super.onEnable(player);
    if(this.powerUpMultiplier > 0) {
      this.listener_ = ({effectName, deltaStacks}) => {
        if(effectName === '格挡' && deltaStacks > 0) {
          const player = backendGameState.player.getModifiedPlayer();
          player.addEffect('力量', this.powerUpMultiplier);
        }
      };
      backendEventBus.on(EventNames.Player.EFFECT_CHANGED, this.listener_);
    }
    if(this.multiplier > 0) {
      this.modifier_ = (player) => {
        const self = this;
        return new Proxy(player, {
          get(target, prop, receiver) {
            if (prop === 'attack') {
              return target.attack + (target.effects['格挡'] || 0) * self.multiplier;
            }
            return target[prop];
          }
        });
      };
      player.addModifier(this.modifier_);
    }
  }

  onDisable(player) {
    super.onDisable(player);
    if(this.listener_) {
      backendEventBus.off(EventNames.Player.EFFECT_CHANGED, this.listener_);
      this.listener_ = null;
    }
    if (this.modifier_) {
      player.removeModifier(this.modifier_);
      this.modifier_ = null;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    let str = '';
    if(this.multiplier > 0) str += `每层/effect{格挡}提供${modifiedNumberString(this.multiplier)}攻击。`;
    if(this.powerUpMultiplier > 0) str += `获得/effect{格挡}时获得${modifiedNumberString(this.powerUpMultiplier)}力量`;
    return str;
  }
}

// 守护姿态（B-）（姿态）
// 回合开始获得格挡，最多3层
export class GuardPose extends BasicDefensePose {
  constructor() {
    super('守护姿态', SkillTier.B_MINUS, 3, 3, 3);
    this.precessor = ['防御姿态', '武术准备'];
  }
}


// 狂战姿态（B-）（姿态）
// 获得格挡时提升1力量，但格挡不再提供攻击
export class BerserkerPose extends BasicFightPose {
  constructor() {
    super('狂战姿态', SkillTier.B_MINUS, 0, 2, 0, 1);
    this.precessor = ['防御姿态', '武术准备'];
  }
}

// 武术姿态（B）（姿态）
// 格挡提升2攻击
export class MartialArtPose extends BasicFightPose {
  constructor() {
    super('武术姿态', SkillTier.B, 0, 2, 2);
    this.precessor = ['武术准备', '狂战姿态'];
  }
}

// 狂战掌控（B+）（姿态）
// 相比狂战姿态，冷却变成1回合，AP开销变成1
export class BerserkerControl extends BasicFightPose {
  constructor() {
    super('狂战掌控', SkillTier.B_PLUS, 1, 1, 0, 1);
    this.precessor = '狂战姿态';
  }
}

// 大师姿态（B+）（姿态）
// 相比武术姿态，冷却变成1回合，AP开销变成1
export class MasterPose extends BasicFightPose {
  constructor() {
    super('大师姿态', SkillTier.A_MINUS, 1, 1, 2);
    this.precessor = '武术姿态';
  }
}

// 真武姿态（A-）（姿态）
// 每层格挡提升3攻击
export class TrueMartialArtPose extends BasicFightPose {
  constructor() {
    super('真武姿态', SkillTier.A_MINUS, 1, 1, 3);
    this.precessor = '大师姿态';
  }
}

// 天一姿态（A）（姿态）
// 每层格挡提升5攻击
export class TianYi extends BasicFightPose {
  constructor() {
    super('天一姿态', SkillTier.A, 1, 1, 5);
    this.precessor = '真武姿态';
  }
}

// 龟守姿态（B+）（姿态）
// 回合开始获得格挡，一次获得2层，最多5层，回合开始少抽1牌
export class TurtlePose extends BasicDefensePose {
  constructor(maxStacks = 5, deltaDrawCardCount = 1) {
    super('龟守姿态', SkillTier.B_PLUS, 3, 3, maxStacks, 2);
    this.precessor = '守护姿态';
    this.modifier_ = null;
    this.deltaDrawCardCount = deltaDrawCardCount;
  }
  onEnable(player) {
    super.onEnable(player);
    this.modifier_ = (player) => {
      const self = this;
      return new Proxy(player, {
        get(target, prop) {
          if(prop === 'drawFrontierSkills') {
            return Math.max(target.drawFrontierSkills - self.deltaDrawCardCount, 0);
          }
          return target[prop];
        }
      });
    };
    player.addModifier(this.modifier_);
  }
  onDisable(player) {
    super.onDisable(player);
    if (this.modifier_) {
      player.removeModifier(this.modifier_);
      this.modifier_ = null;
    }
  }
  regenerateDescription(player) {
    return super.regenerateDescription(player) + `，回合开始抽牌${modifiedNumberString(-this.deltaDrawCardCount)}`;
  }
}

// 玄龟姿态（A-）（姿态）
// 相比龟守姿态，层数上限提升至8层
export class MysticTurtlePose extends TurtlePose {
  constructor() {
    super(8);
    this.name = '玄龟姿态';
    this.tier = SkillTier.A_MINUS;
    this.precessor = '龟守姿态';
    this.maxStack = 8;
  }
}

// 神龟姿态（A）（姿态）
// 相比龟缩姿态，少抽1牌变成多抽1牌
export class DivineTurtlePose extends TurtlePose {
  constructor() {
    super(5, -1);
    this.name = '神龟姿态';
    this.tier = SkillTier.A;
    this.precessor = ['玄龟姿态', '龟守姿态'];
  }
}