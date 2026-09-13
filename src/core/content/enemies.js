import { registerEnemy, getEnemyDefinition } from '../enemies/registry.js';
import { registerSkill } from '../skills/registry.js';
import { AddCardInstruction, DrawCardsInstruction } from '../instructions/cards.js';
import Enemy from '../state/enemy.js';
import {
  DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction,
} from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { UnitSpawnInstruction } from '../instructions/units.js';
import { aliveEnemies, aliveAllies } from '../state/battleState.js';

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

// ②‴ 22 层 Boss · 宫殿骑士长（章2 阵型主题结业考，Boss 波 2 上岗 2026-09-13）
// 护驾：首拍召集 2 名宫廷侍从（Boss 生成器只产单 Boss，随从只能 act 内召；首拍不攻
//   = 给玩家一个先手窗）；**侍从 ≥2 时**才「督战」（全体蓄势1，不亲自攻击），且每回合
//   自我净化——燃烧层数减半（燃烧交互铁律：仪仗威严，侍从环伺时火焰近不了身；
//   亲征形态失去净化 = 给火系留「先清侍从再引爆」的输出窗，对物理系无感）。
// 亲征（侍从不足 2）：攻12 → 攻12 → 盾10 三拍循环；每隔一拍行动结束，若侍从 <2
//   且有 ≥2 空位，重新召集 1 名（凑回护驾形态）。
// 考试点：目标优先级（清侍从 vs 抢 Boss）+ 爆发窗口管理（亲征三拍是输出窗）。
// 2026-09-13 修复：护驾门槛 some→≥2（旧版留 1 侍从即可定式——骑士长永不攻击，
// 玩家杀到剩 1 个后白打 Boss）；召集同步放宽到 <2，1 侍从时也会被补齐。
registerEnemy({
  difficulty: { base: 11, min: 11, max: 11, floorMin: 22, floorMax: 22 },
  id: 'knightCommander', name: '宫殿骑士长',
  createUnit: () => new Enemy({ defId: 'knightCommander', name: '宫殿骑士长', maxHp: 40 }),
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
      // 护驾：督战（全体蓄势1）+ 自我净化（燃烧减半，向下取整）
      for (const e of aliveEnemies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'focus', stacks: 1 }));
      }
      const b = unit.getEffectStacks('burn');
      if (b >= 2) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'burn', stacks: -Math.floor(b / 2) }));
      }
      return;
    }
    // 亲征：攻12 → 攻12 → 盾10 三拍循环（_duelIndex 单调推进，形态来回切换不重置节奏）
    const phase = (unit._duelIndex ?? 0) % 3;
    unit._duelIndex = (unit._duelIndex ?? 0) + 1;
    if (phase < 2) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 12 + unit.getStat('attack') }));
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
      return { kinds: ['buff'], note: '督战：全体蓄势1；侍从≥2时每回合燃烧减半' };
    }
    const phase = (unit._duelIndex ?? 0) % 3;
    if (phase < 2) {
      return { kinds: ['attack'], hits: 1, damage: 12 + unit.getStat('attack'), note: '亲征' };
    }
    return { kinds: ['defend'], note: '亲征：自身护盾+10' };
  },
});

// 宫廷侍从（骑士长召唤物，不进生成池：无 difficulty 元数据 = 生成器取不到它）。
// 攻5 ↔ 护驾（骑士长盾8）两拍；主君已陨则护驾拍退化为攻击拍。
registerEnemy({
  id: 'courtSquire', name: '宫廷侍从',
  createUnit: () => new Enemy({ defId: 'courtSquire', name: '宫廷侍从', maxHp: 14 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 1) {
      const master = aliveEnemies(actx.battleState).find(e => e.defId === 'knightCommander');
      if (master) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: master, amount: 8 }));
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
      ? { kinds: ['defend'], note: '护驾：骑士长护盾+8' }
      : { kinds: ['attack'], hits: 1, damage: 5 + unit.getStat('attack') };
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
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 4 + unit.getStat('attack') }
    : { kinds: ['defend', 'buff'], note: '缩壳：自身护盾6，回复4' }),
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
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: actx.unit, target: actx.player,
      amount: (phase === 0 ? 10 : 14) + actx.unit.getStat('attack'),
    }));
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 1) return { kinds: ['defend', 'buff'], note: '全体友军护盾+12' };
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
