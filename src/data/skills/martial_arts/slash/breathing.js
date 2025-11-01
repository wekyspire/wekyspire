// 呼吸系列（消耗型功能卡）：本回合内，你每丢一张牌，抽1张牌（变体：并获得格挡/护盾/二者）
import Skill from "@data/skill";
import backendEventBus, {EventNames} from "@/backendEventBus";
import {DropSkillCardInstruction} from "@data/battleInstructions";
import {
  createAndSubmitAddEffect,
  createAndSubmitDrawSkillCard, createAndSubmitDropSkillCard,
  createAndSubmitGainShield
} from "@data/battleInstructionHelpers";
import {SkillTier} from "@/utils/tierUtils";

export class BaseBreathing extends Skill {
  constructor(name = '呼吸', tier = SkillTier.B_MINUS, drawPerDrop = 1, blockPerDrop = 0, shieldPerDrop = 0) {
    super(name, 'normal', tier, 0, 1, 1, '呼吸');
    this.baseColdDownTurns = 0; // 消耗型
    this.drawPerDrop = drawPerDrop;
    this.blockPerDrop = blockPerDrop;
    this.shieldPerDrop = shieldPerDrop;
    this.active_ = false;
    this.instListener_ = null;
    this.turnListener_ = null;
  }

  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 0);
  }

  _teardown() {
    if (this.instListener_) {
      backendEventBus.off(EventNames.Executor.PRE_INSTRUCTION_EXECUTION, this.instListener_);
      this.instListener_ = null;
    }
    if (this.turnListener_) {
      backendEventBus.off(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);
      this.turnListener_ = null;
    }
    this.active_ = false;
  }

  use(player, enemy, stage, ctx) {
    if (this.active_) return true;
    this.active_ = true;

    // 本回合监听：在任意丢牌指令结算后，挂接抽牌/加成子指令
    this.instListener_ = ({ instruction, completed }) => {
      try {
        if (!completed) return; // 对于可能的多阶段指令，只在完成时触发
        if (!this.active_) return;
        if (!(instruction instanceof DropSkillCardInstruction)) return;
        // 作为此丢牌指令的孩子，顺序为：丢牌 -> 抽牌/加成
        if (this.drawPerDrop > 0) createAndSubmitDrawSkillCard(player, this.drawPerDrop, instruction);
        if (this.blockPerDrop > 0) createAndSubmitAddEffect(player, '格挡', this.blockPerDrop, instruction);
        if (this.shieldPerDrop > 0) createAndSubmitGainShield(player, player, this.shieldPerDrop, instruction);
      } catch (_) {}
    };
    backendEventBus.on(EventNames.Executor.POST_INSTRUCTION_EXECUTION, this.instListener_);

    // 回合结束：自动将本卡放回牌库底并注销监听
    this.turnListener_ = () => {
      createAndSubmitDropSkillCard(player, this.uniqueID, -1);
      this._teardown();
    };
    backendEventBus.on(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);

    return true;
  }

  regenerateDescription(player) {
    const parts = [];
    if (this.drawPerDrop > 0) parts.push(`本回合每丢1牌，抽${this.drawPerDrop}`);
    if (this.blockPerDrop > 0) parts.push(`并获得${this.blockPerDrop}/effect{格挡}`);
    if (this.shieldPerDrop > 0) parts.push(`并获得${this.shieldPerDrop}/named{护盾}`);
    return parts.join('');
  }
}

// 坚强呼吸（B）
export class StrongBreathing extends BaseBreathing {
  constructor() { super('坚强呼吸', SkillTier.B_PLUS, 1, 1, 0); this.precessor = '呼吸'; }
}
// 柔韧呼吸（B+）
export class FlexibleBreathing extends BaseBreathing {
  constructor() { super('柔韧呼吸', SkillTier.B, 1, 0, 6); this.precessor = ['呼吸', '坚强呼吸']; }
}
// 完美呼吸（A-）
export class PerfectBreathing extends BaseBreathing {
  constructor() { super('完美呼吸', SkillTier.A_MINUS, 1, 1, 6); this.precessor = ['坚强呼吸', '柔韧呼吸']; }
}