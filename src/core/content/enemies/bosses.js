// Boss（各章 Boss 层候选池见 floorEnemyGenerator 的 BOSS_OF_FLOOR；随从跟各自召唤主）。
// 转阶段演出触发点在各 act 的 playScript（fx/scripts/bosses/ 同名文件）。拆分自原
// content/enemies.js（2026-09-24，内容零改动）。

import Enemy from '../../state/enemy.js';
import { registerEnemy, getEnemyDefinition } from '../../enemies/registry.js';
import { getEffectDefinition } from '../../effects/registry.js';
import { AddCardInstruction, BurnCardInstruction, LockCardsInstruction } from '../../instructions/cards.js';
import { DealDamageInstruction, ApplyDamageInstruction, GainShieldInstruction, ApplyHealInstruction, wouldBeLethal } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { UnitSpawnInstruction } from '../../instructions/units.js';
import { PlayerTurnStartInstruction, PlayerTurnEndInstruction } from '../../instructions/turn.js';
import { GainManaInstruction } from '../../instructions/resources.js';
import { aliveEnemies, aliveAllies, allAliveUnits, zoneOf } from '../../state/battleState.js';
import { ESSENCE_STEAL_BLACKLIST } from './chapter1.js';

// 【过热自保】受压计数挂载（无人战体 / 神兵躯壳共用；2026-09-21 用户设计）：
//   玩家回合开始清零 → 累计本回合该单位受到的**生命值伤害**（`result.dealt`）。
//   **被护盾挡下、以及被防御/格挡减免的部分不算**（2026-09-21 用户口径：没穿盾就不算压力；
//   格挡免伤属"实际落血"折算，已含在 dealt 里）；自身来源（自焚类）不计。
//   阈值用法：穿透拍 resolve 前读 `unit._pressure`，压过阈值就取消开火、改起盾。
//   ⚠ 意图预告必须写明这是「生命值伤害」——口径不写清，玩家会按总输出估算而误判。
function attachPressureCounter(kernel, unit, owner) {
  kernel.addSubscription({
    when: PlayerTurnStartInstruction, phase: 'post', owner,
    filter: () => true,
    react: () => { unit._pressure = 0; },
  });
  kernel.addSubscription({
    when: ApplyDamageInstruction, phase: 'post', owner,
    filter: (instr) => instr.target === unit && instr.source !== unit,
    react: (instr) => {
      unit._pressure = (unit._pressure ?? 0) + ((instr.result?.dealt) ?? 0);
    },
  });
}

// ② 11 层 Boss · 燃焰术士（章1 火主题 Boss 池之一，2026-09-13 用户重做稿）：
// 一阶段四拍：盾6+塞1灼伤 → 燃烧5+攻6 → 攻6+塞1灼伤 → 攻20。灼伤是状态牌
// （无法打出，回合结束在手牌中受 2 伤——塞牌库随机位，抽到手上才开始计时）。
// 转段：战斗超 10 回合或血量跌至 80 以下——首拍空转（蓄力），随后四拍循环：
// 全场燃烧7（含自己）→ 攻10+盾10 → 消耗全场燃烧每层回 2 血 → 攻10+盾10。
// 机智点：它给自己也点燃烧、再靠「消耗燃烧回血」闭环——玩家的叠炎既是在烧它、
// 也是在给它备血包（引爆窗口 = 燃烧7 刚挂上、回血拍未到的一拍）。
registerEnemy({
  difficulty: { base: 8, floorMin: 11, floorMax: 11 },
  id: 'pyro', name: '燃焰术士',
  // 2026-09-21 用户定：一章 Boss 集体加强——基础 +7，经 11 层 ×3.4 缩放 ≈ 实战 +24（153→177）
  createUnit: () => new Enemy({ defId: 'pyro', name: '燃焰术士', maxHp: 52 }),
  // 多部件（fx Phase 5 首件试点，2026-09-23；同日视觉大改）：本体 + 3 团环绕火球
  // （程序化焰身/光晕/彗尾 sprite + 点光，无美术素材；P2 剧本推 heat 催成狂暴态）
  // 尺度口径：Boss billboard 实际 ≈20u 高（origin 在脚），轨道必须按体量给——
  // 小数值会全部埋没在袍子躯干里（实拍教训 09-23）
  orbs: { count: 3, color: 0xff8a3a, radius: 8, height: 11, size: 3.2, speed: 1.5, bob: 1.2 },
  // Boss 房间覆写（2026-09-23，composeRoom 深合并进 boss 配方）：
  // 一阶段全场压暗 + 火光微抬——转段「亮起来」才有明暗落差；木质装饰品大增 = 满房燃料，
  // P2 的 charBurn 烧黑/侵蚀才有东西可烧。guaranteed 两件摆在战场走廊外的敌侧翼
  roomOverride: {
    dim: 0.58, fireGain: 1.25,
    scatter: { tags: { wood: 3.0, barrack: 2.0 } },
    guaranteed: [
      { id: 'barricadeWood', x: -46, z: -46, ry: 0.6 }, { id: 'crateLong', x: -40, z: -58, ry: 1.2 },
      { id: 'logPile', x: -58, z: -30, ry: 0.4 }, // 左翼
      { id: 'barrelStack', x: 64, z: -14, ry: 1.9 }, { id: 'weaponRack', x: 70, z: 6, ry: -0.9 }, // 右翼
    ],
  },
  act(actx) {
    const { unit, battleState: bs } = actx;
    if (!unit._phase2 && (bs.turn.count > 7 || unit.hp < 120)) {
      unit._phase2 = true; unit._phaseBeat = 0; // 转段首拍空转（蓄力）
      // 转阶段演出走通用剧本闸口（fx 架构 ANIM_SCRIPT）：core 只报 id+标量参数，
      // 内容全在 stage 侧 fx/scripts/bosses/pyro.js；观战端同源重放
      actx.presenter?.playScript?.({ script: 'bosses/pyroP2', unit: unit.uniqueID });
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
          target: u, effectId: 'burn', stacks: 13 }));
      }
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.player, effectId: 'burn', stacks: 13 }));
      for (const a of aliveAllies(bs)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: a, effectId: 'burn', stacks: 13 }));
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
    if (!unit._phase2 && (bs.turn.count > 7 || unit.hp < 120)) {
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
    if (beat === 0) return { kinds: ['debuff'], note: '赋予所有单位燃烧13（含它自己）' };
    if (beat === 2) return { kinds: ['buff'], note: '消耗全场燃烧，每层回复2血' };
    return { kinds: ['attack', 'defend'], hits: 1, damage: 10 + atk, note: '自身护盾+10' };
  },
});

// ②′ 11 层 Boss · 卡达斯（章1 火主题 Boss 池之一，2026-09-13 用户设计；
// lore：魏启大陆「魔物爆发」——周期性出现的狂躁魔化古姆拉，S 级「死亡魔兽」，
// 獠牙利爪电离空气产生等离子体，魏启储能于肌体）。
// 开场自带炎魔1+暴怒1（暴怒：受伤时获得层数层力量，回合开始清零——打它越狠它越痛）。
// 一阶段四拍：攻3×2 → 攻3×3 → 攻15+暴怒1 → 防10。
// 转段：血量跌至 50 以下的行动拍——回血25+暴怒2，结束回合（嘶吼），进二阶段。
// 二阶段三拍：攻7×2+暴怒2 → 攻5×3+暴怒2 → 攻27+暴怒2。
// 2026-09-19 用户裁决（0918 马拉松 9 败数据）：全系攻击基础伤害 -3/段（多段每段同砍）
// 整体变弱，暴怒不动——保住「多段喂力量」的极化检定属性。
registerEnemy({
  difficulty: { base: 8, floorMin: 11, floorMax: 11 },
  id: 'kardas', name: '卡达斯',
  createUnit: () => new Enemy({ defId: 'kardas', name: '卡达斯', maxHp: 34 }), // 2026-09-21：+7 基础 ≈ 实战 +24（92→116）
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
    if (!unit._phase2 && unit.hp < 50) { // 转段拍：嘶吼（占拍演出）+ 回血25 + 暴怒2，不攻
      unit._phase2 = true; unit._phaseBeat = 0;
      // 转阶段演出走通用剧本闸口（fx 架构 ANIM_SCRIPT，同 pyro）：core 只报 id+标量参数
      actx.presenter?.playScript?.({ script: 'bosses/kardasP2', unit: unit.uniqueID });
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 25 }));
      rageUp(2);
      return;
    }
    if (!unit._phase2) {
      const beat = unit.actionIndex % 4;
      if (beat === 0) hit(2, 3);
      else if (beat === 1) hit(3, 3);
      else if (beat === 2) { hit(1, 15); rageUp(1); }
      else actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      return;
    }
    const beat = (unit._phaseBeat ?? 0) % 3;
    unit._phaseBeat = (unit._phaseBeat ?? 0) + 1;
    if (beat === 0) { hit(2, 7); rageUp(2); }
    else if (beat === 1) { hit(3, 5); rageUp(2); }
    else { hit(1, 27); rageUp(2); }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (!unit._phase2) {
      if (unit.hp < 50) return { kinds: ['buff'], note: '嘶吼：回复25血、暴怒2，进入二阶段' };
      const beat = unit.actionIndex % 4;
      if (beat === 0) return { kinds: ['attack'], hits: 2, damage: 3 + atk };
      if (beat === 1) return { kinds: ['attack'], hits: 3, damage: 3 + atk };
      if (beat === 2) return { kinds: ['attack', 'buff'], hits: 1, damage: 15 + atk, note: '暴怒1' };
      return { kinds: ['defend'], note: '自身护盾+10' };
    }
    const beat = (unit._phaseBeat ?? 0) % 3;
    if (beat === 0) return { kinds: ['attack', 'buff'], hits: 2, damage: 7 + atk, note: '暴怒2' };
    if (beat === 1) return { kinds: ['attack', 'buff'], hits: 3, damage: 5 + atk, note: '暴怒2' };
    return { kinds: ['attack', 'buff'], hits: 1, damage: 27 + atk, note: '撕碎：暴怒2' };
  },
});

// ②″ 11 层 Boss · MEFM-1（章1 火主题 Boss 池之一，2026-09-13 用户设计；
// lore 对应「警戒的无人战体」）。开场自带防御4+格挡2（铁壳：固定减伤 + 受攻击免伤；2026-09-20 后格挡免伤 25%）。
// 一阶段三拍：攻3×2 → 攻3×3 → 炎魔1+格挡1（积焰）。
// 转段：血量跌至 80 以下的行动拍——失去防御4，故障空转一拍，进二阶段。
// 二阶段：首拍获得炎魔2，随后 攻2×3 → 攻2×4 交替（积焰已久的点燃海）。
registerEnemy({
  difficulty: { base: 8, floorMin: 11, floorMax: 11 },
  id: 'mefm1', name: 'MEFM-1',
  createUnit: () => new Enemy({ defId: 'mefm1', name: 'MEFM-1', maxHp: 54 }), // 2026-09-21：+7 基础 ≈ 实战 +24（160→184）
  onBattleStart(ctx, unit) {
    // 铁壳（防御效果轨，P2 故障时失去——防御已效果化，不再直改字段）
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'defense', stacks: 4 }));
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
    if (!unit._phase2 && unit.hp < 80) { // 转段拍：铁壳剥落 + 故障空转（占拍演出）
      unit._phase2 = true; unit._phaseBeat = 0;
      // 转阶段演出走通用剧本闸口（fx 架构 ANIM_SCRIPT，同 pyro）
      actx.presenter?.playScript?.({ script: 'bosses/mefm1P2', unit: unit.uniqueID });
      // 失去防御4：防御已效果化（onBattleStart 走 AddEffectInstruction），剥壳 = 扣 4 层
      // （旧写法直改 unit.defense 字段——该字段已不存在，等于 NaN 赋值，2026-09-22 修）
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'defense', stacks: -4 }));
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
  difficulty: { base: 11, floorMin: 22, floorMax: 22 },
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
  difficulty: { base: 11, floorMin: 22, floorMax: 22 },
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
  difficulty: { base: 11, floorMin: 22, floorMax: 22 },
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
  difficulty: { base: 14, floorMin: 33, floorMax: 33 },
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

// ②‴ 44 层终塔 Boss · 神兵躯壳（孤身神机 · 三阶段 · 300 血 + 200 盾；2026-09-20 用户
// 设计稿，取代旧占位「塔心」）。本注释即设计定稿。
//
// 背景（wekyland 技术谱系）：古南圣国军事遗留的自律兵器，魏启驱动的造物。谱系三代——
//   MEFM-1（11 层）残次原型，铁壳积热、笨重带锈 →
//   完好的无人战体（33 层）量产成品，三灯状态机、智能经岁月严重错乱 →
//   **神兵躯壳**（44 层）塔顶封存的最上位机：装甲已换成灵脉驱壳（200 盾 + 如山），
//   智能只剩「程序」。它和无人战体是同一套技术，只是更先进——无人战体还带「警戒→
//   错乱→自爆」的智能残留，神兵躯壳的行为全是**协议**，直到协议本身烧穿。
//
// 定位（用户定）：数值碾压式终局——300 血 + 200 盾是**入场券**，需要攻防一体的大伤害
// 卡组正面碾过去。它每拍都在起盾，且「如山」在身（回合开始的清盾被否决）、盾只增不减，
// 靠 DOT 慢慢磨是下策：拖长只会越垒越厚。
//
// 【阶段一 · 协议完好】四拍循环（每轮 40 盾在记账）：
//   【直觉】盾40 + 攻20 → 【蓄能】锁定你**最先抽到的三张牌**（牌库顶三张，抽到手即带标、
//   你的回合结束时仍在手则焚毁）+ 5×5 → 【光能炮】攻50 →
//   【错误重启】力量4（此后每一拍都带着 +4，第二循环起压力翻倍）。
// 【转阶段① · 盾碎】第一次被打穿 → **马上**净化自身全部效果 + 凝滞1（无人战体同款：
//   先净化后冻结——此前堆的 DOT 一并清空，冻结期间玩家剩余输出打不动它；如山随之剥落，
//   此后的盾按常规在它回合开始清空）。
// 【阶段二 · 战术失控】首拍【回忆】往你牌库**洗入 7 张【躲闪】**（1AP 消耗，令它下次
//   扫射段数 -2）——设计给玩家的解题件。扫射是**段数伤害**（护盾按段分摊），单发大盾
//   吃得下，要命的是段数，所以答案不在「更厚的盾」而在「按段拆」；同一张卡也是污染
//   （7 张稀释牌库、打出即焚），答案自带代价。此后是固定序列（不循环，走到头就重复尾拍）：
//   【羽翼扫射】10×5 + 盾15 → 【腾空】闪避3 + 盾30 → 【羽翼风暴】10×8 → 【轰落】攻65
//   → 【怜悯】净化自身全部效果后**空过一拍**（唯一的白给窗，也是它甩掉 DOT 的机会）；
//   此后若仍未进第三阶段，就一直重复【处决扫射】14×4 **穿透**（防御/护盾/格挡都不减免）
//   ——拖到这一步，答案只剩下「在这之前打死它」。**【过热自保】（2026-09-21 用户设计，
//   穿透反制）**：这一拍结算前先看它**本回合受到的生命值伤害**（没穿盾的不算），>90 就取消
//   扫射、改起盾 50（意图当场翻成防御并写明口径）——大回合即免伤，把"穿透无解"改回
//   "输出换生存"的交换。
// 【转阶段② · 将被击杀】致死伤害被拦截（无人战体同款范式：改判保留 1 血）+ 净化 + 凝滞1
//   → 进第三阶段。凝滞冻结生命/护盾/效果的一切变更，所以那 1 血在它的下一拍之前打不掉。
// 【阶段三 · 过载自焚】首拍【过载重启】**回满生命值**、空过一拍（此形态不再加盾，也不再
//   有死亡拦截）——玩家此前打掉的 300 血在这一刻被抹掉，真正的终局从这里开始，也是它
//   最后一次重启。此后：【高热】焚毁你全部手牌 + 14×4 扫射 → 【自焚】全场燃烧25 + 25×3
//   扫射 → 【停顿】自扣50血 → 循环【爆发】全场燃烧30 + 攻100。
//   燃烧打在它自己身上（「全场」含它自己），叠上【停顿】的自伤，就是设计好的败亡曲线：
//   终局胜负手从「抢伤害」变成「活着看它烧完自己」——但它每拍 100 伤 + 全场燃烧，
//   想活着看完同样要命（坦度与回复是这一战的第二道门）。
//
// 读数口径：伤害一律「基数 + unit.attack」（F1 同源算式），故力量4 计入后续每一拍；
// getIntention 用同一算式预告（所见即所算），且预告已含**弹道干扰**的段数减免
// （躲闪打进几层，预告就少几段——段数清零时预告改示「本拍不发射」）。
// 神兵的「净化」= 移除自身全部效果（与无人战体盾碎净化同口径，逐条负向 AddEffect 走指令层）。
// 【过热自保】阈值：阶段二【处决扫射】14×4 穿透是全场最硬的一拍（护盾与格挡都不减免——
// 格挡链整链不参与穿透，2026-09-21 口径统一，见 effects.js 的 block），
// 本回合被灌进 >90 点伤害 → 取消这次扫射、改起盾 50（玩家回合的意图预告同步翻成防御）。
const SHELL_OVERHEAT = 90;

const purgeEffectInstructions = (unit) => [...unit.effects].map((e) => new AddEffectInstruction({
  target: unit, effectId: e.effectId, stacks: -e.stacks,
}));

registerEnemy({
  // elite:true 仅借「锚点=base」的缩放语义（章4 Boss 难度18 → hpMult=1），让 300 血
  // 精确落地；floorMin/Max=44 + BOSS_IDS 排除保证它不进任何精英/通配取材池。
  difficulty: { base: 18, floorMin: 44, floorMax: 44, elite: true },
  id: 'divineShell', name: '神兵躯壳',
  createUnit: () => new Enemy({ defId: 'divineShell', name: '神兵躯壳', maxHp: 300 }),
  onBattleStart(ctx, unit) {
    unit.shield += 200; // 灵脉护壳（如山存续）：只增不减，必须真打穿
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'mountain', stacks: 1 }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'pure', stacks: 3 }));
    const owner = `enemy:${unit.uniqueID}:divineShell`;
    attachPressureCounter(ctx.kernel, unit, owner); // 【过热自保】：阶段二穿透拍的受压反制（见 SHELL_OVERHEAT）
    // 盾碎检测（POST：伤害已结算）：第一次被打穿 → 净化全部效果 + 凝滞1 + 就地翻阶段
    //（阶段号与节拍一起改写——它的下一拍就是阶段二的【回忆】，玩家的意图预告同步翻新）。
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === unit
        && (unit._phase ?? 1) === 1
        && (instr.result?.shieldAbsorbed ?? 0) > 0 && unit.shield <= 0,
      react: (instr, c) => {
        unit._phase = 2;
        unit._beat = 0;
        for (const i of purgeEffectInstructions(unit)) c.kernel.submitInstruction(i, instr);
        c.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'stasis', stacks: 1 }), instr);
      },
    });
    // 死亡拦截（PRE，priority 压到修饰者之后——_collect 契约）：第一次致死伤害改判
    // 「保留 1 血 + 净化 + 凝滞1」并进第三阶段。补刀是附级固定伤害（系统结算，不触发
    // 任何响应）；凝滞必须排在最后——顺序反了冻结会挡下自己的净化与改判。
    // ⚠ 铁律（BattleKernel.preview 契约，2026-09-21 实战抓出）：PRE 反应里**禁止直改状态**
    //   —— 卡面/描述的干跑会完整跑一遍 PRE 管线，直接写 unit._phase 会从干跑泄漏到真实
    //   单位上。实战症状：Boss 只剩 91 血时，卡面预览了一发 115 伤的【摧山斩】，预览的
    //   致死判定成立 → 阶段号被写成 3，而 1 血/凝滞（走 veto 替补、干跑中被丢弃）一个都
    //   没落地。所以阶段号改写改挂**替补伤害的 POST**（干跑不跑 POST）。
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'pre', priority: -100, owner,
      // 同批次第二发致死不需要额外门槛：替补批次里紧跟着的凝滞会先把后续伤害 veto 掉
      // （_collect 按 priority 降序，凝滞优先级 0 高于本反应 -100）。
      filter: (instr) => instr.target === unit && (unit._phase ?? 1) === 2,
      react: (instr, c) => {
        if (!wouldBeLethal(instr, unit)) return;
        c.kernel.veto(instr, 'divineShellOverdrive', [
          ...purgeEffectInstructions(unit),
          new DealDamageInstruction({
            source: instr.source, target: unit,
            amount: Math.max(unit.hp - 1, 0) + unit.shield,
            fixed: true, tags: ['divineShellOverdrive'], type: 'minor',
          }),
          new AddEffectInstruction({ target: unit, effectId: 'stasis', stacks: 1 }),
        ]);
      },
    });
    // 替补伤害真落地 = 改判成立 → 此刻才翻阶段（POST；干跑不会走到这里）
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === unit && instr.tags?.includes('divineShellOverdrive'),
      react: () => { unit._phase = 3; unit._beat = 0; },
    });
    // 锁定结算：【蓄能】锁的是**牌库顶三张**（你最先抽到的牌），所以标要活到那几张牌
    // 抽进手里为止——本轮只结算「已在手」的锁定卡（回合末仍在手则焚毁），牌库里的标
    // 留给下一拍继续等；手牌/焚毁/待结算区的标随本轮清掉（离手即免除）。
    ctx.kernel.addSubscription({
      when: PlayerTurnEndInstruction, phase: 'post', owner,
      filter: () => !unit.isDead(),
      react: (instr, c) => {
        for (const card of [...c.battleState.zones.hand]) {
          if (card.locked && zoneOf(c.battleState, card.uniqueID) === 'hand') {
            c.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: card.uniqueID }), instr);
          }
        }
        for (const zone of ['hand', 'burnt', 'pending']) {
          for (const card of c.battleState.zones[zone]) card.locked = false;
        }
      },
    });
  },
  act(actx) {
    const { unit, player, battleState: bs } = actx;
    const atk = unit.getStat('attack');
    const phase = unit._phase ?? 1;
    const beat = unit._beat ?? 0;
    unit._beat = beat + 1;

    const hit = (dmg, pierce = false) => actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: dmg + atk, pierce }));
    // 扫射 = 段数伤害。弹道干扰整量消耗：本次段数 = 基数 − 2×干扰层数（最低 0 段）。
    const jam = unit.getEffectStacks('scatterJam');
    const scatter = (baseHits, dmg, pierce = false) => {
      if (jam > 0) actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'scatterJam', stacks: -jam }));
      const hits = Math.max(0, baseHits - 2 * jam);
      for (let i = 0; i < hits; i++) hit(dmg, pierce);
    };
    // 全场燃烧（含它自己——自焚是它自己的败亡曲线，玩家能做的只是活到那一刻）
    const burnAll = (stacks) => {
      for (const u of allAliveUnits(bs, player)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: u, effectId: 'burn', stacks }));
      }
    };

    // ---- 阶段一 · 协议完好（四拍循环）----
    if (phase === 1) {
      const b = beat % 4;
      if (b === 0) {
        // 【直觉】盾40 + 攻20
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 40 }));
        hit(20);
      } else if (b === 1) {
        // 【蓄能】锁定你最先抽到的三张牌（牌库顶三张）+ 5×5
        const top = bs.zones.deck.slice(0, 3);
        if (top.length > 0) {
          actx.kernel.submitInstruction(new LockCardsInstruction({
            uniqueIDs: top.map((c) => c.uniqueID) }));
        }
        for (let i = 0; i < 5; i++) hit(5);
      } else if (b === 2) {
        hit(50); // 【光能炮】
      } else {
        // 【错误重启】力量4
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks: 4 }));
      }
      return;
    }

    // ---- 阶段二 · 战术失控（首拍回忆，此后固定序列，走到头重复处决扫射）----
    if (phase === 2) {
      if (beat === 0) {
        // 【回忆】洗入 7 张躲闪（随机插入牌库——不是牌库顶，得自己找）
        for (let i = 0; i < 7; i++) {
          actx.kernel.submitInstruction(new AddCardInstruction({
            defId: 'sidestep', toZone: 'deck', index: 'random' }));
        }
      } else if (beat === 1) {
        scatter(5, 10); // 【羽翼扫射】
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 15 }));
      } else if (beat === 2) {
        // 【腾空】闪避3 + 盾30（单发大额被吃一发；多段流只被吃一段）
        actx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: 3 }));
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 30 }));
      } else if (beat === 3) {
        scatter(8, 10); // 【羽翼风暴】
      } else if (beat === 4) {
        hit(65); // 【轰落】
      } else if (beat === 5) {
        // 【怜悯】净化自身全部效果，本拍不攻击（唯一的白给窗）
        for (const i of purgeEffectInstructions(unit)) actx.kernel.submitInstruction(i);
      } else {
        // 【处决扫射】14×4 穿透；【过热自保】（2026-09-21 用户设计）：本回合被灌进
        // >90 点伤害 → 取消这次扫射、改起盾 50（意图同步改成防御）。穿透不吃护盾，
        // 是这条线最没得选的一拍，阈值反制给"能打出大回合"的牌组留一条活路。
        if ((unit._pressure ?? 0) > SHELL_OVERHEAT) {
          actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 50 }));
          return;
        }
        scatter(4, 14, true); // 【处决扫射】14×4 穿透
      }
      return;
    }

    // ---- 阶段三 · 过载自焚 ----
    if (beat === 0) {
      // 【过载重启】回满生命值、空过一拍；此形态不再加盾
      if (unit.hp < unit.maxHp) {
        actx.kernel.submitInstruction(new ApplyHealInstruction({
          target: unit, amount: unit.maxHp - unit.hp }));
      }
      return;
    }
    if (beat === 1) {
      // 【高热】焚毁你全部手牌 + 14×4 扫射
      for (const card of [...bs.zones.hand]) {
        actx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: card.uniqueID }));
      }
      scatter(4, 14);
      return;
    }
    if (beat === 2) {
      // 【自焚】全场燃烧25 + 25×3 扫射
      burnAll(25);
      scatter(3, 25);
      return;
    }
    if (beat === 3) {
      // 【停顿】自扣50血（穿透：不吃自己的防御/护盾/格挡）
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: unit, amount: 50, pierce: true, tags: ['overheatPause'] }));
      return;
    }
    // 【爆发】全场燃烧30 + 攻100（循环到此为止：不结束战斗就一直爆发）
    burnAll(30);
    hit(100);
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit._phase ?? 1;
    const beat = unit._beat ?? 0;
    const jam = unit.getEffectStacks('scatterJam'); // 预告与实际同口径：躲闪的段数减免照算
    const scatterPreview = (base, dmg, note, kinds = ['attack']) => {
      const hits = Math.max(0, base - 2 * jam);
      return hits <= 0
        ? { kinds: ['defend'], note: `${note}：段数已被【躲闪】清零` }
        : { kinds, hits, damage: dmg + atk, note };
    };
    if (phase === 1) {
      const b = beat % 4;
      if (b === 0) return { kinds: ['defend', 'attack'], hits: 1, damage: 20 + atk, note: '直觉：自身护盾+40' };
      if (b === 1) return { kinds: ['attack', 'debuff'], hits: 5, damage: 5 + atk, note: '蓄能：锁定你最先抽到的3张牌（回合结束时仍在手则焚毁）' };
      if (b === 2) return { kinds: ['attack'], hits: 1, damage: 50 + atk, note: '光能炮' };
      return { kinds: ['buff'], note: '错误重启：力量+4' };
    }
    if (phase === 2) {
      if (beat === 0) return { kinds: ['debuff'], note: '回忆：向你牌库洗入7张【躲闪】' };
      if (beat === 1) return scatterPreview(5, 10, '羽翼扫射：自身护盾+15', ['attack', 'defend']);
      if (beat === 2) return { kinds: ['defend', 'buff'], note: '腾空：闪避+3，自身护盾+30' };
      if (beat === 3) return scatterPreview(8, 10, '羽翼风暴');
      if (beat === 4) return { kinds: ['attack'], hits: 1, damage: 65 + atk, note: '轰落' };
      if (beat === 5) return { kinds: ['buff'], note: '怜悯：净化自身全部效果，本拍不攻击' };
      if ((unit._pressure ?? 0) > SHELL_OVERHEAT) {
        return { kinds: ['defend'], note: `过热自保：本回合生命值伤害已超 ${SHELL_OVERHEAT}，取消扫射，自身护盾+50` };
      }
      return scatterPreview(4, 14, `处决扫射：穿透伤害（本回合生命值伤害 >${SHELL_OVERHEAT} 则改为起盾 50）`);
    }
    if (beat === 0) return { kinds: ['buff'], note: '过载重启：回满生命值（此形态不再加盾）' };
    if (beat === 1) return scatterPreview(4, 14, '高热：焚毁你的全部手牌', ['attack', 'debuff']);
    if (beat === 2) return scatterPreview(3, 25, '自焚：全场燃烧+25', ['attack', 'debuff']);
    if (beat === 3) return { kinds: ['unknown'], note: '停顿：自身失去50生命' };
    return { kinds: ['attack', 'debuff'], hits: 1, damage: 100 + atk, note: '爆发：全场燃烧+30' };
  },
});

// 【过热自保】阈值：红灯① 【锁定要害，清除】穿透35 是它最硬的一拍（防御/护盾都不减免），
// 本回合被灌进 >50 点伤害 → 取消开火、改起盾 50（玩家回合的意图预告同步翻成防御）。
const DRONE_OVERHEAT = 50;

// ⑤″ 33 层 Boss · 完好的无人战体（章3 Boss 池之二，2026-09-14 用户设计；原型参考
// wekyland「无人战体」词条：古南圣国军事遗留的自律战斗机器，「完好的」= 装备无损的
// 个体——灰烬装甲可用、拟态基质未失活，所以它带着 150 初始盾与「如山+纯净」的完好
// 协议出场；指示灯「警戒模式由绿转黄」、智能「经漫长岁月往往严重错乱」= 三灯状态机）。
//   绿灯（第 1 拍）【徘徊】：不行动——白给玩家一拍，代价是 150 盾（如山存续）横在面前；
//   黄灯（第 2 拍起三拍循环）：解除威胁（盾15+攻10+锁定手中3张）→ 劝诫（盾30）→
//     解除威胁'（攻10+焚牌库顶2）。盾逐轮累积不清（如山），玩家迟早打穿——破盾越快，
//     黄灯期越短（少挨锁定/焚库）；
//   红灯（转阶段后三拍循环）：锁定要害，清除（穿透35+自身格挡1）→ 反反反反制
//     （锁定全部手牌+5×7）→ 重启....失失失失败（空转）。**【过热自保】（2026-09-21 用户
//     设计，穿透反制）**：穿透那一拍结算前先看它**本回合受到的生命值伤害**（没穿盾的不算），
//     >50 就取消开火、改起盾 50（意图当场翻成防御并写明口径）。
// 转阶段：盾第一次被打穿 → **马上**净化自身全部效果 + 凝滞1（先净化后冻结——转阶段
//   前堆上的 DOT 一并清空，不会在净化之前再吃一口 tick；一切状态无法变更，破盾那回合
//   玩家的剩余输出打不动冻结的机器）→ 其回合开始凝滞解除，行动拍播【系统统统错误，
//   最终预案启动】：盾50，转红灯。
// 死亡协议：第一次致死伤害被拦截（塞西莉亚之恩赐同款范式：改判保留 1 血 + 无敌）——
//   宕机锁死；下一行动拍【错错错误】自爆：对玩家 20 伤 + 拆地板自杀。它永远以自爆收场。
registerEnemy({
  // elite:true 仅借「锚点=base」的缩放语义（章3 Boss 难度14 → hpMult=1），让 100 血
  // 精确落地；floorMin/Max=33 + BOSS_IDS 排除保证它不进任何精英/通配取材池。
  difficulty: { base: 14, floorMin: 33, floorMax: 33, elite: true },
  id: 'intactDrone', name: '完好的无人战体',
  createUnit: () => new Enemy({ defId: 'intactDrone', name: '完好的无人战体', maxHp: 100 }),
  onBattleStart(ctx, unit) {
    unit.shield += 150; // 灰烬装甲（完好无损）——如山存续，必须真打穿
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'mountain', stacks: 1 }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({ target: unit, effectId: 'pure', stacks: 4 }));
    const owner = `enemy:${unit.uniqueID}:drone`;
    attachPressureCounter(ctx.kernel, unit, owner); // 【过热自保】：红灯穿透拍的受压反制（见 DRONE_OVERHEAT）
    // 盾碎检测（POST：伤害已结算）：第一次被打穿 → 马上净化全部效果 + 凝滞1 + 排转阶段
    //（净化在前：转阶段前堆上的 DOT 一并清空，冻结前不留账；如山在场，盾只会因伤害
    // 归零——回合开始的例行清盾被 veto——不会误触发）。挂应用原语 POST（2026-09-15
    // 拆分：盾在受击结算处碎，不筛主/附级——毒磨穿的盾也是碎盾）。
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === unit
        && !unit._stasisArmed && !unit._phase2
        && (instr.result?.shieldAbsorbed ?? 0) > 0 && unit.shield <= 0,
      react: (instr, c) => {
        unit._stasisArmed = true;
        unit._phase2Pending = true;
        for (const e of [...unit.effects]) {
          c.kernel.submitInstruction(new AddEffectInstruction({
            target: unit, effectId: e.effectId, stacks: -e.stacks }), instr);
        }
        c.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'stasis', stacks: 1 }), instr);
      },
    });
    // 死亡协议拦截（致命判定写在 react、priority 压到修饰者之后——_collect 契约）：
    // 第一次致死伤害 veto 并改判「保留 1 血 + 无敌」，进入自爆倒计时。
    // 挂**应用原语 PRE**（2026-09-15 拆分：免死类拦截不关心伤害出自什么原因，
    // 不筛主/附级）；改判的补刀伤害是附级（系统结算，不触发任何响应）。
    // ⚠ 2026-09-21（神兵躯壳同款 bug 排查时抓出）：`unit._detonated = true` 原来写在 PRE 里，
    //   而 BattleKernel.preview 契约明确「PRE 里直改状态会在干跑中泄漏」——卡面/描述预览一发
    //   致死级伤害就会把这台机器的死亡协议提前作废（真打死时不再改判 1 血、不再自爆）。
    //   改判标志移挂**替补伤害的 POST**（干跑不跑 POST）；同批次第二发致死由替补批次里的
    //   无敌/凝滞先一步 veto（无敌/凝滞优先级高于本反应）。
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'pre', priority: -100, owner,
      filter: (instr) => instr.target === unit && !unit._detonated,
      react: (instr, c) => {
        if (!wouldBeLethal(instr, unit)) return;
        c.kernel.veto(instr, 'droneLockdown', [
          new DealDamageInstruction({
            source: instr.source, target: unit,
            amount: Math.max(unit.hp - 1, 0) + unit.shield,
            fixed: true, tags: ['droneLockdown'], type: 'minor',
          }),
          new AddEffectInstruction({ target: unit, effectId: 'invulnerable', stacks: 1 }),
        ]);
      },
    });
    // 替补伤害真落地 = 改判成立 → 此刻才进自爆倒计时（POST；干跑不会走到这里）
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post', owner,
      filter: (instr) => instr.target === unit && instr.tags?.includes('droneLockdown'),
      react: () => { unit._detonated = true; },
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

    // 【系统统统错误，最终预案启动】转阶段拍（净化已在碎盾瞬间完成，凝滞已在回合开始
    // 解除）：盾50，转红灯
    if (unit._phase2Pending) {
      unit._phase2Pending = false;
      unit._phase2 = true;
      unit._redBeat = 0;
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
      // 【锁定要害，清除】穿透35（奇异射线：防御、护盾、格挡都不减免）+ 自身格挡1。
      // 【过热自保】（2026-09-21 用户设计）：本回合被灌进 >50 点伤害 → **取消开火**，
      // 改起盾 50（意图同步改成防御）。穿透不吃防御/护盾/格挡，是玩家最没得选的一拍——
      // 这条给"打得出大回合"的牌组一个明确反制：压过阈值，这一拍就不挨枪。
      if ((unit._pressure ?? 0) > DRONE_OVERHEAT) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 50 }));
        return;
      }
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
    if (beat === 0) return (unit._pressure ?? 0) > DRONE_OVERHEAT
      ? { kinds: ['defend'], note: `过热自保：本回合生命值伤害已超 ${DRONE_OVERHEAT}，取消开火，自身护盾+50` }
      : { kinds: ['attack'], hits: 1, damage: 35 + atk, note: `锁定要害，清除：穿透伤害，自身格挡+1（本回合生命值伤害 >${DRONE_OVERHEAT} 则改为起盾 50）` };
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
  difficulty: { base: 14, floorMin: 33, floorMax: 33, elite: true },
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
  difficulty: { base: 14, floorMin: 33, floorMax: 33, elite: true },
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
