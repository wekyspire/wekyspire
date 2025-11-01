// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turn\PlayerTurnEndInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';
import { submitInstruction } from '../globalExecutor.js';
import { ProcessEndOfTurnEffectsInstruction } from '../turnEffects/ProcessEndOfTurnEffectsInstruction.js';

export class PlayerTurnEndInstruction extends BattleInstruction {
  constructor({ player, enemy, parentInstruction = null }) {
    super({ parentInstruction });
    this.player = player;
    this.enemy = enemy;
  }

  async execute() {
    // 锁住操作（可在外部调用处执行，这里作为兜底）
    backendEventBus.emit(EventNames.Battle.PLAYER_TURN_END, {});

    const mod = this.player.getModifiedPlayer ? this.player.getModifiedPlayer() : this.player;
    // 回合结束效果
    const inst = new ProcessEndOfTurnEffectsInstruction({ target: mod, parentInstruction: this });
    submitInstruction(inst);

    backendEventBus.emit(EventNames.Battle.POST_PLAYER_TURN_END, {});
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} PlayerTurnEnd`;
  }
}
