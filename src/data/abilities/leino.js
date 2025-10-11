// 灵脉相关能力
import {Ability} from "../ability";
import {backendGameState} from "../gameState";
import backendEventBus, {EventNames} from "../../backendEventBus";

export class FireLeino extends Ability {
  constructor() {
    super('火灵脉', '能使用火系灵御技能，获得4层/effect{火焰抗性}', 5, 10);
    this.fireResistAddHook = null;
  }

  apply(player) {
    player.addLeino('fire');
    // 增加一个钩子，来自燃烧的伤害减4
    backendEventBus.on(EventNames.Game.PRE_BATTLE, this.fireResistAddHook = () => {
      player.addEffect('火焰抗性', 4);
    });
  }

  deapply () {
    // 移除钩子
    if(this.fireResistAddHook) {
      backendEventBus.off(EventNames.Game.PRE_BATTLE, this.fireResistAddHook);
      this.fireResistAddHook = null;
    }
  }

  get spawnWeight() {
    // 只有当玩家还没有火灵脉时，才有生成权重
    if (!backendGameState.player.getLeinoWeight('fire') === 0) {
      // 玩家灵脉数量越少，生成权重越高
      let weight = super.spawnWeight;
      if(backendGameState.player.getAllLeinoWeight() <= 1) {
        weight *= 10;
      }
      return weight;
    }
    return 0;
  }
}

class WoodLeino extends Ability {
  constructor() {
    super('木灵脉', '能使用木系灵御技能', 5, 10);
  }

  apply(player) {
    player.addLeino('wood');
  }

  get spawnWeight() {
    // 只有当玩家还没有木灵脉时，才有生成权重
    if (!backendGameState.player.getLeinoWeight('wood') === 0) {
      // 玩家灵脉数量越少，生成权重越高
      let weight = super.spawnWeight;
      if(backendGameState.player.getAllLeinoWeight() <= 1) {
        weight *= 10;
      }
      return weight;
    }
    return 0;
  }
}
