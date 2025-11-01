// 拔刀术：反转斩系列卡牌特性，需要配合斩系列实现的反转成员
import Skill from '@data/skill';
import { backendGameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";

export class DrawBlade extends Skill {
  constructor() {
    super('拔刀术', 'normal', SkillTier.A_MINUS, 0, 1, 1, '拔刀术');
    this.baseColdDownTurns = 3;
    this.cardMode = 'chant';
    this._modifier = null;
  }
  onEnable(player) {
    super.onEnable(player);
    // 对所有斩系列卡牌设置反转标记（示例字段 reverseMode=true，由斩系实现具体语义）
    this._modifier = (p) => {
      for (const sk of [...p.frontierSkills, ...p.backupSkills]) {
        if (sk.skillSeriesName === '斩') {
          sk.reverseMode = true;
        }
      }
      return p;
    };
    player.addModifier(this._modifier);
  }
  onDisable(player) {
    super.onDisable(player);
    if (this._modifier) {
      // 取消反转标记
      for (const sk of [...player.frontierSkills, ...player.backupSkills]) {
        if (sk.skillSeriesName === '斩') delete sk.reverseMode;
      }
      player.removeModifier(this._modifier);
      this._modifier = null;
    }
  }
  use(){ return true; }
  regenerateDescription(){ return `斩系列技能冷却规律反转`; }
}
