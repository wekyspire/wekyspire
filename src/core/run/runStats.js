// run 级战绩统计（结算屏数据源）：击败怪物计数 + 金币累计获得。
// 采集纪律：击杀在 finishBattle 胜利分支按战斗出场编成一次性记账（胜利 = 全歼）；
// 金币只记**流入**（获得/利息/售卖），花费不冲减——「本局共获得」语义。

/** 旧存档无 stats 字段：惰性补齐（一切写入点先经此门）。 */
export function ensureStats(run) {
  run.stats ??= { kills: {}, goldEarned: 0 };
  run.stats.kills ??= {};
  return run.stats;
}

/** 胜利战斗的出场敌人全数计入讨伐（含召唤物；败北场不记）。 */
export function recordKills(run, enemies) {
  const s = ensureStats(run);
  for (const u of enemies ?? []) {
    const id = u?.defId;
    if (id) s.kills[id] = (s.kills[id] ?? 0) + 1;
  }
}

/** 金币流入记账（n ≤ 0 不记）。 */
export function recordGold(run, n) {
  const v = Math.floor(n ?? 0);
  if (v > 0) ensureStats(run).goldEarned += v;
}
