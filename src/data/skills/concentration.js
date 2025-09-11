// 集中系列技能

import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';
import { addBattleLog } from '../battleLogUtils.js';

// 思索（C-）
export class SmallThinking extends Skill {
  constructor() {
    super('思索', 'normal', 1, 0, 3, 1);
  }

  get coldDownTurns() {
    return Math.max(3 - this.power, 0);
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
    super('深思', 'normal', 3, 0, 5, 1);
  }

  get coldDownTurns() {
    return Math.max(4 - this.power, 0);
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

// 想入非非（C+）
export class DreamThinking extends Skill {
  constructor() {
    super('想入非非', 'normal', 2, 0, 2, 1);
  }

  get coldDownTurns() {
    return Math.max(4 - this.power, 0);
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
    super('弱集中', 'magic', 1, 1, 1, 1);
  }

  get coldDownTurns() {
    return Math.max(2 - this.power, 0);
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

// 集中（B-）
export class Concentration extends Skill {
  constructor() {
    super('集中', 'magic', 3, 1, 1, 1);
  }

  get coldDownTurns() {
    return Math.max(3 - this.power, 0);
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

// 专注（B+）
export class FullConcentration extends Skill {
  constructor() {
    super('专注', 'magic', 3, 2, 1, 1);
  }

  get coldDownTurns() {
    return Math.max(4 - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    player.addEffect('超然', 1);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return '获得1层/effect{超然}'
  }
}

