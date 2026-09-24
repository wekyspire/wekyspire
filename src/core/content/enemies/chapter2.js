// 章2 小怪（宫殿，12~22 层普通池）。拆分自原 content/enemies.js（2026-09-24，内容零改动）。

import Enemy from '../../state/enemy.js';
import { registerEnemy, getEnemyDefinition } from '../../enemies/registry.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { UnitSpawnInstruction } from '../../instructions/units.js';
import { aliveEnemies } from '../../state/battleState.js';

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
  difficulty: { base: 5, floorMin: 12, floorMax: 30 },
  id: 'bigSlime', name: '大史莱姆',
  createUnit: () => new Enemy({ defId: 'bigSlime', name: '大史莱姆', maxHp: 34 }), // 2026-09-21 用户定：44→34（二章坦克削血提攻）
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
    // 2026-09-21 用户定（二章坦克削血提攻）：攻击 10→13、自盾 8→4——从「打不动的肉桩」
    // 改成「打得动但锤人疼」。
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: 13 + unit.getStat('attack'),
    }));
    actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 4 }));
  },
  getIntention: (unit, battleState) => (bigSlimeCanSummon(unit, battleState, battleState.turn.count + 1)
    ? { kinds: ['summon'], note: '召唤史莱姆' }
    : { kinds: ['attack', 'defend'], hits: 1, damage: 13 + unit.getStat('attack'), note: '自身护盾+4' }),
});

// ④ 暗影刺客：蓄势滚雪球——攻 → 蓄势+2（每层攻击+1）→ 突袭（高基数），
// 拖久了威胁线性上升，逼玩家集火或速杀
registerEnemy({
  difficulty: { base: 4, floorMin: 12, floorMax: 32 },
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

// ⑦ 夜蝠：汲血（攻击并自愈）×2 → 尖啸（滞气1：玩家下回合无法抽牌）
// 滞气尖啸是节奏型威胁——被叫到的回合要么硬打要么吃伤害
registerEnemy({
  difficulty: { base: 3, floorMin: 12, floorMax: 34 },
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

// ============ 第二~四章补池（2026-09-13 总策划批次，设计稿 tmp/design-monsters-wave1.mjs）============
// 断档诊断：章2 新敌仅 4 只、章3 仅 2 只、章4 为 0，精英只有章1两只——「粪怪堆积」的
// 根因是池子厚度而非单怪设计。本波按场景配方主题补池：章2=宫殿 / 章3=衰败庄园 / 章4=大图书馆。

// ⑱ 宫廷守卫（章2·阵型谜题：全体友军护盾）——「先杀支援还是顶着群体盾硬打输出手」的
// 目标优先级考题。与腐苔球（奶轴支援）错开：它是盾轴支援，护盾会被回合清零（T2），
// 所以必须每两拍重新举盾——它的存活本身就是对面防线的续航。
registerEnemy({
  difficulty: { base: 5, floorMin: 12, floorMax: 24 },
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
  difficulty: { base: 4, floorMin: 12, floorMax: 22 },
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
  difficulty: { base: 5, floorMin: 14, floorMax: 26 },
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

// ============ 体系镜像补池（2026-09-14，木/空卡牌体系落地后的敌方生态）============
// 三只各填一个主题空位：章2 起敌方无毒（叠毒体系无镜像）、章3 起敌方无闪避（御风体系
// 无镜像）、章4 无针对 DoT 的反制件（终章叠毒/燃烧无考题）。各考一道与玩家体系同源的题。

// ㉕ 瘴气菇（章2·叠毒镜像：渐浓毒雾）——孢子云（中毒，每次更浓：2,3,4…）→ 攻6 → 攻6
// 三拍循环。玩家的叠毒是平方收束，它的毒雾也是：拖得越久，每次喷毒越重——把「毒叠起来
// 有多可怕」先在玩家身上演一遍。本身零防脆菇，速杀即无毒；与宫廷守卫同场时「先杀谁」
// 是真问题（盾轴保毒轴）。对标：沼泽伏击者（精英）一口毒5，它常规杂兵 2 起步渐浓。
registerEnemy({
  difficulty: { base: 4, floorMin: 12, floorMax: 26 },
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
