import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { registerSkill } from '../src/core/skills/registry.js';
import { zoneOf, firstAliveEnemy } from '../src/core/state/battleState.js';
import { BurnCardInstruction } from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';
import { PLAYER_BASE_HP } from '../src/core/state/player.js';

// ---- 火灵脉（焚卡 + 自伤）原型：压测 burn zone 与高副作用结算 ----

// 陨落星炎：1 蓝高伤，给自己叠 2 层燃烧
registerSkill({
  id: 'meteorFlame', name: '陨落星炎',
  cost: { mana: 1, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 12,
    }));
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: 'burn', stacks: 2,
    }));
    return true;
  },
});

// 焚烬术：焚掉手牌最左的一张牌，造成 10 伤害（发动中自身已离手，hand[0] 即最左其他牌）
registerSkill({
  id: 'pyreRite', name: '焚烬术',
  cost: { mana: 1, actionPoint: 1 },
  use(sctx) {
    const victim = sctx.battleState.zones.hand[0];
    if (victim) {
      sctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: victim.uniqueID }));
    }
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: sctx.player, target: firstAliveEnemy(sctx.battleState), amount: 10,
    }));
    return true;
  },
});

describe('火灵脉：陨落星炎（自伤叠燃烧）', () => {
  it('高伤打敌人，自己燃烧在自己回合开始跳伤并递减', () => {
    const d = new BattleDriver({
      deck: ['meteorFlame', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    d.play('meteorFlame');
    expect(slime.hp).toBe(20 - 12);
    expect(d.player.getEffectStacks('burn')).toBe(2);
    expect(d.player.hp).toBe(PLAYER_BASE_HP);

    d.endTurn(); // 敌方回合：史莱姆打 3 → 回合 2 开始：燃烧跳 2 穿透
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 2);
    expect(d.player.getEffectStacks('burn')).toBe(1);

    d.endTurn(); // 史莱姆第二动是开盾（无伤害）→ 回合 3 开始：燃烧跳 1，层数扣尽
    expect(d.player.hp).toBe(PLAYER_BASE_HP - 6 - 2 - 1);
    expect(d.player.getEffectStacks('burn')).toBe(0);
    expect(d.player.getEffect('burn')).toBeNull();
  });

  it('燃烧自伤致死判负（高副作用的终局结算）', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5,
    });
    d.start();
    d.player.hp = 2;
    d.dispatch(new AddEffectInstruction({ target: d.player, effectId: 'burn', stacks: 3 }));

    d.endTurn(); // 回合 2 开始：燃烧跳 3 穿透 → 自杀
    expect(d.player.isDead()).toBe(true);
    expect(d.verdict).toBe('defeat');
    expect(d.isFinished()).toBe(true);
  });
});

describe('火灵脉：焚卡（burn zone）', () => {
  it('焚烬术焚掉手牌最左其他牌进焚毁区', () => {
    const d = new BattleDriver({
      deck: ['pyreRite', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    const slime = d.state.enemies[0];
    d.start();

    const expectedVictim = d.state.zones.hand.find(c => c.defId !== 'pyreRite');
    d.play('pyreRite');
    expect(slime.hp).toBe(20 - 10);
    expect(zoneOf(d.state, expectedVictim.uniqueID)).toBe('burnt');
    expect(d.state.history.battle.burnt).toBe(1);
    expect(d.state.zones.hand).toHaveLength(2); // 4 - pyreRite - 焚1
  });

  it('焚毁区永不回库（牌库抽空直接落空，无重洗）', () => {
    const d = new BattleDriver({
      deck: ['pyreRite', 'punch', 'punch', 'punch'],
      enemies: ['slime'], seed: 5, config: { initialDraw: 4 },
    });
    d.start();
    const burntId = d.state.zones.hand.find(c => c.defId !== 'pyreRite').uniqueID;
    d.play('pyreRite'); // 焚 1 张；pyreRite 收尾落牌库底，剩 1 张 punch 留手

    // 指令级压测：焚牌库顶
    const deckTop = d.state.zones.deck[0];
    if (deckTop) d.dispatch(new BurnCardInstruction({ uniqueID: deckTop.uniqueID }));

    // 焚空手牌并抽空牌库：无重洗机制，焚毁牌不得复活
    for (const id of d.state.zones.hand.map(c => c.uniqueID)) {
      d.dispatch(new BurnCardInstruction({ uniqueID: id }));
    }
    d.endTurn(); // 回合 2 抽牌：牌库已空，抽牌直接落空（无重洗）
    expect(d.state.zones.hand).toHaveLength(0); // 无牌可抽：手牌保持空（证明无洗回）
    expect(zoneOf(d.state, burntId)).toBe('burnt');
    for (const card of d.state.zones.burnt) {
      expect(zoneOf(d.state, card.uniqueID)).toBe('burnt');
    }
  });
});
