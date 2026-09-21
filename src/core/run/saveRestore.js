// 存档快照 → run 的恢复原语（core 层，环境无关）：
//   浏览器读档（shell/runController）与 headless 工具（tools/session/engine）共用同一份，
//   两边的读档语义不会漂移。2026-09-21 从 runController 提取（headless 需要它，但 headless
//   不能把 Vue/shell 拖进来）。
//
// 语义：存档 = 检查点。**真实档**落盘只在 prep，恢复后必处 prep；**调试档**（造档工具产出 /
// 面板导出）要能从"房内 / 进阶中"接着跑，故额外恢复 gameStage/currentRoom/roomData/encounter。
import { advanceFloor } from './runFlow.js';

export function restoreRunFromSave(run, save) {
  while (run.floor < save.floor) advanceFloor(run);
  // rng 状态直存直取：回放 advanceFloor 不消耗 run.rng（遭遇用派生种子），
  // 若不恢复状态，读档后的房间派发会偏离活局时间线（旧档无此字段=维持回放语义）
  if (save.rngState != null) run.rng.setState(save.rngState);
  const p = run.player;
  const sp = save.player;
  p.hp = sp.hp; p.maxHp = sp.maxHp;
  p.mana = sp.mana; p.maxMana = sp.maxMana;
  p.maxActionPoints = sp.maxActionPoints; p.actionPoints = sp.maxActionPoints;
  p.money = sp.money;
  p.deck = sp.deck.map(rt => ({ ...rt }));
  p.abilities = [...sp.abilities];
  p.relics = [...sp.relics];
  p.equippedRelics = [...sp.equippedRelics];
  p.relicSlots = sp.relicSlots;
  p.leino = { ...sp.leino };
  p.trainingCount = sp.trainingCount;
  p.ascensionCount = sp.ascensionCount;
  p.bodyLevel = sp.bodyLevel ?? 0; // 旧档无此字段：隐藏体修等级从 0 起
  p.maxHandSize = sp.maxHandSize ?? 5; // 旧档（咏唱槽时代）无此字段：兜底默认
  // 旧档无 baseStats：以当前值为基准兜底；随后 refreshRunModifiers 会把遗物修正重算回去
  p.baseStats = sp.baseStats ? { ...sp.baseStats } : {
    maxHp: p.maxHp, maxMana: p.maxMana, maxActionPoints: p.maxActionPoints,
    attack: p.attack, defense: p.defense, maxHandSize: p.maxHandSize,
  };
  Object.assign(run.remi, save.remi);
  run.pendingCardRemoval = save.pendingCardRemoval;
  run.eventFlags = { ...(save.eventFlags ?? {}) }; // 旧档无此字段 → 空旗标
  run.relicUses = { ...save.relicUses };
  run.shop = save.shop ? { ...save.shop, items: save.shop.items.map(it => ({ ...it })) } : null;
  run.shopPending = save.shopPending ? { ...save.shopPending, choices: [...save.shopPending.choices] } : null;
  run.shopAppleBought = !!save.shopAppleBought;
  run.slot = save.slot ? { ...save.slot } : null;
  run.slotPending = save.slotPending ? { ...save.slotPending } : null;
  run.slotUpgradePending = !!save.slotUpgradePending;
  run.slotDevour = save.slotDevour ?? 0;
  run.slotFreeRolls = save.slotFreeRolls ?? 0;
  run.slotApples = save.slotApples ?? 0;
  // 银行机状态与跨战斗恶魔词条（旧档无此字段 → 视为未访问过银行机 / 无词条）
  run.bank = save.bank ? {
    ...save.bank,
    blackCleared: [...(save.bank.blackCleared ?? [])],
    offers: [...(save.bank.offers ?? [])],
    pendingRoll: save.bank.pendingRoll
      ? { ...save.bank.pendingRoll, options: [...(save.bank.pendingRoll.options ?? [])] } : null,
  } : null;
  run.pendingDebuffs = (save.pendingDebuffs ?? []).map(d => ({ ...d }));
  // 调试档的现场恢复（**仅 debugMode 档**）：真实存档语义 = 检查点，恒在 prep 恢复；
  // 调试档（造档工具产出 / 面板导出）要能从"房内 / 进阶中"直接接着跑，否则复现 bug
  // 还得手动点进房间。非 prep 阶段一律按"落到本层 prep"归一 —— 战斗本身不入档
  // （battle 由 floor+seed 可重导），故 battle 阶段也回退到 prep。
  if (save.debugMode) {
    run.floor = Math.max(1, Math.min(Number(save.floor) || 1, run.totalFloors));
    run.encounter = save.encounter ? [...save.encounter] : run.encounter;
    if (save.gameStage === 'room' && save.currentRoom) {
      run.gameStage = 'room';
      run.currentRoom = save.currentRoom;
      run.roomData = save.roomData ? JSON.parse(JSON.stringify(save.roomData)) : null;
    } else {
      run.gameStage = save.gameStage === 'end' ? 'end' : 'prep';
      run.currentRoom = null;
      run.roomData = null;
      run.result = save.result ?? null;
    }
  }
  return run;
}
