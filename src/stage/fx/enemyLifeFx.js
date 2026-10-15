// 逐敌生死演出注册口（2026-10-15 敌人演出批）：
// 死亡拍覆写与入场拍 garnish 的登记处——注册表只放函数指针，内容实现归属
// fx/scripts/enemies/（一章）与 fx/scripts/bosses/（Boss），与 enemyHitFx 同律。
//   死亡覆写  fn(stage, unit, payload, finish) → false 回落既有分支（重击/普通），
//             其余（含 undefined）= 已消费（own finish）。调用点在假死/裂半判定之后、
//             重击分支之前——天斩裂半优先于种族死亡语言。
//   入场garnish fn(stage, unit)：_unitSpawnBeat 起立落定后追加的主题点缀
//             （春风绿芽/腐根缠绕），fire-and-forget 不占节拍。

const ENEMY_DEATH_BEATS = new Map();
export function registerEnemyDeathBeat(defId, fn) { ENEMY_DEATH_BEATS.set(defId, fn); }
export function enemyDeathBeatOf(defId) { return ENEMY_DEATH_BEATS.get(defId) ?? null; }

const ENEMY_SPAWN_GARNISH = new Map();
export function registerEnemySpawnGarnish(defId, fn) { ENEMY_SPAWN_GARNISH.set(defId, fn); }
export function enemySpawnGarnishOf(defId) { return ENEMY_SPAWN_GARNISH.get(defId) ?? null; }
