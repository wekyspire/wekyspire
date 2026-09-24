// 章4 小怪（图书馆，34~44 层普通池；含族A 玻璃连炮 / 族B 巨兽渐强 / 族C 机制反制三族）。
// 拆分自原 content/enemies.js（2026-09-24，内容零改动）。

import Enemy from '../../state/enemy.js';
import { registerEnemy } from '../../enemies/registry.js';
import { getEffectDefinition } from '../../effects/registry.js';
import { AddCardInstruction, MoveCardInstruction } from '../../instructions/cards.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { aliveEnemies } from '../../state/battleState.js';

// ㉓ 禁书守卫（章4·终章防线锚）——攻10 → 全体友军盾12 → 攻14 三拍循环。
// 宫廷守卫的终章上位：数值跨档 + 自身 3 防御面板，群体盾更厚。
registerEnemy({
  difficulty: { base: 8, floorMin: 34, floorMax: 43 },
  id: 'tomeWarden', name: '禁书守卫',
  createUnit: () => new Enemy({ defId: 'tomeWarden', name: '禁书守卫', maxHp: 40, defense: 3 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 1) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 16 })); // 数值意识（2026-09-16）：12→16（章4 输出 60-100+）
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
  difficulty: { base: 5, floorMin: 34, floorMax: 43 },
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

// ㉗ 掸尘者（章4·DoT 反制件：拂尘）——拂尘（净化全体友军的中毒与燃烧）→ 攻10 → 自盾8
// 三拍循环。终章给叠毒/燃烧体系的一道反考题：毒火囤不起来，输出窗被切成三拍一段——
// 要么先杀它（20 血的脆皮优先目标），要么掐着拂尘拍结算爆发。对物理/直伤体系它只是
// 个弱攻击手（拂尘拍空转），考题只点名 DoT 构筑。主教（Boss）的燃烧净化是它的原型，
// 这只连中毒一起拂。
registerEnemy({
  difficulty: { base: 7, floorMin: 34, floorMax: 43 },
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
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 12 })); // 数值意识（2026-09-16）：8→12
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
  difficulty: { base: 4, floorMin: 34, floorMax: 43 },
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
  difficulty: { base: 6, floorMin: 34, floorMax: 43 },
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
  difficulty: { base: 4, floorMin: 34, floorMax: 43 },
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
  difficulty: { base: 12, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 10, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 11, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 8, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 7, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 7, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 8, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 5, floorMin: 36, floorMax: 43 },
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
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 16 })); // 数值意识（2026-09-16）：10→16
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
  difficulty: { base: 5, floorMin: 36, floorMax: 43 },
  id: 'riteAltar', name: '仪典祭坛',
  createUnit: () => new Enemy({ defId: 'riteAltar', name: '仪典祭坛', maxHp: 26 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex % 2 === 0) {
      for (const e of aliveEnemies(actx.battleState)) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'strength', stacks: 2 }));
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: e, amount: 12 })); // 数值意识（2026-09-16）：8→12 / 14→18
      }
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 18 }));
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
  difficulty: { base: 8, floorMin: 36, floorMax: 43 },
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
  difficulty: { base: 9, floorMin: 36, floorMax: 43 },
  id: 'repeaterBallista', name: '连环弩台',
  createUnit: () => new Enemy({ defId: 'repeaterBallista', name: '连环弩台', maxHp: 22 }),
  act(actx) {
    const { unit } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 16 })); // 数值意识（2026-09-16）：10→16（章4 输出 60-100+）
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
  difficulty: { base: 8, floorMin: 36, floorMax: 43 },
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
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 10 })); // 数值意识（2026-09-16）：6→10
    }
  },
  getIntention: (unit) => {
    if (unit.actionIndex === 0) return { kinds: ['debuff'], note: '装订：4张活页塞入你的牌库顶' };
    return (unit.actionIndex - 1) % 2 === 0
      ? { kinds: ['attack'], hits: 1, damage: 11 + unit.getStat('attack'), note: '缠绕' }
      : { kinds: ['buff'], note: '蜕皮：自愈6' };
  },
});
