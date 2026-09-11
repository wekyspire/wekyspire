import { registerEnemy, getEnemyDefinition } from '../enemies/registry.js';
import { registerSkill } from '../skills/registry.js';
import { AddCardInstruction, DrawCardsInstruction } from '../instructions/cards.js';
import Enemy from '../state/enemy.js';
import {
  DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction,
} from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { UnitSpawnInstruction } from '../instructions/units.js';
import { aliveEnemies } from '../state/battleState.js';

// 敌人定义总集。约定：
//   * 行动序列固定循环，按 unit.actionIndex 取模分支；行动即提交指令，无特判；
//   * 攻击数值一律走「基数 + unit.attack 面板」（battle.md F1 同源算式）——
//     floorEnemyGenerator 按实例难度抬高 attack 面板即可全场统一缩放，
//     getIntention 的 damage 用同一算式（意图预告 = 实际数值，所见即所算）；
//   * difficulty 难度元数据（2026-09 难度制，见 battle_gameplay/ENEMY_GENERATION.md）：
//     { base, min, max, floorMin, floorMax }——base 为设计基准难度（白板强度锚点），
//     实例难度 d ∈ [min,max] 决定属性加成；楼层超出 [floorMin,floorMax] 不再生成
//     （机制老旧 / 数值漂移超出设计包络的敌人自然退役）；
//   * getIntention(unit, battleState) 返回 { kinds, hits?, damage? }：kinds 是基础
//     意图集合（最多两两组合）——'attack'（附 hits×damage，hits=1 时前端省略次数）/
//     'defend' / 'buff'（自我/友军增强，含再生/荆棘/蓄势/自愈）/ 'debuff'（赋予
//     玩家削弱，含燃烧/虚弱/滞气）/ 'summon'（召唤援军，附 unitSpawned）。
//     前端只按种类画图标，不写详细信息。

// ① 固定行动序列杂鱼：攻 6 → 盾 4 循环
registerEnemy({
  id: 'slime', name: '史莱姆',
  difficulty: { base: 2, min: 1, max: 3, floorMin: 1, floorMax: 14 },
  createUnit: () => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 20 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 6 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 4 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 6 + unit.getStat('attack') }
    : { kinds: ['defend'], note: '自身护盾+4' }),
});

// ①' 大史莱姆：条件召唤者——场上无存活史莱姆、敌排有空位（enemies 未满
// config.maxEnemies，与前端槽位数对齐）、且上一回合没召唤过（lastSummonTurn
// 冷却一整轮：召唤 → 打一轮 → 视局面再召唤），满足三条才召唤；否则攻 10 + 盾 5。
// 召唤出的史莱姆尾插 enemies（本回合行动循环快照已取，下回合起参战）。
function bigSlimeCanSummon(unit, battleState, atTurn = battleState.turn.count) {
  const noSlime = !aliveEnemies(battleState).some(e => e.defId === 'slime');
  const hasSlot = battleState.enemies.length < (battleState.config?.maxEnemies ?? 4);
  // atTurn：行动侧传缺省（当前回合）；意图预告传 turn.count+1（预告发生在敌方回合末，
  // 为下一回合预告——冷却闸门按行动时点的回合计算，否则系统性差一拍「预告攻击、
  // 实际召唤」）。noSlime/hasSlot 仍可能被玩家回合行动改变，属预告的天然残差）
  const notSummonedLastTurn = unit.lastSummonTurn !== atTurn - 1;
  return noSlime && hasSlot && notSummonedLastTurn;
}
registerEnemy({
  difficulty: { base: 5, min: 4, max: 8, floorMin: 12, floorMax: 30 },
  id: 'bigSlime', name: '大史莱姆',
  createUnit: () => new Enemy({ defId: 'bigSlime', name: '大史莱姆', maxHp: 44 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (bigSlimeCanSummon(unit, bs)) {
      unit.lastSummonTurn = bs.turn.count;
      actx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition('slime').createUnit(),
        source: unit,
      }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: 10 + unit.getStat('attack'),
    }));
    actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 5 }));
  },
  getIntention: (unit, battleState) => (bigSlimeCanSummon(unit, battleState, battleState.turn.count + 1)
    ? { kinds: ['summon'], note: '召唤史莱姆' }
    : { kinds: ['attack', 'defend'], hits: 1, damage: 10 + unit.getStat('attack'), note: '并获护盾5' }),
});

// ② 带效果联动的小 Boss：每第三次行动给玩家上 2 层燃烧，其余时间攻 10
registerEnemy({
  difficulty: { base: 8, min: 8, max: 18, floorMin: 11, floorMax: 44 },
  id: 'pyro', name: '燃焰术士',
  createUnit: () => new Enemy({ defId: 'pyro', name: '燃焰术士', maxHp: 30 }),
  act(actx) {
    if (actx.unit.actionIndex % 3 === 2) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'burn', stacks: 2,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 3 === 2
    ? { kinds: ['debuff'], note: '赋予玩家燃烧2' }
    : { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') }),
});

// ③ 针鼠：**首拍竖刺（荆棘3，一次性）**，此后「攻3+护盾8 ↔ 攻6」两拍往复。
// 2026-09 用户改稿：旧版每两拍叠一次荆棘（越拖越痛），实质是在奖励速杀；改后荆棘只在开场
// 上一次，长线战斗不再变本加厉——速攻的唯一优势只剩「第一拍就秒掉它」从而完全避开荆棘。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 1, floorMax: 16 },
  id: 'hedgehog', name: '针鼠',
  createUnit: () => new Enemy({ defId: 'hedgehog', name: '针鼠', maxHp: 18 }),
  act(actx) {
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'thorns', stacks: 3,
      }));
      return;
    }
    const phase = (actx.unit.actionIndex - 1) % 2;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player,
      amount: (phase === 0 ? 3 : 6) + actx.unit.getStat('attack'),
    }));
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 8 }));
    }
  },
  getIntention: (unit) => {
    if (unit.actionIndex === 0) return { kinds: ['buff'], note: '自身荆棘3' };
    const phase = (unit.actionIndex - 1) % 2;
    return phase === 0
      ? { kinds: ['attack', 'defend'], hits: 1, damage: 3 + unit.getStat('attack'), note: '并获护盾8' }
      : { kinds: ['attack'], hits: 1, damage: 6 + unit.getStat('attack') };
  },
});

// ④ 暗影刺客：蓄势滚雪球——攻 → 蓄势+2（每层攻击+1）→ 突袭（高基数），
// 拖久了威胁线性上升，逼玩家集火或速杀
registerEnemy({
  difficulty: { base: 4, min: 3, max: 6, floorMin: 12, floorMax: 32 },
  id: 'shadowblade', name: '暗影刺客',
  createUnit: () => new Enemy({ defId: 'shadowblade', name: '暗影刺客', maxHp: 26 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 1) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'focus', stacks: 2,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player,
        amount: (phase === 0 ? 6 : 14) + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 1) return { kinds: ['buff'], note: '自身蓄势+2（攻击+2）' };
    return { kinds: ['attack'], hits: 1, damage: (phase === 0 ? 6 : 14) + unit.getStat('attack') };
  },
});

// ⑤ 怨灵：攻6 → 咒（虚弱2：玩家攻击-2）→ 攻8 三拍循环——削弱玩家的输出轴，
// 长线磨损。2026-09 稿改三拍（旧两拍版每两回合一虚，玩家直接萎了——超模）。
// unique：每场至多一只——虚弱不衰减，双怨灵会把永久 -4 攻击叠到前期无法翻盘；
// 血量 22→18 同步削弱（试玩反馈：前期压力过高）。
registerEnemy({
  difficulty: { base: 3, min: 2, max: 4, floorMin: 2, floorMax: 18 },
  unique: true,
  id: 'wraith', name: '怨灵',
  createUnit: () => new Enemy({ defId: 'wraith', name: '怨灵', maxHp: 18 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 1) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'weaken', stacks: 2,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player,
        amount: (phase === 0 ? 6 : 8) + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 1) return { kinds: ['debuff'], note: '赋予玩家虚弱2（攻击-2）' };
    return { kinds: ['attack'], hits: 1, damage: (phase === 0 ? 6 : 8) + unit.getStat('attack') };
  },
});

// ⑥ 石像卫士：高防厚血 + 再生续航——再生3 → 攻 → 盾 循环，考验破防与斩杀线
registerEnemy({
  difficulty: { base: 5, min: 4, max: 9, floorMin: 23, floorMax: 44 },
  id: 'gargoyle', name: '石像卫士',
  createUnit: () => new Enemy({ defId: 'gargoyle', name: '石像卫士', maxHp: 34, defense: 2 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'regen', stacks: 3,
      }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 6 }));
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '自身再生3' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    return { kinds: ['defend'], note: '自身护盾+6' };
  },
});

// ⑦ 夜蝠：汲血（攻击并自愈）×2 → 尖啸（滞气1：玩家下回合无法抽牌）
// 滞气尖啸是节奏型威胁——被叫到的回合要么硬打要么吃伤害
registerEnemy({
  difficulty: { base: 3, min: 2, max: 5, floorMin: 12, floorMax: 34 },
  id: 'nightbat', name: '夜蝠',
  createUnit: () => new Enemy({ defId: 'nightbat', name: '夜蝠', maxHp: 24 }),
  act(actx) {
    if (actx.unit.actionIndex % 3 === 2) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'stall', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 8 + actx.unit.getStat('attack'),
      }));
      actx.kernel.submitInstruction(new ApplyHealInstruction({
        target: actx.unit, amount: 3,
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 3 === 2
    ? { kinds: ['debuff'], note: '赋予玩家滞气1（下回合无法抽牌）' }
    : { kinds: ['attack', 'buff'], hits: 1, damage: 8 + unit.getStat('attack'), note: '攻击并自愈3' }),
});

// ⑧ 岩甲龟：龟缩（盾7 + 荆棘1）→ 重击 循环——盾棘一体的防御压迫，
// 打盾要吃反伤，绕盾要挨重击
registerEnemy({
  difficulty: { base: 4, min: 3, max: 7, floorMin: 23, floorMax: 40 },
  id: 'rockshell', name: '岩甲龟',
  createUnit: () => new Enemy({ defId: 'rockshell', name: '岩甲龟', maxHp: 30, defense: 1 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 7 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'thorns', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '自身护盾7 + 荆棘1' }
    : { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') }),
});

// ==== 精英怪（2026-09 难度制）：机制更强 / 基准数值更高 / 难度≈两个普通敌人 ====
// 精英只经「精英怪房」模板出场（difficulty.elite: true 同时把它挡在普通通配池外）。
// 缩放锚点：精英的基准数值按自身 base 难度授权（雪狼 55 血 = 难5 白板），
// 属性按 (d − base) 缩放——普通敌人按 (d − 2) 缩放，两套锚点见 ENEMY_GENERATION.md。

// 震慑（雪狼衍生塞牌）：消耗，无效果，1AP——纯手牌淤积（占手牌位 + 打出收 AP 税），
// 可换牌/弃牌处理。只经 AddCard 入场，不入奖励池（同碎铁口径）。
registerSkill({
  id: 'shockCard', name: '震慑', type: 'normal', tier: 'D', series: 'enemyJunk',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use() { return true; },
  describe: () => '无效果',
});

// ⑨ 雪狼（第 1 章精英，样例）：开局压制（虚弱2 + 攻8），随后三拍循环——
// 攻8防8 → 攻8×2 → 向玩家手牌随机位置塞 2 张「震慑」（塞牌是节奏型骚扰：
// 挤占手牌上限与位置敏感卡；满手时震慑改落牌库，AddCard 的 §7.3 兜底语义）。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 7, floorMin: 4, floorMax: 10, elite: true },
  id: 'snowwolf', name: '雪狼',
  createUnit: () => new Enemy({ defId: 'snowwolf', name: '雪狼', maxHp: 55 }),
  act(actx) {
    const atk = actx.unit.getStat('attack');
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'weaken', stacks: 2,
      }));
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 8 + atk,
      }));
      return;
    }
    const phase = (actx.unit.actionIndex - 1) % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 8 + atk,
      }));
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 8 }));
    } else if (phase === 1) {
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: actx.unit, target: actx.player, amount: 8 + atk,
        }));
      }
    } else {
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'shockCard', toZone: 'hand', index: 'random',
        }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) {
      return { kinds: ['debuff', 'attack'], hits: 1, damage: 8 + atk, note: '赋予玩家虚弱2（攻击-2）' };
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['attack', 'defend'], hits: 1, damage: 8 + atk, note: '并获护盾8' };
    if (phase === 1) return { kinds: ['attack'], hits: 2, damage: 8 + atk };
    return { kinds: ['debuff'], note: '向你的手牌塞入2张「震慑」' };
  },
});

// ⑩ 小史莱姆（前期微威胁杂兵，2026-09 难度制）：塞粘液 ↔ 攻3 两拍循环。
// 粘液 = 1AP 抽1 消耗的淤积牌（比震慑温和：能打出换手，但吃 AP、占牌库）。
// 只经 AddCard 入场，不入奖励池。
registerSkill({
  id: 'gooCard', name: '粘液', type: 'normal', tier: 'D', series: 'enemyJunk',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  canSpawnAsReward: false,
  use(sctx) {
    sctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1 }));
    return true;
  },
  describe: () => '抽1',
});
registerEnemy({
  difficulty: { base: 1, min: 1, max: 2, floorMin: 2, floorMax: 16 },
  id: 'slimelet', name: '小史莱姆',
  createUnit: () => new Enemy({ defId: 'slimelet', name: '小史莱姆', maxHp: 3 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      // 粘液塞牌库末（数组尾 = 最晚抽到）：污染在长线兑现，不卡当下
      actx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'gooCard', toZone: 'deck', index: null,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 3 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['debuff'], note: '向牌库末塞入1张「粘液」' }
    : { kinds: ['attack'], hits: 1, damage: 3 + unit.getStat('attack') }),
});

// ⑪ 嗡嗡虫（前期小敌人，2026-09）：闪避1 → 攻1×4 → 攻3 三拍循环。
// 闪避逼玩家先垫一发再集火（或用燃烧/中毒等环境伤害绕过）。
registerEnemy({
  difficulty: { base: 1, min: 1, max: 2, floorMin: 2, floorMax: 16 },
  id: 'buzzbug', name: '嗡嗡虫',
  createUnit: () => new Enemy({ defId: 'buzzbug', name: '嗡嗡虫', maxHp: 7 }),
  act(actx) {
    const atk = actx.unit.getStat('attack');
    const phase = actx.unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'dodge', stacks: 1,
      }));
    } else if (phase === 1) {
      for (let i = 0; i < 4; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: actx.unit, target: actx.player, amount: 1 + atk,
        }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 3 + atk,
      }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '自身闪避1（免疫下一次攻击）' };
    if (phase === 1) return { kinds: ['attack'], hits: 4, damage: 1 + atk };
    return { kinds: ['attack'], hits: 1, damage: 3 + atk };
  },
});

// ⑫ 沼泽伏击者（第 1 章精英，2026-09）：**战斗开始自带 18 盾**（createUnit 预置——
// 敌方回合开始才清盾，故这层盾完整覆盖玩家第一回合，防开局被爆发斩杀），开局扑咬
// 攻15，随后三拍循环——盾15+中毒5 → 盾15+攻10 → 晕眩发呆（不行动，破盾窗口）。
// 中毒 5 是长线压力（回合末固定伤害递减），逼玩家带节奏强攻。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 7, floorMin: 4, floorMax: 10, elite: true },
  id: 'swampAmbusher', name: '沼泽伏击者',
  createUnit: () => {
    const u = new Enemy({ defId: 'swampAmbusher', name: '沼泽伏击者', maxHp: 32 });
    u.shield = 18; // 战斗开始自带护盾（试玩反馈：此前开局无盾，被首回合爆发白嫖）
    return u;
  },
  act(actx) {
    const atk = actx.unit.getStat('attack');
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 15 + atk,
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
      return { kinds: ['attack'], hits: 1, damage: 15 + atk, note: '自身开局自带护盾18' };
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['defend', 'debuff'], note: '自身护盾15，赋予玩家中毒5' };
    if (phase === 1) return { kinds: ['defend', 'attack'], hits: 1, damage: 10 + atk, note: '自身护盾15' };
    return { kinds: ['stun'], note: '晕眩（不行动）' };
  },
});

// ============ 第一章补充敌人（2026-09，设计卡见 battle_gameplay/ENEMIES_1.md §6）============
// 四只各填一个机制空位（支援 / 预告重击 / 亡语 / 蛰伏），互不重叠，都不引入新资源轴。

// ⑬ 腐苔球：治疗自身或最低血友军 6 ↔ 攻 4 两拍循环。双敌房里是「先杀谁」的目标优先级
// 考题，单只时是「你得比它回得快」的持久压力；不叠盾、不反伤——最坏只是把战斗拉长。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 2, floorMax: 16 },
  id: 'mossBall', name: '腐苔球',
  createUnit: () => new Enemy({ defId: 'mossBall', name: '腐苔球', maxHp: 14 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      // 治疗血量最低的存活友军（含自己）：把「先杀谁」变成真问题
      const pool = aliveEnemies(actx.battleState);
      const target = pool.reduce((a, b) => (b.hp < a.hp ? b : a), pool[0]);
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target, amount: 6 }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 4 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['buff'], note: '治疗友军6' }
    : { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') }),
});

// ⑭ 鼓腹蟾：鼓腹蓄力 → 重锤 10+攻击 → 甩舌 4+攻击，三拍循环。三拍里有一拍是明确的
// 重击预告，把「立盾」从反射动作变成决策；蓄力拍零输出，总量与史莱姆同级。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 2, floorMax: 16 },
  id: 'pufferToad', name: '鼓腹蟾',
  createUnit: () => new Enemy({ defId: 'pufferToad', name: '鼓腹蟾', maxHp: 20 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 0) return; // 鼓腹：不提交指令（意图已预告下一拍重击）
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player,
      amount: (phase === 1 ? 10 : 4) + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '鼓腹蓄力·下回合重击10' };
    return { kinds: ['attack'], hits: 1, damage: (phase === 1 ? 10 : 4) + unit.getStat('attack') };
  },
});

// ⑮ 爆囊：攻 3 ↔ 引线+1 两拍循环；**亡语**——死亡时对玩家造成 6 + 3×引线 伤害（可被盾挡）。
// 低血高代价的「什么时候杀它」考题：早杀便宜、拖延变贵，但代价完全由玩家掌控。
// 亡语经 combat.js 的 onDeath 钩子提交（作为致死伤害的子节点立即结算）。
registerEnemy({
  difficulty: { base: 1, min: 1, max: 2, floorMin: 2, floorMax: 16 },
  id: 'blastPod', name: '爆囊',
  createUnit: () => new Enemy({ defId: 'blastPod', name: '爆囊', maxHp: 9 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 3 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'blastFuse', stacks: 1,
      }));
    }
  },
  onDeath(actx) {
    const fuse = actx.unit.getEffectStacks('blastFuse');
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 6 + 3 * fuse,
    }));
  },
  getIntention: (unit) => {
    if (unit.actionIndex % 2 === 0) {
      return { kinds: ['attack'], hits: 1, damage: 3 + unit.getStat('attack') };
    }
    const fuse = unit.getEffectStacks('blastFuse');
    return { kinds: ['debuff'], note: `引线：死亡时对玩家造成 ${6 + 3 * (fuse + 1)} 伤害` };
  },
});

// ⑯ 石茧：沉眠 1 拍（白给）+ 苏醒时攻击 +2，此后每拍 8+攻击。一道「打得掉吗」的 DPS
// 检查：一拍内打不掉 26 血，就要开始面对 8/拍的持续压力（且它无减伤，随时可回头集火）。
// 攻击 +2 落在沉眠拍末尾——苏醒拍的意图预告直接含 +2，所见即所算。
registerEnemy({
  difficulty: { base: 3, min: 2, max: 4, floorMin: 4, floorMax: 16 },
  id: 'stoneCocoon', name: '石茧',
  createUnit: () => new Enemy({ defId: 'stoneCocoon', name: '石茧', maxHp: 26 }),
  act(actx) {
    if (actx.unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'strength', stacks: 2,
      }));
      return; // 沉眠：本拍不攻击
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 8 + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => (unit.actionIndex === 0
    ? { kinds: ['unknown'], note: '沉眠·苏醒时攻击+2' }
    : { kinds: ['attack'], hits: 1, damage: 8 + unit.getStat('attack') }),
});

// ⑰ 岩螺（第一章「苦战」底盘，2026-09 用户定：给慢慢磨的牌组留位置）：攻 4+攻击 ↔
// 缩壳（自身护盾6 + 回复4），两拍循环。特征 = **攻击弱、不会越来越强、血巨厚**：
// 它不叠 buff、不爆发、不召唤，纯粹考「能不能一边稳挡一边保持输出节奏」——缩壳的回血
// 让「纯磨血」不够，但也不需要任何爆发。它是第一章唯一适合打持久战的敌人。
registerEnemy({
  difficulty: { base: 3, min: 2, max: 4, floorMin: 4, floorMax: 16 },
  id: 'rockSnail', name: '岩螺',
  createUnit: () => new Enemy({ defId: 'rockSnail', name: '岩螺', maxHp: 40 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 4 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 6 }));
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: actx.unit, amount: 4 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') }
    : { kinds: ['defend', 'buff'], note: '缩壳：自身护盾6，回复4' }),
});
