import { createSkillRuntime } from '../../state/skillRuntime.js';
import { spawnableCardPool } from '../rewards.js';
import { allRelics } from '../../relics/registry.js';
import { grantRelic } from '../prep.js';

// 老虎机（RUN_DESIGN §4.2）：花费金币抽奖，权重全部占位（§9 经济数值留坑）。

export const SLOT_PLACEHOLDER = {
  spinCost: 5,
  moneyPrize: 15,
  // [奖项, 权重]：card = 奖励池内随机卡（同战后奖励的灵脉等阶门禁；
  // 「高于当前等阶的彩蛋卡」作为正式版方向见 §9 留坑）
  table: [
    ['nothing', 30],
    ['money', 25],
    ['fruit', 15],
    ['training', 10],
    ['card', 8],
    ['relic', 12],
  ],
};

// 抽一次奖：扣费 → 按权重定奖项 → 结算。返回奖项描述 { type, defId? }
export function spinSlot(run) {
  if (run.currentRoom !== 'slot') throw new Error('当前不在老虎机房');
  if (run.player.money < SLOT_PLACEHOLDER.spinCost) throw new Error('金币不足，无法抽奖');
  run.player.money -= SLOT_PLACEHOLDER.spinCost;

  const total = SLOT_PLACEHOLDER.table.reduce((s, [, w]) => s + w, 0);
  let roll = run.rng.next() * total;
  let type = 'nothing';
  for (const [prize, weight] of SLOT_PLACEHOLDER.table) {
    if (roll < weight) { type = prize; break; }
    roll -= weight;
  }

  const result = { type };
  switch (type) {
    case 'money':
      run.player.money += SLOT_PLACEHOLDER.moneyPrize;
      result.money = SLOT_PLACEHOLDER.moneyPrize;
      break;
    case 'fruit':
      run.remi.fruits += 1;
      break;
    case 'training':
      run.player.trainingCount += 1; // +1 等效训练（§4.2）
      break;
    case 'card': {
      const pool = spawnableCardPool(run);
      const def = pool[Math.floor(run.rng.next() * pool.length)];
      run.player.deck.push(createSkillRuntime(def.id));
      result.defId = def.id;
      break;
    }
    case 'relic': {
      const pool = allRelics();
      const def = pool[Math.floor(run.rng.next() * pool.length)];
      grantRelic(run, def.id);
      result.relicId = def.id;
      break;
    }
    default:
      break; // nothing
  }
  return result;
}
