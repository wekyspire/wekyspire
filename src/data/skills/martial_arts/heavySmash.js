import Skill from "../../skill";
import {SkillTier} from "../../../utils/tierUtils";
import { launchAttack } from "../../battleUtils";
import {countString} from "../../../utils/nameUtils";

// 重击（D）（重击）
// 消耗2行动点，赋予易伤2，但仅产生4伤害
export class BasicHeavySmash extends Skill {
  constructor(name='重击', tier = SkillTier.D, damage = 4,
              powerMultiplier = 2, apConsumption = 2, coldDownTurns = 2,
              stack = 2) {
    super(name, 'normal', tier, 0, apConsumption, 1, '重击');
    this.baseColdDownTurns = coldDownTurns; // 基础冷却时间
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.stack = stack; // 赋予易伤层数
  }

  get damage () {
    return this.baseDamage + this.powerMultiplier * this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
      const atkPassThroughDamage = launchAttack(player, enemy, this.damage).passThoughDamage;
      return atkPassThroughDamage <= 0;
    } else {
      enemy.addEffect('易伤', this.stack);
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，命中则赋予/effect{易伤}${countString(this.stack, '层')}`;
  }
}

// 强力重击（C+）（重击）
// 赋予易伤3层
export class StrongHeavySmash extends BasicHeavySmash {
  constructor() {
    super('强力重击', SkillTier.C_PLUS, 4, 3, 2, 2, 3);
    this.precessor = '重击';
  }
}