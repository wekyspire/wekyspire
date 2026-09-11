// 技能运行时状态（plain data，可序列化）。定义查注册表，这里只放 id + 标量。
// zones 数组里流动的就是这类对象；克隆 = 复制运行时状态（战斗克隆换新 uniqueID）。
let counter = 1;

export function createSkillRuntime(defId, overrides = {}) {
  return {
    uniqueID: `sk${counter++}_${Math.random().toString(36).slice(2, 8)}`,
    defId,
    power: 0,               // 强化/弱化偏移（正强化负弱化）
    remainingUses: 1,
    currentCooldown: 0,
    isActivated: false,     // 仅咏唱卡激活后为 true
    ...overrides,
  };
}

export function cloneSkillRuntime(rt, { freshId = true } = {}) {
  const clone = { ...rt };
  if (freshId) clone.uniqueID = `sk${counter++}_${Math.random().toString(36).slice(2, 8)}`;
  return clone;
}
