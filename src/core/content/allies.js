import { registerAlly } from '../allies/registry.js';
import Ally from '../state/ally.js';
import { firstAliveEnemy } from '../state/battleState.js';
import { DealDamageInstruction } from '../instructions/combat.js';

// 瑞米：每个玩家回合（玩家行动之后，P7）造成 2 点伤害，目标跟随主角最后攻击过
// 的敌人（battleState.lastPlayerTarget，PreBattle 挂 POST 追踪）；本场尚未攻击过
// 或目标已倒时回退「最靠前的存活敌人」。意图预告（getIntention）与实际行动
// （act）共用同一解析，所见即所算（预告时点在敌方回合末：你本回合的攻击会在
// 瑞米行动前更新目标，预告与实际可能不同——这是跟随语义的自然结果）。
const REMI_DAMAGE = 2;

function remiTarget(battleState) {
  const last = battleState.enemies.find(
    e => e.uniqueID === battleState.lastPlayerTarget && !e.isDead());
  return last ?? firstAliveEnemy(battleState);
}

registerAlly({
  id: 'remi', name: 'remi',
  createUnit: () => new Ally({ defId: 'remi', name: 'remi', maxHp: 15 }),
  act(actx) {
    const target = remiTarget(actx.battleState);
    if (target) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target, amount: REMI_DAMAGE,
      }));
    }
  },
  getIntention: (_unit, battleState) => {
    const last = battleState.enemies.find(
      e => e.uniqueID === battleState.lastPlayerTarget && !e.isDead());
    const target = last ?? firstAliveEnemy(battleState);
    const note = last
      ? `目标：你最后攻击的敌人（${last.name}）`
      : '目标：最靠前的存活敌人'; // 未攻击过 / 最后目标已倒：回退口径如实呈现
    return { kinds: ['attack'], hits: 1, damage: REMI_DAMAGE, note };
  },
});
