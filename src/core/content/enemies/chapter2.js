// 章2 小怪（南孚宫，12~21 层普通池）。
// 设计卡 = battle_gameplay/ENEMIES_2.md；数值 = v2 固定面板；主题战编成见
// floorEnemyGenerator.js；效果定义一律以 battle_gameplay/skills/EFFECTS.md 为准。
// 阵营三线：公司系（刺客/保安/间谍/杀手/新兵）× 宫廷系（护卫/铁卫/灵御/士兵/见习/机器人）
// × 妖蝶系（妖蝶/巨型妖蝶）+ 军队系（大队战士/狙击手/军号手）。
// 血量"X-Y 随机"的单位：createUnit 取中值，生成器后处理按 rng 定档落描述符 maxHp。

import Enemy from '../../state/enemy.js';
import { registerEnemy, getEnemyDefinition } from '../../enemies/registry.js';
import { DealDamageInstruction, GainShieldInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { UnitSpawnInstruction } from '../../instructions/units.js';
import { AddCardInstruction, BurnCardInstruction, LockCardsInstruction } from '../../instructions/cards.js';
import { PlayerTurnEndInstruction } from '../../instructions/turn.js';
import { aliveEnemies, zoneOf } from '../../state/battleState.js';
import { lockedCardsSettleReact, hasCardModifier } from '../../skills/cardModifiers.js';

// ---- 手牌锁定（间谍/狙击手；无人战体同款口径：锁定不影响打出，玩家回合结束仍在手则焚毁，
// 离手即免除。结算走 cardModifiers 的通用段——标记只落手牌（随抽随清），无牌库标记）----
function attachHandLockSettle(ctx, unit) {
  ctx.kernel.addSubscription({
    when: PlayerTurnEndInstruction,
    phase: 'post',
    owner: `enemy:${unit.uniqueID}:handLock`,
    filter: () => !unit.isDead(),
    react: lockedCardsSettleReact,
  });
}

// 锁定 N 张随机手牌（已锁定的跳过；手牌不足则全锁）。
function lockRandomHandCards(actx, n) {
  const hand = actx.battleState.zones.hand.filter(c => !hasCardModifier(c, 'locked'));
  const picked = actx.battleState.rng.shuffle([...hand]).slice(0, n);
  if (picked.length > 0) {
    actx.kernel.submitInstruction(new LockCardsInstruction({ uniqueIDs: picked.map(c => c.uniqueID) }));
  }
}

// 流弹误伤（新兵枪手）：对随机友军打 N 次次级伤害（不触发任何受击响应）。
function strayFire(actx, times) {
  const others = aliveEnemies(actx.battleState).filter(e => e !== actx.unit);
  for (let i = 0; i < times; i++) {
    const t = actx.battleState.rng.pick(others);
    if (!t) break;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: t, amount: 4, type: 'minor', tags: ['strayFire'],
    }));
  }
}

// ---- 大史莱姆：条件召唤者，坦克 ----
// 场上无存活小史莱姆、敌排有空位（存活口径，含尸体陷阱见 aiAct 装配）、上一回合未召唤
// （lastSummonTurn 冷却一整轮）三条齐备则召唤 1 只小史莱姆（尾插，下回合起参战）；否则
// 两拍循环：攻 16 → 攻 5 + 洗 2 粘液。
function bigSlimeCanSummon(unit, battleState, atTurn = battleState.turn.count) {
  const noSlimelet = !aliveEnemies(battleState).some(e => e.defId === 'slimeletA' || e.defId === 'slimeletB');
  const hasSlot = aliveEnemies(battleState).length < (battleState.config?.maxEnemies ?? 4);
  const notSummonedLastTurn = unit.lastSummonTurn !== atTurn - 1;
  return noSlimelet && hasSlot && notSummonedLastTurn;
}
registerEnemy({
  difficulty: { base: 5, floorMin: 12, floorMax: 21 },
  id: 'bigSlime', name: '大史莱姆',
  createUnit: () => new Enemy({ defId: 'bigSlime', name: '大史莱姆', maxHp: 99 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (bigSlimeCanSummon(unit, bs)) {
      unit.lastSummonTurn = bs.turn.count;
      actx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition('slimeletA').createUnit(),
        source: unit,
      }));
      return;
    }
    const phase = unit.actionIndex % 2;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 16 + unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 5 + unit.getStat('attack'),
      }));
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'gooCard', toZone: 'deck', index: 'random',
        }));
      }
    }
  },
  getIntention: (unit, battleState) => {
    if (bigSlimeCanSummon(unit, battleState, battleState.turn.count + 1)) {
      return { kinds: ['summon'], note: '召唤 1 只小史莱姆' };
    }
    const atk = unit.getStat('attack');
    return unit.actionIndex % 2 === 0
      ? { kinds: ['attack'], hits: 1, damage: 16 + atk }
      : { kinds: ['attack', 'debuff'], hits: 1, damage: 5 + atk, note: '洗入 2 张「粘液」' };
  },
});

// ---- 公司刺客（脆皮干扰）：出场灵体 1（首段伤害置 1）----
// 三拍循环：攻 6 → 力量 +3 → 攻 2×3。B：从第 2 拍开始（首行动为力量拍）。
function corpAssassinDef(id, startBeat) {
  registerEnemy({
    difficulty: { base: 3, floorMin: 12, floorMax: 21 },
    id, name: id === 'corpAssassin' ? '公司刺客' : '公司刺客B',
    createUnit: () => new Enemy({ defId: id, name: id === 'corpAssassin' ? '公司刺客' : '公司刺客B', maxHp: 38 }),
    onBattleStart(ctx, unit) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'phantom', stacks: 1 }));
    },
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 1) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 3,
        }));
      } else if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 6 + unit.getStat('attack'),
        }));
      } else {
        for (let i = 0; i < 3; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: actx.player, amount: 2 + unit.getStat('attack'),
          }));
        }
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 1) return { kinds: ['buff'], note: '自身力量+3' };
      if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 6 + atk };
      return { kinds: ['attack'], hits: 3, damage: 2 + atk };
    },
  });
}
corpAssassinDef('corpAssassin', 0);
corpAssassinDef('corpAssassinB', 1);

// ---- 公司保安（肉）：两拍循环 攻 4 → 盾 12 + 力量 3。B：从第 2 拍开始。血量 42-48 随机。----
function corpGuardDef(id, startBeat) {
  const name = id === 'corpGuard' ? '公司保安' : '公司保安B';
  registerEnemy({
    difficulty: { base: 3, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 45 }),
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 2;
      if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 4 + unit.getStat('attack'),
        }));
      } else {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 12 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 3,
        }));
      }
    },
    getIntention: (unit) => {
      const phase = (unit.actionIndex + startBeat) % 2;
      return phase === 0
        ? { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') }
        : { kinds: ['defend', 'buff'], note: '护盾+12，自身力量+3' };
    },
  });
}
corpGuardDef('corpGuard', 0);
corpGuardDef('corpGuardB', 1);

// ---- 间谍（强力干扰：锁定 = 无人战体同款，回合末仍在手则焚毁）----
// 拍 1 锁 1 + 攻 10 → 拍 2 锁 4 → 拍 3 锁 1 + 力量 2 → 第 4 拍起攻 3×3 永续。
// B：只以 3-1-2 拍循环（锁 1+力 2 → 锁 1+攻 10 → 锁 4），不进入永续攻击。
function spyLockNote(n) { return `锁定${n}：回合结束时仍在手则焚毁`; }
function spyDef(id, looping) {
  const name = id === 'spy' ? '间谍' : '间谍B';
  registerEnemy({
    difficulty: { base: 4, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 72 }),
    onBattleStart: attachHandLockSettle,
    act(actx) {
      const { unit } = actx;
      // beat：0=锁1+攻10，1=锁4，2=锁1+力2，3+=攻3×3。B 按 [2,0,1] 循环取拍。
      const beat = looping
        ? [2, 0, 1][unit.actionIndex % 3]
        : Math.min(unit.actionIndex, 3);
      if (beat === 0) {
        lockRandomHandCards(actx, 1);
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 10 + unit.getStat('attack'),
        }));
      } else if (beat === 1) {
        lockRandomHandCards(actx, 4);
      } else if (beat === 2) {
        lockRandomHandCards(actx, 1);
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 2,
        }));
      } else {
        for (let i = 0; i < 3; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: actx.player, amount: 3 + unit.getStat('attack'),
          }));
        }
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const beat = looping
        ? [2, 0, 1][unit.actionIndex % 3]
        : Math.min(unit.actionIndex, 3);
      if (beat === 0) return { kinds: ['debuff', 'attack'], hits: 1, damage: 10 + atk, note: spyLockNote(1) };
      if (beat === 1) return { kinds: ['debuff'], note: spyLockNote(4) };
      if (beat === 2) return { kinds: ['debuff', 'buff'], note: `${spyLockNote(1)}；自身力量+2` };
      return { kinds: ['attack'], hits: 3, damage: 3 + atk };
    },
  });
}
spyDef('spy', false);
spyDef('spyB', true);

// ---- 杀手（协作压制）：开局杀手 1（每有一张牌被打出，蓄势 +1——出牌量税）。攻 7 走天下，
// 拖久了威胁随玩家的节奏自我放大。
registerEnemy({
  difficulty: { base: 5, floorMin: 12, floorMax: 21 },
  id: 'killer', name: '杀手',
  createUnit: () => new Enemy({ defId: 'killer', name: '杀手', maxHp: 79 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'killer', stacks: 1 }));
  },
  act(actx) {
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 7 + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => ({ kinds: ['attack'], hits: 1, damage: 7 + unit.getStat('attack') }),
});

// ---- 新兵枪手（攻击压力，误伤友军）：三拍循环 攻 8+流弹误伤 4 → 装填（盾 5）→
// 攻 12 + 流弹误伤两名各 4。B/C：从第 2/3 拍开始。血量 42-48 随机。----
function recruitGunnerDef(id, startBeat) {
  const name = { recruitGunner: '新兵枪手', recruitGunnerB: '新兵枪手B', recruitGunnerC: '新兵枪手C' }[id];
  registerEnemy({
    difficulty: { base: 3, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 45 }),
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 8 + unit.getStat('attack'),
        }));
        strayFire(actx, 1);
      } else if (phase === 1) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 5 }));
      } else {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 12 + unit.getStat('attack'),
        }));
        strayFire(actx, 2);
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 8 + atk, note: '流弹误伤随机友军 4' };
      if (phase === 1) return { kinds: ['defend'], note: '慌张装填：护盾+5' };
      return { kinds: ['attack'], hits: 1, damage: 12 + atk, note: '流弹误伤两名随机友军各 4' };
    },
  });
}
recruitGunnerDef('recruitGunner', 0);
recruitGunnerDef('recruitGunnerB', 1);
recruitGunnerDef('recruitGunnerC', 2);

// ---- 南孚妖蝶（节奏骚扰）：出场闪避 2。三拍循环 洗 2 虚无 → 盾 10 → 滞气 3。
// B：第一拍改为攻 3×3；C：第三拍改为攻 12；D：仅以 1-2 两拍循环。血量 21-29 随机。----
const NYMPH_FAMILY = new Set(['nymph', 'nymphB', 'nymphC', 'nymphD']);
function nymphDef(id, { b1Attack = false, b3Attack = false, twoBeat = false } = {}) {
  const name = { nymph: '南孚妖蝶', nymphB: '南孚妖蝶B', nymphC: '南孚妖蝶C', nymphD: '南孚妖蝶D' }[id];
  const cycle = twoBeat ? 2 : 3;
  registerEnemy({
    difficulty: { base: 2, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 25 }),
    onBattleStart(ctx, unit) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: 2 }));
    },
    act(actx) {
      const { unit } = actx;
      const phase = unit.actionIndex % cycle;
      if (phase === 0 && b1Attack) {
        for (let i = 0; i < 3; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: actx.player, amount: 3 + unit.getStat('attack'),
          }));
        }
      } else if (phase === 0) {
        for (let i = 0; i < 2; i++) {
          actx.kernel.submitInstruction(new AddCardInstruction({
            defId: 'voidCard', toZone: 'deck', index: 'random',
          }));
        }
      } else if (phase === 1) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      } else if (b3Attack) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 12 + unit.getStat('attack'),
        }));
      } else {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'stall', stacks: 3,
        }));
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const phase = unit.actionIndex % cycle;
      if (phase === 0) return b1Attack
        ? { kinds: ['attack'], hits: 3, damage: 3 + atk }
        : { kinds: ['debuff'], note: '将 2 张「虚无」洗入你的牌库' };
      if (phase === 1) return { kinds: ['defend'], note: '护盾+10' };
      return b3Attack
        ? { kinds: ['attack'], hits: 1, damage: 12 + atk }
        : { kinds: ['debuff'], note: '赋予玩家滞气3（下回合无法抽牌）' };
    },
  });
}
nymphDef('nymph');
nymphDef('nymphB', { b1Attack: true });
nymphDef('nymphC', { b3Attack: true });
nymphDef('nymphD', { twoBeat: true });

// ---- 南孚宫护卫（支援）：两拍循环 全体友军护盾 6 → 攻 7。----
registerEnemy({
  difficulty: { base: 3, floorMin: 12, floorMax: 21 },
  id: 'palaceGuard', name: '南孚宫护卫',
  createUnit: () => new Enemy({ defId: 'palaceGuard', name: '南孚宫护卫', maxHp: 55 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 2 === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 6 }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 7 + unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '全体友军护盾+6' }
    : { kinds: ['attack'], hits: 1, damage: 7 + unit.getStat('attack') }),
});

// ---- 仪仗铁卫（以盾代攻）：出场护盾 15 + 如山 1（盾不清空）+ 冲撞 1（攻击伤害
// + 当前护盾一半——由 ram 效果供能，act 只提交基础值）。三拍循环 盾 15 → 攻 5 → 攻 7。----
registerEnemy({
  difficulty: { base: 4, floorMin: 12, floorMax: 21 },
  id: 'ironGuard', name: '仪仗铁卫',
  createUnit: () => new Enemy({ defId: 'ironGuard', name: '仪仗铁卫', maxHp: 66 }),
  onBattleStart(ctx, unit) {
    unit.shield += 15;
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'mountain', stacks: 1 }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'ram', stacks: 1 }));
  },
  act(actx) {
    const { unit } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 15 }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player,
        amount: (phase === 1 ? 5 : 7) + unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['defend'], note: '列盾：护盾+15' };
    // 预告与 ram 效果同源（+盾一半）；玩家破盾后读数实时回落
    const atk = unit.getStat('attack') + Math.floor(unit.shield / 2);
    return { kinds: ['attack'], hits: 1, damage: (phase === 1 ? 5 : 7) + atk };
  },
});

// ---- 南孚宫灵御（支援）：两拍循环 攻 9 → 盾 10 + 全体友军蓄势 3。血量 53-58 随机。----
registerEnemy({
  difficulty: { base: 4, floorMin: 12, floorMax: 21 },
  id: 'channeler', name: '南孚宫灵御',
  createUnit: () => new Enemy({ defId: 'channeler', name: '南孚宫灵御', maxHp: 55 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 9 + unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'momentum', stacks: 3,
        }));
      }
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 9 + unit.getStat('attack') }
    : { kinds: ['defend', 'buff'], note: '护盾+10，全体友军蓄势+3' }),
});

// ---- 见习灵御（持续成长的攻击压力）：拍 1 力量 +3；此后每拍 攻 3 + 力量 +2（无上限）。
// B/C：从第 2/3 拍开始（跳过力量开局，直接进攻击节拍）。血量 38-45 随机。----
function apprenticeDef(id, startBeat) {
  const name = { apprentice: '见习灵御', apprenticeB: '见习灵御B', apprenticeC: '见习灵御C' }[id];
  registerEnemy({
    difficulty: { base: 3, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 41 }),
    act(actx) {
      const { unit } = actx;
      const beat = unit.actionIndex + startBeat;
      if (beat === 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 3,
        }));
        return;
      }
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 3 + unit.getStat('attack'),
      }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'strength', stacks: 2,
      }));
    },
    getIntention: (unit) => {
      const beat = unit.actionIndex + startBeat;
      if (beat === 0) return { kinds: ['buff'], note: '自身力量+3' };
      return { kinds: ['attack', 'buff'], hits: 1, damage: 3 + unit.getStat('attack'), note: '自身力量+2' };
    },
  });
}
apprenticeDef('apprentice', 0);
apprenticeDef('apprenticeB', 1);
apprenticeDef('apprenticeC', 2);

// ---- 南孚宫士兵（DPS 补全）：三拍循环 攻 6 → 盾 10 → 攻 4×3。----
registerEnemy({
  difficulty: { base: 3, floorMin: 12, floorMax: 21 },
  id: 'soldier', name: '南孚宫士兵',
  createUnit: () => new Enemy({ defId: 'soldier', name: '南孚宫士兵', maxHp: 45 }),
  act(actx) {
    const { unit } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 6 + unit.getStat('attack'),
      }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
    } else {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 4 + unit.getStat('attack'),
        }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 6 + atk };
    if (phase === 1) return { kinds: ['defend'], note: '护盾+10' };
    return { kinds: ['attack'], hits: 3, damage: 4 + atk };
  },
});

// ---- 燃烧机器人（燃烧磨蚀）：出场炎魔 1（造成生命伤害附带燃烧 1）；报废亡语 燃烧 2。
// 三拍循环 攻 7 → 燃烧 3 → 掷射废弃弹壳（洗 2 灼伤）。B：血量减半（22）+ 从第 2 拍开始；
// C：从第 3 拍开始。----
function burnBotDef(id, startBeat, maxHp) {
  const name = { burnBot: '燃烧机器人', burnBotB: '燃烧机器人B', burnBotC: '燃烧机器人C' }[id];
  registerEnemy({
    difficulty: { base: 3, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp }),
    onBattleStart(ctx, unit) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'flameDemon', stacks: 1,
      }));
    },
    onDeath(actx) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'burn', stacks: 2,
      }));
    },
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 7 + unit.getStat('attack'),
        }));
      } else if (phase === 1) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'burn', stacks: 3,
        }));
      } else {
        for (let i = 0; i < 2; i++) {
          actx.kernel.submitInstruction(new AddCardInstruction({
            defId: 'burnWound', toZone: 'deck', index: 'random',
          }));
        }
      }
    },
    getIntention: (unit) => {
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 7 + unit.getStat('attack') };
      if (phase === 1) return { kinds: ['debuff'], note: '火花泄漏：赋予玩家燃烧3' };
      return { kinds: ['debuff'], note: '掷射废弃弹壳：2 张「灼伤」洗入你的牌库' };
    },
  });
}
burnBotDef('burnBot', 0, 44);
burnBotDef('burnBotB', 1, 22);
burnBotDef('burnBotC', 2, 44);

// ---- 南孚大队战士（法术反制）：两拍循环 攻 6 + 漏气 2 → 攻 6×2。B：从第 2 拍开始。
// 血量 55-64 随机。----
function legionnaireDef(id, startBeat) {
  const name = id === 'legionnaire' ? '南孚大队战士' : '南孚大队战士B';
  registerEnemy({
    difficulty: { base: 4, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 60 }),
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 2;
      if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 6 + unit.getStat('attack'),
        }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'leak', stacks: 2,
        }));
      } else {
        for (let i = 0; i < 2; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: actx.player, amount: 6 + unit.getStat('attack'),
          }));
        }
      }
    },
    getIntention: (unit) => {
      const phase = (unit.actionIndex + startBeat) % 2;
      return phase === 0
        ? { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + unit.getStat('attack'), note: '漏气2：下回合开始失去 2 魏启' }
        : { kinds: ['attack'], hits: 2, damage: 6 + unit.getStat('attack') };
    },
  });
}
legionnaireDef('legionnaire', 0);
legionnaireDef('legionnaireB', 1);

// ---- 南孚大队狙击手（回合压力）：三拍循环 锁定 2 → 装填（空拍蓄力）→ 射击 21。
// B：从第 2 拍开始（装填 → 射击 → 锁定，错半拍轮射）。----
function sniperDef(id, startBeat) {
  const name = id === 'sniper' ? '南孚大队狙击手' : '南孚大队狙击手B';
  registerEnemy({
    difficulty: { base: 4, floorMin: 12, floorMax: 21 },
    id, name,
    createUnit: () => new Enemy({ defId: id, name, maxHp: 40 }),
    onBattleStart: attachHandLockSettle,
    act(actx) {
      const { unit } = actx;
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) {
        lockRandomHandCards(actx, 2);
      } else if (phase === 2) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 21 + unit.getStat('attack'),
        }));
      }
      // phase === 1：装填空拍
    },
    getIntention: (unit) => {
      const phase = (unit.actionIndex + startBeat) % 3;
      if (phase === 0) return { kinds: ['debuff'], note: spyLockNote(2) };
      if (phase === 1) return { kinds: ['unknown'], note: '装填（下拍：射击）' };
      return { kinds: ['attack'], hits: 1, damage: 21 + unit.getStat('attack'), note: '射击' };
    },
  });
}
sniperDef('sniper', 0);
sniperDef('sniperB', 1);

// ---- 南孚大队军号手（齐射指挥）：出场齐射 1（攻击分段，段数=存活友军数含自身——
// 行为在 act 侧实现）。三拍循环 全体蓄势 2 → 齐射 4×N → 齐射 6×N。----
registerEnemy({
  difficulty: { base: 3, floorMin: 12, floorMax: 21 },
  id: 'bugler', name: '南孚大队军号手',
  createUnit: () => new Enemy({ defId: 'bugler', name: '南孚大队军号手', maxHp: 38 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'volley', stacks: 1 }));
  },
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      for (const e of aliveEnemies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'momentum', stacks: 2,
        }));
      }
    } else {
      const hits = aliveEnemies(bs).length; // 含自身——落单号手也有一声单响
      const per = (phase === 1 ? 4 : 6) + unit.getStat('attack');
      for (let i = 0; i < hits; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: per,
        }));
      }
    }
  },
  getIntention: (unit, battleState) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '全体友军蓄势+2' };
    const hits = aliveEnemies(battleState).length;
    const per = (phase === 1 ? 4 : 6) + unit.getStat('attack');
    return { kinds: ['attack'], hits, damage: per, note: '齐射' };
  },
});

// ---- 巨型妖蝶（母体）：出场闪避 1。首拍 幻象 1；此后三拍循环 洗 2 虚无 → 攻 10 → 滞气 1。
// 任何时候（场上无南孚妖蝶族 + 上回合未召唤 + 有空位）随机召唤一只妖蝶变体。----
function motherNymphCanSummon(unit, battleState, atTurn = battleState.turn.count) {
  const noNymph = !aliveEnemies(battleState).some(e => NYMPH_FAMILY.has(e.defId));
  const hasSlot = aliveEnemies(battleState).length < (battleState.config?.maxEnemies ?? 4);
  const notSummonedLastTurn = unit.lastSummonTurn !== atTurn - 1;
  return noNymph && hasSlot && notSummonedLastTurn;
}
registerEnemy({
  difficulty: { base: 5, floorMin: 12, floorMax: 21 },
  id: 'motherNymph', name: '巨型妖蝶',
  createUnit: () => new Enemy({ defId: 'motherNymph', name: '巨型妖蝶', maxHp: 71 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: 1 }));
  },
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (unit.actionIndex > 0 && motherNymphCanSummon(unit, bs)) {
      unit.lastSummonTurn = bs.turn.count;
      actx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition(bs.rng.pick(['nymph', 'nymphB', 'nymphC', 'nymphD'])).createUnit(),
        source: unit,
      }));
      return;
    }
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'illusion', stacks: 1,
      }));
      return;
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) {
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'voidCard', toZone: 'deck', index: 'random',
        }));
      }
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'stall', stacks: 1,
      }));
    }
  },
  getIntention: (unit, battleState) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex > 0 && motherNymphCanSummon(unit, battleState, battleState.turn.count + 1)) {
      return { kinds: ['summon'], note: '随机召唤一只南孚妖蝶' };
    }
    if (unit.actionIndex === 0) return { kinds: ['debuff'], note: '鳞粉幻象：赋予玩家幻象1（抽到的卡 AP 开销随机增减）' };
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['debuff'], note: '将 2 张「虚无」洗入你的牌库' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + atk };
    return { kinds: ['debuff'], note: '赋予玩家滞气1（下回合无法抽牌）' };
  },
});
