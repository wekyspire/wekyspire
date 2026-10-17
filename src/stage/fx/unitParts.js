// 单位多部件挂接注册表（UnitObject.parts 的内容侧接线）：
// 内容 def 声明 `unitParts: [{ kind, ...params }]`（core 只存展示数据，同 orbs），
// 舞台建视图时逐项调本注册表的工厂。工厂负责把部件挂到 unit（或 standee）上、
// 写 unit.parts、并在 userData.dispose 里自收（UnitObject.dispose 统一回调）。
//
// 为什么不放 sync.js 里按 defId 特判：部件是内容（归属 Boss 脚本文件），舞台只认
// kind 字符串；新增 Boss 部件只在一处 register。

const REG = new Map();

export function registerUnitPart(kind, factory) {
  if (REG.has(kind)) console.warn(`[fx/unitParts] 部件重名覆盖：${kind}`);
  REG.set(kind, factory);
}

export function attachUnitParts(unit, defs) {
  if (!defs?.length) return;
  for (const d of defs) {
    const fn = REG.get(d.kind);
    if (!fn) continue;
    try { fn(unit, d); } catch (err) {
      console.warn(`[fx/unitParts] 部件挂接异常（跳过）：${d.kind}`, err);
    }
  }
}
