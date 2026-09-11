import { createRegistry } from '../registryFactory.js';

// 能力定义注册表。定义 = { id, name, description,
//   onBattleStart?(ctx), subscriptions?(ctx), applyRunModifiers?(player) }
// 行为同样走订阅模型（写轨）+ 战斗开始钩子；run 级数值修正走 applyRunModifiers。
const reg = createRegistry('能力');

export const registerAbility = reg.register;
export const getAbilityDefinition = reg.get;
export const hasAbility = reg.has;
export const clearAbilityRegistry = reg.clear;
export const allAbilities = reg.all;
