import { createRegistry } from '../registryFactory.js';

// 遗物定义注册表（RUN_DESIGN §6.3）。契约镜像 ability：
// { id, name, description,
//   onBattleStart?(ctx), subscriptions?(ctx), applyRunModifiers?(player),
//   prepUse?(runState),   // 战前主动钩子：仅 prep 阶段可触发（见 run/prep.js）
//   uses?, cooldown? }    // prepUse 次数/冷却字段位（占位：run 级次数走 run.relicUses）
// 独立注册表（获取途径/稀有度/UI 与能力不同，钩子机制共享）。
const reg = createRegistry('遗物');

export const registerRelic = reg.register;
export const getRelicDefinition = reg.get;
export const hasRelic = reg.has;
export const clearRelicRegistry = reg.clear;
export const allRelics = reg.all;
