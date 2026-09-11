import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import Enemy from '../src/core/state/enemy.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { zoneOf, moveCard, firstAliveEnemy } from '../src/core/state/battleState.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { DrawCardsInstruction } from '../src/core/instructions/cards.js';
import { GainManaInstruction } from '../src/core/instructions/resources.js';
import { ChantTriggerInstruction } from '../src/core/instructions/turn.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 火灵脉·爆炎组合 + 通用散卡（FIRE_VEIN_CARDS §1、§3）----
// 全部走 BattleDriver 真实结算。约定：
// - tank()：高血史莱姆（默认怪 20 血扛不住 28/38 直伤，测试统一抬高血量避免中途胜利）；
// - initialDraw 0 + toHand：洗牌不落定起手，按 defId 精确布置；
// - 入战半满魏启，需要时 dispatch GainMana 补满或直接布置 player.mana。

// 测试本地咏唱探针：激活期间每次咏唱节拍（ChantTrigger）对首敌造成 5 点伤害。
// 用于验证「快速咏唱」（先发系列）与 P5 咏唱触发共享同一挂载点。
registerSkill({
  id: 'chantPing', name: '咏唱探针', type: 'normal', tier: 'C',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction,
      phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(new DealDamageInstruction({
          source: sctx.player, target: firstAliveEnemy(ctx.battleState), amount: 5,
        }), instr);
      },
    }],
  },
});

const tank = (hp = 500) => new Enemy({ defId: 'slime', name: '史莱姆', maxHp: hp });

// 把指定 defId 的卡（牌库或手中第一张）挪进手牌
function toHand(d, defId) {
  const card = [...d.state.zones.deck, ...d.state.zones.hand].find(c => c.defId === defId);
  if (card && zoneOf(d.state, card.uniqueID) !== 'hand') {
    moveCard(d.state, card.uniqueID, 'hand');
  }
  return card;
}

function makeDriver(deck, enemies, player = {}) {
  const d = new BattleDriver({
    deck, enemies, seed: 5,
    config: { initialDraw: 0 },
    player,
  });
  d.start();
  return d;
}

describe('火球术系列：直伤与抽牌', () => {
  // [defId, 总伤害, 抽牌数]（火球连发 15×2 段；2026-09 稿：火弹/火箭 15、火球 25）
  const cases = [
    ['fireBolt', 15, 1],
    ['fireArrow', 15, 2],
    ['fireBall', 25, 2],
    ['greaterFireBall', 38, 2],
    ['fireBarrage', 30, 3],
  ];
  for (const [id, dmg, draw] of cases) {
    it(`${id}：${dmg}伤害抽${draw}，费2魏启`, () => {
      const d = makeDriver([id, 'punch', 'punch', 'punch', 'punch', 'punch'], [tank()]);
      d.dispatch(new GainManaInstruction({ amount: 99 })); // 补满至 3
      toHand(d, id);
      d.play(id);
      expect(d.state.enemies[0].hp, id).toBe(500 - dmg);
      expect(d.player.mana, id).toBe(3 - 2);
      expect(d.state.zones.hand, id).toHaveLength(draw); // 打出后抽 N（抽牌自牌库顶）
    });
  }

  it('蓄热火球：每次打出后自身伤害+12（仅本卡，其他卡吃不到）', () => {
    const d = makeDriver(
      ['heatChargedBall', 'fireBolt', 'punch', 'punch', 'punch', 'punch'],
      [tank()], { maxMana: 5 });
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    toHand(d, 'heatChargedBall');
    toHand(d, 'fireBolt');

    d.play('heatChargedBall');
    expect(d.state.enemies[0].hp).toBe(500 - 8);          // 首打：基数 8，本次不享受 +12
    const ball = d.state.zones.deck.find(c => c.defId === 'heatChargedBall');
    expect(ball.power).toBe(12);                          // 加成落 runtime.power（卡面威力直读）

    d.play('fireBolt');                                   // 火弹 15：不吃蓄热
    expect(d.state.enemies[0].hp).toBe(500 - 8 - 15);

    d.dispatch(new GainManaInstruction({ amount: 99 }));  // 回满（二打需 2 魏启）
    toHand(d, 'heatChargedBall');
    d.play('heatChargedBall');
    expect(d.state.enemies[0].hp).toBe(500 - 8 - 15 - 20); // 二打：8 + 12
  });
});

describe('爆裂术系列：蓄能与终止群伤', () => {
  // [defId, 基数, 每魏启系数]
  const cases = [
    ['smallBurst', 25, 5],
    ['karadiaBurst', 35, 7],
    ['qimingBlaze', 45, 9],
  ];
  for (const [id, base, coeff] of cases) {
    it(`${id}：激活期每消耗1魏启+${coeff}，免费解除打${base}+蓄能群伤`, () => {
      const d = makeDriver(
        [id, 'fireBolt', 'punch', 'punch', 'punch', 'punch'],
        [tank(), tank()], { maxMana: 8 });
      d.dispatch(new GainManaInstruction({ amount: 99 })); // 8
      const burst = toHand(d, id);
      toHand(d, 'fireBolt');

      d.play(id); // 发动：4魏启点亮（发动费不计入蓄能）
      expect(burst.isActivated, id).toBe(true);
      expect(d.player.mana, id).toBe(4);

      d.play('fireBolt'); // 消耗2魏启 → 蓄能 +2×coeff
      expect(d.player.mana, id).toBe(2);

      d.play(burst.uniqueID); // 免费解除 → 终止群伤
      expect(burst.isActivated, id).toBe(false);
      expect(zoneOf(d.state, burst.uniqueID), id).toBe('deck'); // 无消耗：解除回牌库
      const total = base + 2 * coeff;
      expect(d.state.enemies[0].hp, id).toBe(500 - 15 - total); // 首敌另吃了火弹15
      expect(d.state.enemies[1].hp, id).toBe(500 - total);
    });
  }
});

describe('凝焰系列：X费随当前魏启缩放', () => {
  // [defId, 纳气, 每点X燃烧层数]
  const cases = [
    ['flameBirth', 1, 3],
    ['flameSurge', 3, 3],
    ['flameCondense', 5, 4],
  ];
  for (const [id, naqi, perX] of cases) {
    it(`${id}：3魏启时全耗，纳气${naqi}，对目标施加燃烧${perX}×3`, () => {
      const d = makeDriver([id, 'punch', 'punch', 'punch'], [tank()]);
      d.player.mana = 3;
      toHand(d, id);
      d.play(id);
      expect(d.player.mana, id).toBe(0);
      expect(d.player.getEffectStacks('naqi'), id).toBe(naqi);
      expect(d.player.getEffect('burn'), id).toBeNull(); // 燃烧施加给目标而非自身
      expect(d.state.enemies[0].getEffectStacks('burn'), id).toBe(perX * 3);
    });
  }

  it('X=0（空蓝）仍可打出：只给纳气，不上燃烧', () => {
    const d = makeDriver(['flameBirth', 'punch', 'punch', 'punch'], [tank()]);
    d.player.mana = 0;
    toHand(d, 'flameBirth');
    d.play('flameBirth');
    expect(d.player.mana).toBe(0);
    expect(d.player.getEffectStacks('naqi')).toBe(1);
    expect(d.player.getEffect('burn')).toBeNull();
  });
});

describe('高热系列：咏唱触发纳气+自施燃烧（P5 每回合），解除后停跳', () => {
  const cases = [['fever', 1], ['highFever', 2]];
  for (const [id, naqi] of cases) {
    it(`${id}：点亮不结算，P5 触发纳气${naqi}+燃烧4，解除焚毁后不再触发`, () => {
      // maxMana 8：避免回蓝被默认上限 3 截断
      const d = makeDriver([id, 'punch', 'punch', 'punch', 'punch'], [tank()], { maxMana: 8 });
      const card = toHand(d, id);
      d.play(id); // 0费点亮：本身不结算
      expect(card.isActivated, id).toBe(true);
      expect(d.player.getEffectStacks('naqi'), id).toBe(0);
      expect(d.player.getEffectStacks('burn'), id).toBe(0);

      d.endTurn(); // 回合1 P5 咏唱触发：纳气N + 自身燃烧4；史莱姆攻6
      // 回合2开始：纳气兑现+N蓝，燃烧跳4（P5 触发的效果在下一回合开始兑现/跳伤）
      expect(d.player.hp, id).toBe(PLAYER_BASE_HP - 6 - 4);
      // 入战4 + 回合1/回合2 各自然+1 + 纳气N（首回合开始也有自然恢复）
      expect(d.player.mana, id).toBe(4 + 1 + 1 + naqi);
      expect(d.player.getEffectStacks('burn'), id).toBe(3);

      d.play(card.uniqueID); // 免费解除：消耗咏唱 → 焚毁
      expect(zoneOf(d.state, card.uniqueID), id).toBe('burnt');
      expect(d.player.getEffectStacks('burn'), id).toBe(3);
      expect(d.player.getEffectStacks('naqi'), id).toBe(0);

      d.endTurn(); // 已焚毁：P5 空转，燃烧只自然递减（回合3开始跳3 → 2）
      expect(d.player.getEffectStacks('burn'), id).toBe(2);
    });
  }
});

describe('火雨系列：低耗群伤', () => {
  it('火雨：所有敌人各受12', () => {
    const d = makeDriver(['fireRain', 'punch', 'punch', 'punch'], [tank(), tank()]);
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    toHand(d, 'fireRain');
    d.play('fireRain');
    expect(d.player.mana).toBe(3 - 3);
    for (const e of d.state.enemies) expect(e.hp).toBe(500 - 12);
  });

  it('火流：两波各12；首波击杀的目标不吃第二波', () => {
    const d = makeDriver(['fireStream', 'punch', 'punch', 'punch'], [
      new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 12 }), tank(),
    ]);
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    toHand(d, 'fireStream');
    d.play('fireStream');
    expect(d.state.enemies[0].isDead()).toBe(true); // 12 血死于首波
    expect(d.state.enemies[0].hp).toBe(0);
    expect(d.state.enemies[1].hp).toBe(500 - 24); // 存活者吃满两波
  });
});

describe('添柴系列：焚卡换魏启', () => {
  const cases = [['fuelTheFire', 3], ['roaringFire', 4]];
  for (const [id, mana] of cases) {
    it(`${id}：选1手牌焚毁，获得${mana}魏启`, () => {
      // maxMana 8：避免回蓝被默认上限 3 截断
      const d = makeDriver([id, 'punch', 'punch', 'punch', 'punch'], [tank()], { maxMana: 8 });
      d.player.mana = 1;
      const card = toHand(d, id);
      const victim = toHand(d, 'punch');
      d.play(id); // 挂起等待选牌
      expect(d.pendingInput?.request.kind).toBe('selectCards');
      d.respond([victim.uniqueID]);
      expect(zoneOf(d.state, victim.uniqueID), id).toBe('burnt');
      expect(d.player.mana, id).toBe(1 + mana);
      expect(zoneOf(d.state, card.uniqueID), id).toBe('burnt'); // 自身消耗
    });
  }

  it('猛火：焚1抽2回4魏启', () => {
    const d = makeDriver(['blazeUp', 'punch', 'punch', 'punch', 'punch', 'punch'], [tank()], { maxMana: 8 });
    d.player.mana = 0;
    toHand(d, 'blazeUp');
    const victim = toHand(d, 'punch');
    d.play('blazeUp');
    d.respond([victim.uniqueID]);
    expect(zoneOf(d.state, victim.uniqueID)).toBe('burnt');
    expect(d.player.mana).toBe(4);
    expect(d.state.zones.hand).toHaveLength(2); // 抽2
  });

  it('燎原：抽2焚2抽2回9魏启（不可控）', () => {
    const d = makeDriver(
      ['wildfire', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      [tank()], { maxMana: 12 });
    d.player.mana = 0;
    toHand(d, 'wildfire'); // 手牌：wildfire；牌库 6 张拳
    d.play('wildfire');
    expect(d.state.zones.burnt).toHaveLength(3); // 抽到的 2 张 + 自身消耗
    expect(d.state.zones.hand).toHaveLength(2); // 再抽 2
    expect(d.state.zones.deck).toHaveLength(6 - 2 - 2); // 焚2 - 抽2
    expect(d.player.mana).toBe(9);
  });

  it('边界：手上无其他牌时添柴不可打出', () => {
    const d = makeDriver(['fuelTheFire'], [tank()]);
    toHand(d, 'fuelTheFire'); // 手牌只有它自己
    expect(() => d.play('fuelTheFire')).toThrow('无法出牌');
  });
});

describe('先发系列：固有消耗直伤 + 抽1', () => {
  const cases = [['firstShot', 8], ['firstArrow', 12], ['firstFireBall', 17]];
  for (const [id, dmg] of cases) {
    it(`${id}：不占抽牌位起手在手，${dmg}伤害并抽1（2026-09 修订：快速咏唱换抽牌）`, () => {
      const d = makeDriver([id, 'punch', 'punch', 'punch', 'punch'], [tank()]);
      // initialDraw 0 下固有卡仍起手在手
      expect(d.handIds(), id).toContain(id);
      const card = d.state.zones.hand.find(c => c.defId === id);
      const deckLen = d.state.zones.deck.length;
      d.play(id); // 直伤 + 抽 1
      expect(d.state.enemies[0].hp, id).toBe(500 - dmg);
      expect(zoneOf(d.state, card.uniqueID), id).toBe('burnt'); // 消耗
      expect(d.state.zones.deck.length, id).toBe(deckLen - 1);  // 抽 1
    });
  }
});

describe('忍耐：燃烧受伤转魏启', () => {
  it('每累计5点燃烧伤害回1魏启，余数跨回合保留', () => {
    // maxMana 8：避免回蓝被默认上限 3 截断
    const d = makeDriver(['patience', 'punch', 'punch', 'punch', 'punch'], [tank()], { maxMana: 8 });
    const card = toHand(d, 'patience');
    d.player.mana = 0;
    d.play('patience');
    expect(card.isActivated).toBe(true);
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 7 }));

    d.endTurn(); // 史莱姆攻6；回合2开始：燃烧跳7（穿透）→ 回1蓝余2，层数6
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 7);
    expect(d.player.mana).toBe(0 + 1 + 1); // 自然+1 + 忍耐+1
    expect(d.player.getEffectStacks('burn')).toBe(6);
    expect(card.patiencePool).toBe(2);

    d.endTurn(); // 史莱姆第2动开盾；回合3开始：燃烧跳6 → 余2+6=8 再回1（余3）
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 7 - 6);
    expect(d.player.mana).toBe(2 + 1 + 1);
    expect(card.patiencePool).toBe(3);
  });
});

describe('深入卡：回响烈焰 / 放手一搏', () => {
  it('回响烈焰：按坟墓张数回蓝并抽3，自身入坟后为下一张计数', () => {
    const d = makeDriver(
      ['echoingFlames', 'echoingFlames', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      [tank()]);
    const first = toHand(d, 'echoingFlames');
    const second = toHand(d, 'echoingFlames');
    d.player.mana = 0;

    d.play(first.uniqueID); // 坟墓空 → +0
    expect(d.player.mana).toBe(0);
    expect(zoneOf(d.state, first.uniqueID)).toBe('burnt'); // 消耗
    expect(d.state.zones.hand).toHaveLength(4); // 剩余第二张 + 抽3

    d.play(second.uniqueID); // 坟墓1（首张）→ +1
    expect(d.player.mana).toBe(1);
    expect(d.state.zones.hand).toHaveLength(6); // 4 - 1 + 3
  });

  it('放手一搏：焚毁全部手牌，每张回2魏启，抽3', () => {
    // maxMana 8：避免回蓝被默认上限 3 截断
    const d = makeDriver(
      ['allIn', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      [tank()], { maxMana: 8 });
    const allIn = toHand(d, 'allIn');
    toHand(d, 'punch');
    toHand(d, 'punch');
    d.player.mana = 0;

    d.play(allIn.uniqueID);
    expect(d.state.zones.burnt).toHaveLength(3); // 两张拳 + 自身消耗
    expect(d.player.mana).toBe(4); // 2 × 2
    expect(d.state.zones.hand).toHaveLength(3); // 抽3
  });
});

describe('通用单卡：火源归一 / 火墙 / 含焰术 / 膨胀', () => {
  it('火源归一：吸纳全场燃烧，每层3护盾', () => {
    const d = makeDriver(['gatherFlame', 'punch', 'punch', 'punch'], [tank(), tank()]);
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 3 }));
    for (const e of d.state.enemies) {
      d.dispatch(new AddEffectInstruction({ target: e, effectId: 'burn', stacks: 2 }));
    }
    toHand(d, 'gatherFlame');
    d.play('gatherFlame');
    expect(d.player.shield).toBe((3 + 2 + 2) * 3);
    expect(d.player.getEffectStacks('burn')).toBe(0);
    for (const e of d.state.enemies) expect(e.getEffectStacks('burn')).toBe(0);
  });

  it('火墙：阻挡下一次敌方攻击（自施燃烧照常跳伤），用后失效', () => {
    const d = makeDriver(['fireWall', 'punch', 'punch', 'punch'], [tank()], { maxMana: 8 });
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    toHand(d, 'fireWall');
    d.play('fireWall');
    expect(d.player.mana).toBe(8 - 4);
    expect(d.player.getEffectStacks('burn')).toBe(3);

    d.endTurn(); // 敌回合1：史莱姆攻击被阻挡；回合2开始：燃烧跳3
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 3); // 攻击 0 + 燃烧 3
    expect(d.player.getEffectStacks('burn')).toBe(2);

    d.endTurn(); // 敌回合2：史莱姆开盾；回合3开始：燃烧跳2
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 3 - 2);

    d.endTurn(); // 敌回合3：史莱姆再攻6——火墙已用尽，不再阻挡；回合4开始：燃烧跳1
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 3 - 2 - 6 - 1);
  });

  it('含焰术：防火1——燃烧结算被跳过（层数照常递减）', () => {
    const d = makeDriver(['fireWard', 'punch', 'punch', 'punch'], [tank()]);
    toHand(d, 'fireWard');
    d.play('fireWard');
    expect(d.player.getEffectStacks('fireproof')).toBe(1);
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 5 }));

    d.endTurn(); // 史莱姆攻6；回合2开始：燃烧伤害被防火跳过，层数 5→4
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6);
    expect(d.player.getEffectStacks('burn')).toBe(4);
  });

  it('膨胀：手牌上限+1（可抽满8张），自身燃烧5', () => {
    const d = makeDriver(['expand', ...Array(9).fill('punch')], [tank()]);
    toHand(d, 'expand');
    d.play('expand');
    expect(d.player.maxHandSize).toBe(8);
    expect(d.player.getEffectStacks('burn')).toBe(5);

    d.dispatch(new DrawCardsInstruction({ count: 8 })); // 上限8：可抽满8
    expect(d.state.zones.hand).toHaveLength(8);
    d.dispatch(new DrawCardsInstruction({ count: 5 })); // 已满：抽牌落空
    expect(d.state.zones.hand).toHaveLength(8);
  });
});

describe('通用咏唱：火焰精通 / 火焰亲和', () => {
  it('火焰精通：每消耗1魏启获得3护盾（含X费全耗）', () => {
    const d = makeDriver(
      ['fireMastery', 'fireBolt', 'flameBirth', 'punch', 'punch', 'punch'],
      [tank()]);
    toHand(d, 'fireMastery');
    toHand(d, 'fireBolt');
    toHand(d, 'flameBirth');
    d.player.mana = 5;

    d.play('fireMastery'); // 0费激活
    d.play('fireBolt'); // 消耗2 → +6护盾
    expect(d.player.shield).toBe(6);
    d.player.mana = 3;
    d.play('flameBirth'); // X=3 全耗 → +9护盾
    expect(d.player.shield).toBe(15);
    expect(d.player.mana).toBe(0);
  });

  it('火焰亲和：火灵脉牌魏启消耗-1，非火牌不减；X费火卡同享', () => {
    const d = makeDriver(
      ['fireAffinity', 'fireBolt', 'purify', 'flameBirth', 'punch', 'punch', 'punch'],
      [tank()]);
    toHand(d, 'fireAffinity');
    toHand(d, 'fireBolt');
    toHand(d, 'purify');
    toHand(d, 'flameBirth');
    d.player.mana = 5;

    d.play('fireAffinity'); // 激活
    d.play('fireBolt'); // 2-1=1
    expect(d.player.mana).toBe(4);
    d.play('purify'); // 非火：1MP 原价
    expect(d.player.mana).toBe(3);
    d.player.mana = 3;
    d.play('flameBirth'); // X 名义3、实扣 3-1=2（X 读打出时点蓝量）
    expect(d.player.mana).toBe(1);
    // 纳气层数：purify 的纳气2 + 焰生的纳气1（按名义效果结算，与费用减免无关）
    expect(d.player.getEffectStacks('naqi')).toBe(3);
  });
});

describe('边界：魏启不足 / 群伤终局截断', () => {
  it('蓝量1时火球术（2魏启）不可打出', () => {
    const d = makeDriver(['fireBall', 'punch', 'punch', 'punch'], [tank()]);
    d.player.mana = 1;
    toHand(d, 'fireBall');
    expect(() => d.play('fireBall')).toThrow('无法出牌');
  });

  it('群伤击杀唯一敌人：即时胜利，后续段被终局截断不炸', () => {
    const d = makeDriver(
      ['fireRain', 'punch', 'punch', 'punch'],
      [new Enemy({ defId: 'slime', name: '史莱姆', maxHp: 5 })],
      { maxMana: 4 });
    d.dispatch(new GainManaInstruction({ amount: 99 }));
    toHand(d, 'fireRain');
    d.play('fireRain');
    expect(d.verdict).toBe('victory');
    expect(d.isFinished()).toBe(true);
    expect(d.state.enemies[0].isDead()).toBe(true);
  });
});

describe('可燃血液系列（2026-09 稿：防御咏唱——每回合P5 护盾+自施燃烧）', () => {
  // C/B：1AP；A：0费（设计稿未写费用 → 缺省约定）。点亮不结算；
  // 每回合 P5 咏唱触发：护盾N + 自身燃烧3；解除后停泵、燃烧不回收。
  // 2026-09 稿：护盾 9/13/13。
  for (const [id, shield] of [['kindlingBlood', 9], ['kindlingBloodPlus', 13], ['kindlingBloodMaster', 13]]) {
    it(`${id}：点亮不结算，P5 触发护盾${shield}+燃烧3；解除后不再触发`, () => {
      const d = makeDriver([id, 'punch', 'punch'], [tank()], { maxMana: 4 });
      const card = toHand(d, id);
      d.play(id);
      expect(card.isActivated, id).toBe(true);
      expect(d.player.shield, id).toBe(0); // 打出不触发
      expect(d.player.getEffectStacks('burn'), id).toBe(0);

      d.dispatch(new ChantTriggerInstruction()); // P5 咏唱节拍
      expect(d.player.shield, id).toBe(shield);
      expect(d.player.getEffectStacks('burn'), id).toBe(3);

      d.dispatch(new ChantTriggerInstruction()); // 下回合节拍：持续触发
      expect(d.player.shield, id).toBe(shield * 2);
      expect(d.player.getEffectStacks('burn'), id).toBe(6);

      d.play(card.uniqueID); // 免费解除（非消耗 → 回牌库）
      expect(card.isActivated, id).toBe(false);
      expect(zoneOf(d.state, card.uniqueID), id).toBe('deck');

      d.dispatch(new ChantTriggerInstruction()); // 解除后空转
      expect(d.player.shield, id).toBe(shield * 2); // 不再加盾
      expect(d.player.getEffectStacks('burn'), id).toBe(6); // 燃烧不回收
    });
  }
});
