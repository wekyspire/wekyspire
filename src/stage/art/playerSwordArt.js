// 玩家大剑体系立绘映射：佩戴大剑遗物时，骑士立绘随牌堆中斩链
// 最高链位换图（五档：铁剑 → 微光 → 灼热 → 炽烈 → 白金）。
// 独立成文件的理由：纯逻辑不依赖 import.meta.glob（unitArt.js 的素材表是 Vite 特性），
// node 冒烟可直接 import 本文件；unitArt.js re-export 保持消费方路径不变。

import { getSkillDefinition } from '../../core/skills/registry.js';

// 玩家大剑立绘档序（rank = 数组下标；BattleStage 的只升不降 latch 用它比大小）
export const PLAYER_SWORD_TIERS = Object.freeze(['sword1', 'sword3', 'sword6', 'sword7', 'sword8']);

// 斩链（大剑遗物体系）链位 → 立绘档：链 7 阶对图 5 档，前期变化慢、后期加速发光。
const SLASH_ART_BY_STEP = Object.freeze(['sword1', 'sword3', 'sword3', 'sword6', 'sword6', 'sword7', 'sword8']);

// 斩链序：链头 slash 沿 battlePromotesTo 走到尾（链调整不漂移，无需手维护）。
// 惰性缓存——内容注册表在 content/index.js 跑完后才齐全。
let _slashChainCache = null;
function slashChain() {
  if (_slashChainCache) return _slashChainCache;
  const order = [];
  let cur = 'slash';
  while (cur && !order.includes(cur)) {
    order.push(cur);
    const next = getSkillDefinition(cur)?.battlePromotesTo;
    cur = (Array.isArray(next) ? next[0] : next) ?? null;
  }
  _slashChainCache = order;
  return order;
}

/**
 * 玩家大剑立绘变体：从一组卡牌 defId（牌堆全量）里取斩链最高链位 → 对应图档。
 * 无斩链卡（未佩戴大剑体系）返回 null = 普通立绘。纯函数，headless 可测。
 */
export function playerSwordVariant(defIds) {
  const order = slashChain();
  let best = -1;
  for (const id of defIds ?? []) {
    const i = order.indexOf(id);
    if (i > best) best = i;
  }
  if (best < 0) return null;
  return SLASH_ART_BY_STEP[Math.min(best, SLASH_ART_BY_STEP.length - 1)];
}
