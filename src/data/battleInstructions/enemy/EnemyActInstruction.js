// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\enemy\EnemyActInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';

export class EnemyActInstruction extends BattleInstruction {
  constructor({ enemy, player, parentInstruction = null }) {
    super({ parentInstruction });
    if (!enemy) throw new Error('EnemyActInstruction: enemy is required');
    if (!player) throw new Error('EnemyActInstruction: player is required');
    this.enemy = enemy;
    this.player = player;
  }

  async execute() {
    // 在执行器环境中执行敌人行动，行动内部的 helper 会自动挂到当前指令
    try {
      const modPlayer = this.player.getModifiedPlayer ? this.player.getModifiedPlayer() : this.player;
      this.enemy.act(modPlayer);
    } catch (_) {}
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} EnemyAct(${this.enemy?.name})`;
  }
}

