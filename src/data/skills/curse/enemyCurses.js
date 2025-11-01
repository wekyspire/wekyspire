// 诅咒系列技能，负面效果，spawnWeight都为0

import Skill from '../../skill.js';

// 粘液诅咒
export class SlimeCurse extends Skill {
  constructor() {
    super('粘液诅咒', 'normal', -1, 0, 1, 1, '诅咒');
  }
  // 没有任何效果
}
