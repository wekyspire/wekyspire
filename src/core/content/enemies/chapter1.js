// 章1 小怪（要塞外围，1~11 层普通池；按 2026-09 难度制出没区间标注在各自 difficulty）。
// 拆分自原 content/enemies.js（2026-09-24，按「章小怪/精英/Boss」三分类；内容零改动）。

import Enemy from '../../state/enemy.js';
import { registerEnemy } from '../../enemies/registry.js';
import { registerSkill } from '../../skills/registry.js';
import { AddCardInstruction, DrawCardsInstruction, BurnCardInstruction } from '../../instructions/cards.js';
import { DealDamageInstruction, ApplyDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { aliveEnemies } from '../../state/battleState.js';

// ① 固定行动序列杂鱼：攻 6 → 盾 4 循环
registerEnemy({
  id: 'slime', name: '史莱姆',
  difficulty: { base: 2, floorMin: 1, floorMax: 14 },
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

// ③ 针鼠：**首拍竖刺（荆棘3，一次性）**，此后「攻3+护盾8 ↔ 攻6」两拍往复。
// 2026-09 用户改稿：旧版每两拍叠一次荆棘（越拖越痛），实质是在奖励速杀；改后荆棘只在开场
// 上一次，长线战斗不再变本加厉——速攻的唯一优势只剩「第一拍就秒掉它」从而完全避开荆棘。
registerEnemy({
  difficulty: { base: 2, floorMin: 1, floorMax: 16 },
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

// ⑤ 怨灵：攻6 → 咒（虚弱2：玩家攻击-2）→ 攻8 三拍循环——削弱玩家的输出轴，
// 长线磨损。2026-09 稿改三拍（旧两拍版每两回合一虚，玩家直接萎了——超模）。
// unique：每场至多一只——虚弱不衰减，双怨灵会把永久 -4 攻击叠到前期无法翻盘；
// 血量 22→18 同步削弱（试玩反馈：前期压力过高）。
registerEnemy({
  difficulty: { base: 3, floorMin: 2, floorMax: 18 },
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

// ⑩ 小史莱姆（前期微威胁杂兵，2026-09 难度制）：塞粘液 ↔ 攻3 两拍循环。
// 粘液 = 1AP 抽1 消耗的淤积牌（比震慑温和：能打出换手，但吃 AP、占牌库）。
// 只经 AddCard 入场，不入奖励池。
registerSkill({
  id: 'gooCard', name: '粘液', type: 'normal', tier: 'C', series: 'enemyJunk',
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
  difficulty: { base: 1, floorMin: 2, floorMax: 16 },
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
  difficulty: { base: 1, floorMin: 2, floorMax: 16 },
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

// ============ 第一章补充敌人（2026-09，设计卡见 battle_gameplay/ENEMIES_1.md §5）============
// 四只各填一个机制空位（支援 / 预告重击 / 亡语 / 蛰伏），互不重叠，都不引入新资源轴。

// ⑬ 腐苔球（2026-09-14 章1「塔基爆发」改版）：**腐烂蔓延**——活着就在收拢你的手牌
// 空间（紧勒，EFFECTS.md 目录定义的实装首用）：每拍玩家紧勒+1（手牌上限 -1，效果
// 轨可见），奇数拍小攻、偶数拍自愈；**枯萎（死亡）时归还自己施加的全部层数**——
// 绑怪生命周期的教学化口径：杀了就松手。上限实际扣减直改 player.maxHandSize
// （战斗内有效；战后 refreshRunModifiers 从 baseStats 重算自动恢复），下限 2 不锁死。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'mossBall', name: '腐苔球',
  createUnit: () => new Enemy({ defId: 'mossBall', name: '腐苔球', maxHp: 14 }),
  act(actx) {
    const { unit, player } = actx;
    unit._grip = (unit._grip ?? 0) + 1;
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: player, effectId: 'constrict', stacks: 1 }));
    player.maxHandSize = Math.max(2, (player.maxHandSize ?? 5) - 1);
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
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'pufferToad', name: '鼓腹蟾',
  createUnit: () => new Enemy({ defId: 'pufferToad', name: '鼓腹蟾', maxHp: 20 }),
  onBattleStart(ctx, unit) {
    // 受击响应挂应用原语 POST + 只认主级（2026-09-15 拆分）：「被攻击膨胀」——
    // 附级伤害（玩家荆棘反伤/毒 tick）不喂膨胀（此前 filter 只查 source 非空，
    // 荆棘反伤 source=敌方 unit，会白喂膨胀=同族病灶，本次顺手修正）。
    ctx.kernel.addSubscription({
      when: ApplyDamageInstruction, phase: 'post',
      owner: `enemy:${unit.uniqueID}:inflate`,
      filter: (instr) => instr.target === unit && instr.source
        && instr.type === 'major' && !unit.isDead(),
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
  difficulty: { base: 1, floorMin: 2, floorMax: 16 },
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
  difficulty: { base: 3, floorMin: 4, floorMax: 16 },
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
  difficulty: { base: 3, floorMin: 4, floorMax: 16 },
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

// ⑰ 刺刺草（wiki：F·木「茎秆布满尖刺」「刺尖含麻痹毒素」「缓慢蠕动」）：低层 DoT
// 教学件——藤鞭 4+中毒1 ↔ 扎根自盾4 两拍循环；血薄（12），是「带不带解毒素」的
// 第一道分岔题。
registerEnemy({
  difficulty: { base: 2, floorMin: 3, floorMax: 14 },
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
  difficulty: { base: 1, floorMin: 3, floorMax: 14 },
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
  difficulty: { base: 3, floorMin: 5, floorMax: 16 },
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
  difficulty: { base: 2, floorMin: 4, floorMax: 12 },
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
