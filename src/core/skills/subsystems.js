// 子体系（SKILL_DESIGN_PRINCIPLES「卡牌设计准则」）：主体系内的紧密交互组。
// 与 series（晋升链族，视觉/美术消费方）分属两层：
//   * 奖励亲和按 subsystem 加权（rewards.js；无 subsystem = 体系通用卡，不吃亲和）；
//   * 深入卡门禁 def.deep 存合法 subsystem id（rewards.js DEEP_GATES）；
//   * 卡面页脚小项展示归属（cardFace.js，label 即展示名）；
//   * 卡牌成员判定（cardKit.isBladeCard 等）读 subsystem，不读 series/keywords。
export const SUBSYSTEMS = Object.freeze({
  fist: Object.freeze({ label: '拳法' }),
  blade: Object.freeze({ label: '刀法' }),
  block: Object.freeze({ label: '拆法' }),
  burst: Object.freeze({ label: '爆炎' }),
  blaze: Object.freeze({ label: '叠炎' }),
});

/** def.subsystem / def.deep 的合法性判据（null = 未归属，合法）。 */
export function isLegalSubsystem(value) {
  return value == null || Object.hasOwn(SUBSYSTEMS, value);
}

/** 页脚展示名；未归属返回 null。 */
export function subsystemLabel(value) {
  return SUBSYSTEMS[value]?.label ?? null;
}
