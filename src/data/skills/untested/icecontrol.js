
import Skill from "../skill";


// 降温 (D)
export class IceControlI extends Skill {
  constructor() {
    super('降温', 'magic', 1, '移除3层/effect{重伤}、/effect{燃烧}', 1, 1, "冷冻");
  }
};

// 急冻 (C)
export class IceControlII extends Skill {
  constructor() {
    super('急冻', 'magic', 3, '移除/effect{重伤}、/effect{燃烧}、/effect{炙热}', 1, 1, "冷冻");
  }
};

// 冰结 (B)
export class IceControlIII extends Skill {
  constructor() {
    super('冰结', 'magic', 5, '移除/effect{重伤}、/effect{燃烧}、/effect{炙热}，获得20护盾', 1, 1, "冷冻");
    this.coldDownTurns = 3;  
  }
};

// 冷窒 (A)
export class IceControlIV extends Skill {
  constructor() {
    super('冷窒', 'magic', 7, '赋予3层/effect{虚弱}、/effect{脆弱}', 2, 1, "冷冻");
    this.coldDownTurns = 3;  
  }
};

// 凝灭 (S)
export class Decimation extends Skill {
  constructor() {
    super('凝灭', 'magic', 9, '赋予100层/effect{虚弱}、/effect{脆弱}', 5, 1, "冷冻");
  }
}

