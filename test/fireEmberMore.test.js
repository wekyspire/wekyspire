import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { zoneOf } from '../src/core/state/battleState.js';
import Enemy from '../src/core/state/enemy.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { ChantTriggerInstruction } from '../src/core/instructions/turn.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 火灵脉·叠炎（续）：自焚 / 焰愈 / 焚原 / 镜燃 / 咏唱（燃心决/取暖/绝炎）----
// 全程 BattleDriver 驱动真实结算（不 mock Core）。
// 燃烧基准行为（effects.js）：己方阵营回合开始受等于层数的穿透伤害后层数 -1。

describe('自焚系列：自伤换高伤（0费 + 冷却1）', () => {
  it('玩火/引焰/焚灭：伤害命中敌人，燃烧落给自己，冷却打出后启动并跨回合回充', () => {
    // 靶子加厚到 60 血：三张连打不致死，效果全部完整结算
    // （若一击终局，V4 即时性会 abort 掉同拍未结算的后续子指令）
    const d = new BattleDriver({
      deck: ['playWithFire', 'drawFlame', 'immolate'],
      enemies: [new Enemy({ defId: 'pyro', name: '燃焰术士', maxHp: 60 })],
      seed: 5, config: { initialDraw: 3 },
    });
    const pyro = d.state.enemies[0];
    d.start();

    d.play('playWithFire'); // 11 伤 + 自身燃烧2
    expect(pyro.hp).toBe(60 - 11);
    expect(d.player.getEffectStacks('burn')).toBe(2);
    // 冷却启动：充能耗尽、计时 1；打出后回牌库底（非消耗）
    const pf = d.state.zones.deck.find(c => c.defId === 'playWithFire');
    expect(pf.remainingUses).toBe(0);
    expect(pf.currentCooldown).toBe(1);

    d.play('drawFlame'); // 16 伤 + 燃烧3 → 累计 5
    expect(pyro.hp).toBe(60 - 11 - 16);
    expect(d.player.getEffectStacks('burn')).toBe(5);

    d.endTurn(); // 敌方：燃焰术士攻 10；回合2 P1：燃烧跳 5 穿透；P2：冷却推进回充
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 10 - 5);
    expect(d.player.getEffectStacks('burn')).toBe(4);
    // 玩火冷却 1 回合归零 → 回充 1 格（回合 2 抽牌后已回手）
    const pfRecharged = d.state.zones.hand.find(c => c.defId === 'playWithFire');
    expect(pfRecharged.remainingUses).toBe(1);
    expect(pfRecharged.currentCooldown).toBe(0);

    d.play('immolate'); // 23 伤 + 燃烧5 → 累计 9
    expect(pyro.hp).toBe(60 - 11 - 16 - 23);
    expect(d.player.getEffectStacks('burn')).toBe(4 + 5);
  });
});

describe('焰愈系列：燃烧层数转化治疗（1AP 消耗）', () => {
  it('焰愈：无燃烧时只回基础 5，卡消耗进焚毁区', () => {
    const d = new BattleDriver({
      deck: ['flameHeal'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    d.start();
    d.player.hp = 10;
    const card = d.state.zones.hand[0];
    d.play('flameHeal');
    expect(d.player.hp).toBe(15); // 10 + 5（燃烧 0 层，无加成）
    expect(zoneOf(d.state, card.uniqueID)).toBe('burnt');
  });

  it('焰愈：每层燃烧让治愈+1', () => {
    const d = new BattleDriver({
      deck: ['flameHeal'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    d.start();
    d.player.hp = 10;
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 4 }));
    d.play('flameHeal');
    expect(d.player.hp).toBe(10 + 5 + 4 * 1);
    // 只读不消耗：燃烧层数原样保留
    expect(d.player.getEffectStacks('burn')).toBe(4);
  });

  it('炽愈：每层+2；涅槃：每层+3', () => {
    const b = new BattleDriver({
      deck: ['blazingHeal'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    b.start();
    b.player.hp = 10;
    b.dispatch(new AddEffectInstruction({ target: b.player, effectId: 'burn', stacks: 3 }));
    b.play('blazingHeal');
    expect(b.player.hp).toBe(10 + 7 + 3 * 2);

    const n = new BattleDriver({
      deck: ['nirvana'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    n.start();
    n.player.hp = 10;
    n.dispatch(new AddEffectInstruction({ target: n.player, effectId: 'burn', stacks: 2 }));
    n.play('nirvana');
    expect(n.player.hp).toBe(10 + 10 + 2 * 3);
  });
});

describe('焚原：敌人死亡时燃烧传播（咏唱3）', () => {
  it('死亡的敌人身上有燃烧时，等量传播给其余存活敌人', () => {
    const d = new BattleDriver({
      deck: ['ashField'], enemies: ['slime', 'slime'], seed: 5, config: { initialDraw: 1 },
    });
    const [a, b] = d.state.enemies;
    d.start();
    d.play('ashField');
    expect(d.state.zones.hand[0].isActivated).toBe(true);

    d.dispatch(new AddEffectInstruction({ target: a, effectId: 'burn', stacks: 3 }));
    d.dispatch(new DealDamageInstruction({ source: d.player, target: a, amount: 999 }));
    expect(a.isDead()).toBe(true);
    expect(b.getEffectStacks('burn')).toBe(3); // 死前 3 层整量传播
    expect(b.hp).toBe(20); // 传播只上层、不结算伤害
  });

  it('无燃烧的敌人死亡不传播；场上再无敌人时传播落空并判胜', () => {
    const d = new BattleDriver({
      deck: ['ashField'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    const slime = d.state.enemies[0];
    d.start();
    d.play('ashField');

    d.dispatch(new DealDamageInstruction({ source: d.player, target: slime, amount: 999 }));
    expect(slime.isDead()).toBe(true); // 无燃烧：无事发生
    expect(d.verdict).toBe('victory'); // 全灭判胜，传播对象为空不报错
  });
});

describe('镜燃系列：获得燃烧时反哺（咏唱3）', () => {
  it('镜燃：自己获得几层燃烧，就对随机敌人施加等量燃烧', () => {
    const d = new BattleDriver({
      deck: ['mirrorBurn'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    const slime = d.state.enemies[0];
    d.start();
    d.play('mirrorBurn');

    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 2 }));
    expect(d.player.getEffectStacks('burn')).toBe(2);
    expect(slime.getEffectStacks('burn')).toBe(2); // 单敌时随机退化为必中
  });

  it('业火：自己获得燃烧时对所有敌人施加等量燃烧；敌方获得的燃烧不回灌', () => {
    const d = new BattleDriver({
      deck: ['karmaFire'], enemies: ['slime', 'slime'], seed: 5, config: { initialDraw: 1 },
    });
    const [a, b] = d.state.enemies;
    d.start();
    d.play('karmaFire');

    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 2 }));
    expect(a.getEffectStacks('burn')).toBe(2);
    expect(b.getEffectStacks('burn')).toBe(2);

    // 敌人身上新增燃烧不触发（filter 限定 target 为玩家），无镜像级联
    d.dispatch(new AddEffectInstruction({ target: a, effectId: 'burn', stacks: 3 }));
    expect(a.getEffectStacks('burn')).toBe(5);
    expect(b.getEffectStacks('burn')).toBe(2);
  });
});

describe('咏唱（§2.2）', () => {
  it('燃心决：P5 触发获得魏启与燃烧；锁定（anchored）不可再次打出解除', () => {
    const d = new BattleDriver({
      deck: ['burningHeart'], enemies: ['slime'], seed: 5,
      config: { initialDraw: 1 }, player: { maxMana: 10 },
    });
    d.start();
    d.play('burningHeart'); // 0 费发动激活（咏唱0：不占手牌容量）
    const card = d.state.zones.hand[0];
    expect(card.isActivated).toBe(true);

    expect(() => d.play('burningHeart')).toThrow(/无法出牌/); // 锁定：不可主动解除

    const mana0 = d.player.mana; // 入战 = 上限一半 = 5
    d.endTurn(); // P5：+3 魏启 + 燃烧7 → 敌方史莱姆攻 6 → 回合2 P1：燃烧跳 7、+1 魏启
    expect(d.player.mana).toBe(mana0 + 3 + 1);
    expect(d.player.getEffectStacks('burn')).toBe(7 - 1);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 7);
    expect(card.isActivated).toBe(true); // 全程钉在手牌
  });

  it('取暖：每回合 P5 对所有敌人施加 1 层燃烧（敌方回合开始跳伤后自然归零）', () => {
    const d = new BattleDriver({
      deck: ['warmUp'], enemies: ['slime', 'slime'], seed: 5, config: { initialDraw: 1 },
    });
    const [s1, s2] = d.state.enemies;
    d.start();
    d.play('warmUp');
    d.endTurn(); // P5：双敌燃烧1 → 敌方 E1：各跳 1 穿透伤、层数-1 归零 → E2：各攻 6
    expect(s1.hp).toBe(20 - 1);
    expect(s2.hp).toBe(20 - 1);
    expect(s1.getEffectStacks('burn')).toBe(0);
    expect(s2.getEffectStacks('burn')).toBe(0);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 * 2);
  });

  it('绝炎：燃烧层数免疫下降（驱散与自然递减均被取消），跳伤照常结算', () => {
    const d = new BattleDriver({
      deck: ['absoluteFlame'], enemies: ['slime'], seed: 5, config: { initialDraw: 1 },
    });
    const slime = d.state.enemies[0];
    d.start();
    d.play('absoluteFlame');
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 5 }));
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'burn', stacks: 5 }));

    // 驱散式下降：负层数变更被 veto
    d.dispatch(new AddEffectInstruction({ target: slime, effectId: 'burn', stacks: -3 }));
    expect(slime.getEffectStacks('burn')).toBe(5);

    d.endTurn(); // 敌方 E1：slime 燃烧跳 5、层数不减 → 攻 6；回合2 P1：玩家燃烧跳 5、层数不减
    expect(d.player.getEffectStacks('burn')).toBe(5);
    expect(slime.getEffectStacks('burn')).toBe(5);
    expect(slime.hp).toBe(20 - 5);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 5);

    d.endTurn(); // 第二轮：层数依旧钉在 5，跳伤照常累积
    // （史莱姆行动序 攻→盾→攻：第二轮开盾不攻击，玩家只承受伤燃烧跳伤）
    expect(d.player.getEffectStacks('burn')).toBe(5);
    expect(slime.getEffectStacks('burn')).toBe(5);
    expect(slime.hp).toBe(20 - 5 * 2);
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 5 * 2);
  });
});

describe('取暖系列三阶（2026-09 稿：取暖/灼目/灼身）', () => {
  // 层数 = 敌方回合开始跳伤后 -1：P5 施加 N → 敌方 E1 跳 N 伤、层数归 N-1
  for (const [id, n] of [['warmUp', 1], ['dazzleEye', 2], ['scorchBody', 3]]) {
    it(`${id}：P5 对所有敌人施加燃烧${n}`, () => {
      const d = new BattleDriver({
        deck: [id], enemies: ['slime', 'slime'], seed: 5, config: { initialDraw: 1 },
      });
      const [s1, s2] = d.state.enemies;
      d.start();
      d.play(id);
      d.endTurn(); // P5 施加 → 敌方 E1 各跳 N 伤、层数 -1
      expect(s1.hp, id).toBe(20 - n);
      expect(s2.hp, id).toBe(20 - n);
      expect(s1.getEffectStacks('burn'), id).toBe(n - 1);
      expect(s2.getEffectStacks('burn'), id).toBe(n - 1);
    });
  }
});

describe('火焰披风（2026-09 稿：燃烧换护盾咏唱）', () => {
  it('每回合 P5：正在燃烧则获 9 护盾，未燃烧则无护盾', () => {
    const d = new BattleDriver({
      deck: ['flameCloak'], enemies: ['slime'], seed: 5, config: { initialDraw: 1, drawPerTurn: 0 },
      player: { maxMana: 8 },
    });
    d.start();
    d.play('flameCloak'); // 3魏启点亮
    expect(d.state.zones.hand[0].isActivated).toBe(true);
    d.dispatch(new ChantTriggerInstruction()); // P5 等价：未燃烧 → 无护盾
    expect(d.player.shield).toBe(0);
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 2 }));
    d.dispatch(new ChantTriggerInstruction()); // P5 等价：正在燃烧 → +9 护盾
    expect(d.player.shield).toBe(9);
  });
});
