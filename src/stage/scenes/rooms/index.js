// 房型配方层入口：配方 + 种子 → 场景定义（与 dungeon.js 的 DUNGEON 同构，
// BattleStage 经 scenes/index.js 的 getScene 直接消费）。战斗几何（battleLine/slots）
// 复用 dungeon.js 数据源——PCG 只换皮相，站位/战线不动。

import { DUNGEON } from '../dungeon.js';
import { composeRoom } from './composeRoom.js';
import { RECIPES } from './presets.js';

/**
 * @param recipeId 配方 id（presets.js：ch1 / ch3 / boss）
 * @param seed 房间种子（run 种子 + 层号派生；同种子恒定同布局）
 * @returns 场景定义 { id, build3D, battleLine, slots }
 */
export function getRoomScene(recipeId, seed = 'dev') {
  return {
    id: `pcg:${recipeId}`,
    build3D: () => composeRoom(recipeId, seed),
    battleLine: DUNGEON.battleLine,
    slots: DUNGEON.slots,
  };
}

/**
 * 楼层 → 场景 id（P4 接线口）：每章第 10 层为 Boss 层（11/22/33/44）→ pcg:boss；
 * 阶段流（用户定 2026-09）：1-10 杂乱要塞 → pcg:fortress，12-21 宫殿 → pcg:palace，
 * 23-32 衰败庄园 → pcg:manor，34-43 大图书馆 → pcg:library。
 * 隔层（boss4 与研究层之间，不计层数）不进本映射——SDK 直接 getRoomScene('mezzanine', seed)。
 * @param floor 1..44
 */
export function sceneIdForFloor(floor) {
  if (floor % 11 === 0) return 'pcg:boss';
  const stage = Math.ceil(floor / 11); // 1..4
  return ['pcg:fortress', 'pcg:palace', 'pcg:manor', 'pcg:library'][stage - 1];
}

export { RECIPES };
