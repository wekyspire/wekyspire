/**
 * BurnSkillCardInstruction - 焚毁卡牌元语（第二阶段）
 *
 * 假设生命周期离场已在 SkillLeaveBattleInstruction 中完成。
 * 本元语仅负责：动画 + 容器迁移 + 事件。
 */

import { BattleInstruction } from '../BattleInstruction.js';
import {enqueueState, captureSnapshot, enqueueDelay} from '../../animationInstructionHelpers.js';
import { enqueueCardBurn } from '../../../utils/animationHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';
import {SkillLeaveBattleInstruction} from "./SkillLeaveBattleInstruction";
import {submitInstruction} from "../globalExecutor";
import {createAndSubmitLambda} from "../../battleInstructionHelpers";

export class BurnSkillCardInstruction extends BattleInstruction {
  constructor({ player, skillID, parentInstruction = null }) {
    super({ parentInstruction });
    if (!player) throw new Error('BurnSkillCardInstruction: player is required');
    if (!skillID) throw new Error('BurnSkillCardInstruction: skillID is required');
    this.player = player;
    this.skillID = skillID;
    this.executeStage = 0;
  }

  async execute() {
    const player = this.player;
    if(this.executeStage === 0) { // 卡牌离场
      const find = () => {
        const sources = [
          { name: 'activated', arr: player.activatedSkills },
          { name: 'frontier', arr: player.frontierSkills },
          { name: 'backup', arr: player.backupSkills },
        ];
        for (const src of sources) {
          const idx = Array.isArray(src.arr) ? src.arr.findIndex(sk => sk.uniqueID === this.skillID) : -1;
          if (idx !== -1) return { src: src.name, idx };
        }
        return { src: null, idx: -1 };
      };

      const { src, idx } = find();
      if (idx === -1) {
        console.warn(`[Burn] Skill ${this.skillID} not found in containers`);
        return true;
      }
      // 焚烧卡牌
      let skill = null;
      if (src === 'activated') skill = player.activatedSkills.splice(idx, 1)[0];
      if (src === 'frontier') skill = player.frontierSkills.splice(idx, 1)[0];
      if (src === 'backup') skill = player.backupSkills.splice(idx, 1)[0];

      if (!skill) return true;
      this.skill = skill;

      // 动画
      createAndSubmitLambda(()=>{enqueueCardBurn(this.skillID)});
      createAndSubmitLambda(()=>{enqueueDelay()}); // 屏障，保证动画完毕后卡牌才从skills内解注册
      // 卡牌离场
      const leave = new SkillLeaveBattleInstruction({ player, skillID: this.skillID, parentInstruction: this });
      submitInstruction(leave);
      // 离场后加入burntSkills
      createAndSubmitLambda(()=> {
        // 放入焚毁区
        player.burntSkills.push(skill);
      });
      backendEventBus.emit(EventNames.Player.SKILL_BURNT, {skill});
      return true;
    } else {
      // 取出卡对象
      let skill = null;
      if (this.src === 'activated') skill = player.activatedSkills.splice(this.idx, 1)[0];
      if (this.src === 'frontier') skill = player.frontierSkills.splice(this.idx, 1)[0];
      if (this.src === 'backup') skill = player.backupSkills.splice(this.idx, 1)[0];

      if (!skill) return true;
      this.skill = skill;

      // 动画
      createAndSubmitLambda(()=>{enqueueCardBurn(this.skillID)});

      createAndSubmitLambda(()=> {
        enqueueDelay();
        // 放入焚毁区并从总技能数组中删除引用
        player.burntSkills.push(skill);
        const allIdx = player.skills.findIndex(sk => sk === skill);
        if (allIdx !== -1) player.skills.splice(allIdx, 1);
      });

      // 事件 + 快照
      backendEventBus.emit(EventNames.Player.SKILL_BURNT, {skill});
      createAndSubmitLambda(()=>{enqueueState({snapshot: captureSnapshot(), durationMs: 0});});
      return true;
    }
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} SkillID:${this.skillID}`;
  }
}
