import { createAndSubmitAddEffect, createAndSubmitApplyHeal } from './battleInstructionHelpers.js';
import effectDescriptions from './effectDescription.js'

// 基础作战单位抽象类（玩家/敌人公用）
export default class Unit {
  constructor() {
    this.type = 'unit';
    this.name = '';
    this.hp = 0; // 当前生命值
    this.maxHp = 0; // 最大生命值
    this.shield = 0; // 当前护盾
    this.baseAttack = 0; // 基础攻击力
    this.baseDefense = 0; // 基础防御力
    this.baseMagic = 0; // 基础灵能强度
    this.effects = {}; // 效果列表
  }

  // 计算属性（默认规则）
  get attack() {
    return this.baseAttack + (this.effects['力量'] || 0);
  }

  get defense() {
    return this.baseDefense + (this.effects['坚固'] || 0);
  }

  get magic() {
    return this.baseMagic + (this.effects['集中'] || 0);
  }

  // 添加效果（指令式）
  addEffect(effectName, stacks = 1) {
    createAndSubmitAddEffect(this, effectName, stacks);
  }

  // 移除效果（指令式：添加负层数）
  removeEffect(effectName, stacks = 1) {
    createAndSubmitAddEffect(this, effectName, -Math.abs(stacks));
  }

  hasEffect(effectName) {
    return (this.effects[effectName] || 0) !== 0;
  }

  // 应用治疗（指令式）
  applyHeal(heal) {
    createAndSubmitApplyHeal(this, heal);
  }

  // 随机移除效果
  // mode:
  // - 'random' 随机移除,
  // - 'highest-stack' 优先层数最高的
  // - 'highest-stack-kind' 以种类数为单位移除，优先层数最高种类
  // - 'ramdom-kind' 以种类数为单位移除，随机种类
  // type: 'all' | 'buff' | 'debuff' | 'neutral' 只移除指定类型的效果
  removeEffects(count, mode = 'random', type='all') {
    if (!count || count <= 0) return;

    const isTarget = (name) => {
      const desc = effectDescriptions[name];
      return desc && (type === 'all' || desc.type === type);
    };

    // 动态获取当前有效减益（层数>0）
    const getTargetEntries = () => Object.entries(this.effects)
      .filter(([name, stacks]) => (stacks || 0) > 0 && isTarget(name));

    const kindRandom = mode === 'random-kind' || mode === 'ramdom-kind';
    const kindHighest = mode === 'highest-stack-kind';

    if (kindRandom || kindHighest) {
      // 以“种类”为单位移除
      for (let i = 0; i < count; i++) {
        const targets = getTargetEntries();
        if (targets.length === 0) break;

        let chosen;
        if (kindHighest) {
          // 选择层数最高的种类（并在并列时随机）
          const maxStacks = Math.max(...targets.map(([, s]) => s));
          const candidates = targets.filter(([, s]) => s === maxStacks);
          chosen = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
          // 随机选择一个种类
          chosen = targets[Math.floor(Math.random() * targets.length)];
        }
        const [name, stacks] = chosen;
        this.removeEffect(name, stacks);
      }
      return;
    }

    // 以“层数”为单位移除
    for (let i = 0; i < count; i++) {
      const targets = getTargetEntries();
      if (targets.length === 0) break;

      let chosenName;
      if (mode === 'highest-stack') {
        // 选择当前层数最高的效果（并在并列时随机）
        const maxStacks = Math.max(...targets.map(([, s]) => s));
        const candidates = targets.filter(([, s]) => s === maxStacks);
        chosenName = candidates[Math.floor(Math.random() * candidates.length)][0];
      } else {
        // 'random'：在效果种类中等概率选一个，移除1层
        chosenName = targets[Math.floor(Math.random() * targets.length)][0];
      }

      this.removeEffect(chosenName, 1);
    }
  }

  removeNegativeEffects(count, mode = 'random') {
    this.removeEffects(count, mode, 'debuff');
  }

  removePositiveEffects(count, mode = 'random') {
    this.removeEffects(count, mode, 'buff');
  }

  clearEffects (type='all') {
    // 将所有同类效果一网打尽
    const isTarget = (name) => {
      const desc = effectDescriptions[name];
      return desc && (type === 'all' || desc.type === type);
    };
    for (const [name, stacks] of Object.entries(this.effects)) {
      if ((stacks || 0) > 0 && isTarget(name)) {
        this.removeEffect(name, stacks);
      }
    }
  }

  clearNegativeEffects() {
    this.clearEffects('debuff');
  }
  clearPositiveEffects() {
    this.clearEffects('buff');
  }
}
