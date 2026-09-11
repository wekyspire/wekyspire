// 存档（菜单级）：run 状态快照的持久化。
// runState 纪律 = 只存 id 与数字（§6.4），故快照 = 纯字段摘取，JSON 直存。
// 存档语义 = 检查点：仅在 prep / end 阶段落盘；战斗内退出 = 回到本层战前。
// 模式隔离：肉鸽与故事各占一个存档槽，互不覆盖。

const KEYS = Object.freeze({
  infinite: 'wekyspire:save:infinite',
  story: 'wekyspire:save:story',
});
const VERSION = 1;

const memory = new Map(); // 无 localStorage 环境（vitest node）的回退存储

const keyOf = (storyMode) => storyMode ? KEYS.story : KEYS.infinite;

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
    floor: run.floor,
    totalFloors: run.totalFloors,
    gameStage: run.gameStage,
    result: run.result,
    pendingCardRemoval: run.pendingCardRemoval,
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
  writeRaw(keyOf(run.storyMode), JSON.stringify(snapshotRun(run)));
}

export function readSave(storyMode = false) {
  const raw = readRaw(keyOf(storyMode));
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    return save.version === VERSION ? save : null; // 版本不符：视为无档
  } catch { return null; }
}

export function clearSave(storyMode = false) {
  removeRaw(keyOf(storyMode));
}
