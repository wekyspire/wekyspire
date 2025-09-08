
import Skill from "../skill";

// 强光(B)
export class LumiI extends Skill {
  constructor() {
    super('强光', 'light', 4, '获得【3】/effect{闪避}和/effect{清晰}', 1, 1, "强光");
    this.upgradeTo = "耀光";
  }
  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('闪避', 3);
      enemy.addEffect('闪避', -3);
      return true;
    }
    return false;
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得3层/effect{闪避}，敌人失去3层/effect{闪避}`;
  }
}

// 耀光(A)
export class LumiII extends Skill {
  constructor() {
    super('耀光', 'light', 6, '获得【5】/effect{闪避}和/effect{清晰}，敌人获得/effect{眩晕}', 2, 1, "强光", 1);
    this.upgradeTo = ["灿烂", "持光为形"];
  }
  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('闪避', 5);
      enemy.addEffect('闪避', -5);
      enemy.addEffect('眩晕', 1);
      return true;
    }
    return false;
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得5层/effect{闪避}，敌人失去5层/effect{闪避}，2层/effect{眩晕}`;
  }
}

// 灿烂(S)
export class Splendor extends Skill {
  constructor() {
    super('灿烂', 'light', 9, '获得8/effect{闪避}和/effect{清晰}，敌人获得2层/effect{眩晕}，3层/effect{虚弱}', 3, 1, "强光", 2);
    this.subtitle = '闪瞎你的狗眼';
  }
  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('闪避', 8);
      enemy.addEffect('闪避', -8);
      enemy.addEffect('眩晕', 2);
      enemy.addEffect('虚弱', 3);
      return true;
    }
    return false;
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得8/effect{闪避}和/effect{清晰}，敌人获得2层/effect{眩晕}，3层/effect{虚弱}`;
  }
}

// 持光为形(S)
export class LightShaper extends Skill {
  constructor() {
    super('持光为形', 'light', 9, '获得4层/effect{炙热}，10层/effect{碎甲}，/effect{持光为形}', 5, 1, '强光', 1);
    this.subtitle = '人们以为那只是个传说';
  }
  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('炙热', 4);
      player.addEffect('碎甲', 10);
      player.addEffect('持光为形', 1);
      return true;
    }
    return false;
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得4层/effect{炙热}，10层/effect{碎甲}，/effect{持光为形}`;
  }
}