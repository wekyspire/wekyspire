// 注册表工厂：effect / skill / enemy / ally / ability 共用同一模式。
// 定义一律为 plain object（可静态检查、可 glob 收集），按 id 注册。
export function createRegistry(kind) {
  const defs = new Map();
  return {
    register(def) {
      if (!def?.id) throw new Error(`${kind}定义缺 id`);
      defs.set(def.id, def);
      return def;
    },
    get(id) {
      const def = defs.get(id);
      if (!def) throw new Error(`未注册的${kind}: ${id}`);
      return def;
    },
    has: (id) => defs.has(id),
    clear: () => defs.clear(),
    all: () => [...defs.values()],
  };
}
