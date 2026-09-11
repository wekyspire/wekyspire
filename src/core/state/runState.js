import Player from './player.js';
import { createRng } from './rng.js';

// runState：整局（run）寿命。战斗级状态一律不进这里（见 battleState.js）。
// 结构依据 RUN_DESIGN §6.1；序列化纪律：只存 id 与数字，不挂闭包（§6.4，存档白捡）。
export function createRunState({ player = null, seed = 1, profile = null } = {}) {
  const p = player ?? new Player();
  // 养成字段幂等初始化（测试 fixture 可能传入预构造 Player）
  p.leino = { fire: 0, wood: 0, air: 0, body: 0, ...p.leino }; // 四维独立灵脉等级（§5.1）
  p.trainingCount ??= 0;          // 训练房累计训练次数（进阶主途径，§4.1）
  p.ascensionCount ??= 0;         // 已完成进阶次数（§5.3，总进阶次数封顶 6）
  p.bodyLevel ??= 0;              // 隐藏体修等级（跳过进阶时 +1，决定体修卡包门禁）
  p.relics ??= [];                // 遗物背包 [relicId]
  p.equippedRelics ??= [];        // 装备中的遗物（受 relicSlots 上限约束，§4.5）
  p.relicSlots ??= 2;

  return {
    seed,
    rng: createRng(seed),        // run 级独立 rng 流（奖励房派发/奖励生成确定性）
    floor: 1,
    gameStage: 'prep',           // 'prep' | 'battle' | 'reward' | 'room' | 'ascension' | 'end'
    result: null,                // 'victory' | 'defeat'（run 终局判定）
    encounter: null,             // 当前层的敌人编成 [defId]（prep 阶段按 seed+floor 确定性生成）
    rewards: null,               // 战后奖励 { money, skillChoices, chosenSkill }（reward 阶段，rewards.js 填充/清空）
    currentRoom: null,           // 当前奖励房类型（'training'|'slot'|'camp'|'event'）
    roomData: null,              // 当前奖励房临时数据（如训练抓牌候选；离房时清空）
    pendingCardRemoval: 0,       // 待使用的删卡机会（Boss 奖励，§2.1）
    relicUses: {},               // 主动遗物剩余次数 { relicId: uses }（§4.5）
    ascensionOffer: null,        // 进阶事件待授予能力候选（§5.3；占位恒为空）
    cardOffering: null,          // 种子包待选（首次点亮灵脉：九选三，§5.3 追加）
    commonPity: 0,               // 通用卡注入保底计数（每 N 次开包必出一次）
    player: p,
    remi: {
      level: profile?.remiBaseLevel ?? 1, // 瑞米状态 = 基线(profile) + 局内增量（§6.4）
      fruits: 0,                          // 升级果存量
      drivenOff: false,                   // HP 归零 = 被打跑（§3），营地找回
      activeSupport: null,                // 当前支援功能（列表待补，§9）
      unlockedSupports: [],
    },
    profile: profile ?? null,    // 跨局持久内容（故事模式接缝；肉鸽模式传空）
  };
}
