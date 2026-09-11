import { createRegistry } from '../registryFactory.js';

// 我方 AI 队友定义注册表（如瑞米）。契约与敌人定义相同：
// { id, name, createUnit(): Ally, act(actx), getIntention?(unit) }
const reg = createRegistry('队友');

export const registerAlly = reg.register;
export const getAllyDefinition = reg.get;
export const hasAlly = reg.has;
export const clearAllyRegistry = reg.clear;
export const allAllies = reg.all;
