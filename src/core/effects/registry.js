import { createRegistry } from '../registryFactory.js';

// 效果定义注册表。效果 = 数据面 + statModifiers（读轨）+ subscriptions（写轨）。
// 状态类只存 { effectId, stacks }，行为一律经本表反查（可序列化约束）。
const reg = createRegistry('效果');

export const registerEffect = reg.register;
export const getEffectDefinition = reg.get;
export const hasEffect = reg.has;
export const clearEffectRegistry = reg.clear;
export const allEffects = reg.all;
