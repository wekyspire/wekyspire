
import Skill from "../skill";


// 瑞米召唤术 (C)
export class SummonRemi extends Skill {
  constructor() {
    super('瑞米召唤术', 'magic', 3, '召唤瑞米，它会听从你的指令！', 1, 1, "瑞米");
    this.used = false;
  }
  
  use(player, enemy) {
    if (super.use()) {
      addBattleLog('你召唤了...瑞米！');
      this.used = true;
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    if(this.used) return '这技能他妈的卵用没有！';
    return '召唤瑞米，它会听从你的指令！';
  }
}

// 大瑞米召唤术 (B)
export class GreatSummonRemi extends Skill {
  constructor() {
    super('大瑞米召唤术', 'magic', 5, '召唤瑞米，获得随机药水！', 1, 1, "瑞米");
  }
  
  use(player, enemy) {
    if (super.use()) {
      addBattleLog('你召唤了...瑞米！');
      // 后面交给事件系统处理
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return '召唤瑞米，获得随机药水！';
  }
}

// 瑞米祝福术 (A)
export class RemiBlessing extends Skill {
  constructor() {
    super('瑞米祝福术', 'magic', 7, '获得瑞米的祝福，变得好运！', 1, 1, "瑞米");
  }
  
  use(player, enemy) {
    if (super.use()) {
      addBattleLog('你召唤了...瑞米！');
      // 后面交给事件系统处理
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return '获得瑞米的祝福，变得好运！';
  }
}

// 瑞米奇术 (S)
export class RemiMiracle extends Skill {
  constructor() {
    super('瑞米奇术', 'magic', 9, '将此技能和所有/named{诅咒}替为/skill{苹果}', 0, 1, "瑞米");
  }

  use(player, enemy) {
    if (super.use()) {
      addBattleLog('你使用了...瑞米奇术！');
      // 后面交给事件系统处理
      return true;
    }
    return false;
  }
};

// 苹果 (S)
export class Apple extends Skill {
  constructor() {
    super('苹果', 'magic', 9, '恢复40%/named{生命}，获得2/named{魏启}、80/named{护盾}，/named{焚毁}');
  }

  use(player, enemy) {
    if (super.use()) {
      healUnit(player, player, 40);
      // TODO
      return true;
    }
    return false;
  }
};