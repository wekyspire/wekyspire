import Unit from './unit.js';

// AI 驱动单位基类：敌人（Enemy）与我方队友（Ally，如瑞米）共用。
// 行为（行动序列/act/意图文案）在定义侧（enemies|allies/definitions），
// 实例只持有状态：defId + 行动游标 + 当前意图。阵营由 side 区分。
export default class AIUnit extends Unit {
  constructor(opts = {}) {
    super(opts);
    this.defId = opts.defId ?? null;
    // 意图模型（battle.md 意图分类）：kinds 为基础意图集合，最多两两组合——
    // 'attack'（附带 hits/damage，预告 = 实际数值）| 'defend' | 'buff'（自我/友军增强）
    // | 'debuff'（赋予对方削弱）| 'summon'（召唤援军）；无 getIntention 的敌人
    // 兜底 { kinds: ['unknown'] }。可选 note：行动逻辑补充说明（tooltip 附加行，
    // 如图标条无法表达的固定索敌规则——瑞米「目标：最靠前的存活敌人」）。
    this.intention = null;
    this.actionIndex = 0;       // 固定行动序列游标（状态）；推进逻辑在定义/指令侧
  }
}
