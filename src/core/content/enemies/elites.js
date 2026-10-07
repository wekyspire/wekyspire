// 精英怪（每章第 6/9 层的精英池，difficulty.elite = true；随从（无难度元数据、不进生成池）跟各自召唤主）。

import Enemy from '../../state/enemy.js';
import { registerEnemy, getEnemyDefinition } from '../../enemies/registry.js';
import { registerSkill } from '../../skills/registry.js';
import { AddCardInstruction } from '../../instructions/cards.js';
import { DealDamageInstruction, GainShieldInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { UnitSpawnInstruction } from '../../instructions/units.js';
import { PlayerTurnEndInstruction } from '../../instructions/turn.js';
import { aliveEnemies, zoneOf } from '../../state/battleState.js';

// ==== 精英怪：机制更强 / 基准数值更高 / 战力≈两个普通敌人 ====
// 精英只经「精英怪房」模板出场（difficulty.elite: true 同时把它挡在普通通配池外）。
// v2 起精英也是固定数值（createUnit() 授权面板，不缩放）——base 只是战力档位标签
//（雪狼 base 10 ≈ 两个 d5 白板），见 ENEMY_GENERATION.md。

// 震慑（雪狼衍生塞牌）：消耗，无效果，1AP——纯手牌淤积（占手牌位 + 打出收 AP 税），
// 可换牌/弃牌处理。只经 AddCard 入场，不入奖励池（同碎铁口径）。
registerSkill({
  id: 'shockCard', name: '震慑', type: 'normal', tier: 'C', series: 'enemyJunk',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use() { return true; },
  describe: () => '无效果',
});

// ⑨ 雪狼（第 1 章精英）：血牛 + 节奏骚扰——开局压制（虚弱2 + 攻9），随后三拍循环：
// 塞 2 张「震慑」入玩家手牌 → 攻6+盾14 → 攻6×3
//（塞牌挤占手牌上限与位置敏感卡；满手时震慑改落牌库，AddCard 的兜底语义）。
registerEnemy({
  difficulty: { base: 10, floorMin: 4, floorMax: 10, elite: true },
  id: 'snowwolf', name: '雪狼',
  createUnit: () => new Enemy({ defId: 'snowwolf', name: '雪狼', maxHp: 98 }),
  act(actx) {
    const atk = actx.unit.getStat('attack');
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'weaken', stacks: 2,
      }));
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 9 + atk,
      }));
      return;
    }
    const phase = (actx.unit.actionIndex - 1) % 3;
    if (phase === 0) {
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'shockCard', toZone: 'hand', index: 'random',
        }));
      }
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 6 + atk,
      }));
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 14 }));
    } else {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: actx.unit, target: actx.player, amount: 6 + atk,
        }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) {
      return { kinds: ['debuff', 'attack'], hits: 1, damage: 9 + atk, note: '赋予玩家虚弱2（攻击-2）' };
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['debuff'], note: '向你的手牌塞入2张「震慑」' };
    if (phase === 1) return { kinds: ['attack', 'defend'], hits: 1, damage: 6 + atk, note: '自身护盾+14' };
    return { kinds: ['attack'], hits: 3, damage: 6 + atk };
  },
});

// ⑫ 沼泽伏击者（第 1 章精英）：爆发——开局自带护盾20（防首回合
// 被斩杀），首拍扑咬 25；随后三拍循环：盾15+中毒5 → 盾15+攻10 → 晕眩发呆（破盾窗口）。
registerEnemy({
  difficulty: { base: 10, floorMin: 4, floorMax: 10, elite: true },
  id: 'swampAmbusher', name: '沼泽伏击者',
  createUnit: () => {
    const u = new Enemy({ defId: 'swampAmbusher', name: '沼泽伏击者', maxHp: 60 });
    u.shield = 20; // 战斗开始自带护盾——完整覆盖玩家第一回合
    return u;
  },
  act(actx) {
    const atk = actx.unit.getStat('attack');
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 25 + atk,
      }));
      return;
    }
    const phase = (actx.unit.actionIndex - 1) % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 15 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'poison', stacks: 5,
      }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 15 }));
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + atk,
      }));
    }
    // phase 2：晕眩发呆——不提交任何指令（破盾/回血的喘息拍）
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) {
      return { kinds: ['attack'], hits: 1, damage: 25 + atk, note: '自身开局自带护盾20' };
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['defend', 'debuff'], note: '自身护盾15，赋予玩家中毒5' };
    if (phase === 1) return { kinds: ['defend', 'attack'], hits: 1, damage: 10 + atk, note: '自身护盾15' };
    return { kinds: ['stun'], note: '晕眩（不行动）' };
  },
});

// ⑳ 碎岩穿山甲（第 1 章精英）：重甲 + 蓄势冲锋——固定防御 3
//（白板 6 伤拳只磨出 3）；两拍循环：蓄力（盾15 + 蓄势6）→ 冲锋（攻12，
// 蓄势让每一击都吃满加成）。
registerEnemy({
  difficulty: { base: 10, floorMin: 4, floorMax: 10, elite: true },
  id: 'rockPangolin', name: '碎岩穿山甲',
  createUnit: () => new Enemy({ defId: 'rockPangolin', name: '碎岩穿山甲', maxHp: 59 }),
  onBattleStart(ctx, unit) {
    unit.defense += 3; // 花岗岩甲：固定减伤轨
  },
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 15 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'momentum', stacks: 6,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player,
        amount: 12 + unit.getStat('attack'), // 蓄势走 PRE 订阅，不双计
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '蓄力：自身护盾+15、蓄势+6' }
    : { kinds: ['attack'], hits: 1,
        damage: 12 + unit.getStat('attack'),   // 蓄势由 withMomentumBonus 统一计入预告——手动再加=双计
        note: `冲锋（蓄势${unit.getEffectStacks('momentum')}：伤害+${unit.getEffectStacks('momentum')}）` }),
});

// ㉒ 庄园主（章3 精英·召唤主题：大史莱姆退役后接班）——四拍循环：
// 攻9 → 召唤仆人（场上无仆人且有空位）→ 攻13 → 自身盾8。
// 仆人护主（给它盾5）——先杀仆人还是抢主人，是每回合的账。
registerEnemy({
  difficulty: { base: 7, floorMin: 23, floorMax: 32, elite: true },
  id: 'manorLord', name: '庄园主',
  createUnit: () => new Enemy({ defId: 'manorLord', name: '庄园主', maxHp: 60 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 4;
    if (phase === 1) {
      const noServant = !aliveEnemies(bs).some(e => e.defId === 'footmanImp');
      const hasSlot = aliveEnemies(bs).length < (bs.config?.maxEnemies ?? 4);
      if (noServant && hasSlot) {
        actx.kernel.submitInstruction(new UnitSpawnInstruction({
          unit: getEnemyDefinition('footmanImp').createUnit(),
          source: unit,
        }));
        return;
      }
      // 仆从已就位：召唤拍退化为攻击拍
    }
    if (phase === 3) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player,
      amount: (phase === 2 ? 13 : 9) + unit.getStat('attack'),
    }));
  },
  getIntention: (unit, battleState) => {
    const phase = unit.actionIndex % 4;
    if (phase === 1) {
      const noServant = !aliveEnemies(battleState).some(e => e.defId === 'footmanImp');
      const hasSlot = aliveEnemies(battleState).length < (battleState.config?.maxEnemies ?? 4);
      if (noServant && hasSlot) return { kinds: ['summon'], note: '召唤仆人' };
      return { kinds: ['attack'], hits: 1, damage: 9 + unit.getStat('attack') };
    }
    if (phase === 2) return { kinds: ['attack'], hits: 1, damage: 13 + unit.getStat('attack') };
    return { kinds: ['defend'], note: '自身护盾+8' };
  },
});

// 庄园仆从（召唤物，不进生成池：无 difficulty 元数据 = 通配/精英池都取不到它——
// 「difficulty 缺失视为不可生成」的生成器防御口径）。护主 ↔ 攻4 两拍。
// 护主对象 = 庄园主或饕餮领主（后者 Boss 波 2 复用此件作「盛宴」资粮）。
const footmanMasterOf = (e) => e.defId === 'manorLord' || e.defId === 'gluttonLord';
registerEnemy({
  id: 'footmanImp', name: '庄园仆从',
  createUnit: () => new Enemy({ defId: 'footmanImp', name: '庄园仆从', maxHp: 12 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      const master = aliveEnemies(actx.battleState).find(footmanMasterOf);
      if (master) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: master, amount: 5 }));
        return;
      }
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 4 + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit, battleState) => {
    const master = aliveEnemies(battleState).find(footmanMasterOf);
    return (unit.actionIndex % 2 === 0 && master)
      ? { kinds: ['defend', 'buff'], note: '护主：主君护盾+5' }
      : { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') };
  },
});

// ==== 章2 精英（南孚宫 17/20 层；ENEMIES_2.md 精英节）====

// 四色炸弹（爆破专家衍生塞牌，Z_CARDS.md 口径）：红/蓝 = 定时炸弹（可打出消耗，
// 回合末仍在手受 15——处理出口是花代价打出或弃掉）；白/黑 = 即爆雷（打出当拍自伤，
// 白色带消耗、黑色是回库的滞留税）。均不入奖励池。
function timedBombCard({ id, name, cost, note }) {
  registerSkill({
    id, name, type: 'normal', tier: 'Z', series: 'enemyJunk',
    cost,
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    keywords: ['exhaust'],
    canSpawnAsReward: false,
    use() { return true; },
    subscriptions: (sctx) => [{
      when: PlayerTurnEndInstruction, phase: 'post',
      filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
      react: (instr, ctx) => ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: ctx.player, amount: 15, fixed: true, tags: [id],
      }), instr),
    }],
    describe: () => note,
  });
}
timedBombCard({ id: 'redBomb', name: '红色炸弹', cost: { mana: 0, actionPoint: 2 },
  note: '消耗。回合结束时，若此卡在手牌中，受到15点伤害' });
timedBombCard({ id: 'blueBomb', name: '蓝色炸弹', cost: { mana: 3, actionPoint: 0 },
  note: '消耗。回合结束时，若此卡在手牌中，受到15点伤害' });

function instantBombCard({ id, name, amount, exhaust }) {
  registerSkill({
    id, name, type: 'normal', tier: 'Z', series: 'enemyJunk',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal', targetMode: 'none',
    ...(exhaust ? { keywords: ['exhaust'] } : {}),
    canSpawnAsReward: false,
    use(sctx) {
      sctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: sctx.player, amount, fixed: true, type: 'minor', tags: ['selfcost'],
      }));
      return true;
    },
    describe: () => `打出时受到${amount}点伤害${exhaust ? '。消耗' : ''}`,
  });
}
instantBombCard({ id: 'blackBomb', name: '黑色炸弹', amount: 9, exhaust: false });
instantBombCard({ id: 'whiteBomb', name: '白色炸弹', amount: 14, exhaust: true });

// 爆破专家（章2 精英·炸弹工厂）：四拍循环——洗红+蓝炸弹入牌库 → 攻10 →
// 攻7 + 塞白+黑炸弹进手牌 → 重击21。定时与即爆两档拆弹账：红蓝可花代价排掉，
// 白黑当拍就疼。
registerEnemy({
  difficulty: { base: 12, floorMin: 17, floorMax: 20, elite: true },
  id: 'demolitions', name: '爆破专家',
  createUnit: () => new Enemy({ defId: 'demolitions', name: '爆破专家', maxHp: 120 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 4;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'redBomb', toZone: 'deck', index: 'random' }));
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'blueBomb', toZone: 'deck', index: 'random' }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + atk,
      }));
    } else if (phase === 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 7 + atk,
      }));
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'whiteBomb', toZone: 'hand', index: 'random' }));
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'blackBomb', toZone: 'hand', index: 'random' }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 21 + atk,
        tags: ['heavy'],   // 重击档：敌方命中演出（enemyHitFx）
      }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 4;
    if (phase === 0) return { kinds: ['debuff'], note: '将「红色炸弹」「蓝色炸弹」洗入你的牌库' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + atk };
    if (phase === 2) return { kinds: ['attack', 'debuff'], hits: 1, damage: 7 + atk, note: '向你的手牌塞入「白色炸弹」「黑色炸弹」' };
    return { kinds: ['attack'], hits: 1, damage: 21 + atk, note: '重击' };
  },
});

// 灵御猎手（章2 精英·资源对冲）：首拍 干扰1（每回 1 魏启洗 1 虚无——回蓝体系的天敌，
// 当前回蓝手段少时近似空转、回蓝卡补齐后是主要压力源）。四拍循环：攻15 →
// 攻3×5 → 重击24 → 干扰1 + 洗 4 虚无。
registerEnemy({
  difficulty: { base: 12, floorMin: 17, floorMax: 20, elite: true },
  id: 'hunter', name: '灵御猎手',
  createUnit: () => new Enemy({ defId: 'hunter', name: '灵御猎手', maxHp: 126 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'interfere', stacks: 1,
      }));
      return;
    }
    const phase = (unit.actionIndex - 1) % 4;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 15 + atk,
      }));
    } else if (phase === 1) {
      for (let i = 0; i < 5; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 3 + atk,
        }));
      }
    } else if (phase === 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 24 + atk,
        tags: ['heavy'],   // 重击档：敌方命中演出（enemyHitFx）
      }));
    } else {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'interfere', stacks: 1,
      }));
      for (let i = 0; i < 4; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'voidCard', toZone: 'deck', index: 'random',
        }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) return { kinds: ['debuff'], note: '赋予玩家干扰1（每回复1魏启，牌库洗入1虚无）' };
    const phase = (unit.actionIndex - 1) % 4;
    if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 15 + atk };
    if (phase === 1) return { kinds: ['attack'], hits: 5, damage: 3 + atk };
    if (phase === 2) return { kinds: ['attack'], hits: 1, damage: 24 + atk, note: '重击' };
    return { kinds: ['debuff'], note: '赋予玩家干扰1；将 4 张「虚无」洗入你的牌库' };
  },
});
