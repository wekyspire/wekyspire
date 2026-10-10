import { registerSkill } from '../skills/registry.js';
import { firstAliveEnemy } from '../state/battleState.js';
import { DealDamageInstruction, GainShieldInstruction, previewDamage } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { AddCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { PlayerTurnStartInstruction } from '../instructions/turn.js';
import { reactFx } from './cardKit.js';

// 应用后伤害文本（content 攻击卡通用）：基数 + 攻击面板 + power，再经
// previewDamage 干跑吃 PRE 修正（下次伤害翻倍、目标格挡免伤等）。
// tags = 该卡结算时打在伤害指令上的同一批标记——tags 门控的 PRE 修正（如架势镜
// 「perfect +10」）因此同样进预览，卡面所见即所算；调用方须与 use() 的出牌
// tags 共用同一常量（两处各写一份会漂移）。
// 无存活敌人（战斗收尾）时退化为裸面板值。
export function resolvedDamageText(sctx, base, tags = []) {
  const amount = base + sctx.player.getStat('attack') + sctx.self.power;
  const target = enemyTarget(sctx);
  const { damage } = target
    ? previewDamage(sctx, { source: sctx.player, target, amount, tags })
    : { damage: amount };
  return `${damage}伤害`;
}

// ① 纯伤害攻击牌（真拳系列 C 位：拳 C/B/A → 真拳 S；B/A 与 C 同名）
registerSkill({
  // 通用填充卡（拳/盾是全体系起始牌组的填充位，不走体修路线无法升级）；
  // 不进任何奖励池——开包即提升，填充卡不占奖励位（StS Strike 同款）。
  id: 'punch', name: '拳', type: 'normal', tier: 'C', series: 'punch', subsystem: 'fist',
  canSpawnAsReward: false,
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  targetMode: 'enemy', // 前端交互声明：需指定敌方目标（曲线箭头瞄准）
  promotesTo: 'punchB',
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player,
      target: enemyTarget(sctx),
      amount: 6 + sctx.player.getStat('attack') + sctx.self.power,
      skill: sctx.self, // 伤害出处（日志归属；cardKit.dealDamage 缺省带，手搓路径要显式）
    }));
    return true;
  },
  describe: () => '6伤害',
  battleDescribe: (sctx) => resolvedDamageText(sctx, 6),
});

// 玩家指定目标（须为敌方存活单位）优先，否则默认首个存活敌人
// （content 内多卡复用，导出供 bodySkills 等内容文件共享）
export function enemyTarget(sctx) {
  return (sctx.target?.side === 'enemy' && !sctx.target.isDead())
    ? sctx.target
    : firstAliveEnemy(sctx.battleState);
}

// ② 获得护盾牌：盾系列 C 位（BODY_CULTIVATION_CARDS §3.1 拆组合·盾系列：1AP 获得 5 护盾）。
// 无冷却（冷却1 在 B 盾——升阶的阶差）。
registerSkill({
  id: 'shieldC', name: '盾', type: 'normal', tier: 'C', series: 'block', subsystem: 'block',
  canSpawnAsReward: false, // 通用填充卡，不进奖励池（同拳）
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  promotesTo: 'shieldB',
  use(sctx) {
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 5 }));
    return true;
  },
  describe: () => '5护盾',
});

// ③ 施加/触发效果牌：余烬 + 燃烧（点火系列 C 位；0费冷却1——2026-10-10 火系大改：
// 去伤害去费用，点火是余烬经济的启动器）
// 点火是火体系的燃烧入口——由首次点亮火灵脉时进阶获赠直发
// （ascension.FIRST_ASCENSION_GRANT）。
registerSkill({
  id: 'igniteC', name: '点火', type: 'fire', tier: 'C', series: 'ignite', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  targetMode: 'enemy',
  promotesTo: 'igniteB',
  use(sctx) {
    const target = enemyTarget(sctx);
    sctx.kernel.submitInstruction(new AddCardInstruction({
      defId: 'emberMote', toZone: 'deck', index: 'random',
    }));
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target, effectId: 'burn', stacks: 5,
    }));
    return true;
  },
  describe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}5',
  battleDescribe: () => '/named{洗入1}/card{emberMote}，赋予/effect{燃烧}5',
});

// ④ 咏唱牌：每个玩家回合开始回复 1 点魏启（验证 activated 生命周期 + WAIT 回合）。
// 咏唱双态：发动后住手牌持续生效，按咏唱值占手牌压力（咏唱1 = 激活时计 1 张手牌）；
// 再次打出免费解除并回牌库（压力随离手释放）。
registerSkill({
  id: 'focusChant', name: '凝神诀', type: 'normal', tier: 'C', series: 'focusChant',
  cost: { mana: 1, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant',
  chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: PlayerTurnStartInstruction,
      phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }), instr);
        reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
      },
    }],
  },
  describe: () => '回合开始时魏启+1',
  battleDescribe: (sctx) => '回合开始时魏启+1',
});
