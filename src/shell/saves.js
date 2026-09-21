// 存档（菜单级）：run 状态快照的持久化。
// runState 纪律 = 只存 id 与数字（§6.4），故快照 = 纯字段摘取，JSON 直存。
// 存档语义 = 检查点：仅在 prep / end 阶段落盘；战斗内退出 = 回到本层战前。
// 槽位隔离：肉鸽 / 故事 / **调试** 各占一个槽，互不覆盖——调试局（改过状态的局）只写
// debug 槽，真实存档永不被污染（见 runController 的 persist 守卫与 modeOf）。

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
    gameStage: run.gameStage,
    result: run.result,
    // 房型房间的现场（只有调试局会读它：真实档语义 = 检查点，恒在 prep 恢复；
    // 见 runController.restoreFromSave 的 debugMode 分支）
    currentRoom: run.currentRoom ?? null,
    roomData: run.roomData ? JSON.parse(JSON.stringify(run.roomData)) : null,
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
    // 不存档的话，读档会把存款吞掉、也能把恶魔 roll 的代价赖掉（2026-09-12 补）
    bank: run.bank ? {
      ...run.bank,
      blackCleared: [...(run.bank.blackCleared ?? [])],
      offers: [...(run.bank.offers ?? [])],
      pendingRoll: run.bank.pendingRoll
        ? { ...run.bank.pendingRoll, options: [...(run.bank.pendingRoll.options ?? [])] } : null,
    } : null,
    pendingDebuffs: (run.pendingDebuffs ?? []).map(d => ({ ...d })),
    player: {
      hp: p.hp, maxHp: p.maxHp,
      mana: p.mana, maxMana: p.maxMana,
      maxActionPoints: p.maxActionPoints,
      money: p.money,
      deck: p.deck.map(rt => ({ ...rt })),
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
