// battleUtils - minimal, pure-ish helpers retained for compatibility
// State-mutating combat/card helpers have been migrated to instruction-based API and removed.


// Pure logic helper: whether a skill should be burnt after use
export function willSkillBurn(skill) {
  if (!skill) return false;
  const canReturn = (skill.coldDownTurns !== 0) || (skill.maxUses === Infinity) || (skill.remainingUses > 0);
  return !canReturn;
}
