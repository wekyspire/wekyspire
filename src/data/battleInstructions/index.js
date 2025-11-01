/**
 * battleInstructions/index.js - 战斗元语统一导出
 * 
 * 导出所有元语类和相关工具，方便其他模块引用。
 */

// 基础类和执行器
export { BattleInstruction } from './BattleInstruction.js';
export { BattleInstructionExecutor } from './BattleInstructionExecutor.js';

// 全局执行器管理
export {
  getGlobalExecutor,
  initializeGlobalExecutor,
  cleanupGlobalExecutor,
  submitInstruction,
  runGlobalExecutor,
  getCurrentInstruction,
  getExecutorDebugInfo
} from './globalExecutor.js';

// 核心元语
export { UseSkillInstruction } from './core/UseSkillInstruction.js';
export { ActivateSkillInstruction } from './core/ActivateSkillInstruction.js';
export { ConsumeSkillResourcesInstruction } from './core/ConsumeSkillResourcesInstruction.js';

// 战斗相关元语
export { LaunchAttackInstruction } from './combat/LaunchAttackInstruction.js';
export { DealDamageInstruction } from './combat/DealDamageInstruction.js';
export { GainShieldInstruction } from './combat/GainShieldInstruction.js';
export { ApplyHealInstruction } from './combat/ApplyHealInstruction.js';

// 效果相关元语
export { AddEffectInstruction } from './effect/AddEffectInstruction.js';

// 卡牌操作元语
export { DrawSkillCardInstruction } from './card/DrawSkillCardInstruction.js';
export { DropSkillCardInstruction } from './card/DropSkillCardInstruction.js';
export { BurnSkillCardInstruction } from './card/BurnSkillCardInstruction.js';
export { DiscoverSkillCardInstruction } from './card/DiscoverSkillCardInstruction.js';

// 异步元语
export { AwaitPlayerInputInstruction } from './async/AwaitPlayerInputInstruction.js';

// 状态变更元语
export { GainManaInstruction } from './state/GainManaInstruction.js';
export { ConsumeManaInstruction } from './state/ConsumeManaInstruction.js';

// 回合效果处理元语
export { ProcessEndOfTurnEffectsInstruction } from './turnEffects/ProcessEndOfTurnEffectsInstruction.js';
export { ProcessEndOfTurnEffectInstruction } from './turnEffects/ProcessEndOfTurnEffectInstruction.js';
