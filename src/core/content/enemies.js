import { registerEnemy, getEnemyDefinition } from '../enemies/registry.js';
import { registerSkill } from '../skills/registry.js';
import { getEffectDefinition } from '../effects/registry.js';
import { AddCardInstruction, DrawCardsInstruction, MoveCardInstruction, BurnCardInstruction, LockCardsInstruction } from '../instructions/cards.js';
import Enemy from '../state/enemy.js';
import {
  DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction, wouldBeLethal,
} from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { UnitSpawnInstruction } from '../instructions/units.js';
import { PlayerTurnEndInstruction } from '../instructions/turn.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { aliveEnemies, aliveAllies, zoneOf } from '../state/battleState.js';

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

// ①' 大史莱姆：条件召唤者——场上无存活史莱姆、敌排有空位（**存活敌人数** 未满
// config.maxEnemies，与前端槽位数对齐——enemies 数组含尸体，直接数 length 会在
// 有单位死亡后永远「满员」，2026-09-13 Boss 波 2 冒烟抓出并统一改存活口径）、且
// 上一回合没召唤过（lastSummonTurn 冷却一整轮：召唤 → 打一轮 → 视局面再召唤），
// 满足三条才召唤；否则攻 10 + 盾 5。
// 召唤出的史莱姆尾插 enemies（本回合行动循环快照已取，下回合起参战）。
function bigSlimeCanSummon(unit, battleState, atTurn = battleState.turn.count) {
  const noSlime = !aliveEnemies(battleState).some(e => e.defId === 'slime');
  const hasSlot = aliveEnemies(battleState).length < (battleState.config?.maxEnemies ?? 4);
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
    : { kinds: ['attack', 'defend'], hits: 1, damage: 10 + unit.getStat('attack'), note: '自身护盾+5' }),
});

// ② 11 层 Boss · 燃焰术士（章1 火主题 Boss 池之一，2026-09-13 用户重做稿）：
// 一阶段四拍：盾6+塞1灼伤 → 燃烧5+攻6 → 攻6+塞1灼伤 → 攻20。灼伤是状态牌
// （无法打出，回合结束在手牌中受 2 伤——塞牌库随机位，抽到手上才开始计时）。
// 转段：战斗超 10 回合或血量跌至 80 以下——首拍空转（蓄力），随后四拍循环：
// 全场燃烧7（含自己）→ 攻10+盾10 → 消耗全场燃烧每层回 2 血 → 攻10+盾10。
// 机智点：它给自己也点燃烧、再靠「消耗燃烧回血」闭环——玩家的叠炎既是在烧它、
// 也是在给它备血包（引爆窗口 = 燃烧7 刚挂上、回血拍未到的一拍）。
registerEnemy({
  difficulty: { base: 8, min: 8, max: 8, floorMin: 11, floorMax: 11 },
  id: 'pyro', name: '燃焰术士',
  createUnit: () => new Enemy({ defId: 'pyro', name: '燃焰术士', maxHp: 45 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (!unit._phase2 && (bs.turn.count > 10 || unit.hp < 80)) {
      unit._phase2 = true; unit._phaseBeat = 0; // 转段首拍空转（蓄力）
      return;
    }
    const atk = unit.getStat('attack');
    if (!unit._phase2) {
      const beat = unit.actionIndex % 4;
      if (beat === 0) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 6 }));
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'burnWound', toZone: 'deck', index: 'random' }));
      } else if (beat === 1) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'burn', stacks: 5 }));
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 6 + atk }));
      } else if (beat === 2) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 6 + atk }));
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'burnWound', toZone: 'deck', index: 'random' }));
      } else {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 20 + atk }));
      }
      return;
    }
    const beat = (unit._phaseBeat ?? 0) % 4;
    unit._phaseBeat = (unit._phaseBeat ?? 0) + 1;
    if (beat === 0) {
      for (const u of aliveEnemies(bs)) { // 全场 = 敌方（自己）+ 玩家与盟友
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: u, effectId: 'burn', stacks: 7 }));
      }
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'burn', stacks: 7 }));
      for (const a of aliveAllies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: a, effectId: 'burn', stacks: 7 }));
      }
    } else if (beat === 2) {
      // 消耗全场所有燃烧，每层回复 2 血（自身闭环：烧自己 → 吃回）
      let total = 0;
      for (const u of [unit, ...aliveEnemies(bs).filter(e => e !== unit), actx.player, ...aliveAllies(bs)]) {
        const s = u.getEffectStacks('burn');
        if (s > 0) {
          total += s;
          actx.kernel.submitInstruction(new AddEffectInstruction({
            target: u, effectId: 'burn', stacks: -s }));
        }
      }
      if (total > 0) {
        actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: total * 2 }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + atk }));
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
    }
  },
  getIntention: (unit, bs) => {
    if (!unit._phase2 && (bs.turn.count > 10 || unit.hp < 80)) {
      return { kinds: ['buff'], note: '二阶段蓄力：下回合起全场点燃' };
    }
    const atk = unit.getStat('attack');
    if (!unit._phase2) {
      const beat = unit.actionIndex % 4;
      if (beat === 0) return { kinds: ['defend', 'debuff'], note: '护盾+6，塞1张灼伤入你牌库' };
      if (beat === 1) return { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + atk, note: '赋予燃烧5' };
      if (beat === 2) return { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + atk, note: '塞1张灼伤入你牌库' };
      return { kinds: ['attack'], hits: 1, damage: 20 + atk, note: '重击' };
    }
    const beat = (unit._phaseBeat ?? 0) % 4;
    if (beat === 0) return { kinds: ['debuff'], note: '赋予所有单位燃烧7（含它自己）' };
    if (beat === 2) return { kinds: ['buff'], note: '消耗全场燃烧，每层回复2血' };
    return { kinds: ['attack', 'defend'], hits: 1, damage: 10 + atk, note: '自身护盾+10' };
  },
});

// ②′ 11 层 Boss · 卡达斯（章1 火主题 Boss 池之一，2026-09-13 用户设计；
// lore：魏启大陆「魔物爆发」——周期性出现的狂躁魔化古姆拉，S 级「死亡魔兽」，
// 獠牙利爪电离空气产生等离子体，魏启储能于肌体）。
// 开场自带炎魔1+暴怒1（暴怒：受伤时获得层数层力量，回合开始清零——打它越狠它越痛）。
// 一阶段四拍：攻5×2 → 攻5×3 → 攻18+暴怒1 → 防10。
// 转段：血量跌至 50 以下的行动拍——回血25+暴怒2，结束回合（嘶吼），进二阶段。
// 二阶段三拍：攻10×2+暴怒2 → 攻8×3+暴怒2 → 攻30+暴怒2。
registerEnemy({
  difficulty: { base: 8, min: 8, max: 8, floorMin: 11, floorMax: 11 },
  id: 'kardas', name: '卡达斯',
  createUnit: () => new Enemy({ defId: 'kardas', name: '卡达斯', maxHp: 27 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'flameDemon', stacks: 1 }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'rage', stacks: 1 }));
  },
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const hit = (n, amount) => {
      for (let i = 0; i < n; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: amount + atk }));
      }
    };
    const rageUp = (stacks) => actx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'rage', stacks }));
    if (!unit._phase2 && unit.hp < 50) { // 转段拍：回血25+暴怒2，不攻
      unit._phase2 = true; unit._phaseBeat = 0;
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 25 }));
      rageUp(2);
      return;
    }
    if (!unit._phase2) {
      const beat = unit.actionIndex % 4;
      if (beat === 0) hit(2, 5);
      else if (beat === 1) hit(3, 5);
      else if (beat === 2) { hit(1, 18); rageUp(1); }
      else actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      return;
    }
    const beat = (unit._phaseBeat ?? 0) % 3;
    unit._phaseBeat = (unit._phaseBeat ?? 0) + 1;
    if (beat === 0) { hit(2, 10); rageUp(2); }
    else if (beat === 1) { hit(3, 8); rageUp(2); }
    else { hit(1, 30); rageUp(2); }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (!unit._phase2) {
      if (unit.hp < 50) return { kinds: ['buff'], note: '嘶吼：回复25血、暴怒2，进入二阶段' };
      const beat = unit.actionIndex % 4;
      if (beat === 0) return { kinds: ['attack'], hits: 2, damage: 5 + atk };
      if (beat === 1) return { kinds: ['attack'], hits: 3, damage: 5 + atk };
      if (beat === 2) return { kinds: ['attack', 'buff'], hits: 1, damage: 18 + atk, note: '暴怒1' };
      return { kinds: ['defend'], note: '自身护盾+10' };
    }
    const beat = (unit._phaseBeat ?? 0) % 3;
    if (beat === 0) return { kinds: ['attack', 'buff'], hits: 2, damage: 10 + atk, note: '暴怒2' };
    if (beat === 1) return { kinds: ['attack', 'buff'], hits: 3, damage: 8 + atk, note: '暴怒2' };
    return { kinds: ['attack', 'buff'], hits: 1, damage: 30 + atk, note: '撕碎：暴怒2' };
  },
});

// ②″ 11 层 Boss · MEFM-1（章1 火主题 Boss 池之一，2026-09-13 用户设计；
// lore 对应「警戒的无人战体」）。开场自带防御4+格挡2（铁壳：固定减伤 + 受攻击减半）。
// 一阶段三拍：攻3×2 → 攻3×3 → 炎魔1+格挡1（积焰）。
// 转段：血量跌至 80 以下的行动拍——失去防御4，故障空转一拍，进二阶段。
// 二阶段：首拍获得炎魔2，随后 攻2×3 → 攻2×4 交替（积焰已久的点燃海）。
registerEnemy({
  difficulty: { base: 8, min: 8, max: 8, floorMin: 11, floorMax: 11 },
  id: 'mefm1', name: 'MEFM-1',
  createUnit: () => new Enemy({ defId: 'mefm1', name: 'MEFM-1', maxHp: 47 }),
  onBattleStart(ctx, unit) {
    unit.defense += 4; // 铁壳（基础防御轨，P2 故障时失去）
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'block', stacks: 2 }));
  },
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const hit = (n, amount) => {
      for (let i = 0; i < n; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: amount + atk }));
      }
    };
    if (!unit._phase2 && unit.hp < 80) { // 转段拍：失去铁壳，故障空转
      unit._phase2 = true; unit._phaseBeat = 0;
      unit.defense = Math.max(0, unit.defense - 4);
      return;
    }
    if (!unit._phase2) {
      const beat = unit.actionIndex % 3;
      if (beat === 0) hit(2, 3);
      else if (beat === 1) hit(3, 3);
      else {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'flameDemon', stacks: 1 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'block', stacks: 1 }));
      }
      return;
    }
    const beat = (unit._phaseBeat ?? 0);
    unit._phaseBeat = beat + 1;
    if (beat === 0) { // 二阶段首拍：炎魔2（点火完成）
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'flameDemon', stacks: 2 }));
      return;
    }
    hit(beat % 2 === 1 ? 3 : 4, 2);
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (!unit._phase2) {
      if (unit.hp < 80) return { kinds: ['buff'], note: '故障：失去防御4，停机一回合' };
      const beat = unit.actionIndex % 3;
      if (beat === 0) return { kinds: ['attack'], hits: 2, damage: 3 + atk };
      if (beat === 1) return { kinds: ['attack'], hits: 3, damage: 3 + atk };
      return { kinds: ['buff'], note: '积焰：炎魔1、格挡1' };
    }
    if ((unit._phaseBeat ?? 0) === 0) return { kinds: ['buff'], note: '点火完成：炎魔2' };
    const beat = unit._phaseBeat ?? 0;
    return { kinds: ['attack'], hits: beat % 2 === 1 ? 3 : 4, damage: 2 + atk, note: '点燃海' };
  },
});

// ②‴ 22 层 Boss · 宫殿骑士长（章2 阵型主题结业考，Boss 池三之一，2026-09-13 重做加深）
// 护驾：首拍召集 2 名宫廷侍从（Boss 生成器只产单 Boss，随从只能 act 内召；首拍不攻
//   = 给玩家一个先手窗）；**侍从 ≥2 时**才「督战」（全体蓄势1 + **仪仗威压：自身格挡2**，
//   不亲自攻击），且每回合自我净化——燃烧层数减半（燃烧交互铁律：仪仗威严，侍从环伺时
//   火焰近不了身；亲征形态失去净化与格挡 = 给火系留「先清侍从再引爆」的输出窗）。
// 亲征（侍从不足 2）：攻16 → 攻16 → 盾10 三拍循环；每隔一拍行动结束，若侍从 <2
//   且有 ≥2 空位，重新召集 1 名（凑回护驾形态）。
// 考试点：快速清侍从制造亲征窗口倾泻爆发（处刑姿态攻 16 是窗口的代价）；拖久则
//   盾 + 格挡 + 蓄势滚雪球。**清场才能获胜**（用户定 2026-09-13：Boss 死≠即胜，
//   侍从必须清完）。
registerEnemy({
  difficulty: { base: 11, min: 11, max: 11, floorMin: 22, floorMax: 22 },
  id: 'knightCommander', name: '宫殿骑士长',
  createUnit: () => new Enemy({ defId: 'knightCommander', name: '宫殿骑士长', maxHp: 54 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (unit.actionIndex === 0) {
      for (let i = 0; i < 2; i++) {
        actx.kernel.submitInstruction(new UnitSpawnInstruction({
          unit: getEnemyDefinition('courtSquire').createUnit(), source: unit }));
      }
      return;
    }
    const squires = aliveEnemies(bs).filter(e => e.defId === 'courtSquire').length;
    if (squires >= 2) {
      // 护驾：督战（全体蓄势1）+ 仪仗威压（自身格挡2）+ 自我净化（燃烧减半，向下取整）
      for (const e of aliveEnemies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'focus', stacks: 1 }));
      }
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'block', stacks: 2 }));
      const b = unit.getEffectStacks('burn');
      if (b >= 2) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -Math.floor(b / 2) }));
      }
      return;
    }
    // 亲征：攻16 → 攻16 → 盾10 三拍循环（_duelIndex 单调推进，形态来回切换不重置节奏）
    const phase = (unit._duelIndex ?? 0) % 3;
    unit._duelIndex = (unit._duelIndex ?? 0) + 1;
    if (phase < 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 16 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
    }
    // 隔回合重新召集 1 名侍从（侍从 <2 才补，凑回护驾形态）
    unit._recall = !unit._recall;
    const twoSlots = aliveEnemies(bs).length <= (bs.config?.maxEnemies ?? 4) - 2;
    if (unit._recall && squires < 2 && twoSlots) {
      actx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition('courtSquire').createUnit(), source: unit }));
    }
  },
  getIntention: (unit, battleState) => {
    if (unit.actionIndex === 0) return { kinds: ['summon'], note: '召集 2 名宫廷侍从' };
    if (aliveEnemies(battleState).filter(e => e.defId === 'courtSquire').length >= 2) {
      return { kinds: ['buff'], note: '督战：全体蓄势1、自身格挡2；侍从≥2时每回合燃烧减半' };
    }
    const phase = (unit._duelIndex ?? 0) % 3;
    if (phase < 2) {
      return { kinds: ['attack'], hits: 1, damage: 16 + unit.getStat('attack'), note: '亲征' };
    }
    return { kinds: ['defend'], note: '亲征：自身护盾+10' };
  },
});

// 宫廷侍从（骑士长召唤物，不进生成池：无 difficulty 元数据 = 生成器取不到它）。
// 攻5 ↔ 护驾（骑士长盾10）两拍；主君已陨则护驾拍退化为攻击拍。
registerEnemy({
  id: 'courtSquire', name: '宫廷侍从',
  createUnit: () => new Enemy({ defId: 'courtSquire', name: '宫廷侍从', maxHp: 22 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 1) {
      const master = aliveEnemies(actx.battleState).find(e => e.defId === 'knightCommander');
      if (master) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: master, amount: 10 }));
        return;
      }
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 5 + actx.unit.getStat('attack') }));
  },
  getIntention: (unit, battleState) => {
    if (unit.actionIndex % 2 === 0) {
      return { kinds: ['attack'], hits: 1, damage: 5 + unit.getStat('attack') };
    }
    const master = aliveEnemies(battleState).find(e => e.defId === 'knightCommander');
    return master
      ? { kinds: ['defend'], note: '护驾：骑士长护盾+10' }
      : { kinds: ['attack'], hits: 1, damage: 5 + unit.getStat('attack') };
  },
});

// ②⁴ 22 层 Boss · 烛厅守钟人·卡珊（章2 Boss 池三之一，2026-09-13 新——外挂时钟/手牌节奏考）
// 本体三拍循环：烛火（攻10+燃烧2）→ 攻14 → 添烛（自盾12）。
// **鸣钟 = 独立外挂时钟**（不占本体节拍，每次行动后追加判定）：
//   一阶段每 4 次行动后鸣钟——若玩家手牌 ≥5 张则受 12 伤（正常吃盾，可算可防；
//   摇钟本身不攻击、不达标只响不伤）。二阶段（HP≤50%）钟摆加速：每 3 次行动鸣钟、
//   阈值 ≥4、伤害 16，且烛火燃烧 2→3、添烛盾 12→16。
// 燃烧交互：对燃烧零抗性（火系爽局），但烛火拍给玩家上的燃烧对灼脉流是双刃剑。
// 考试点：鸣钟拍前必须把手牌卸到阈值下（囤牌流被点名，dump/连打都是解），
//   与骑士长（阵型）、主教（debuff 对冲）三题错开。实现零新基础设施：
//   鸣钟 = act 内行动后计数判定 + zones.hand.length 现成读取。
registerEnemy({
  difficulty: { base: 11, min: 11, max: 11, floorMin: 22, floorMax: 22 },
  id: 'candleWarden', name: '烛厅守钟人·卡珊',
  createUnit: () => new Enemy({ defId: 'candleWarden', name: '烛厅守钟人·卡珊', maxHp: 44 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const atk = unit.getStat('attack');
    // 二阶段：HP≤50%（钟摆加速）——永久转段（一旦敲响过半血之钟不回头，防状态在阈值线抖动）
    if (!unit._phase2 && unit.hp * 2 <= unit.maxHp) unit._phase2 = true;
    const phase2 = !!unit._phase2;
    // 本体三拍：烛火 → 攻 → 添烛
    const beat = unit.actionIndex % 3;
    if (beat === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + atk }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'burn', stacks: phase2 ? 3 : 2 }));
    } else if (beat === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 14 + atk }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({
        target: unit, amount: phase2 ? 16 : 12 }));
    }
    // 鸣钟（外挂时钟）：行动后计数，达间隔清零并判定手牌阈值
    unit._bellCount = (unit._bellCount ?? 0) + 1;
    const interval = phase2 ? 3 : 4;
    if (unit._bellCount >= interval) {
      unit._bellCount = 0;
      const threshold = phase2 ? 4 : 5;
      if (bs.zones.hand.length >= threshold) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: phase2 ? 16 : 12, tags: ['bell'] }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase2 = !!unit._phase2 || unit.hp * 2 <= unit.maxHp; // 预告同口径（转段拍即预告二阶段数值）
    const interval = phase2 ? 3 : 4;
    const threshold = phase2 ? 4 : 5;
    const bellIn = interval - (unit._bellCount ?? 0); // 距下次鸣钟的行动数
    const bell = `鸣钟：${bellIn} 次行动后，若你手牌≥${threshold} 则受 ${phase2 ? 16 : 12} 伤`;
    const beat = unit.actionIndex % 3;
    if (beat === 0) {
      return { kinds: ['attack', 'debuff'], hits: 1, damage: 10 + atk,
        note: `烛火：燃烧${phase2 ? 3 : 2}；${bell}` };
    }
    if (beat === 1) return { kinds: ['attack'], hits: 1, damage: 14 + atk, note: bell };
    return { kinds: ['defend'], note: `添烛：自身护盾+${phase2 ? 16 : 12}；${bell}` };
  },
});

// ②⁵ 22 层 Boss · 宴厅主教·马尔尚（章2 Boss 池三之一，2026-09-13 新——debuff 管理/净化节奏考）
// 三拍：**布道**（虚弱补到 4 层——不叠加滚雪球；玩家每回合打出 3 张非攻击牌净化 1 层，
//   赎罪机制写在 weaken 效果本体）→ 攻 15 → **祈祷**（自回 14 + 净化自身全部燃烧——
//   圣水浇灭：燃烧不得囤，火系必须在两拍祈祷之间引爆）。
// 二阶段（HP≤40%）狂信：虚弱补到 6、攻 19、祈祷回 18。
// 考试点：出牌结构对冲虚弱 + 爆发必须卡在两拍祈祷之间。
registerEnemy({
  difficulty: { base: 11, min: 11, max: 11, floorMin: 22, floorMax: 22 },
  id: 'bishopMarchand', name: '宴厅主教·马尔尚',
  createUnit: () => new Enemy({ defId: 'bishopMarchand', name: '宴厅主教·马尔尚', maxHp: 46 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    // 二阶段：HP≤40%（狂信）——永久转段（否则祈祷自回会把自己抬出二阶段，狂信形同虚设）
    if (!unit._phase2 && unit.hp * 5 <= unit.maxHp * 2) unit._phase2 = true;
    const phase2 = !!unit._phase2;
    const beat = unit.actionIndex % 3;
    if (beat === 0) {
      // 布道：虚弱补到 4/6 层（读现层算差值；只补不滚）
      const target = phase2 ? 6 : 4;
      const cur = actx.player.getEffectStacks('weaken');
      if (cur < target) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'weaken', stacks: target - cur }));
      }
    } else if (beat === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: (phase2 ? 19 : 15) + atk }));
    } else {
      // 祈祷：自回 + 净化自身全部燃烧（无燃烧也回血——祈祷拍的自身代谢）
      actx.kernel.submitInstruction(new ApplyHealInstruction({
        target: unit, amount: phase2 ? 18 : 14 }));
      const b = unit.getEffectStacks('burn');
      if (b > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -b }));
      }
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase2 = !!unit._phase2 || unit.hp * 5 <= unit.maxHp * 2; // 预告同口径
    const beat = unit.actionIndex % 3;
    if (beat === 0) {
      return { kinds: ['debuff'], note: `布道：虚弱补到${phase2 ? 6 : 4}层（每层攻击-1）` };
    }
    if (beat === 1) {
      return { kinds: ['attack'], hits: 1, damage: (phase2 ? 19 : 15) + atk, note: '' };
    }
    return { kinds: ['buff'], note: `祈祷：自回${phase2 ? 18 : 14}血，净化自身全部燃烧` };
  },
});

// ②″ 33 层 Boss · 饕餮领主（章3 滚雪球/资源主题结业考，Boss 波 2 上岗 2026-09-13）
// 四拍「盛宴」循环：召唤庄园仆从 → 攻10 → **吞噬**（吃掉场上全部仆从：每只回 15 血
//   +力量1；同时消化自身全部燃烧层数，每层转 1 血——燃烧交互铁律：火系必须在吞噬拍
//   之前引爆，而不是堆着等滚雪球；物理系无感）→ 攻14。
// 玩家对策 = 在吞噬拍之前杀仆从（仆从是他的血包兼成长资粮）：杀光他就只剩平拍，
// 但仆从会不断再召；不杀 = 养虎。考试点：多目标输出分配 +「杀还是不杀」的节奏账。
registerEnemy({
  difficulty: { base: 14, min: 14, max: 14, floorMin: 33, floorMax: 33 },
  id: 'gluttonLord', name: '饕餮领主',
  createUnit: () => new Enemy({ defId: 'gluttonLord', name: '饕餮领主', maxHp: 36 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 4;
    if (phase === 0) {
      const hasSlot = aliveEnemies(bs).length < (bs.config?.maxEnemies ?? 4);
      if (hasSlot) {
        actx.kernel.submitInstruction(new UnitSpawnInstruction({
          unit: getEnemyDefinition('footmanImp').createUnit(), source: unit }));
        return;
      }
      // 满员：召唤拍退化为攻击拍
    }
    if (phase === 2) {
      // 吞噬：吃光仆从（致命穿透伤害 = 走正常死亡结算，死亡类效果如实触发），
      // 每只回 15 血 + 力量1；空席则吞噬拍白过（玩家管住了仆从的奖励）。
      for (const e of aliveEnemies(bs)) {
        if (e.defId !== 'footmanImp') continue;
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: e, amount: 999, pierce: true, tags: ['devour'] }));
        actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 15 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 1 }));
      }
      // …并消化自身全部燃烧层数（每层转 1 血；无仆可吞也消化——吞噬拍的自身代谢）
      const b = unit.getEffectStacks('burn');
      if (b > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -b }));
        actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: b }));
      }
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player,
      amount: (phase === 3 ? 14 : 10) + unit.getStat('attack') }));
  },
  getIntention: (unit, battleState) => {
    const phase = unit.actionIndex % 4;
    if (phase === 0) {
      const hasSlot = aliveEnemies(battleState).length < (battleState.config?.maxEnemies ?? 4);
      return hasSlot
        ? { kinds: ['summon'], note: '召唤庄园仆从' }
        : { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    }
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    if (phase === 2) {
      const n = aliveEnemies(battleState).filter(e => e.defId === 'footmanImp').length;
      return { kinds: ['buff'], note: n > 0
        ? `吞噬：吃掉 ${n} 名仆从（每只+15血、力量+1）并消化自身燃烧`
        : '吞噬：无仆可吞（仍消化自身燃烧）' };
    }
    return { kinds: ['attack'], hits: 1, damage: 14 + unit.getStat('attack') };
  },
});

// ②‴ 44 层终塔 Boss · 塔心（孤身巨石 · 三阶段，Boss 波 3 上岗 2026-09-13；设计定稿见
// tmp/design-final-boss.md——整塔唯一一场 1v1 巨石战：无召唤无随从，靠体量与换形态压场，
// 与波 2 两只召唤轴 Boss 反其道，避免「终极战又在清小怪」）。
// 阶段由自身 hp 比例驱动（>66% P1 塔心之怒 / 33–66% P2 塔心之壁 / ≤33% P3 塔心崩落）；
// 每次跨入新阶段的第一拍改为「蜕壳」宣言拍：不攻击，净化自身全部燃烧 + 自盾 15
// （燃烧交互铁律：换壳即剥落——火系要在一个阶段内完成「堆层→引爆」闭环，不能跨阶段囤层）。
//   P1 快攻考（盾线跟不跟得上连击）：三连击(6+atk×3) → 攻16 → 三连击，三拍循环；
//   P2 持久输出考（盾墙里维持 DPS）：自盾20+蓄势2 → 攻10 → 自盾20 → 攻14，四拍循环；
//   P3 终局竞速（它也在死）：攻14 → 攻14 → 大崩落（攻22+自身燃烧6）——自焚是设计好的
//   败亡曲线，玩家正解从「抢伤害」切换为「全防御拖它自焚」（赢 = 不死）。
// 阶段内节拍用 _phaseBeat 独立计数（换阶段重置），蜕壳拍不消耗节拍。
const towerHeartPhaseOf = (unit) => {
  const r = unit.hp / unit.maxHp;
  return r > 2 / 3 ? 1 : r > 1 / 3 ? 2 : 3;
};
registerEnemy({
  difficulty: { base: 18, min: 18, max: 18, floorMin: 44, floorMax: 44 },
  id: 'towerHeart', name: '塔心',
  createUnit: () => new Enemy({ defId: 'towerHeart', name: '塔心', maxHp: 44 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const phase = towerHeartPhaseOf(unit);
    // 蜕壳：跨入新阶段的第一拍（宣言拍，不攻击）
    if (phase !== (unit._phase ?? 1)) {
      unit._phase = phase;
      unit._phaseBeat = 0;
      const b = unit.getEffectStacks('burn');
      if (b > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -b }));
      }
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 15 }));
      return;
    }
    const beat = (unit._phaseBeat ?? 0) % (phase === 2 ? 4 : 3);
    unit._phaseBeat = (unit._phaseBeat ?? 0) + 1;
    if (phase === 1) {
      // 三连击 → 攻16 → 三连击
      if (beat !== 1) {
        for (let i = 0; i < 3; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: actx.player, amount: 6 + atk }));
        }
      } else {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 16 + atk }));
      }
      return;
    }
    if (phase === 2) {
      // 自盾20+蓄势2 → 攻10 → 自盾20 → 攻14
      if (beat === 0 || beat === 2) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 20 }));
        if (beat === 0) {
          actx.kernel.submitInstruction(new AddEffectInstruction({
            target: unit, effectId: 'focus', stacks: 2 }));
        }
      } else {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: (beat === 1 ? 10 : 14) + atk }));
      }
      return;
    }
    // P3：攻14 → 攻14 → 大崩落（攻22 + 自身燃烧6，自焚累积不再蜕壳）
    if (beat === 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 22 + atk }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'burn', stacks: 6 }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 14 + atk }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = towerHeartPhaseOf(unit);
    // 预告与实际同轨：下一拍若是蜕壳（即将跨入新阶段），预告宣言
    if (phase !== (unit._phase ?? 1)) {
      return { kinds: ['buff'], note: '蜕壳：净化自身全部燃烧，自身护盾+15' };
    }
    const beat = (unit._phaseBeat ?? 0) % (phase === 2 ? 4 : 3);
    if (phase === 1) {
      return beat !== 1
        ? { kinds: ['attack'], hits: 3, damage: 6 + atk, note: '塔心之怒' }
        : { kinds: ['attack'], hits: 1, damage: 16 + atk, note: '塔心之怒' };
    }
    if (phase === 2) {
      if (beat === 0) return { kinds: ['defend', 'buff'], note: '塔心之壁：自身护盾+20，蓄势2' };
      if (beat === 2) return { kinds: ['defend'], note: '塔心之壁：自身护盾+20' };
      return { kinds: ['attack'], hits: 1, damage: (beat === 1 ? 10 : 14) + atk, note: '塔心之壁' };
    }
    return beat === 2
      ? { kinds: ['attack'], hits: 1, damage: 22 + atk, note: '大崩落：塔心自身燃烧+6' }
      : { kinds: ['attack'], hits: 1, damage: 14 + atk, note: '塔心崩落' };
  },
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
      ? { kinds: ['attack', 'defend'], hits: 1, damage: 3 + unit.getStat('attack'), note: '自身护盾+8' }
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
      // 再生递减（2026-09-14 马拉松修复）：首次 3 层，此后每次 -1、最低 1——
      // 原无限「再生3+盾6」循环让输出不足的卡组磨了 26~37 回合（d-free 实测），
      // 净回复收敛后马拉松自然收束；再生依旧，只是「拖得越久回得越少」。
      const times = (actx.unit._regenTimes ?? 0);
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'regen', stacks: Math.max(1, 3 - times),
      }));
      actx.unit._regenTimes = times + 1;
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
    if (phase === 0) {
      const next = Math.max(1, 3 - (unit._regenTimes ?? 0));
      return { kinds: ['buff'], note: `自身再生${next}` };
    }
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
      // 缩壳蓄势（2026-09-14 马拉松修复）：双龟阵曾是「无风险马拉松」（32 层两份试玩
      // 死于 15~20+ 回合龟拳磨血）——每次缩壳 +1 蓄势，攻拍 10+atk 随之线性上涨，
      // 拖得越久龟拳越痛，磨盘战有时间账单。
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'focus', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '自身护盾7 + 荆棘1 + 蓄势+1' }
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
    if (phase === 0) return { kinds: ['attack', 'defend'], hits: 1, damage: 8 + atk, note: '自身护盾+8' };
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
  // 融合（wiki：「魔化时多只融合成一只大史莱姆，实际仍是多个体」）：尸液融入存活的
  // 史莱姆族（+4血+1攻面板）——打小的喂大的，AOE/斩杀顺序的低压力教学（2026-09-14）。
  onDeath(actx) {
    for (const e of aliveEnemies(actx.battleState)) {
      if (e.defId !== 'slime' && e.defId !== 'slimelet' && e.defId !== 'bigSlime') continue;
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: e, amount: 4 }));
      e.attack += 1;
    }
  },
});

// ⑪ 嗡嗡虫（前期小敌人，2026-09；2026-09-14 章1「塔基爆发」改版）：wiki 习性
// 「成群结队的冲击足以让人头晕目眩、难以视物」——振翅拍改为**塞 1 张迷眼粉尘**
// （灼伤的轻量版，硬卡手教学）进牌库随机位，随后两拍撞击。本体脆（7 血），是
// 章 1「塞卡/卡手」主题的入门件；与粘液（软卡手税）构成两档语言。
registerEnemy({
  difficulty: { base: 1, min: 1, max: 2, floorMin: 2, floorMax: 16 },
  id: 'buzzbug', name: '嗡嗡虫',
  createUnit: () => new Enemy({ defId: 'buzzbug', name: '嗡嗡虫', maxHp: 7 }),
  act(actx) {
    const atk = actx.unit.getStat('attack');
    const phase = actx.unit.actionIndex % 3;
    if (phase === 0) {
      // 振翅：迷眼粉尘塞入牌库随机位（抽到手上才开始计时）
      actx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'dustCloud', toZone: 'deck', index: 'random',
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
    if (phase === 0) return { kinds: ['debuff'], note: '振翅：1张迷眼粉尘塞入你的牌库' };
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

// ============ 第一章补充敌人（2026-09，设计卡见 battle_gameplay/ENEMIES_1.md §5）============
// 四只各填一个机制空位（支援 / 预告重击 / 亡语 / 蛰伏），互不重叠，都不引入新资源轴。

// ⑬ 腐苔球（2026-09-14 章1「塔基爆发」改版）：**腐烂蔓延**——活着就在收拢你的手牌
// 空间（紧勒，EFFECTS.md 目录定义的实装首用）：每拍玩家紧勒+1（手牌上限 -1，效果
// 轨可见），奇数拍小攻、偶数拍自愈；**枯萎（死亡）时归还自己施加的全部层数**——
// 绑怪生命周期的教学化口径：杀了就松手。上限实际扣减直改 player.maxHandSize
// （战斗内有效；战后 refreshRunModifiers 从 baseStats 重算自动恢复），下限 2 不锁死。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 2, floorMax: 16 },
  id: 'mossBall', name: '腐苔球',
  createUnit: () => new Enemy({ defId: 'mossBall', name: '腐苔球', maxHp: 14 }),
  act(actx) {
    const { unit, player } = actx;
    unit._grip = (unit._grip ?? 0) + 1;
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: player, effectId: 'constrict', stacks: 1 }));
    player.maxHandSize = Math.max(2, (player.maxHandSize ?? 6) - 1);
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 3 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 3 }));
    }
  },
  getIntention: (unit) => ({
    kinds: unit.actionIndex % 2 === 0 ? ['attack', 'debuff'] : ['buff', 'debuff'],
    hits: unit.actionIndex % 2 === 0 ? 1 : undefined,
    damage: unit.actionIndex % 2 === 0 ? 3 + unit.getStat('attack') : undefined,
    note: '蔓延：你的手牌上限 -1（死亡时解除其全部紧勒）',
  }),
  onDeath(actx) {
    const grip = actx.unit._grip ?? 0;
    if (grip > 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'constrict', stacks: -grip }));
      actx.player.maxHandSize += grip;
    }
  },
});

// ⑭ 鼓腹蟾（2026-09-14 章1「塔基爆发」改版）：**鼓腹**——每次被攻击膨胀（攻击+1，
// _inflated 计数），膨胀满 4 次后下一拍**自爆**（对玩家 8+atk 伤并炸死自己）——
// 「别贪刀连打」的轻教学，与静电毛球互为镜像（毛球不打它亏、蟾蜍打太狠亏）。
// 意图实时反映膨胀伤害与自爆预告（玩家出牌后刷新意图），膨胀可见可控。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 2, floorMax: 16 },
  id: 'pufferToad', name: '鼓腹蟾',
  createUnit: () => new Enemy({ defId: 'pufferToad', name: '鼓腹蟾', maxHp: 20 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'post',
      owner: `enemy:${unit.uniqueID}:inflate`,
      filter: (instr) => instr.target === unit && instr.source && !unit.isDead(),
      react: () => {
        unit._inflated = (unit._inflated ?? 0) + 1;
        unit.attack += 1; // 膨胀：攻击面板直接涨（difficultyScaling 同款直改口径）
      },
    });
  },
  act(actx) {
    const { unit, player } = actx;
    if ((unit._inflated ?? 0) >= 4) {
      // 自爆：对玩家爆发并炸死自己（走正规死亡结算）
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 8 + unit.getStat('attack') }));
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: unit, amount: 999, pierce: true, tags: ['burst'] }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 5 + unit.getStat('attack') }));
  },
  getIntention: (unit) => {
    const n = unit._inflated ?? 0;
    if (n >= 3) return { kinds: ['attack'], hits: 1, damage: 8 + unit.getStat('attack'), note: '即将自爆！（停止攻击它）' };
    return { kinds: ['attack'], hits: 1, damage: 5 + unit.getStat('attack'), note: n > 0 ? `鼓腹×${n}：每被攻击一次膨胀+1攻` : undefined };
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
    // 亡语数值恒挂 note（含攻击拍）——「这回合杀不杀它」的决策窗口在每一拍，
    // 只在引线拍亮数值等于要求玩家背公式（R8-B/C 双杀点的信息负担）。
    // 预览口径 = 此刻击杀的爆炸（6+3×当前引线）——引线是爆囊自己行动时才 +1，
    // 玩家在己方回合看到意图的决策窗口里，多算一层会高估 3 点代价
    const fuse = unit.getEffectStacks('blastFuse');
    const boom = `引线：死亡时对玩家造成 ${6 + 3 * fuse} 伤害`;
    if (unit.actionIndex % 2 === 0) {
      return { kinds: ['attack'], hits: 1, damage: 3 + unit.getStat('attack'), note: boom };
    }
    return { kinds: ['debuff'], note: boom };
  },
});

// ⑯ 石茧：沉眠 1 拍（白给）+ 苏醒时攻击 +2，此后每拍 8+攻击。一道「打得掉吗」的 DPS
// 检查：一拍内打不掉 26 血，就要开始面对 8/拍的持续压力（且它无减伤，随时可回头集火）。
// 攻击 +2 落在沉眠拍末尾——苏醒拍的意图预告直接含 +2，所见即所算。
registerEnemy({
  difficulty: { base: 3, min: 2, max: 4, floorMin: 4, floorMax: 16 },
  id: 'stoneCocoon', name: '石茧',
  createUnit: () => new Enemy({ defId: 'stoneCocoon', name: '石茧', maxHp: 26 }),
  // 苏醒回合参数（用户 2026-09-11 定）：wakeDelay = 沉眠几拍才苏醒（缺省 1 = 只沉眠一拍），
  // **苏醒越晚 = 难度越低**（少叠一层力量 wakeStrength，且由遭遇生成侧按更低难度配额生成）。
  // 同层多只石茧时，第二只起延迟一回合苏醒——否则「两只同拍醒＝每回合 20+ 伤」是
  // 第 1 章最容易低估的死局（第 3 轮试玩两个正常局皆死于此）。
  act(actx) {
    const wakeDelay = actx.unit.wakeDelay ?? 1;
    if (actx.unit.actionIndex < wakeDelay) {
      // 力量只在**最后一拍沉眠**叠一次：否则沉眠越久叠得越多，「苏醒越晚难度越低」会被抵消
      if (actx.unit.actionIndex === wakeDelay - 1) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.unit, effectId: 'strength', stacks: actx.unit.wakeStrength ?? 2,
        }));
      }
      return; // 沉眠：本拍不攻击
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 8 + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => {
    const wakeDelay = unit.wakeDelay ?? 1;
    // 沉睡期把「还有几拍醒、醒了打多少」说清（纯展示，不影响 AI 行为）
    if (unit.actionIndex < wakeDelay) {
      const left = wakeDelay - unit.actionIndex;
      return { kinds: ['unknown'], note: `沉眠：${left} 回合后苏醒并获得力量${unit.wakeStrength ?? 2}，此后每回合都攻击` };
    }
    return { kinds: ['attack'], hits: 1, damage: 8 + unit.getStat('attack') };
  },
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
      // 缩壳蓄势（2026-09-14 马拉松修复）：礁石滩曾是「无风险磨 12+ 回合」——攻击软、
      // 缩壳无限回复，输出不足的卡组全程零压力干耗。每次缩壳 +1 蓄势（每层攻击+1，
      // 走 getStat 自动进攻击与意图预告）＝温水煮青蛙的时间账单：磨可以，但越磨越疼。
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'focus', stacks: 1,
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') }
    : { kinds: ['defend', 'buff'], note: '缩壳：自身护盾6，回复4，蓄势+1' }),
});

// ============ 第二~四章补池（2026-09-13 总策划批次，设计稿 tmp/design-monsters-wave1.mjs）============
// 断档诊断：章2 新敌仅 4 只、章3 仅 2 只、章4 为 0，精英只有章1两只——「粪怪堆积」的
// 根因是池子厚度而非单怪设计。本波按场景配方主题补池：章2=宫殿 / 章3=衰败庄园 / 章4=大图书馆。

// ⑱ 宫廷守卫（章2·阵型谜题：全体友军护盾）——「先杀支援还是顶着群体盾硬打输出手」的
// 目标优先级考题。与腐苔球（奶轴支援）错开：它是盾轴支援，护盾会被回合清零（T2），
// 所以必须每两拍重新举盾——它的存活本身就是对面防线的续航。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 7, floorMin: 12, floorMax: 24 },
  id: 'palaceGuard', name: '宫廷守卫',
  createUnit: () => new Enemy({ defId: 'palaceGuard', name: '宫廷守卫', maxHp: 22 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        // 互盾拆除（第 7 轮裁决）：守卫的光环不罩其他守卫——双守卫互相举盾叠出的
        // 防雪球让「先杀支援」的考题失效（支援比输出手还硬）；自己仍吃自己的盾。
        if (e !== actx.unit && e.defId === 'palaceGuard') continue;
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 6 }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 7 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '全体友军护盾+6（不罩其他守卫）' }
    : { kinds: ['attack'], hits: 1, damage: 7 + unit.getStat('attack') }),
});

// ⑲ 传令官（章2·击杀优先级谜题）：首拍全体友军蓄势2（它自己脆，给玩家一拍反应窗），
// 此后攻5。杀得快等于白赚，杀不掉全队滚雪球——与雪狼开局虚弱镜像：一个压玩家，一个抬敌人。
registerEnemy({
  difficulty: { base: 4, min: 3, max: 6, floorMin: 12, floorMax: 22 },
  id: 'herald', name: '传令官',
  createUnit: () => new Enemy({ defId: 'herald', name: '传令官', maxHp: 16 }),
  act(actx) {
    if (actx.unit.actionIndex === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'focus', stacks: 2,
        }));
      }
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: 5 + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => (unit.actionIndex === 0
    ? { kinds: ['buff'], note: '全体友军蓄势+2（攻击+2）' }
    : { kinds: ['attack'], hits: 1, damage: 5 + unit.getStat('attack') }),
});

// ⑳ 大理石哨兵（章2·防线锚：受创龟缩）——行动时比较当前 hp 与「自己上次行动结束时的
// hp」（_lastHp，每次 act 末尾记账，首拍缺省 = 当前 hp）：受创 ≥ 8 → 龟缩举盾 12 不攻击；
// 否则攻 9。谜题 = 输出节奏分配：一轮爆发 ≥8 = 用伤害买它一回合沉默（但溢出伤害打在
// 盾上）；控制每轮 ≤7 = 它一直攻，吃伤害换输出窗口。
// ※ 为什么不用「有无盾」做分支（2026-09-13 用户指正）：T2 铁律——盾在持有者回合开始
// 清零，轮到敌方行动的时点盾恒为 0，「有盾→攻/无盾→举盾」会退化成永不攻击的肉桩。
// hp 差值是唯一无需新引擎/新订阅的可读状态；燃烧·中毒 tick 也计入受创（语义通：
// 被折磨痛了同样会缩）。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 8, floorMin: 14, floorMax: 26 },
  id: 'marbleSentinel', name: '大理石哨兵',
  createUnit: () => new Enemy({ defId: 'marbleSentinel', name: '大理石哨兵', maxHp: 26, defense: 2 }),
  act(actx) {
    const { unit } = actx;
    const lost = (unit._lastHp ?? unit.hp) - unit.hp;   // 自上次行动以来的受创
    if (lost >= 8) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 12 }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 9 + unit.getStat('attack'),
      }));
    }
    unit._lastHp = unit.hp;   // 行动末尾记账（含本回合举盾/受击后的最新值）
  },
  getIntention: (unit) => {
    // 预告计入自身回合开始的燃烧 tick（行动前结算）：燃烧锁死下它必然龟缩，
    // 不预告龟缩会让玩家白留防御牌/错估输出窗（第 7 轮 B 报告的信息缺失）。
    // act 时 tick 已落进 hp，无需此项；这只是「预告时点」的口径补正。
    // ⚠ tick 先被站立盾吸收（ClearShield 晚于回合开始结算，combat.js 顺序铁律）——
    // 预告必须按「穿盾部分」预估，否则举着 12 盾时预告龟缩、实际照攻（R8-E 实报：
    // 预告龟缩 → 吃攻 9）。口径与 act 严格同源：hp 差值 + max(0, 燃烧 − 当前盾)。
    const burnThrough = Math.max(0, unit.getEffectStacks('burn') - unit.shield);
    const lost = (unit._lastHp ?? unit.hp) - unit.hp + burnThrough;
    return lost >= 8
      ? { kinds: ['defend'], note: '受创≥8：龟缩，自身护盾+12' }
      : { kinds: ['attack'], hits: 1, damage: 9 + unit.getStat('attack'), note: '受创≥8 时改为龟缩举盾' };
  },
});

// ㉑ 贪杯鬼（章3·滚雪球）：喝酒（自愈 5 + 力量 1）×2 → 醉拳 12，三拍循环。
// 拖得越久力量越高，但喝酒拍不输出——「趁它喝酒抢血」的窗口题（暗影刺客是蓄势，
// 贪杯鬼是自愈+力量双轴）。
registerEnemy({
  difficulty: { base: 6, min: 5, max: 9, floorMin: 23, floorMax: 36 },
  id: 'tippler', name: '贪杯鬼',
  createUnit: () => new Enemy({ defId: 'tippler', name: '贪杯鬼', maxHp: 30 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase < 2) {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: actx.unit, amount: 5 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'strength', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 12 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 3 < 2
    ? { kinds: ['buff'], note: '喝酒：自愈5，力量+1' }
    : { kinds: ['attack'], hits: 1, damage: 12 + unit.getStat('attack'), note: '醉拳' }),
});

// ㉒ 庄园主（章3 精英·召唤主题：大史莱姆退役后接班）——四拍循环：
// 攻9 → 召唤仆人（场上无仆人且有空位）→ 攻13 → 自身盾8。
// 仆人护主（给它盾5）——先杀仆人还是抢主人，是每回合的账。
registerEnemy({
  difficulty: { base: 7, min: 6, max: 9, floorMin: 23, floorMax: 32, elite: true },
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

// ㉓ 禁书守卫（章4·终章防线锚）——攻10 → 全体友军盾12 → 攻14 三拍循环。
// 宫廷守卫的终章上位：数值跨档 + 自身 3 防御面板，群体盾更厚。
registerEnemy({
  difficulty: { base: 8, min: 7, max: 11, floorMin: 34, floorMax: 43 },
  id: 'tomeWarden', name: '禁书守卫',
  createUnit: () => new Enemy({ defId: 'tomeWarden', name: '禁书守卫', maxHp: 40, defense: 3 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 1) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 12 }));
      }
      // 盾拍蓄势（2026-09-14 马拉松修复）：禁书库防挡 3+全体盾 12 曾把小刀流磨到
      // 无风险长跑——盾拍自身 +2 蓄势，大攻击（14+atk）随回合线性上涨，拖久必痛。
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'focus', stacks: 2,
      }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player,
      amount: (phase === 0 ? 10 : 14) + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 1) return { kinds: ['defend', 'buff'], note: '全体友军护盾+12，自身蓄势+2' };
    return { kinds: ['attack'], hits: 1, damage: (phase === 0 ? 10 : 14) + unit.getStat('attack') };
  },
});

// ㉔ 蛀书虫（章4·群狼小件：连击）——攻2×3 → 攻6 两拍循环。
// 连击逼「单发大盾」以外的对策（多段吃盾次数多），嗡嗡虫的终章上位。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 7, floorMin: 34, floorMax: 43 },
  id: 'bookWorm', name: '蛀书虫',
  createUnit: () => new Enemy({ defId: 'bookWorm', name: '蛀书虫', maxHp: 14 }),
  act(actx) {
    const atk = actx.unit.getStat('attack');
    if (actx.unit.actionIndex % 2 === 0) {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: actx.unit, target: actx.player, amount: 2 + atk,
        }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 6 + atk,
      }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    return unit.actionIndex % 2 === 0
      ? { kinds: ['attack'], hits: 3, damage: 2 + atk }
      : { kinds: ['attack'], hits: 1, damage: 6 + atk };
  },
});

// ============ 体系镜像补池（2026-09-14，木/空卡牌体系落地后的敌方生态）============
// 三只各填一个主题空位：章2 起敌方无毒（叠毒体系无镜像）、章3 起敌方无闪避（御风体系
// 无镜像）、章4 无针对 DoT 的反制件（终章叠毒/燃烧无考题）。各考一道与玩家体系同源的题。

// ㉕ 瘴气菇（章2·叠毒镜像：渐浓毒雾）——孢子云（中毒，每次更浓：2,3,4…）→ 攻6 → 攻6
// 三拍循环。玩家的叠毒是平方收束，它的毒雾也是：拖得越久，每次喷毒越重——把「毒叠起来
// 有多可怕」先在玩家身上演一遍。本身零防脆菇，速杀即无毒；与宫廷守卫同场时「先杀谁」
// 是真问题（盾轴保毒轴）。对标：沼泽伏击者（精英）一口毒5，它常规杂兵 2 起步渐浓。
registerEnemy({
  difficulty: { base: 4, min: 3, max: 6, floorMin: 12, floorMax: 26 },
  id: 'miasmaShroom', name: '瘴气菇',
  createUnit: () => new Enemy({ defId: 'miasmaShroom', name: '瘴气菇', maxHp: 24 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 3 === 0) {
      // 孢子云：_spore 从 1 起每次喷吐 +1（首口毒2）
      unit._spore = (unit._spore ?? 1) + 1;
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'poison', stacks: unit._spore }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: 6 + unit.getStat('attack') }));
  },
  getIntention: (unit) => (unit.actionIndex % 3 === 0
    ? { kinds: ['debuff'], note: `孢子云：赋予玩家中毒${(unit._spore ?? 1) + 1}（每次更浓）` }
    : { kinds: ['attack'], hits: 1, damage: 6 + unit.getStat('attack') }),
});

// ㉖ 风狸（章3·御风镜像：等风停）——起风（闪避2）→ 风爪 攻2×3 → 突风 攻8 三拍循环。
// 闪避在它自己回合开始蒸发 1 层：起风后 2→1→0，每第三拍是零闪避的输出窗——玩家的
// 爆发牌要跟它的起风拍错开；单发重击被闪避白吃（垫一发小的再出大的），中毒/燃烧
// 绕过闪避（dot 是天然克制）。嗡嗡虫的章3 上位：那边教「先垫一发」，这边教「算风停」。
registerEnemy({
  difficulty: { base: 6, min: 5, max: 9, floorMin: 23, floorMax: 38 },
  id: 'windRaccoon', name: '风狸',
  createUnit: () => new Enemy({ defId: 'windRaccoon', name: '风狸', maxHp: 24 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'dodge', stacks: 2 }));
    } else if (phase === 1) {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 2 + atk }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 8 + atk }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '起风：自身闪避2（免疫攻击；中毒/燃烧可穿）' };
    if (phase === 1) return { kinds: ['attack'], hits: 3, damage: 2 + atk, note: '风爪' };
    return { kinds: ['attack'], hits: 1, damage: 8 + atk, note: '突风' };
  },
});

// ㉗ 掸尘者（章4·DoT 反制件：拂尘）——拂尘（净化全体友军的中毒与燃烧）→ 攻10 → 自盾8
// 三拍循环。终章给叠毒/燃烧体系的一道反考题：毒火囤不起来，输出窗被切成三拍一段——
// 要么先杀它（20 血的脆皮优先目标），要么掐着拂尘拍结算爆发。对物理/直伤体系它只是
// 个弱攻击手（拂尘拍空转），考题只点名 DoT 构筑。主教（Boss）的燃烧净化是它的原型，
// 这只连中毒一起拂。
registerEnemy({
  difficulty: { base: 7, min: 6, max: 9, floorMin: 34, floorMax: 43 },
  id: 'dustkeeper', name: '掸尘者',
  createUnit: () => new Enemy({ defId: 'dustkeeper', name: '掸尘者', maxHp: 20 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      for (const e of aliveEnemies(bs)) {
        for (const eff of ['poison', 'burn']) {
          const s = e.getEffectStacks(eff);
          if (s > 0) {
            actx.kernel.submitInstruction(new AddEffectInstruction({
              target: e, effectId: eff, stacks: -s }));
          }
        }
      }
      return;
    }
    if (phase === 2) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: 10 + unit.getStat('attack') }));
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '拂尘：净化全体友军的中毒与燃烧' };
    if (phase === 2) return { kinds: ['defend'], note: '自身护盾+8' };
    return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
  },
});

// ============ 第四章高压敌（2026-09-14 用户设计：特色战斗三族 + 机制四件套）============
// 设计总纲（第四轮设计稿定稿）：每场战斗是一个有「破解方程」的谜题——
//   族A 玻璃连炮：开局重压（合计 40+ 直伤）+ 持续中压 + 异常轮转；弱点是分体（杀一只
//     少一份伤害与异常源），破解=以攻为守、爆发削员。血量终值 50+（基准 20-30）。
//   族B 巨兽渐强：超级血牛（终值 200+，基准 40-44）+ 持续塞牌干扰 + 威胁随回合陡增；
//     弱点是前 1-2 拍低伤（启动窗口），破解=高质量启动 + 抗干扰（过牌/烧牌）+ 限时斩杀。
//   族C 机制反制：读玩家构筑/行为反着打（复制负面/罚抽牌/罚囤牌/罚多动）；
//     破解=认出镜子改节奏，或纯爆发掀桌。
//   机制四件套：初始大盾（抗首回合爆发）/ 闪避 / 大口径多段 / 群体增益（盾+力量）。
// 数值口径：章4 楼层 D=18-21；玩家通关局基线 HP 84-90、盾 20-40、成型输出 40-60/回合。
// 红线：前 2 拍合计 ≤ 25（A1 典礼方阵的 45 直伤为用户点名的例外）、单回合峰值 30-40、
// 滚雪球 6-8 回合进不可挡区、多源爆发错拍、一切大伤害意图预告可见。

// ---- 族A · 玻璃连炮 ----

// ① 守像（典礼方阵的列兵，A1）：拍1 全员齐射（45 直伤的分量者）；此后按同场序位分派
// 私有异常循环（0号灼伤牌/1号虚弱/2号重锤/3号中毒）。阵型共鸣：每死一只，其余攻击 -2
// （读「初始只数 - 现存活数」动态结算，无需订阅）——杀一只压力断崖。
registerEnemy({
  difficulty: { base: 4, min: 3, max: 5, floorMin: 34, floorMax: 43 },
  id: 'wardStatue', name: '守像',
  createUnit: () => new Enemy({ defId: 'wardStatue', name: '守像', maxHp: 30 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const kin = bs.enemies.filter(e => e.defId === 'wardStatue');
    const fallen = kin.filter(e => e.isDead()).length; // 阵型共鸣：折损越多攻势越散
    const atk = unit.getStat('attack') - 2 * fallen;
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: Math.max(2, 11 + atk) }));
      return;
    }
    const role = kin.indexOf(unit); // 同场序位决定私有异常（indexOf 含死者，序位稳定）
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: Math.max(2, 13 + atk) }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: Math.max(2, 6 + atk) }));
    if (role % 4 === 0 && phase === 0) {
      actx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'burnWound', toZone: 'deck', index: 'random' }));
    } else if (role % 4 === 1 && phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'weaken', stacks: 2 }));
    } else if (role % 4 === 3 && phase === 1) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'poison', stacks: 3 }));
    }
  },
  getIntention: (unit, bs) => {
    const kin = (bs?.enemies ?? []).filter(e => e.defId === 'wardStatue');
    const fallen = kin.filter(e => e.isDead()).length;
    const atk = unit.getStat('attack') - 2 * fallen;
    if (unit.actionIndex === 0) return { kinds: ['attack'], hits: 1, damage: Math.max(2, 11 + atk), note: '齐射' };
    const role = kin.indexOf(unit);
    const phase = (unit.actionIndex - 1) % 3;
    const noteOf = { 0: '塞灼伤牌', 1: '虚弱2', 3: '中毒3' }[role % 4] ?? '';
    if (phase === 2) return { kinds: ['attack'], hits: 1, damage: 13 + atk, note: '重锤' };
    return { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + atk, note: noteOf };
  },
});

// ② 音叉灵（A2 音叉双鸣）：大振 → 失谐 2 拍（仅自盾）→ 更大振，五拍循环。成对出场时
// 第二只由生成器塞 wakeDelay=1 + 难度 -1（石茧惯例）——两台大振恒错 2 拍，任意回合
// 最多一次大振。失谐窗口 = 白给的输出回合，破解=记拍子。
registerEnemy({
  difficulty: { base: 6, min: 5, max: 7, floorMin: 34, floorMax: 43 },
  id: 'tuningFork', name: '音叉灵',
  createUnit: () => new Enemy({ defId: 'tuningFork', name: '音叉灵', maxHp: 20 }),
  act(actx) {
    const { unit } = actx;
    const wakeDelay = unit.wakeDelay ?? 0;
    if (wakeDelay && unit.actionIndex < wakeDelay) return; // 错拍延迟（仅成对时非零）
    const t = unit.actionIndex - wakeDelay;
    const beat = t % 5;
    if (beat === 0 || beat === 3) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player,
        amount: (beat === 0 ? 26 : 28) + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 4 }));
    }
  },
  getIntention: (unit) => {
    const wakeDelay = unit.wakeDelay ?? 0;
    const beat = (unit.actionIndex - wakeDelay) % 5;
    if (unit.actionIndex < wakeDelay) return { kinds: ['unknown'], note: '静默' };
    if (beat === 0 || beat === 3) {
      return { kinds: ['attack'], hits: 1, damage: (beat === 0 ? 26 : 28) + unit.getStat('attack'), note: '大振' };
    }
    return { kinds: ['defend'], note: '失谐（自身盾4）' };
  },
});

// ③ 烛灵（A3 烛火群）：恒攻 + 自燃线性滚雪球（攻击 = 8 + 2×行动次数），无自愈无防御——
// 纯 DPS 时限检查：拖到第 6-7 回合合计输出进不可挡区，必须速扫。基准血量全场最低档。
registerEnemy({
  difficulty: { base: 4, min: 4, max: 7, floorMin: 34, floorMax: 43 },
  id: 'candleSpirit', name: '烛灵',
  createUnit: () => new Enemy({ defId: 'candleSpirit', name: '烛灵', maxHp: 22 }),
  act(actx) {
    const burn = 8 + 2 * actx.unit.actionIndex + actx.unit.getStat('attack');
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player, amount: burn }));
  },
  getIntention: (unit) => ({
    kinds: ['attack'], hits: 1,
    damage: 8 + 2 * unit.actionIndex + unit.getStat('attack'),
    note: `自燃+2/回合（当前+${2 * unit.actionIndex}）`,
  }),
});

// ---- 族B · 巨兽渐强 ----

// ④ 档案馆巨像（B1）：单体超级血牛（终值 200+）。三拍循环：低伤锤（10+t×2）↔ 干扰拍
// （攻6 + 塞 2 墨渍）↔ 重压拍（14+t×2 + 自盾10），t=行动次数——第 8 拍起锤击 24+，
// 超期账单。前 2 拍合计 ≤ 22 = 免费启动窗口（咏唱/引擎铺场来得及）。
registerEnemy({
  difficulty: { base: 12, min: 10, max: 13, floorMin: 36, floorMax: 43 },
  id: 'archiveColossus', name: '档案馆巨像',
  createUnit: () => new Enemy({ defId: 'archiveColossus', name: '档案馆巨像', maxHp: 40 }),
  act(actx) {
    const { unit } = actx;
    const t = unit.actionIndex;
    const phase = t % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + 2 * t + unit.getStat('attack') }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 6 + unit.getStat('attack') }));
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'inkBlot', toZone: 'deck', index: 'random' }));
      actx.kernel.submitInstruction(new AddCardInstruction({ defId: 'inkBlot', toZone: 'deck', index: 'random' }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 14 + 2 * t + unit.getStat('attack') }));
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
    }
  },
  getIntention: (unit) => {
    const t = unit.actionIndex;
    const phase = t % 3;
    if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 10 + 2 * t + unit.getStat('attack'), note: `低伤锤（随回合增强，当前+${2 * t}）` };
    if (phase === 1) return { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + unit.getStat('attack'), note: '塞2墨渍' };
    return { kinds: ['attack', 'defend'], hits: 1, damage: 14 + 2 * t + unit.getStat('attack'), note: `重压（随回合增强，当前+${2 * t}）+自身盾10` };
  },
});

// ⑤ 噬书巨虫（B2）：啃食（攻9 + **吞掉玩家手牌最右 1 张**——移入焚毁区，战斗结束不
// 返还：战斗 zones 本就不回写 run 牌组，被吞的卡本场消失）↔ 蜕变（自愈8+蓄势1）↔
// 喷洒（(8+蓄势)×3）。反「精致留手」：留牌价值排序 + 速杀。
registerEnemy({
  difficulty: { base: 10, min: 8, max: 12, floorMin: 36, floorMax: 43 },
  id: 'bookDevourer', name: '噬书巨虫',
  createUnit: () => new Enemy({ defId: 'bookDevourer', name: '噬书巨虫', maxHp: 44 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 9 + unit.getStat('attack') }));
      const hand = bs.zones.hand;
      if (hand.length) {
        actx.kernel.submitInstruction(new MoveCardInstruction({
          uniqueID: hand[hand.length - 1].uniqueID, toZone: 'burnt', reason: 'devoured' }));
      }
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 8 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: 1 }));
    } else {
      const per = 8 + unit.getStat('attack'); // 蓄势经 statModifiers 已入面板，不重复加
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: per }));
      }
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['attack', 'debuff'], hits: 1, damage: 9 + unit.getStat('attack'), note: '啃食：吞掉你最右 1 张手牌（本场不返还）' };
    if (phase === 1) return { kinds: ['buff'], note: '蜕变：自愈8，蓄势+1' };
    const per = 8 + unit.getStat('attack');
    return { kinds: ['attack'], hits: 3, damage: per, note: `喷洒（共${per * 3}）` };
  },
});

// ⑥ 墨海母核（B3 墨海涨潮）：两拍循环「触须横扫 12+atk ↔ 涨墨（玩家手牌上限 -1，
// 战斗内叠层、保底 4 + 塞 1 墨渍）」。单回合峰值温和，全部压力来自操作空间收缩——
// 「可打但越来越挤」。手牌上限走 battleState.modifiers（战斗级，战后自动复位）。
registerEnemy({
  difficulty: { base: 11, min: 9, max: 12, floorMin: 36, floorMax: 43 },
  id: 'inkTideCore', name: '墨海母核',
  createUnit: () => new Enemy({ defId: 'inkTideCore', name: '墨海母核', maxHp: 42 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 12 + unit.getStat('attack') }));
    } else {
      if ((bs.modifiers.maxHandSize ?? 0) > -2) { // 保底 4（基准 6 - 2）
        bs.modifiers.maxHandSize -= 1;
      }
      actx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'inkBlot', toZone: 'deck', index: 'random' }));
    }
  },
  getIntention: (unit, bs) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 12 + unit.getStat('attack') }
    : { kinds: ['debuff'], note: `涨墨：手牌上限-1（当前上限 ${6 + (bs?.modifiers?.maxHandSize ?? 0)}），塞1墨渍` }),
});

// ---- 族C · 机制反制 ----

// ⑦ 占卜水晶球（C1 镜厅）：中攻 ↔ 蓄能循环；每逢第 4 拍「镜映」——把当前所有敌方
// 单位身上的负面状态（燃烧/中毒/虚弱等 debuff 类效果）原样复制给玩家。DoT 流打它 =
// 第 4 拍原样退货——先读镜子再选武器（直伤/净化/4 拍内控量）。
registerEnemy({
  difficulty: { base: 8, min: 7, max: 9, floorMin: 36, floorMax: 43 },
  id: 'oracleOrb', name: '占卜水晶球',
  createUnit: () => new Enemy({ defId: 'oracleOrb', name: '占卜水晶球', maxHp: 16 }),
  act(actx) {
    const { unit, kernel } = actx;
    const beat = unit.actionIndex % 4;
    if (beat === 3) {
      for (const e of aliveEnemies(actx.battleState)) {
        for (const eff of e.effects) {
          const def = getEffectDefinition(eff.effectId);
          if (def?.type === 'debuff' && eff.stacks > 0) {
            kernel.submitInstruction(new AddEffectInstruction({
              target: actx.player, effectId: eff.effectId, stacks: eff.stacks }));
          }
        }
      }
      return;
    }
    if (beat % 2 === 0) {
      kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + unit.getStat('attack') }));
    } else {
      kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
    }
  },
  getIntention: (unit) => {
    const beat = unit.actionIndex % 4;
    if (beat === 3) return { kinds: ['debuff'], note: '镜映：将敌方全体的负面状态复制给你' };
    if (beat % 2 === 0) return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    return { kinds: ['defend'], note: '蓄能：自身盾8' };
  },
});

// ⑧ 禁阅抄录员（C2）：攻击随玩家累计抽牌数成长（每 3 张 +2，行动时按 floor(drawn/3)
// 拉齐蓄势层）——抽牌引擎流被点名。焚页拍清空自身蓄势换自愈 6：逼它洗牌再集火的交互窗。
registerEnemy({
  difficulty: { base: 7, min: 6, max: 8, floorMin: 36, floorMax: 43 },
  id: 'censorScribe', name: '禁阅抄录员',
  createUnit: () => new Enemy({ defId: 'censorScribe', name: '禁阅抄录员', maxHp: 14 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 1) {
      const known = unit.getEffectStacks('focus');
      if (known > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'focus', stacks: -known }));
      }
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 6 }));
      return;
    }
    const target = Math.floor((bs.history.battle.drawn ?? 0) / 3); // 通晓 = 玩家每抽3张+1层
    const cur = unit.getEffectStacks('focus');
    if (target > cur) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: target - cur }));
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player,
      amount: (phase === 0 ? 9 : 11) + unit.getStat('attack') }));
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 1) return { kinds: ['buff'], note: '焚页：清空通晓，自愈6' };
    return {
      kinds: ['attack'], hits: 1,
      damage: (phase === 0 ? 9 : 11) + unit.getStat('attack'),
      note: `你每抽3张牌它攻击+2（当前+${2 * unit.getEffectStacks('focus')}）`,
    };
  },
});

// ⑨ 账房墨灵（C3）：收账时若你手牌近乎满（≥ 上限-1），攻击 +6 且蓄势 +2——囤牌课税的
// 敌人化（读当下手牌数，快打流白嫖记账拍）。超载流/留手流被点名。
registerEnemy({
  difficulty: { base: 7, min: 6, max: 8, floorMin: 36, floorMax: 43 },
  id: 'ledgerImp', name: '账房墨灵',
  createUnit: () => new Enemy({ defId: 'ledgerImp', name: '账房墨灵', maxHp: 15 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (unit.actionIndex % 2 === 1) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 6 }));
      return;
    }
    const capacity = 6 + (bs.modifiers.maxHandSize ?? 0);
    const hoarding = bs.zones.hand.length >= capacity - 1;
    if (hoarding) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: 2 }));
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player,
      amount: 13 + (hoarding ? 6 : 0) + unit.getStat('attack') }));
  },
  getIntention: (unit, bs) => {
    if (unit.actionIndex % 2 === 1) return { kinds: ['defend'], note: '记账（自身盾6）' };
    const capacity = 6 + (bs?.modifiers?.maxHandSize ?? 0);
    const hoarding = (bs?.zones?.hand?.length ?? 0) >= capacity - 1;
    return {
      kinds: ['attack'], hits: 1,
      damage: 13 + (hoarding ? 6 : 0) + unit.getStat('attack'),
      note: hoarding ? '收账：你手牌近乎满——罚息+6且蓄势+2' : '收账',
    };
  },
});

// ⑩ 学术监察（C4）：驳回复拍削你下回合抽牌（drawPenaltyTurns 通道）；论证据读你上回合
// 出牌数（history.turn.played 在敌方行动时读到的即玩家上回合总量）——多动流出牌 ≥4
// 时攻击 +5。「多动罚」：复读机/高频引擎被点名，序列多样化无感。
registerEnemy({
  difficulty: { base: 8, min: 7, max: 9, floorMin: 36, floorMax: 43 },
  id: 'acadMonitor', name: '学术监察',
  createUnit: () => new Enemy({ defId: 'acadMonitor', name: '学术监察', maxHp: 17 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'weaken', stacks: 2 }));
    } else if (phase === 1) {
      const played = bs.history.turn.played; // 玩家上回合出牌数
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player,
        amount: 12 + (played >= 4 ? 5 : 0) + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 13 + unit.getStat('attack') }));
      const d = bs.debuffs ?? (bs.debuffs = {});
      d.drawPenaltyTurns = Math.max(d.drawPenaltyTurns ?? 0, 0) + 1; // 下回合抽牌-1
    }
  },
  getIntention: (unit, bs) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['debuff'], note: '查重：虚弱2' };
    if (phase === 1) {
      const played = bs?.history?.turn?.played ?? 0;
      return {
        kinds: ['attack'], hits: 1, damage: 12 + (played >= 4 ? 5 : 0) + unit.getStat('attack'),
        note: played >= 4 ? '论证：你上回合出牌≥4——引用罚+5' : '论证',
      };
    }
    return { kinds: ['attack', 'debuff'], hits: 1, damage: 13 + unit.getStat('attack'), note: '驳回：下回合你抽牌-1' };
  },
});

// ---- 机制四件套 + 开局重物 ----

// ⑪ 持盾像（初始大盾源）：onSpawn 时全体友军 +14 盾（runFlow.assembleBattle 调用，
// 玩家先手前生效=真·抗首回合爆发）；三拍循环续盾。杀掉它群体盾断供——但它血厚且常被
// 增益/仇恨掩护。破解：单点速杀盾源，或先用持续输出磨穿盾窗。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 6, floorMin: 36, floorMax: 43 },
  id: 'shieldBearer', name: '持盾像',
  createUnit: () => new Enemy({ defId: 'shieldBearer', name: '持盾像', maxHp: 34 }),
  onSpawn(unit, enemies) {
    for (const e of enemies) if (!e.isDead()) e.shield += 14; // 开局群体大盾：抗爆发
  },
  act(actx) {
    const { unit } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 10 }));
      }
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 9 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 12 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: 1 }));
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['defend', 'buff'], note: '竖盾：全体友军盾+10' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 9 + unit.getStat('attack') };
    return { kinds: ['defend', 'buff'], note: '稳固：自身盾12+蓄势1' };
  },
});

// ⑫ 仪典祭坛（群体增益核心）：两拍循环「祝圣（全体友军力量+2、盾+8）↔ 蓄能（自盾14）」。
// 输出为零但每两拍让全队攻击 +2——3 个循环后多段怪每段 +6。必须优先处理，但它自盾最厚。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 6, floorMin: 36, floorMax: 43 },
  id: 'riteAltar', name: '仪典祭坛',
  createUnit: () => new Enemy({ defId: 'riteAltar', name: '仪典祭坛', maxHp: 26 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 2 === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'strength', stacks: 2 }));
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 8 }));
      }
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 14 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['buff'], note: '祝圣：全体友军力量+2、盾+8' }
    : { kinds: ['defend'], note: '蓄能：自身盾14' }),
});

// ⑬ 风刃魔像（闪避+大口径多段）：两拍循环「起风（自身闪避拉到 3——蒸发口径照旧，
// 敌方回合开始 -1）↔ 刃舞（(6+atk)×4 四连击）」。多段流的坟墓（每段单独判闪避）、
// DoT 流的猎物（毒/燃烧穿透闪避）。被祭坛喂力量后 8×4=32/轮。
registerEnemy({
  difficulty: { base: 8, min: 6, max: 9, floorMin: 36, floorMax: 43 },
  id: 'galeGolem', name: '风刃魔像',
  createUnit: () => new Enemy({ defId: 'galeGolem', name: '风刃魔像', maxHp: 20 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 2 === 0) {
      const cur = unit.getEffectStacks('dodge');
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'dodge', stacks: Math.max(0, 3 - cur) })); // 拉到 3
    } else {
      const per = 6 + unit.getStat('attack');
      for (let i = 0; i < 4; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: per }));
      }
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['buff'], note: '起风：自身闪避3' }
    : { kinds: ['attack'], hits: 4, damage: 6 + unit.getStat('attack'), note: `刃舞×4（共${(6 + unit.getStat('attack')) * 4}）` }),
});

// ⑭ 连环弩台（重装→爆发节律）：三拍循环「装填（盾10+蓄势2）→ 点射（10+蓄势×2）→
// 齐射（(7+蓄势)×3）」。装填拍是明确预告的「下轮会痛」——读意图后的盾量分配教科书。
registerEnemy({
  difficulty: { base: 9, min: 7, max: 10, floorMin: 36, floorMax: 43 },
  id: 'repeaterBallista', name: '连环弩台',
  createUnit: () => new Enemy({ defId: 'repeaterBallista', name: '连环弩台', maxHp: 22 }),
  act(actx) {
    const { unit } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: 2 }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 10 + unit.getStat('attack') })); // 蓄势已入面板
    } else {
      const per = 7 + unit.getStat('attack'); // 蓄势已入面板，不重复加
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: per }));
      }
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['defend', 'buff'], note: '装填：盾10+蓄势2' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    const per = 7 + unit.getStat('attack');
    return { kinds: ['attack'], hits: 3, damage: per, note: `齐射（共${per * 3}）` };
  },
});

// ⑮ 装订巨蟒（开局塞大卡）：首拍向玩家牌库**顶**塞 4 张「活页」（第 2 回合起手必被
// 污染——活页可打出：自伤4抽2，付代价清障）；自身两拍循环「缠绕 11+atk ↔ 蜕皮自愈6」。
registerEnemy({
  difficulty: { base: 8, min: 7, max: 10, floorMin: 36, floorMax: 43 },
  id: 'binderPython', name: '装订巨蟒',
  createUnit: () => new Enemy({ defId: 'binderPython', name: '装订巨蟒', maxHp: 36 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex === 0) {
      for (let i = 0; i < 4; i++) {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'looseLeaf', toZone: 'deck', index: 0 })); // 塞牌库顶：下回合必抽到
      }
      return;
    }
    if ((unit.actionIndex - 1) % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 11 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 6 }));
    }
  },
  getIntention: (unit) => {
    if (unit.actionIndex === 0) return { kinds: ['debuff'], note: '装订：4张活页塞入你的牌库顶' };
    return (unit.actionIndex - 1) % 2 === 0
      ? { kinds: ['attack'], hits: 1, damage: 11 + unit.getStat('attack'), note: '缠绕' }
      : { kinds: ['buff'], note: '蜕皮：自愈6' };
  },
});

// ⑤″ 33 层 Boss · 完好的无人战体（章3 Boss 池之二，2026-09-14 用户设计；原型参考
// wekyland「无人战体」词条：古南圣国军事遗留的自律战斗机器，「完好的」= 装备无损的
// 个体——灰烬装甲可用、拟态基质未失活，所以它带着 150 初始盾与「如山+纯净」的完好
// 协议出场；指示灯「警戒模式由绿转黄」、智能「经漫长岁月往往严重错乱」= 三灯状态机）。
//   绿灯（第 1 拍）【徘徊】：不行动——白给玩家一拍，代价是 150 盾（如山存续）横在面前；
//   黄灯（第 2 拍起三拍循环）：解除威胁（盾15+攻10+锁定手中3张）→ 劝诫（盾30）→
//     解除威胁'（攻10+焚牌库顶2）。盾逐轮累积不清（如山），玩家迟早打穿——破盾越快，
//     黄灯期越短（少挨锁定/焚库）；
//   红灯（转阶段后三拍循环）：锁定要害，清除（穿透35+自身格挡1）→ 反反反反制
//     （锁定全部手牌+5×7）→ 重启....失失失失败（空转）。
// 转阶段：盾第一次被打穿 → **马上**凝滞1（一切状态无法变更——破盾那回合玩家的剩余
//   输出打不动冻结的机器）→ 其回合开始凝滞解除，行动拍播【系统统统错误，最终预案启动】：
//   净化自身全部效果 + 盾50，转红灯。
// 死亡协议：第一次致死伤害被拦截（塞西莉亚之恩赐同款范式：改判保留 1 血 + 无敌）——
//   宕机锁死；下一行动拍【错错错误】自爆：对玩家 20 伤 + 拆地板自杀。它永远以自爆收场。
registerEnemy({
  // elite:true 仅借「锚点=base」的缩放语义（章3 Boss 难度14 → hpMult=1），让 100 血
  // 精确落地；floorMin/Max=33 + BOSS_IDS 排除保证它不进任何精英/通配取材池。
  difficulty: { base: 14, min: 14, max: 14, floorMin: 33, floorMax: 33, elite: true },
  id: 'intactDrone', name: '完好的无人战体',
  createUnit: () => new Enemy({ defId: 'intactDrone', name: '完好的无人战体', maxHp: 100 }),
  onBattleStart(ctx, unit) {
    unit.shield += 150; // 灰烬装甲（完好无损）——如山存续，必须真打穿
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'mountain', stacks: 1 }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'pure', stacks: 4 }));
    const owner = `enemy:${unit.uniqueID}:drone`;
    // 盾碎检测（POST：伤害已结算）：第一次被打穿 → 马上凝滞1 + 排转阶段。
    // 如山在场，盾只会因伤害归零（回合开始的例行清盾被 veto），不会误触发。
    ctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === unit
        && !unit._stasisArmed && !unit._phase2
        && (instr.result?.shieldAbsorbed ?? 0) > 0 && unit.shield <= 0,
      react: (instr, c) => {
        unit._stasisArmed = true;
        unit._phase2Pending = true;
        c.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'stasis', stacks: 1 }), instr);
      },
    });
    // 死亡协议拦截（致命判定写在 react、priority 压到修饰者之后——_collect 契约）：
    // 第一次致死伤害 veto 并改判「保留 1 血 + 无敌」，进入自爆倒计时。
    ctx.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', priority: -100, owner,
      filter: (instr) => instr.target === unit && !unit._detonated,
      react: (instr, c) => {
        if (!wouldBeLethal(instr, unit)) return;
        unit._detonated = true;
        c.kernel.veto(instr, 'droneLockdown', [
          new DealDamageInstruction({
            source: instr.source, target: unit,
            amount: Math.max(unit.hp - 1, 0) + unit.shield,
            fixed: true, tags: ['droneLockdown'],
          }),
          new AddEffectInstruction({ target: unit, effectId: 'invulnerable', stacks: 1 }),
        ]);
      },
    });
    // 锁定结算：玩家回合结束时，手牌中的锁定卡焚毁（离手即免除），随后全 zone 清标
    // ——本轮锁定结算完毕，离手的卡不带标回库/回手。
    ctx.kernel.addSubscription({
      when: PlayerTurnEndInstruction, phase: 'post', owner,
      filter: () => !unit.isDead(),
      react: (instr, c) => {
        for (const card of [...c.battleState.zones.hand]) {
          if (card.locked && zoneOf(c.battleState, card.uniqueID) === 'hand') {
            c.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: card.uniqueID }), instr);
          }
        }
        for (const zone of ['hand', 'deck', 'burnt', 'pending']) {
          for (const card of c.battleState.zones[zone]) card.locked = false;
        }
      },
    });
  },
  act(actx) {
    const { unit, battleState: bs, player } = actx;
    const atk = unit.getStat('attack');

    // 【错错错误】自爆拍：对玩家 20 伤，拆掉无敌地板后自杀（miracle 同款顺序铁律：
    // 先摘地板再落死，反过来会被地板挡回 1）
    if (unit._detonated) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 20 + atk, tags: ['detonate'] }));
      const inv = unit.getEffectStacks('invulnerable');
      if (inv > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'invulnerable', stacks: -inv }));
      }
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: unit, amount: 999, pierce: true, tags: ['detonate'] }));
      return;
    }

    // 【系统统统错误，最终预案启动】转阶段拍（凝滞已在回合开始解除）：净化全部效果 + 盾50
    if (unit._phase2Pending) {
      unit._phase2Pending = false;
      unit._phase2 = true;
      unit._redBeat = 0;
      for (const e of [...unit.effects]) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: e.effectId, stacks: -e.stacks }));
      }
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 50 }));
      return;
    }

    // 绿灯【徘徊】：第 1 拍不行动
    if (unit.actionIndex === 0) return;

    if (!unit._phase2) {
      const beat = (unit.actionIndex - 1) % 3;
      if (beat === 0) {
        // 【解除威胁】盾15 + 攻10 + 锁定手中3张（随机；锁定不影响打出，回合末仍在手才焚）
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 15 }));
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 10 + atk }));
        const pool = bs.rng.shuffle([...bs.zones.hand]);
        actx.kernel.submitInstruction(new LockCardsInstruction({
          uniqueIDs: pool.slice(0, 3).map(c => c.uniqueID) }));
      } else if (beat === 1) {
        // 【劝诫】盾30
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 30 }));
      } else {
        // 【解除威胁'】攻10 + 焚牌库顶2（快照 uniqueID，牌库抽空自然落空）
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 10 + atk }));
        for (let i = 0; i < 2; i++) {
          const top = bs.zones.deck[0];
          if (!top) break;
          actx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: top.uniqueID }));
        }
      }
      return;
    }

    // 红灯三拍循环
    const beat = unit._redBeat % 3;
    unit._redBeat += 1;
    if (beat === 0) {
      // 【锁定要害，清除】穿透35（奇异射线：防御与护盾都不减免）+ 自身格挡1
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 35 + atk, pierce: true }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'block', stacks: 1 }));
    } else if (beat === 1) {
      // 【反反反反制】锁定全部手牌 + 5×7
      actx.kernel.submitInstruction(new LockCardsInstruction({
        uniqueIDs: bs.zones.hand.map(c => c.uniqueID) }));
      for (let i = 0; i < 7; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 5 + atk }));
      }
    }
    // beat 2：【重启....失失失失败】空转
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit._detonated) {
      return { kinds: ['attack'], hits: 1, damage: 20 + atk, note: '错错错误：自爆！' };
    }
    if (unit.getEffectStacks('stasis') > 0 || unit._phase2Pending) {
      return { kinds: ['buff'], note: '系统统统错误，最终预案启动：净化自身全部效果，护盾+50' };
    }
    if (unit.actionIndex === 0) return { kinds: ['unknown'], note: '徘徊' };
    if (!unit._phase2) {
      const beat = (unit.actionIndex - 1) % 3;
      if (beat === 0) return { kinds: ['attack', 'debuff'], hits: 1, damage: 10 + atk, note: '解除威胁：锁定手中3张牌（回合结束时仍在手则焚毁）' };
      if (beat === 1) return { kinds: ['defend'], note: '劝诫：自身护盾+30' };
      return { kinds: ['attack', 'debuff'], hits: 1, damage: 10 + atk, note: '解除威胁：焚毁牌库顶2张' };
    }
    const beat = unit._redBeat % 3;
    if (beat === 0) return { kinds: ['attack'], hits: 1, damage: 35 + atk, note: '锁定要害，清除：穿透伤害，自身格挡+1' };
    if (beat === 1) return { kinds: ['attack', 'debuff'], hits: 7, damage: 5 + atk, note: '反反反反制：锁定你的全部手牌' };
    return { kinds: ['unknown'], note: '重启....失失失失败' };
  },
});

// ⑥″ 33 层 Boss · 温室之后（章3 Boss 池之三，2026-09-14 用户设计；wiki 魔物爆发页·
// 南孚妖蝶——D 级、空/暗双属性、「本体脆弱，麻烦在于如何命中」）。设定升级：庄园温室
// 自长风高原引种了宿主植物，妖蝶随之入栖；魔化百年、暗脉觉醒（大陆仅 1.59‱ 的附属
// 灵脉），虫群意识凝成单一的「之后」——场上的每一只蝶都是它（分布的自我）。
// 核心体验（v2 用户定稿）：**同律集群**——母体与子体打同一套招式语言（蝶针/鳞粉/孕卵），
// 拍子与份量不同，读谱一次掌握全场；无真伪、无换位，身份一目了然。
//   母体三拍：鳞粉（中毒3）→ 蝶针 20 → 孕卵（子体不足2时补位；满员改自愈12）；
//   子体两拍：蝶针 8 ↔ 鳞屑（中毒2）；
//   舞步蜕变：母体每满三轮，全体蝶力量+2（滚雪球死钟，翅膀花纹逐阶变色的演出即计数条）；
//   孤蝶之怒（防白嫖）：子体全灭的一次性狂化——力量+4 即时生效 + 孕卵拍永久改为蝶针，
//   清场后留 1~2 拍爆发窗口，磨蹭就吃狂化母体的满额输出；
//   灵动：母体每拍补 1 层闪避（蒸发口径照旧）——只克单点大额爆发（大招落空），
//   多段流只被吃一段、群伤正解不受阻。
// 死亡：万蝶溃散——母体亡语杀光子体（同一结算树内完成，胜利判定不被亡语绊住）。
registerEnemy({
  // elite:true 仅借「锚点=base」的缩放语义（章3 Boss 难度14 → hpMult=1），让 150 血
  // 精确落地；floorMin/Max=33 + BOSS_IDS 排除保证不进任何精英/通配取材池。
  difficulty: { base: 14, min: 14, max: 14, floorMin: 33, floorMax: 33, elite: true },
  id: 'greenhouseQueen', name: '温室之后',
  createUnit: () => new Enemy({ defId: 'greenhouseQueen', name: '温室之后', maxHp: 150 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: 1 }));
    for (let i = 0; i < 2; i++) {
      ctx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition('butterflyLarva').createUnit(), source: unit }));
    }
  },
  act(actx) {
    const { unit, battleState: bs, player } = actx;
    const atk = unit.getStat('attack');
    // 灵动：每拍补 1 层闪避（敌方回合开始蒸发——玩家的回合里恒有 1 层挡单发）
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'dodge', stacks: 1 }));
    // 孤蝶之怒：子体全灭的一次性狂化（力量+4；孕卵拍在下方分支改蝶针）
    const larvae = aliveEnemies(bs).filter(e => e.defId === 'butterflyLarva');
    if (larvae.length === 0 && !unit._soloRage) {
      unit._soloRage = true;
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'strength', stacks: 4 }));
    }
    // 舞步蜕变：每满三轮（第 4/7/10…拍行动前）全体蝶力量+2
    const n = unit._beat ?? 0;
    if (n > 0 && n % 3 === 0) {
      for (const e of aliveEnemies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'strength', stacks: 2 }));
      }
    }
    const beat = n % 3;
    unit._beat = n + 1;
    if (beat === 0) {
      // 【鳞粉】玩家中毒3
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: player, effectId: 'poison', stacks: 3 }));
    } else if (beat === 1) {
      // 【蝶针】
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 20 + atk }));
    } else if (larvae.length < 2) {
      // 【孕卵】补位
      actx.kernel.submitInstruction(new UnitSpawnInstruction({
        unit: getEnemyDefinition('butterflyLarva').createUnit(), source: unit }));
    } else if (unit._soloRage) {
      // 孤蝶狂化：孕卵拍永久改为蝶针
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 20 + atk }));
    } else {
      // 【振翅】满员时的维持拍
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 12 }));
    }
  },
  getIntention: (unit, bs) => {
    const atk = unit.getStat('attack');
    const larvae = (bs?.enemies ?? []).filter(e => e.defId === 'butterflyLarva' && !e.isDead());
    const n = unit._beat ?? 0;
    const molt = n > 0 && n % 3 === 0 ? '蜕变：全体蝶力量+2；' : '';
    const beat = n % 3;
    if (beat === 0) return { kinds: ['debuff'], note: `${molt}鳞粉：中毒3` };
    if (beat === 1) return { kinds: ['attack'], hits: 1, damage: 20 + atk, note: '蝶针' };
    if (larvae.length < 2) return { kinds: ['summon'], note: `${molt}孕卵：孵化一只妖蝶子体` };
    if (unit._soloRage) return { kinds: ['attack'], hits: 1, damage: 20 + atk, note: '孤蝶之怒' };
    return { kinds: ['buff'], note: '振翅：自愈12' };
  },
  onDeath(actx) {
    // 万蝶溃散：母体亡→子体同拍蒸发（走正规死亡结算；子体无亡语不递归）
    for (const e of aliveEnemies(actx.battleState)) {
      if (e.defId !== 'butterflyLarva') continue;
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: e, amount: 999, pierce: true, tags: ['disperse'] }));
    }
  },
});

// 妖蝶子体（温室之后的分布自我——无 difficulty 元数据 = 永不进生成池，只经母体孵化）。
// 与母体同律：两拍循环 蝶针 8 ↔ 鳞屑（中毒2）——读谱一次掌握全场的「回声份量」。
registerEnemy({
  id: 'butterflyLarva', name: '妖蝶子体',
  createUnit: () => new Enemy({ defId: 'butterflyLarva', name: '妖蝶子体', maxHp: 40 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 8 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: player, effectId: 'poison', stacks: 2 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 8 + unit.getStat('attack'), note: '蝶针' }
    : { kinds: ['debuff'], note: '鳞屑：中毒2' }),
});

// ⑦″ 33 层 Boss · 渊素食客（章3 Boss 池之四，2026-09-14 用户设计；自发角色。wiki 灵御
// 页：渊素（砹晶石）1956 年被 UPW 认定为毒品、与降临神教关联；「1920 年后考核要求大师
// 与持枪士兵看护」）。设定：昔日的灵御考核官，监守自盗庄园地窖的渊素窖藏，常年吸食致
// 灵脉晶化——他曾是给人发证书的人，现在是塔要淘汰的东西。
// 考核定位=**增益掠夺考**：你叠的每一层力量，都是他的。
// 【渊素共鸣】（常驻被动）：每获得一个负面效果（按赋予次数计，非层数），获得 1 层力量
//   ——叠火/叠毒流仍可打（DoT 穿透照掉血），但他的输出同步膨胀，打不打变成对赌。
// 三段单向堕落（血量驱动 70%/40%，越打越疯）：
//   一段·清醒（>70%）——考核官的体面（用玩家的招式语言）：灵压9 → 架势（盾8+格挡2）
//     → 虹吸（偷2魏启+攻6）；
//   跨线【吸食】：自愈12+力量1；
//   二段·瘾发（40~70%）：灵脉虹吸（偷玩家一个增益的全部层数）→ 谵妄突袭 (8+atk)×2
//     （偷来的力量立刻变现）→ 戒断（盾12+格挡2）；
//   跨线【过量】：自伤6+力量2+蓄势2；
//   三段·渊素暴走（<40%）：每拍【过载】自伤4换力量1（自焚死钟——龟缩玩家的胜路是
//     「赢=不死」）；灵潮倾泻 (6+atk)×3 → 掠夺成性（偷2魏启+1AP+力量1）→
//     渊素反噬（fixed 5，自愈5——吸玩家的命）。
registerEnemy({
  // elite:true 仅借「锚点=base」的缩放语义（章3 Boss 难度14 → hpMult=1），180 血精确落地。
  difficulty: { base: 14, min: 14, max: 14, floorMin: 33, floorMax: 33, elite: true },
  id: 'essenceEater', name: '渊素食客',
  createUnit: () => new Enemy({ defId: 'essenceEater', name: '渊素食客', maxHp: 180 }),
  onBattleStart(ctx, unit) {
    // 渊素共鸣：获得负面效果（payload.stacks>0 的赋予）→ 力量+1。
    // 力量是 buff，不会自触发递归；naqi 类纯玩家侧触发逻辑偷过去语义荒谬，入黑名单。
    ctx.kernel.addSubscription({
      when: AddEffectInstruction, phase: 'post',
      owner: `enemy:${unit.uniqueID}:essenceResonance`,
      filter: (instr) => instr.target === unit
        && instr.payload?.stacks > 0
        && getEffectDefinition(instr.effectId)?.type === 'debuff',
      react: (instr, c) => c.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'strength', stacks: 1 }), instr),
    });
  },
  act(actx) {
    const { unit, player } = actx;
    const atk = unit.getStat('attack');
    // 三段单向锁存（kardas _phase2 同款语义）：吸食/反噬的回血不许把阶段跌回去——
    // 沦陷的清醒不会回来。实时血量只允许向前推进阶段。
    const r = unit.hp / unit.maxHp;
    const phase = Math.max(unit._phase ?? 1, r > 0.7 ? 1 : r > 0.4 ? 2 : 3);
    // 跨线宣言拍：不攻击，只嗑药
    if (phase !== (unit._phase ?? 1)) {
      unit._phase = phase;
      unit._beat = 0;
      if (phase === 2) {
        // 【吸食】
        actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 12 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'strength', stacks: 1 }));
        return;
      }
      // 【过量】
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: unit, amount: 6, fixed: true, tags: ['overdose'] }));
      actx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'strength', stacks: 2 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'focus', stacks: 2 }));
      return;
    }
    // 三段过载：每拍自伤4换力量1（自焚死钟，先于行动结算）
    if (phase === 3) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: unit, amount: 4, fixed: true, tags: ['overload'] }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'strength', stacks: 1 }));
    }
    const beat = (unit._beat ?? 0) % 3;
    unit._beat = (unit._beat ?? 0) + 1;
    if (phase === 1) {
      if (beat === 0) {
        // 【灵压】
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 9 + atk }));
      } else if (beat === 1) {
        // 【架势】
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'block', stacks: 2 }));
      } else {
        // 【虹吸】偷2魏启 + 攻6
        actx.kernel.submitInstruction(new GainManaInstruction({ amount: -2 }));
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 6 + atk }));
      }
      return;
    }
    if (phase === 2) {
      if (beat === 0) {
        // 【灵脉虹吸】偷玩家一个增益的全部层数（黑名单外的非空 buff；无可偷则退化为攻6）
        const buffs = player.effects.filter(e => e.stacks > 0
          && getEffectDefinition(e.effectId)?.type === 'buff'
          && !ESSENCE_STEAL_BLACKLIST.has(e.effectId));
        if (buffs.length > 0) {
          const pick = buffs[actx.battleState.rng.int(0, buffs.length - 1)];
          actx.kernel.submitInstruction(new AddEffectInstruction({
            target: player, effectId: pick.effectId, stacks: -pick.stacks }));
          actx.kernel.submitInstruction(new AddEffectInstruction({
            target: unit, effectId: pick.effectId, stacks: pick.stacks }));
        } else {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: player, amount: 6 + atk }));
        }
      } else if (beat === 1) {
        // 【谵妄突袭】偷来的力量立刻变现
        for (let i = 0; i < 2; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: player, amount: 8 + atk }));
        }
      } else {
        // 【戒断】
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 12 }));
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'block', stacks: 2 }));
      }
      return;
    }
    // 三段·渊素暴走
    if (beat === 0) {
      // 【灵潮倾泻】
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 6 + atk }));
      }
    } else if (beat === 1) {
      // 【掠夺成性】偷2魏启 + 力量1 + 攻8（原案偷1AP——AP每回合开始置满，敌方拍
      // 偷取对玩家无感，折成直伤才有牙）
      actx.kernel.submitInstruction(new GainManaInstruction({ amount: -2 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'strength', stacks: 1 }));
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 8 + atk }));
    } else {
      // 【渊素反噬】吸玩家的命
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 5, fixed: true, tags: ['vampiric'] }));
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 5 }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.hp / unit.maxHp > 0.7 ? 1 : unit.hp / unit.maxHp > 0.4 ? 2 : 3;
    if (phase !== (unit._phase ?? 1)) {
      return phase === 2
        ? { kinds: ['buff'], note: '吸食：自愈12、力量+1（渊素共鸣：每次获得负面效果力量+1）' }
        : { kinds: ['buff'], note: '过量：自伤6、力量+2、蓄势+2，进入暴走' };
    }
    const beat = (unit._beat ?? 0) % 3;
    if (phase === 1) {
      if (beat === 0) return { kinds: ['attack'], hits: 1, damage: 9 + atk, note: '灵压' };
      if (beat === 1) return { kinds: ['defend', 'buff'], note: '架势：盾8、格挡2' };
      return { kinds: ['attack', 'debuff'], hits: 1, damage: 6 + atk, note: '虹吸：偷取2魏启' };
    }
    if (phase === 2) {
      if (beat === 0) return { kinds: ['debuff'], note: '灵脉虹吸：偷取你的一个增益的全部层数' };
      if (beat === 1) return { kinds: ['attack'], hits: 2, damage: 8 + atk, note: '谵妄突袭' };
      return { kinds: ['defend', 'buff'], note: '戒断：盾12、格挡2' };
    }
    if (beat === 0) return { kinds: ['attack'], hits: 3, damage: 6 + atk, note: `灵潮倾泻（每拍过载：自伤4换力量+1）` };
    if (beat === 1) return { kinds: ['attack', 'debuff'], hits: 1, damage: 8 + atk, note: '掠夺成性：偷2魏启，力量+1' };
    return { kinds: ['attack', 'buff'], hits: 1, damage: 5, note: '渊素反噬：5点穿透生命伤害，自愈5' };
  },
});

// 灵脉虹吸的黑名单：纯玩家侧触发逻辑（偷过去语义反转）与内部计数轨不可偷
const ESSENCE_STEAL_BLACKLIST = new Set(['naqi', 'blastFuse']);

// ============ 章1「塔基爆发」新敌（2026-09-14 用户设计；wiki 魔物爆发页低阶魔物，
// 习性即机制书）。主题：塔基要塞正处一场 D 级魔物爆发中——F/E 级杂鱼起步，机制随
// 烈度爬升（DoT → 滚雪球 → 时机 → 集群 → 组合），6/9 层精英收烈度，11 层源头 Boss。============

// ⑯ 静电毛球（wiki：E·雷「滚动摩擦积蓄静电」「多个附着累积电击致肢体僵硬」「怕水」）：
// **充能**（2026-09-14 用户新效果）——每拍自动充能+1（每层攻击+1，意图栏实时可见
// 滚雪球），玩家攻击它=提前放电（受击层数-2）。不打它越电越强、打它有泄压收益——
// 攻防节奏抉择，与鼓腹蟾互为镜像（蟾蜍打太狠亏、毛球不打亏）。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 4, floorMax: 12 },
  id: 'staticPuff', name: '静电毛球',
  createUnit: () => new Enemy({ defId: 'staticPuff', name: '静电毛球', maxHp: 10 }),
  act(actx) {
    const { unit, player } = actx;
    // 先放电后积蓄：行动面板在提交一刻快照——同拍「先充再放」吃不到新充能；
    // 倒序后每拍攻击自然吃到上一拍的充能，与意图 damage 同口径。
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 3 + unit.getStat('attack') }));
    actx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'charge', stacks: 1 }));
  },
  getIntention: (unit) => ({ kinds: ['attack'], hits: 1, damage: 3 + unit.getStat('attack') + 1,
    note: `静电放电（充能${unit.getEffectStacks('charge')}+1：每层+1，攻击它泄放2层）` }),
});

// ⑰ 刺刺草（wiki：F·木「茎秆布满尖刺」「刺尖含麻痹毒素」「缓慢蠕动」）：低层 DoT
// 教学件——藤鞭 4+中毒1 ↔ 扎根自盾4 两拍循环；血薄（12），是「带不带解毒素」的
// 第一道分岔题。
registerEnemy({
  difficulty: { base: 2, min: 1, max: 3, floorMin: 3, floorMax: 14 },
  id: 'thornWeed', name: '刺刺草',
  createUnit: () => new Enemy({ defId: 'thornWeed', name: '刺刺草', maxHp: 12 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 4 + unit.getStat('attack') }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: player, effectId: 'poison', stacks: 1 }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 4 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack', 'debuff'], hits: 1, damage: 4 + unit.getStat('attack'), note: '藤鞭：中毒1' }
    : { kinds: ['defend'], note: '扎根：自身护盾+4' }),
});

// ⑱ 腐食甲虫（wiki：E「集群 10-30」「啃食皮革制品、帆布背包或裸露在外的食物」
// 「传播病菌」）：集群白板+双重资源压力——攻击附带**啃食**（吃掉玩家牌库顶 1 张，
// 本场消化：战斗 zones 是 run 牌组的克隆，焚毁天然不回写）；**亡语病菌**（死亡时
// 玩家中毒 2）——AOE 流的甜蜜点带小代价。
registerEnemy({
  difficulty: { base: 1, min: 1, max: 2, floorMin: 3, floorMax: 14 },
  id: 'carrionBeetle', name: '腐食甲虫',
  createUnit: () => new Enemy({ defId: 'carrionBeetle', name: '腐食甲虫', maxHp: 8 }),
  act(actx) {
    const { unit, player, battleState: bs } = actx;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 3 + unit.getStat('attack') }));
    const top = bs.zones.deck[0];
    if (top) {
      actx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: top.uniqueID }));
    }
  },
  getIntention: (unit) => ({ kinds: ['attack', 'debuff'], hits: 1,
    damage: 3 + unit.getStat('attack'), note: '啃食：吃掉你的牌库顶1张（本场消化）' }),
  onDeath(actx) {
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: actx.player, effectId: 'poison', stacks: 2 }));
  },
});

// ⑲ 掘地鼹鼠（wiki：F·地「异常发达、金属光泽的前爪」「挖洞逃离危险」「致病菌」）：
// **遁地节拍**——突袭 7 ↔ 遁地（闪避拉到 2+自愈 2）两拍循环。遁地拍玩家打不着它
// （蒸发口径：遁地给的闪避跨玩家回合仍在），现身拍是集火窗口——「转火时机」的
// 低配教学（与第四章音叉错拍同族但更直白）。
registerEnemy({
  difficulty: { base: 3, min: 2, max: 4, floorMin: 5, floorMax: 16 },
  id: 'diggerMole', name: '掘地鼹鼠',
  createUnit: () => new Enemy({ defId: 'diggerMole', name: '掘地鼹鼠', maxHp: 14 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 7 + unit.getStat('attack') }));
    } else {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'dodge', stacks: 2 }));
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 2 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 7 + unit.getStat('attack'), note: '突袭' }
    : { kinds: ['buff'], note: '遁地：自身闪避2、自愈2（打不着它）' }),
});

// ⑳ 碎岩穿山甲（wiki：C·地「层层叠叠如花岗岩般的厚重甲片」「小口径枪械难以穿透
// 背部，需攻击腹部或眼部」「冲锋撞断树木」）：章 1 新精英。**重甲+蓄力冲锋**——
// 固定防御 3（白板 6 伤拳只磨出 3：考玩家的卡牌成长性输出）；两拍循环：蓄力（盾 6
// + 蓄势 1，重甲恢复）→ 冲锋（14+atk 大单发，**冲锋拍失衡：防御归零**，下一拍恢复）
// ——重甲的破绽窗口写在意图里，读节奏打。
registerEnemy({
  difficulty: { base: 5, min: 4, max: 6, floorMin: 4, floorMax: 10, elite: true },
  id: 'rockPangolin', name: '碎岩穿山甲',
  createUnit: () => new Enemy({ defId: 'rockPangolin', name: '碎岩穿山甲', maxHp: 45 }),
  onBattleStart(ctx, unit) {
    unit.defense += 3; // 花岗岩甲：固定减伤轨（冲锋拍失衡时归零）
  },
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      // 蓄力：重甲恢复 + 自盾 + 蓄势
      unit.defense = Math.max(unit.defense, 3);
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 6 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'focus', stacks: 1 }));
    } else {
      // 冲锋：大单发；冲锋瞬间腹部暴露——防御归零（破绽窗口）
      unit.defense = 0;
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 14 + unit.getStat('attack') }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '蓄力：重甲恢复、自身护盾+6、蓄势+1' }
    : { kinds: ['attack'], hits: 1, damage: 14 + unit.getStat('attack'), note: '冲锋：露出腹部（本拍防御归零）' }),
});
