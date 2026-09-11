import { getEffectDefinition } from '../effects/registry.js';

let unitCounter = 1;

// 战斗单位基类（玩家/敌人/队友共用）。
// 禁令：不 import 内核/Bridge，不发表现意图，不含 DOM/Vue。
// 只做纯粹的状态持有与派生计算；结算逻辑（扣血/加盾的顺序与联动）在指令里。
export default class Unit {
  constructor({ name = '', maxHp = 1, attack = 0, defense = 0, magic = 0 } = {}) {
    this.uniqueID = `u${unitCounter++}`;   // 投影 reconcile / presenter 寻址用
    this.side = null;                      // 'player' | 'enemy'，战斗装配时指派
    this.name = name;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.shield = 0;
    this.attack = attack;   // base 值；修正后数值走 getStat()
    this.defense = defense;
    this.magic = magic;
    this.effects = [];      // [{ effectId, stacks }]，行为经注册表反查
  }

  isDead() {
    return this.hp <= 0;
  }

  // ---- 效果（数据面） ----

  getEffect(effectId) {
    return this.effects.find(e => e.effectId === effectId) ?? null;
  }

  getEffectStacks(effectId) {
    return this.getEffect(effectId)?.stacks ?? 0;
  }

  addEffect(effectId, stacks = 1) {
    const def = getEffectDefinition(effectId);
    const existing = this.getEffect(effectId);
    if (def.stacking === 'boolean') {
      if (!existing) this.effects.push({ effectId, stacks: 1 });
      return;
    }
    // count / duration 按层数累加；支持负层数扣减，扣尽移除
    if (existing) {
      existing.stacks += stacks;
      if (existing.stacks <= 0) {
        this.effects.splice(this.effects.indexOf(existing), 1);
      }
    } else if (stacks > 0) {
      this.effects.push({ effectId, stacks });
    }
  }

  removeEffect(effectId, stacks = Infinity) {
    const i = this.effects.findIndex(e => e.effectId === effectId);
    if (i < 0) return;
    const e = this.effects[i];
    if (stacks >= e.stacks) this.effects.splice(i, 1);
    else e.stacks -= stacks;
  }

  clearEffects(predicate = null) {
    this.effects = predicate ? this.effects.filter(e => !predicate(e)) : [];
  }

  // ---- 读轨：属性修正（面板） ----
  // getStat('attack') = base + Σ 效果的 statModifiers。
  // 规则：面板只加性（乘除/条件结算走 PRE 订阅写轨，不进面板）。
  // view（可选，通常为 battleState）：供跨实体衍生使用——如火焰主宰
  // "每3层燃烧提供1点灵能"需要读敌人身上的燃烧层数。不需要 view 的修饰忽略它。
  // UI 显示、AI 意图、技能 amount/describe 全部走这里；结算时的反应走订阅（写轨）。
  getStat(stat, view = null) {
    let value = this[stat] ?? 0;
    for (const e of this.effects) {
      const mod = getEffectDefinition(e.effectId).statModifiers?.[stat];
      if (mod) value += mod(e.stacks, this, view);
    }
    return value;
  }
}
