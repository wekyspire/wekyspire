// 章1 小怪（首个 Boss 前 · 第 1–10 层普通池）。
// 2026-09-22 用户全量重写 ENEMIES_1.md：v2 固定数值（面板即所见），主题战编成见
// floorEnemyGenerator.js；效果定义一律以 battle_gameplay/skills/EFFECTS.md 为准。

import Enemy from '../../state/enemy.js';
import { registerEnemy } from '../../enemies/registry.js';
import { registerSkill } from '../../skills/registry.js';
import { AddCardInstruction, DrawCardsInstruction, BurnCardInstruction } from '../../instructions/cards.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';
import { EnemyTurnStartInstruction } from '../../instructions/turn.js';
import { aliveEnemies } from '../../state/battleState.js';

// ---- 复苏组件（腐败根须/树心/刺刺草「春风」共用）----
// onDeath 记账（剩余次数 + 倒计时 2），敌方回合开始时 tick——倒计时归零即复活。
// 时序：玩家回合 N 击杀 → 敌回合 N（2→1）→ 玩家回合 N+1（喘息）→ 敌回合 N+1 复活动作
// ——「死亡后 1 回合复活，玩家只有 1 回合喘息」。
// 复活前提 = 战斗仍在进行：若它是场上最后一只敌人，击杀瞬间胜利结算先行、tick 永不
// 执行——「把它留到最后杀」就是根须/树心的既定收束打法，无需改核心胜利判定。
function reviveKit({ times = Infinity, hp = null } = {}) {
  return {
    onBattleStart(ctx, unit) {
      unit._revives = times;
      ctx.kernel.addSubscription({
        when: EnemyTurnStartInstruction,
        phase: 'post',
        owner: `enemy:${unit.uniqueID}:revive`,
        filter: () => unit.isDead() && (unit._reviveCountdown ?? 0) > 0,
        react: (instr, kctx) => {
          unit._reviveCountdown -= 1;
          if (unit._reviveCountdown > 0) return;
          unit._reviveCountdown = 0;
          unit.hp = hp ?? unit.maxHp;
          unit.shield = 0;
          kctx.presenter?.unitSpawned?.({ source: null, unit });
        },
      });
    },
    onDeath(actx) {
      const unit = actx.unit;
      if ((unit._revives ?? 0) > 0) {
        unit._revives -= 1;
        unit._reviveCountdown = 2; // 隔一个完整玩家回合后复活
      }
    },
  };
}

// ---- 淤积牌 ----

// 粘液（小史莱姆衍生塞牌）：1AP 抽1 消耗——吃 AP、占牌库的软卡手税。只经 AddCard
// 入场，不入奖励池。
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

// ---- 普通怪 ----

// 史莱姆：教学基准怪——攻 12 → 盾 8 两拍循环。第 1 层固定单挑；2–4 层史莱姆战固定位。
registerEnemy({
  id: 'slime', name: '史莱姆',
  difficulty: { base: 2, floorMin: 1, floorMax: 4 },
  createUnit: () => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 27 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 12 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 8 }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 12 + unit.getStat('attack') }
    : { kinds: ['defend'], note: '自身护盾+8' }),
});

// 怨灵 A/B（成群出现的强 Debuff 位；A 类开局洗 4 张虚无，B 类开局虚弱 2）：
// 之后两拍循环——攻 10 → 洗 1 张虚无。虚无牌永久滞留牌库，长线磨损玩家的抽牌质量。
function wraithDef(id, opener) {
  const open = opener.opener;
  registerEnemy({
    id, name: '怨灵',
    difficulty: { base: 3, floorMin: 2, floorMax: 6 },
    createUnit: () => new Enemy({ defId: id, name: '怨灵', maxHp: 28 }),
    act(actx) {
      const { unit, player } = actx;
      if (unit.actionIndex === 0) return open(actx);
      const phase = (unit.actionIndex - 1) % 2;
      if (phase === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 10 + unit.getStat('attack'),
        }));
      } else {
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'voidCard', toZone: 'deck', index: 'random',
        }));
      }
    },
    getIntention: (unit) => {
      if (unit.actionIndex === 0) return opener.intention;
      return (unit.actionIndex - 1) % 2 === 0
        ? { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') }
        : { kinds: ['debuff'], note: '向你的牌库洗入1张「虚无」' };
    },
  });
}
wraithDef('wraithA', {
  intention: { kinds: ['debuff'], note: '向你的牌库洗入4张「虚无」' },
  opener: (actx) => {
    for (let i = 0; i < 4; i++) {
      actx.kernel.submitInstruction(new AddCardInstruction({
        defId: 'voidCard', toZone: 'deck', index: 'random',
      }));
    }
  },
});
wraithDef('wraithB', {
  intention: { kinds: ['debuff'], note: '赋予玩家虚弱2（攻击-2）' },
  opener: (actx) => {
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: actx.player, effectId: 'weaken', stacks: 2,
    }));
  },
});

// 小史莱姆 A/B：微威胁铺场位。登场获得「融合」（EFFECTS.md：死亡时友军史莱姆族
// 各恢复 6 生命 +2 力量）——打小的喂大的。A 类先塞后打，B 类先打后塞（错拍出题）。
function slimeletDef(id, firstIsAttack) {
  registerEnemy({
    id, name: '小史莱姆',
    difficulty: { base: 1, floorMin: 2, floorMax: 16 },
    createUnit: () => new Enemy({ defId: id, name: '小史莱姆', maxHp: 9 }),
    onBattleStart(ctx, unit) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'fusion', stacks: 1,
      }));
    },
    act(actx) {
      const { unit, player } = actx;
      const jab = unit.actionIndex % 2 === (firstIsAttack ? 1 : 0);
      if (jab) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 4 + unit.getStat('attack'),
        }));
      } else {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 3 + unit.getStat('attack'),
        }));
        actx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'gooCard', toZone: 'deck', index: null,
        }));
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const jab = unit.actionIndex % 2 === (firstIsAttack ? 1 : 0);
      return jab
        ? { kinds: ['attack'], hits: 1, damage: 4 + atk }
        : { kinds: ['attack', 'debuff'], hits: 1, damage: 3 + atk, note: '向牌库末塞入1张「粘液」' };
    },
  });
}
slimeletDef('slimeletA', false); // A 类：拍1 塞粘液攻3 → 拍2 攻4
slimeletDef('slimeletB', true);  // B 类：拍2 攻4 → 拍1 塞粘液攻3

// 针鼠：荆棘教学——首拍竖刺（荆棘3），此后三拍循环：攻6+盾8 → 攻10 → 攻6+荆棘3。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'hedgehog', name: '针鼠',
  createUnit: () => new Enemy({ defId: 'hedgehog', name: '针鼠', maxHp: 28 }),
  act(actx) {
    const { unit } = actx;
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'thorns', stacks: 3,
      }));
      return;
    }
    const phase = (unit.actionIndex - 1) % 3;
    const amount = (phase === 1 ? 10 : 6) + unit.getStat('attack');
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount,
    }));
    if (phase === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
    } else if (phase === 2) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'thorns', stacks: 3,
      }));
    }
  },
  getIntention: (unit) => {
    if (unit.actionIndex === 0) return { kinds: ['buff'], note: '自身荆棘3' };
    const phase = (unit.actionIndex - 1) % 3;
    const atk = unit.getStat('attack');
    if (phase === 0) return { kinds: ['attack', 'defend'], hits: 1, damage: 6 + atk, note: '自身护盾+8' };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + atk };
    return { kinds: ['attack', 'buff'], hits: 1, damage: 6 + atk, note: '自身荆棘+3' };
  },
});

// 腐苔球：压缩手牌空间——每拍玩家紧勒+1（手牌上限-1，效果轨可见），奇数拍攻 8、
// 偶数拍自愈盾回；亡语归还自己施加的全部紧勒层数（杀了就松手）。
// A/B 类（2026-09-22 用户定，头轮试玩反馈紧勒叠太快）：B 类紧勒晚一拍起步——第 2 拍
// 才开始蔓延，给玩家一个手牌完整的首回合抢输出；同场 2 只苔球的编成一律 A/B 配合
// （见 floorEnemyGenerator），单只编成用 A。
function mossBallDef(id, delayedGrip) {
  registerEnemy({
    difficulty: { base: 2, floorMin: 2, floorMax: 16 },
    id, name: '腐苔球',
    createUnit: () => new Enemy({ defId: id, name: '腐苔球', maxHp: 27 }),
    act(actx) {
      const { unit, player } = actx;
      if (!(delayedGrip && unit.actionIndex === 0)) {
        unit._grip = (unit._grip ?? 0) + 1;
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: player, effectId: 'constrict', stacks: 1 }));
        player.maxHandSize = Math.max(2, (player.maxHandSize ?? 5) - 1);
      }
      if (unit.actionIndex % 2 === 0) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 8 + unit.getStat('attack') }));
      } else {
        actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 8 }));
        actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 8 }));
      }
    },
    getIntention: (unit) => {
      const gripsNow = !(delayedGrip && unit.actionIndex === 0);
      const attacking = unit.actionIndex % 2 === 0;
      return {
        kinds: attacking
          ? (gripsNow ? ['attack', 'debuff'] : ['attack'])
          : (gripsNow ? ['defend', 'buff', 'debuff'] : ['defend', 'buff']),
        hits: attacking ? 1 : undefined,
        damage: attacking ? 8 + unit.getStat('attack') : undefined,
        note: gripsNow ? '蔓延：你的手牌上限 -1（死亡时解除其全部紧勒）' : '迟滞蔓延（下回合起）',
      };
    },
    onDeath(actx) {
      const grip = actx.unit._grip ?? 0;
      if (grip > 0) {
        actx.kernel.submitInstruction(new AddEffectInstruction({
          target: actx.player, effectId: 'constrict', stacks: -grip }));
        actx.player.maxHandSize += grip;
      }
    },
  });
}
mossBallDef('mossBallA', false); // A 类：每拍紧勒（含首拍）
mossBallDef('mossBallB', true);  // B 类：首拍只打不缠，第 2 拍起每拍紧勒

// 鼓腹蟾：渐强威胁——鼓气 → 启动段 → 永远重击 18。放着不管会出事，但打它没有任何
// 反制机制（2026-09-22 稿去掉旧「被攻击膨胀」）——纯粹的 DPS 检查。
// A/B/C 类（2026-09-22 用户定，蟾群团灭复盘：三蟾同步齐射 30→54 无解）：B/C 启动段
// 各多插一/两拍「攻 7」过渡拍——重击到达时间 A=T3 / B=T4 / C=T5，蟾群编成可用不同型错峰
// 后齐射变轮射（T3 峰值 54→35），玩家每回合有可防御窗口；单蟾 18 不动，仍考验 DPS
// 与启动速度（拖到 T5 三蟾照样齐 54）。
function pufferToadDef(id, ramped) {
  registerEnemy({
    difficulty: { base: 2, floorMin: 2, floorMax: 16 },
    id, name: '鼓腹蟾',
    createUnit: () => new Enemy({ defId: id, name: '鼓腹蟾', maxHp: 32 }),
    act(actx) {
      const { unit, player } = actx;
      const i = unit.actionIndex;
      if (i === 0) return; // 鼓气：白给一拍
      const rampEnd = 2 + ramped;               // 重击起点（含）
      const amount = i >= rampEnd ? 18 : (i === rampEnd - 1 ? 10 : 7);
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: amount + unit.getStat('attack'),
      }));
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const i = unit.actionIndex;
      if (i === 0) return { kinds: ['unknown'], note: '鼓腹（蓄力中）' };
      const rampEnd = 2 + ramped;
      if (i >= rampEnd) return { kinds: ['attack'], hits: 1, damage: 18 + atk, note: '重击' };
      if (i === rampEnd - 1) return { kinds: ['attack'], hits: 1, damage: 10 + atk };
      return { kinds: ['attack'], hits: 1, damage: 7 + atk };
    },
  });
}
pufferToadDef('pufferToadA', 0); // A 类：鼓气 → 攻10 → 重击18∞
pufferToadDef('pufferToadB', 1); // B 类：鼓气 → 攻7 → 攻10 → 重击18∞
pufferToadDef('pufferToadC', 2); // C 类：鼓气 → 攻7 → 攻7 → 攻10 → 重击18∞

// 爆囊：定时炸弹——进战获得爆炸引线3（自己回合结束 -1，归零对玩家阵营全体炸 20 并
// 自爆）。三拍节奏：攻5 → 攻8 → 原地待爆。杀它 = 拆弹（被击杀则引线什么都不做）。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'blastPod', name: '爆囊',
  createUnit: () => new Enemy({ defId: 'blastPod', name: '爆囊', maxHp: 28 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'blastFuse', stacks: 3,
    }));
  },
  act(actx) {
    const { unit, player } = actx;
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 5 + unit.getStat('attack'),
      }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 8 + unit.getStat('attack'),
      }));
    }
    // phase 2：原地待爆（引线在回合结束自然走）
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const fuse = unit.getEffectStacks('blastFuse');
    const boom = `爆炸引线${fuse}：归零时对玩家阵营全体炸 20（击杀它=拆弹）`;
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['attack'], hits: 1, damage: 5 + atk, note: boom };
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 8 + atk, note: boom };
    return { kinds: ['unknown'], note: `准备引爆！${boom}` };
  },
});

// 石茧：首拍重击 15，此后每拍攻6+盾9——没有沉眠期了（2026-09-22 稿），开局就是压力。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'stoneCocoon', name: '石茧',
  createUnit: () => new Enemy({ defId: 'stoneCocoon', name: '石茧', maxHp: 36 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 15 + unit.getStat('attack'),
      }));
      return;
    }
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 6 + unit.getStat('attack'),
    }));
    actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 9 }));
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    return unit.actionIndex === 0
      ? { kinds: ['attack'], hits: 1, damage: 15 + atk, note: '破茧重击' }
      : { kinds: ['attack', 'defend'], hits: 1, damage: 6 + atk, note: '自身护盾+9' };
  },
});

// 岩螺：蓄势引擎——拍1 缩壳（盾10+回10+蓄势3），拍2 攻1×4（蓄势让每段都吃加成）。
// 拖得越久打越疼，但本体血厚难秒：打还是磨的节奏题。
registerEnemy({
  difficulty: { base: 4, floorMin: 2, floorMax: 16 },
  id: 'rockSnail', name: '岩螺',
  createUnit: () => new Enemy({ defId: 'rockSnail', name: '岩螺', maxHp: 55 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 10 }));
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 10 }));
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'momentum', stacks: 3,
      }));
    } else {
      const per = 1 + unit.getStat('attack'); // 蓄势由 momentum 的 PRE 订阅统一加（双计 bug 2026-09-22 修）
      for (let i = 0; i < 4; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: per,
        }));
      }
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '缩壳：自身护盾+10、回复10、蓄势+3' }
    : { kinds: ['attack'], hits: 4,
        damage: 1 + unit.getStat('attack') + unit.getEffectStacks('momentum'),
        note: `蓄势${unit.getEffectStacks('momentum')}：每段伤害+${unit.getEffectStacks('momentum')}` }),
});

// 刺刺草：春风——第一次死亡后隔 1 回合以 14 血复苏；每拍藤鞭（攻5+中毒2）。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'thornWeed', name: '刺刺草',
  createUnit: () => new Enemy({ defId: 'thornWeed', name: '刺刺草', maxHp: 19 }),
  ...reviveKit({ times: 1, hp: 14 }),
  act(actx) {
    const { unit, player } = actx;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 5 + unit.getStat('attack'),
    }));
    actx.kernel.submitInstruction(new AddEffectInstruction({
      target: player, effectId: 'poison', stacks: 2,
    }));
  },
  getIntention: (unit) => ({ kinds: ['attack', 'debuff'], hits: 1,
    damage: 5 + unit.getStat('attack'), note: '藤鞭：中毒2（春风：第一次死亡后复苏）' }),
});

// 腐食甲虫：出场自带甲壳2（主级伤害减半/层）；每拍啃咬（攻5 + 吃掉玩家牌库顶1张）。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'carrionBeetle', name: '腐食甲虫',
  createUnit: () => new Enemy({ defId: 'carrionBeetle', name: '腐食甲虫', maxHp: 22 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'shell', stacks: 2,
    }));
  },
  act(actx) {
    const { unit, player, battleState: bs } = actx;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player, amount: 5 + unit.getStat('attack'),
    }));
    const top = bs.zones.deck[0];
    if (top) {
      actx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: top.uniqueID }));
    }
  },
  getIntention: (unit) => ({ kinds: ['attack', 'debuff'], hits: 1,
    damage: 5 + unit.getStat('attack'), note: '啃食：吃掉你的牌库顶1张（本场消化）' }),
});

// 掘地鼹鼠：三拍蓄爆循环——首拍突袭7，然后 攻10+盾30 → 恢复24 → 攻22。
// 自愈+厚盾+大单发，是一只完整的「马拉松检查」。
registerEnemy({
  difficulty: { base: 3, floorMin: 2, floorMax: 16 },
  id: 'diggerMole', name: '掘地鼹鼠',
  createUnit: () => new Enemy({ defId: 'diggerMole', name: '掘地鼹鼠', maxHp: 38 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 7 + unit.getStat('attack'),
      }));
      return;
    }
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 10 + unit.getStat('attack'),
      }));
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: unit, amount: 30 }));
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: unit, amount: 24 }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 22 + unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    if (unit.actionIndex === 0) return { kinds: ['attack'], hits: 1, damage: 7 + atk, note: '突袭' };
    const phase = (unit.actionIndex - 1) % 3;
    if (phase === 0) return { kinds: ['attack', 'defend'], hits: 1, damage: 10 + atk, note: '自身护盾+30' };
    if (phase === 1) return { kinds: ['buff'], note: '掘洞恢复：回复24' };
    return { kinds: ['attack'], hits: 1, damage: 22 + atk, note: '重击' };
  },
});

// 静电毛球：电动（每有一个友军攻击+3，友军增减即时反映面板）——集群越厚它越凶。
// 每拍电击（攻4）并为友军全员蓄势+1：群战里的成长引擎。血量 16–24 随机（生成器定档）。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'staticPuff', name: '静电毛球',
  createUnit: () => new Enemy({ defId: 'staticPuff', name: '静电毛球', maxHp: 20 }),
  onBattleStart(ctx, unit) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: unit, effectId: 'dynamo', stacks: 1,
    }));
  },
  act(actx) {
    const { unit, player, battleState: bs } = actx;
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: player,
      amount: 4 + unit.getStat('attack', bs), // 蓄势走 PRE 订阅（防双计）
    }));
    for (const e of aliveEnemies(bs)) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: e, effectId: 'momentum', stacks: 1,
      }));
    }
  },
  getIntention: (unit, battleState) => {
    const atk = unit.getStat('attack', battleState);
    const friends = battleState
      ? aliveEnemies(battleState).filter(u => u !== unit && !u.isDead()).length : 1;
    return { kinds: ['attack', 'buff'], hits: 1,
      damage: 4 + atk + unit.getEffectStacks('momentum'),
      note: `电动（友军${friends}名：攻击+${3 * friends}），友军全员蓄势+1` };
  },
});

// 嗡嗡虫 A/B（塞卡干扰位，成群出现）：登场闪避1；三拍循环——A 类先塞后打，B 类先打后塞。
// 迷眼粉尘塞牌库随机位（抽到手上才开始计时），尾拍是 2×5 的多段撞击。
function buzzbugDef(id, firstIsAttack) {
  registerEnemy({
    id, name: '嗡嗡虫',
    difficulty: { base: 2, floorMin: 2, floorMax: 16 },
    createUnit: () => new Enemy({ defId: id, name: '嗡嗡虫', maxHp: 19 }),
    onBattleStart(ctx, unit) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'dodge', stacks: 1,
      }));
    },
    act(actx) {
      const { unit, player } = actx;
      const phase = unit.actionIndex % 3;
      const swarm = phase === 2;
      const jab = phase === (firstIsAttack ? 1 : 0);
      if (swarm) {
        for (let i = 0; i < 5; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: player, amount: 2 + unit.getStat('attack'),
          }));
        }
      } else if (jab) {
        for (let i = 0; i < 4; i++) {
          actx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: player, amount: 1 + unit.getStat('attack'),
          }));
        }
      } else {
        for (let i = 0; i < 2; i++) {
          actx.kernel.submitInstruction(new AddCardInstruction({
            defId: 'dustCloud', toZone: 'deck', index: 'random',
          }));
        }
      }
    },
    getIntention: (unit) => {
      const atk = unit.getStat('attack');
      const phase = unit.actionIndex % 3;
      if (phase === 2) return { kinds: ['attack'], hits: 5, damage: 2 + atk };
      const jab = phase === (firstIsAttack ? 1 : 0);
      return jab
        ? { kinds: ['attack'], hits: 4, damage: 1 + atk }
        : { kinds: ['debuff'], note: '振翅：2张迷眼粉尘塞入你的牌库' };
    },
  });
}
buzzbugDef('buzzbugA', false); // A 类：拍1 塞粉尘 → 拍2 撞×4 → 拍3 撞×5
buzzbugDef('buzzbugB', true);  // B 类：拍1 撞×4 → 拍2 塞粉尘 → 拍3 撞×5

// 腐败根须：会复苏的一直攻击——死亡后隔 1 回合复活（无限次；作为场上最后一只
// 被击杀时战斗即刻胜利，复苏不触发）。首现 18 血，复苏固定 13 血（2026-09-22 用户定：
// 复活体更脆——花在「再杀一次」上的输出能换到更多喘息）。两拍循环：攻8 → 攻4×3。
registerEnemy({
  difficulty: { base: 2, floorMin: 2, floorMax: 16 },
  id: 'rottenRoot', name: '腐败根须',
  createUnit: () => new Enemy({ defId: 'rottenRoot', name: '腐败根须', maxHp: 18 }),
  ...reviveKit({ times: Infinity, hp: 13 }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 8 + unit.getStat('attack'),
      }));
    } else {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 4 + unit.getStat('attack'),
        }));
      }
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 8 + unit.getStat('attack'), note: '复苏：死后1回合复活' }
    : { kinds: ['attack'], hits: 3, damage: 4 + unit.getStat('attack'), note: '复苏：死后1回合复活' }),
});

// 腐败树心：血厚版根须——同样无限复苏（留到最后杀即终结）。两拍：攻6 → 攻4×3。
registerEnemy({
  difficulty: { base: 3, floorMin: 2, floorMax: 16 },
  id: 'rottenTreeHeart', name: '腐败树心',
  createUnit: () => new Enemy({ defId: 'rottenTreeHeart', name: '腐败树心', maxHp: 45 }),
  ...reviveKit({ times: Infinity }),
  act(actx) {
    const { unit, player } = actx;
    if (unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: player, amount: 6 + unit.getStat('attack'),
      }));
    } else {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: player, amount: 4 + unit.getStat('attack'),
        }));
      }
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['attack'], hits: 1, damage: 6 + unit.getStat('attack'), note: '复苏：死后1回合复活' }
    : { kinds: ['attack'], hits: 3, damage: 4 + unit.getStat('attack'), note: '复苏：死后1回合复活' }),
});

// 灵脉虹吸的黑名单：纯玩家侧触发逻辑（偷过去语义反转）与内部计数轨不可偷。
// blastFuse（2026-09-22 重定义）仍是敌方式倒计时——玩家挂着只会炸自己，不可偷。
// bosses.js 的吞噬者（灵脉虹吸）同表共用——此前它引用了未导出的本表（潜在 ReferenceError）。
export const ESSENCE_STEAL_BLACKLIST = new Set(['naqi', 'blastFuse', 'fusion']);
