import { createRegistry } from '../registryFactory.js';

// 敌人定义注册表。定义 = { id, name, createUnit(): Enemy, act(actx), getIntention?(unit, battleState) }
// act 只提交指令；actx = { ...ctx, unit, def }。
const reg = createRegistry('敌人');

export const registerEnemy = reg.register;
export const getEnemyDefinition = reg.get;
export const hasEnemy = reg.has;
export const clearEnemyRegistry = reg.clear;
export const allEnemies = reg.all;
