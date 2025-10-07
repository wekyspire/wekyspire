// 集中系列技能

import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';
import { addBattleLog } from '../battleLogUtils.js';

// 思索（C-）
export class SmallThinking extends Skill {
  constructor() {
    super('思索', 'normal', 1, 0, 3);
    this.baseColdDownTurns = 4;
    this.baseSlowStart = true;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 1);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得1层/effect{集中}'
  }
}

// 深思（B-）
export class DeepThinking extends Skill {
  constructor() {
    super('深思', 'normal', 3, 0, 4);
    this.baseColdDownTurns = 5;
    this.baseSlowStart = true;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 2);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得2层/effect{集中}'
  }
}

// 推敲（B+）
export class CarefulThinking extends Skill {
  constructor() {
    super('推敲', 'normal', 5, 0, 5);
    this.baseColdDownTurns = 6;
    this.baseSlowStart = true;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 3);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得3层/effect{集中}'
  }
}

// 出神（A）
export class PureThinking extends Skill {
  constructor() {
    super('出神', 'normal', 7, 0, 7);
    this.baseColdDownTurns = 7;
    this.baseSlowStart = true;
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 5);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得5层/effect{集中}'
  }
}

// 顿悟（A）
export class Epiphany extends Skill {
  constructor() {
    super('顿悟', 'normal', 7, 0, 7, 1);
  }

  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 1);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 3);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得3层/effect{集中}'
  }
}

// 想入非非（C+）
export class DreamThinking extends Skill {
  constructor() {
    super('想入非非', 'normal', 2, 0, 1);
    this.baseColdDownTurns = 4;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
        player.addEffect('集中', 2);
        return false;
    } else {
        player.addEffect('眩晕', 1);
        return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得2层/effect{集中}，1层/effect{眩晕}'
  }
}

// 弱集中 （C-）
export class SmallConcentration extends Skill {
  constructor() {
    super('弱集中', 'normal', 1, 1, 1);
    this.baseColdDownTurns = 2;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 1);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得1层/effect{集中}'
  }
}

// 集中（C+）
export class Concentration extends Skill {
  constructor() {
    super('集中', 'normal', 2, 2, 1);
    this.baseColdDownTurns = 3;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('集中', 2);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得2层/effect{集中}'
  }
}

// 专注（B）
export class FullConcentration extends Skill {
  constructor() {
    super('专注', 'normal', 4, 3, 1, 1);
    this.cardMode = 'chant';
  }
  // 使用技能
  use(player, enemy, stage) {
    return true;
  }
  onEnable(player) {
    super.onEnable(player);
    player.addEffect('超然', 1);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
    player.removeEffect('超然', 1);
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return '/effect{超然}'
  }
}

// 忘我（A-）
export class MaximumConcentration extends Skill {
  constructor() {
    super('忘我', 'normal', 6, 5, 1, 1);
    this.cardMode = 'chant';
  }

  // 使用技能
  use(player, enemy, stage) {
    return true;
  }
  onEnable(player) {
    super.onEnable(player);
    player.addEffect('超然', 2);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
    player.removeEffect('超然', 2);
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '2层/effect{超然}'
  }
}

// 纯粹（A+）
export class Devotion extends Skill {
  constructor() {
    super('纯粹', 'normal', 8, 8, 1, 1);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('超然', 2);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得2层/effect{超然}'
  }
}