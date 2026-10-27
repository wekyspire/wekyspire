// 存档（菜单级）：run 状态快照的持久化。
// runState 纪律 = 只存 id 与数字（§6.4），故快照 = 纯字段摘取，JSON 直存。
// 存档语义 = 检查点：仅在 prep / end 阶段落盘；战斗内退出 = 回到本层战前。
// 槽位隔离：肉鸽 / 故事 / **调试** 各占一个槽，互不覆盖——调试局（改过状态的局）只写
// debug 槽，真实存档永不被污染（见 runController 的 persist 守卫与 modeOf）。

import { cloneModifiers } from '../core/skills/cardModifiers.js';

const KEYS = Object.freeze({
  infinite: 'wekyspire:save:infinite',
  story: 'wekyspire:save:story',
  debug: 'wekyspire:save:debug',
});
const VERSION = 1;

const memory = new Map(); // 无 localStorage 环境（vitest node）的回退存储

/** run → 槽位名（调试局优先：debugMode 一旦置位就只认 debug 槽）。 */
export const modeOf = (run) => (run?.debugMode ? 'debug' : (run?.storyMode ? 'story' : 'infinite'));

// 槽位名归一（mode 可为 'infinite'|'story'|'debug'；旧的布尔 storyMode 写法仍兼容）
const keyOf = (mode) => {
  const m = (mode === true || mode === 'story') ? 'story' : (mode === 'debug' ? 'debug' : 'infinite');
  return KEYS[m];
};

function readRaw(key) {
  try { return localStorage.getItem(key); }
  catch { return memory.get(key) ?? null; }
}
function writeRaw(key, raw) {
  try { localStorage.setItem(key, raw); }
  catch { memory.set(key, raw); }
}
function removeRaw(key) {
  try { localStorage.removeItem(key); }
  catch { memory.delete(key); }
}

// run → 可序列化快照（player.deck 本身即 plain 运行时对象）
export function snapshotRun(run) {
  const p = run.player;
  return {
    version: VERSION,
    savedAt: Date.now(),
    seed: run.seed,
    rngState: run.rng.getState(), // run 级 rng 内部态（uint32）：读档后续房间派发与活局时间线一致（旧档无此字段 = 维持旧回放语义）
    storyMode: run.storyMode ?? false, // 读档回到存档自身的模式（肉鸽/故事）
    debugMode: run.debugMode ?? false, // 调试局标记：读档走 debug 槽语义（恢复房/阶段，见 runController）
    floor: run.floor,
    totalFloors: run.totalFloors,
    route: run.route ?? 'body',   // 开局路线（D2）；旧档无此字段 → 体修口径
    gameStage: run.gameStage,
    result: run.result,
    // 房型房间的现场（只有调试局会读它：真实档语义 = 检查点，恒在 prep 恢复；
    // 见 runController.restoreFromSave 的 debugMode 分支）
    currentRoom: run.currentRoom ?? null,
    roomData: run.roomData ? JSON.parse(JSON.stringify(run.roomData)) : null,
    // 塔楼房间表（开局定死的种子事实）：旧档无此字段 → 读档按种子重导（saveRestore）
    roomTable: run.roomTable ? [...run.roomTable] : null,
    // 本层遭遇（描述符数组）：调试档据此复现指定的敌人编成；真实档读档时由
    // advanceFloor 按 seed+floor 重新确定性生成，故旧档没有此字段也不影响
    encounter: run.encounter ? run.encounter.map(e => (e && typeof e === 'object' ? { ...e } : e)) : null,
    pendingCardRemoval: run.pendingCardRemoval,
    eventFlags: { ...(run.eventFlags ?? {}) }, // 剧情旗标（事件分支记忆；故事模式必需）
    relicUses: { ...run.relicUses },
    shop: run.shop ? { ...run.shop, items: run.shop.items.map(it => ({ ...it })) } : null,
    shopPending: run.shopPending ? { ...run.shopPending, choices: [...run.shopPending.choices] } : null,
    shopAppleBought: !!run.shopAppleBought,
    slot: run.slot ? { ...run.slot } : null,
    slotPending: run.slotPending ? { ...run.slotPending } : null,
    slotUpgradePending: !!run.slotUpgradePending,
    slotDevour: run.slotDevour ?? 0,
    slotFreeRolls: run.slotFreeRolls ?? 0,
    slotApples: run.slotApples ?? 0,
    // 银行机状态（存款/连击/超额取款黑名单/待选恶魔词条/词条附赠操作）与跨战斗词条队列：
    // 不存档的话，读档会把存款吞掉、也能把恶魔 roll 的代价赖掉
    bank: run.bank ? {
      ...run.bank,
      blackCleared: [...(run.bank.blackCleared ?? [])],
      offers: [...(run.bank.offers ?? [])],
      pendingRoll: run.bank.pendingRoll
        ? { ...run.bank.pendingRoll, options: [...(run.bank.pendingRoll.options ?? [])] } : null,
    } : null,
    pendingDebuffs: (run.pendingDebuffs ?? []).map(d => ({ ...d })),
    // 战绩统计（结算屏数据源）：旧档无此字段 → 读档侧 ensureStats 惰性补零
    stats: { kills: { ...(run.stats?.kills ?? {}) }, goldEarned: run.stats?.goldEarned ?? 0 },
    player: {
      hp: p.hp, maxHp: p.maxHp,
      mana: p.mana, maxMana: p.maxMana,
      maxActionPoints: p.maxActionPoints,
      money: p.money,
      // modifiers 深拷贝：快照与活局不共享引用（后续挂/摘不得改写历史快照）
      deck: p.deck.map(rt => ({ ...rt, modifiers: cloneModifiers(rt.modifiers) })),
      abilities: [...p.abilities],
      relics: [...p.relics],
      equippedRelics: [...p.equippedRelics],
      relicSlots: p.relicSlots,
      leino: { ...p.leino },
      trainingCount: p.trainingCount,
      ascensionCount: p.ascensionCount,
      bodyLevel: p.bodyLevel ?? 0,
      maxHandSize: p.maxHandSize,
      baseStats: { ...p.baseStats }, // run 级修正的基准（遗物成长/防御重算依赖它）
    },
    remi: { ...run.remi, unlockedSupports: [...run.remi.unlockedSupports] },
  };
}

export function recordSave(run) {
  writeRaw(keyOf(modeOf(run)), JSON.stringify(snapshotRun(run)));
}

/** 读存档。mode 可为 'infinite' | 'story' | 'debug'（旧的布尔 storyMode 写法仍兼容）。 */
export function readSave(mode = 'infinite') {
  const raw = readRaw(keyOf(mode));
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    return save.version === VERSION ? save : null; // 版本不符：视为无档
  } catch { return null; }
}

export function clearSave(mode = 'infinite') {
  removeRaw(keyOf(mode));
}

// ---------- 玩家存档库（调试工作流）：命名快照，与三个槽位互不相干 ----------
// 用途：玩到关键楼层（如章 2 入口）把当前局面存成命名档，与 build 编织器产出的
// tmp/saves 文件档一起构成 build 库。保存是纯快照（不改 run、不触发调试局转换）；
// 任何阶段可存——战斗中存的档恢复时按既有语义回到本层战前（saveRestore 归一）。
const LIB_PREFIX = 'wekyspire:save:lib:';

function libKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LIB_PREFIX)) keys.push(k);
    }
  } catch { for (const k of memory.keys()) if (k.startsWith(LIB_PREFIX)) keys.push(k); }
  return keys;
}

/** 局面 → 命名存档（同名覆盖）。返回 null = 成功，字符串 = 失败原因。 */
export function saveToLib(run, name) {
  const n = String(name ?? '').trim().slice(0, 40);
  if (!n) return '存档名不能为空';
  const overwrite = readRaw(LIB_PREFIX + n) != null;
  writeRaw(LIB_PREFIX + n, JSON.stringify(snapshotRun(run)));
  return overwrite ? `已覆盖同名存档「${n}」` : null;
}

/** 库清单（按保存时间新→旧）：名字 + 摘要（不返回完整档体）。 */
export function listSaveLib() {
  const out = [];
  for (const k of libKeys()) {
    try {
      const s = JSON.parse(readRaw(k) ?? '');
      out.push({
        name: k.slice(LIB_PREFIX.length),
        savedAt: s.savedAt ?? 0,
        floor: s.floor ?? 0,
        gameStage: s.gameStage ?? '',
        currentRoom: s.currentRoom ?? null,
        deck: s.player?.deck?.length ?? 0,
        relics: s.player?.relics?.length ?? 0,
        mode: s.debugMode ? 'debug' : (s.storyMode ? 'story' : 'infinite'),
      });
    } catch { /* 坏档跳过（不挡整个列表） */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function readFromLib(name) {
  const raw = readRaw(LIB_PREFIX + String(name ?? '').trim());
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    return save.version === VERSION ? save : null;
  } catch { return null; }
}

export function deleteFromLib(name) {
  removeRaw(LIB_PREFIX + String(name ?? '').trim());
}
