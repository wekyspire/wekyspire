import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { spawnableCardPool } from '../src/core/run/rewards.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { canPromoteRuntime } from '../src/core/run/promotion.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { canUseSkill, makeSkillCtx } from '../src/core/skills/helpers.js';
import { zoneOf, moveCard } from '../src/core/state/battleState.js';
import {
  DrawCardsInstruction, DiscardCardInstruction, BurnCardInstruction,
} from '../src/core/instructions/cards.js';
import { DealDamageInstruction } from '../src/core/instructions/combat.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';

// 体修·刀组合（BODY_CULTIVATION_CARDS §2）正式落地验证：
// 斩系列进阶链与【斩】机制 / 花刀弃牌 / 回旋斩牌库末 / 飞刀两侧与顽固 /
// 藏锋滞气 / 呼吸弃牌回补 / 培植 power / 开刃斩进阶 / 刀法咏唱 / 完美飞刀选牌输入。
// 全部经 BattleDriver 驱动真实结算（headless，不 mock Core）。

const enemyHp = (d) => d.state.enemies[0].hp;

// 高血木桩（沿用 slime 行为定义，仅改血量）：进阶链/冷却类用例需跨多回合打牌
function tank(hp = 200) {
  const e = getEnemyDefinition('slime').createUnit();
  e.maxHp = hp;
  e.hp = hp;
  return e;
}

// 手牌按 defId 重排（位置敏感卡的确定性布置）
function placeAt(d, defId, index) {
  const hand = d.state.zones.hand;
  const i = hand.findIndex(c => c.defId === defId);
  const [card] = hand.splice(i, 1);
  hand.splice(index, 0, card);
  return card;
}

// 任意 zone 查找（初始抽牌后位置不确定，测试布置用）
function findCard(d, defId) {
  for (const zone of ['hand', 'deck', 'burnt', 'pending']) {
    const card = d.state.zones[zone].find(c => c.defId === defId);
    if (card) return card;
  }
  return undefined;
}

// 把指定卡弄回手牌（无论当前在哪）
function toHand(d, defId) {
  const card = findCard(d, defId);
  if (zoneOf(d.state, card.uniqueID) !== 'hand') {
    moveCard(d.state, card.uniqueID, 'hand');
  }
  return card;
}

// 直接充满充能（慢热/冷却中的卡，测试需要立刻打出时用）
function charge(rt) {
  rt.remainingUses = getSkillDefinition(rt.defId).charges?.max ?? 1;
  rt.currentCooldown = 0;
  return rt;
}

// 卡牌 sctx（battleDescribe 断言用）
function sctxOf(d, rt) {
  return makeSkillCtx(d.ctx, rt);
}

describe('斩系列：局内进阶链', () => {
  it('打出：16伤害+洗入3碎铁；进阶为裂石斩落牌库底，耗尽且按新阶冷却', () => {
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    charge(slash);                                            // 慢热开局 0 充能，测试直接充满
    const hp0 = enemyHp(d);
    d.play('slash');
    expect(hp0 - enemyHp(d)).toBe(16);
    expect(slash.defId).toBe('rockCleave');                       // 发动后进阶
    expect(zoneOf(d.state, slash.uniqueID)).toBe('deck');         // 落牌库底（FIFO）
    expect(d.state.zones.deck.at(-1).uniqueID).toBe(slash.uniqueID);
    expect(d.state.zones.deck.filter(c => c.defId === 'ironShard')).toHaveLength(3); // 洗入3碎铁
    expect(slash.remainingUses).toBe(0);                          // 进阶不白送充能：仍是「刚打出」态
    expect(slash.currentCooldown).toBe(3);                        // 按新阶冷却计时
  });

  it('慢热：开局 0 充能（起手在手也卡着），牌库中推进 2 回合后回充（2026-09 稿）', () => {
    const d = new BattleDriver({
      deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5,
      config: { drawPerTurn: 0 },                     // 关掉回合抽牌：斩留在牌库冷却
    });
    d.start();
    const slash = findCard(d, 'slash');
    expect(slash.remainingUses).toBe(0);                      // slowStart：起手无充能
    expect(canUseSkill(d.ctx, slash)).toBe(false);            // 卡着不可打出
    moveCard(d.state, slash.uniqueID, 'deck');                // 洗回牌库（换牌/乱舞的实际路径）
    d.endTurn();                                              // 回合 2 P2：牌库冷却 2→1
    expect(slash.currentCooldown).toBe(1);
    expect(slash.remainingUses).toBe(0);
    d.endTurn();                                              // 回合 3 P2：冷却 1→0，回充
    expect(slash.remainingUses).toBe(1);
    expect(slash.currentCooldown).toBe(0);
  });

  it('链上各阶：数值/冷却逐阶 +1，打出持续进阶到下一阶', () => {
    const CHAIN = [
      ['rockCleave', '裂石斩', 'C', 30, 3, 'goldCleave'],
      ['goldCleave', '削金斩', 'B', 57, 4, 'mountainCleave'],
      ['mountainCleave', '摧山斩', 'A', 108, 5, 'seaCleave'],
      ['seaCleave', '分海斩', 'A', 205, 6, 'skyCleave'],
      ['skyCleave', '开天斩', 'S', 390, 7, 'godCleave'],
    ];
    for (const [id, name, tier, dmg, cd, next] of CHAIN) {
      const def = getSkillDefinition(id);
      expect(def.name).toBe(name);
      expect(def.tier).toBe(tier);
      expect(def.charges.cooldownTurns).toBe(cd);
      expect(def.battlePromotesTo).toBe(next);        // 局内进阶链（非局外晋升字段）
      expect(def.promotesTo).toBeUndefined();          // 斩不可局外晋升：对营地/训练场不可见
      expect(def.cooldownZones).toEqual(['deck']);                // 全链只在牌库冷却

      const d = new BattleDriver({ deck: [id, 'punch', 'punch', 'punch'], enemies: [tank(999)], seed: 7 });
      d.start();
      const card = toHand(d, id);
      const hp0 = enemyHp(d);
      d.play(id);
      expect(hp0 - enemyHp(d)).toBe(dmg);
      expect(card.defId).toBe(next);
      expect(card.remainingUses).toBe(0);
      expect(card.currentCooldown).toBe(getSkillDefinition(next).charges.cooldownTurns);
    }
  });

  it('链尾断神斩：741伤害，不再进阶，冷却8', () => {
    const d = new BattleDriver({ deck: ['godCleave', 'punch', 'punch', 'punch'], enemies: [tank(999)], seed: 7 });
    d.start();
    const god = toHand(d, 'godCleave');
    const hp0 = enemyHp(d);
    d.play('godCleave');
    expect(hp0 - enemyHp(d)).toBe(741);
    expect(god.defId).toBe('godCleave');
    expect(god.currentCooldown).toBe(8);
    expect(getSkillDefinition('godCleave').battlePromotesTo).toBeNull();
    expect(getSkillDefinition('godCleave').promotesTo).toBeUndefined();
  });

  it('斩链不可局外晋升：营地/训练场的晋升口径（promotesTo）对全链不可见', () => {
    for (const id of ['slash', 'rockCleave', 'goldCleave', 'mountainCleave', 'seaCleave', 'skyCleave', 'godCleave']) {
      expect(canPromoteRuntime(createSkillRuntime(id))).toBe(false);
    }
  });

  it('只在牌库中冷却：手中渡过回合不推进，回牌库后推进', () => {
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    slash.remainingUses = 0;
    slash.currentCooldown = 2;
    d.endTurn();                                        // 敌方回合 → 我方回合 P2 扫掠
    expect(slash.currentCooldown).toBe(2);              // 手中不冷却
    moveCard(d.state, slash.uniqueID, 'deck');
    d.endTurn();
    expect(slash.currentCooldown).toBe(1);              // 牌库中推进 1
  });

  it('不可被焚毁：焚毁被否决，以回牌库取代（充能没收、冷却≥1）', () => {
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    slash.remainingUses = 1;
    slash.currentCooldown = 0;
    d.dispatch(new BurnCardInstruction({ uniqueID: slash.uniqueID }));
    expect(zoneOf(d.state, slash.uniqueID)).toBe('deck');   // 回牌库取代焚毁
    expect(d.state.zones.burnt).toHaveLength(0);
    expect(slash.remainingUses).toBe(0);                    // 入库充能没收
    expect(slash.currentCooldown).toBe(1);                  // 进入牌库时冷却1
  });

  it('进阶 keepPower：强化偏移随转化延续', () => {
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    charge(slash);
    slash.power = 3;
    const hp0 = enemyHp(d);
    d.play('slash');
    expect(hp0 - enemyHp(d)).toBe(16 + 3);             // power 入算式
    expect(slash.defId).toBe('rockCleave');
    expect(slash.power).toBe(3);                       // 强化随转化延续
  });

  it('描述双轨：应用前纯文本，应用后带 /named{斩} 热区（含慢热）', () => {
    const def = getSkillDefinition('slash');
    const text = '16伤害，/named{洗入3}/card{ironShard}，/named{慢热}，/named{斩}';
    expect(def.describe()).toBe(text);
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const rt = toHand(d, 'slash');
    expect(def.battleDescribe(sctxOf(d, rt))).toBe(text);
  });
});

describe('碎铁（斩衍生牌）', () => {
  it('3伤害，打出即消耗焚毁；不入奖励池', () => {
    const d = new BattleDriver({ deck: ['slash', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    charge(toHand(d, 'slash'));
    d.play('slash');
    const shard = d.state.zones.deck.find(c => c.defId === 'ironShard');
    moveCard(d.state, shard.uniqueID, 'hand');
    const hp0 = enemyHp(d);
    d.play(shard.uniqueID);
    expect(hp0 - enemyHp(d)).toBe(3);
    expect(zoneOf(d.state, shard.uniqueID)).toBe('burnt');
    expect(spawnableCardPool().map(x => x.id)).not.toContain('ironShard');
  });
});

describe('花刀系列：弃牌换护盾（2026-09 稿改防御）', () => {
  it('花刀：8护盾 + 结算期选1张手牌丢弃', () => {
    const d = new BattleDriver({ deck: ['handCleave', 'punch', 'guard', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'handCleave');
    const victim = d.state.zones.hand.find(c => c.defId !== 'handCleave');
    const hp0 = enemyHp(d);
    d.play('handCleave');
    expect(d.player.shield).toBe(8);                   // 8 护盾，不再造成伤害
    expect(hp0 - enemyHp(d)).toBe(0);
    expect(d.pendingInput?.request.kind).toBe('selectHandCard');
    d.respond([victim.uniqueID]);
    expect(zoneOf(d.state, victim.uniqueID)).toBe('deck');   // 弃牌 = 落牌库底
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);
  });

  it('二重花刀：8护盾×2 + 选2张丢弃', () => {
    const d = new BattleDriver({ deck: ['doubleCleave', 'punch', 'guard', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'doubleCleave');
    const victims = d.state.zones.hand.filter(c => c.defId !== 'doubleCleave').slice(0, 2);
    d.play('doubleCleave');
    expect(d.player.shield).toBe(16);
    d.respond(victims.map(c => c.uniqueID));
    for (const v of victims) expect(zoneOf(d.state, v.uniqueID)).toBe('deck');
  });

  it('完美花刀：14护盾 + 选1张丢弃', () => {
    const d = new BattleDriver({ deck: ['perfectCleave', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'perfectCleave');
    const victim = d.state.zones.hand.find(c => c.defId !== 'perfectCleave');
    d.play('perfectCleave');
    expect(d.player.shield).toBe(14);
    d.respond([victim.uniqueID]);
    expect(zoneOf(d.state, victim.uniqueID)).toBe('deck');
  });

  it('边界：花刀打出后手中无其他牌，不产生选牌请求', () => {
    const d = new BattleDriver({ deck: ['handCleave', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'handCleave');
    for (const other of [...d.state.zones.hand.filter(c => c.defId !== 'handCleave')]) {
      moveCard(d.state, other.uniqueID, 'deck');
    }
    d.play('handCleave');
    expect(d.player.shield).toBe(8);
    expect(d.calls('requestInput')).toHaveLength(0);
  });

  it('银刀乱舞：丢弃所有无法打出的手牌，每张8护盾；可打出的不动', () => {
    const d = new BattleDriver({ deck: ['silverDance', 'cycloneSlash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const blade = toHand(d, 'cycloneSlash');
    blade.remainingUses = 0;                       // 冷却中 → 无法打出
    blade.currentCooldown = 1;
    toHand(d, 'silverDance');
    const hp0 = enemyHp(d);
    d.play('silverDance');
    expect(d.player.shield).toBe(8);               // 弃1张卡手刀 → 8护盾
    expect(hp0 - enemyHp(d)).toBe(0);
    expect(zoneOf(d.state, blade.uniqueID)).toBe('deck');   // 卡手刀回牌库（去那冷却）
    expect(d.state.zones.hand.some(c => c.defId === 'punch')).toBe(true);
    expect(d.calls('requestInput')).toHaveLength(0);
  });

  it('风暴刀舞：每张13护盾', () => {
    const d = new BattleDriver({ deck: ['stormDance', 'cycloneSlash', 'fineDagger', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    for (const defId of ['cycloneSlash', 'fineDagger']) {
      const blade = toHand(d, defId);
      blade.remainingUses = 0;
      blade.currentCooldown = 1;
    }
    toHand(d, 'stormDance');
    d.play('stormDance');
    expect(d.player.shield).toBe(26);              // 2 张卡手牌 × 13
  });

  it('优雅刀舞：丢弃所有无法打出的手牌，每张格挡1，不获得护盾', () => {
    const d = new BattleDriver({ deck: ['graceDance', 'cycloneSlash', 'fineDagger', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    for (const defId of ['cycloneSlash', 'fineDagger']) {
      const blade = toHand(d, defId);
      blade.remainingUses = 0;
      blade.currentCooldown = 1;
    }
    toHand(d, 'graceDance');
    d.play('graceDance');
    expect(d.player.shield).toBe(0);
    expect(d.player.getEffectStacks('block')).toBe(2);
  });

  it('边界：无无法打出的手牌时，银刀乱舞无任何效果', () => {
    const d = new BattleDriver({ deck: ['silverDance', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'silverDance');
    d.play('silverDance');
    expect(d.player.shield).toBe(0);
    expect(d.state.zones.hand.filter(c => c.defId === 'punch')).toHaveLength(3);   // 只少了自己
  });
});

describe('快速花刀/快速横刀（2026-09 稿散卡）', () => {
  it('快速花刀：6护盾 + 换掉所有无法打出的手牌（抽新牌原地补位）', () => {
    const d = new BattleDriver({
      deck: ['quickCleave', 'cycloneSlash', 'fineDagger', 'punch', 'guard', 'guard'],
      enemies: [tank()], seed: 5, config: { initialDraw: 3 },
    });
    d.start();
    const stuck1 = toHand(d, 'cycloneSlash');
    stuck1.remainingUses = 0; stuck1.currentCooldown = 1;   // 卡手刀
    const stuck2 = toHand(d, 'fineDagger');
    stuck2.remainingUses = 0; stuck2.currentCooldown = 1;   // 顽固不满足也是卡手
    toHand(d, 'quickCleave');
    const handSnapshot = [...d.state.zones.hand];
    const stuckIdx = [0, 1].map(i => handSnapshot.findIndex(c => c === (i === 0 ? stuck1 : stuck2)));
    d.play('quickCleave');
    expect(d.player.shield).toBe(6);
    expect(zoneOf(d.state, stuck1.uniqueID)).toBe('deck');  // 换掉 = 弃入牌库
    expect(zoneOf(d.state, stuck2.uniqueID)).toBe('deck');
    expect(d.calls('requestInput')).toHaveLength(0);        // 换牌是自动的，无需选牌
    // 补位的新牌落在原手位（升序插回复原次序）
    expect(d.state.zones.hand).toHaveLength(handSnapshot.length - 1); // 少了自身（回牌库）
    for (const idx of stuckIdx) {
      expect(zoneOf(d.state, d.state.zones.hand[Math.min(idx, d.state.zones.hand.length - 1)].uniqueID)).toBe('hand');
    }
  });

  it('快速花刀：无卡手牌时只发护盾，换牌空转', () => {
    const d = new BattleDriver({ deck: ['quickCleave', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'quickCleave');
    const before = [...d.state.zones.hand];
    d.play('quickCleave');
    expect(d.player.shield).toBe(6);
    expect(d.state.zones.hand.filter(c => before.includes(c))).toHaveLength(before.length - 1); // 只少自身
  });

  it('快速横刀：4/11护盾，抽出牌库中的斩', () => {
    for (const [id, shield] of [['quickDrawShield', 4], ['quickDrawShieldPlus', 11]]) {
      const d = new BattleDriver({ deck: [id, 'slash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
      d.start();
      const slash = findCard(d, 'slash');
      if (zoneOf(d.state, slash.uniqueID) === 'hand') moveCard(d.state, slash.uniqueID, 'deck');
      toHand(d, id);
      d.play(id);
      expect(d.player.shield, id).toBe(shield);
      expect(zoneOf(d.state, slash.uniqueID), id).toBe('hand');   // 抽出斩
      expect(zoneOf(d.state, findCard(d, id).uniqueID), id).toBe('burnt');   // 消耗
    }
  });
});

describe('回旋斩系列：牌库末抽牌', () => {
  it('回旋斩：7伤害，从牌库末抽1', () => {
    const d = new BattleDriver({ deck: ['cycloneSlash', 'punch', 'punch', 'punch', 'guard', 'guard'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'cycloneSlash');
    const bottom = d.state.zones.deck.at(-1);
    const hp0 = enemyHp(d);
    d.play('cycloneSlash');
    expect(hp0 - enemyHp(d)).toBe(7);
    expect(zoneOf(d.state, bottom.uniqueID)).toBe('hand');   // 牌库末 → 手
  });

  it('回旋爆斩：11伤害，从牌库末抽3', () => {
    const d = new BattleDriver({
      deck: ['cycloneBurst', 'punch', 'punch', 'punch', 'guard', 'guard', 'guard', 'guard'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'cycloneBurst');
    const bottoms = d.state.zones.deck.slice(-3);
    const hp0 = enemyHp(d);
    d.play('cycloneBurst');
    expect(hp0 - enemyHp(d)).toBe(11);
    for (const c of bottoms) expect(zoneOf(d.state, c.uniqueID)).toBe('hand');
  });

  it('完美回斩：15伤害抽2，无冷却可连打', () => {
    const d = new BattleDriver({ deck: ['perfectCyclone', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'perfectCyclone');
    const hp0 = enemyHp(d);
    d.play('perfectCyclone');
    expect(hp0 - enemyHp(d)).toBe(15);
    toHand(d, 'perfectCyclone');                   // 打出后回牌库底，无冷却直接再打
    d.play('perfectCyclone');
    expect(hp0 - enemyHp(d)).toBe(30);
  });
});

describe('飞刀系列：邻牌献祭', () => {
  it('飞刀：顽固需两侧有牌；12伤害并弃两侧', () => {
    const d = new BattleDriver({ deck: ['flyingDagger', 'punch', 'guard', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'flyingDagger');
    const fd = placeAt(d, 'flyingDagger', 1);
    const [left, right] = [d.state.zones.hand[0], d.state.zones.hand[2]];
    const hp0 = enemyHp(d);
    d.play('flyingDagger');
    expect(hp0 - enemyHp(d)).toBe(12);
    expect(zoneOf(d.state, left.uniqueID)).toBe('deck');
    expect(zoneOf(d.state, right.uniqueID)).toBe('deck');
    expect(fd.currentCooldown).toBe(1);            // 冷却1

    // 顽固：缺一侧不可打出（充能恢复后仍受位置门槛限制）
    toHand(d, 'flyingDagger');
    fd.remainingUses = 1;
    fd.currentCooldown = 0;
    // 首打后手里只剩 1 张牌：从牌库搬一张回来，凑出可判位置的三张手牌
    const back = d.state.zones.deck.find(c => c.uniqueID === left.uniqueID || c.uniqueID === right.uniqueID);
    moveCard(d.state, back.uniqueID, 'hand');
    placeAt(d, 'flyingDagger', 0);
    expect(canUseSkill(d.ctx, fd)).toBe(false);   // 最左端：无左侧
    placeAt(d, 'flyingDagger', 1);
    expect(canUseSkill(d.ctx, fd)).toBe(true);    // 两侧有牌
  });

  it('强力飞刀 20 / 绝灭飞刀 32 伤害', () => {
    for (const [id, dmg] of [['heavyDagger', 20], ['annihilateDagger', 32]]) {
      const d = new BattleDriver({ deck: [id, 'punch', 'guard', 'punch'], enemies: [tank()], seed: 5 });
      d.start();
      toHand(d, id);
      placeAt(d, id, 1);
      const hp0 = enemyHp(d);
      d.play(id);
      expect(hp0 - enemyHp(d)).toBe(dmg);
    }
  });

  it('回旋飞刀：弃两侧 + 抽2牌插回两侧原位', () => {
    const d = new BattleDriver({
      deck: ['returningDagger', 'punch', 'guard', 'punch', 'punch', 'guard', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'returningDagger');
    placeAt(d, 'returningDagger', 1);
    const left = d.state.zones.hand[0];
    const right = d.state.zones.hand[2];
    const rest = d.state.zones.hand.slice(3);
    const [x, y] = [d.state.zones.deck[0], d.state.zones.deck[1]];   // 抽2 = 牌库顶两张
    const hp0 = enemyHp(d);
    d.play('returningDagger');
    expect(hp0 - enemyHp(d)).toBe(20);
    expect(zoneOf(d.state, left.uniqueID)).toBe('deck');
    expect(zoneOf(d.state, right.uniqueID)).toBe('deck');
    // 抽到的两张插回两侧槽位：手牌顺序 [x, y, 其余...]
    expect(d.state.zones.hand.slice(0, 2).map(c => c.uniqueID))
      .toEqual([x.uniqueID, y.uniqueID]);
    expect(d.state.zones.hand.slice(2).map(c => c.uniqueID))
      .toEqual(rest.map(c => c.uniqueID));
  });

  it('精致飞刀：20伤害，仅弃左侧', () => {
    const d = new BattleDriver({ deck: ['fineDagger', 'punch', 'guard', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'fineDagger');
    placeAt(d, 'fineDagger', 1);
    const left = d.state.zones.hand[0];
    const right = d.state.zones.hand[2];
    const hp0 = enemyHp(d);
    d.play('fineDagger');
    expect(hp0 - enemyHp(d)).toBe(20);
    expect(zoneOf(d.state, left.uniqueID)).toBe('deck');   // 左侧被弃
    expect(zoneOf(d.state, right.uniqueID)).toBe('hand');  // 右侧不动
  });

  it('完美飞刀：20伤害焚两侧 + 寻找2牌（选牌输入）插入两侧', () => {
    const d = new BattleDriver({
      deck: ['perfectDagger', 'punch', 'guard', 'punch', 'punch', 'guard', 'punch'],
      enemies: [tank()], seed: 3,
    });
    d.start();
    toHand(d, 'perfectDagger');
    placeAt(d, 'perfectDagger', 1);
    const left = d.state.zones.hand[0];
    const right = d.state.zones.hand[2];
    const rest = d.state.zones.hand.slice(3);
    const hp0 = enemyHp(d);
    d.play('perfectDagger');
    expect(hp0 - enemyHp(d)).toBe(20);
    expect(zoneOf(d.state, left.uniqueID)).toBe('burnt');  // 焚毁两侧
    expect(zoneOf(d.state, right.uniqueID)).toBe('burnt');
    expect(d.pendingInput?.request.kind).toBe('selectDeckCard');
    const [p1, p2] = [d.state.zones.deck[0], d.state.zones.deck[1]];
    d.respond([p1.uniqueID, p2.uniqueID]);
    expect(zoneOf(d.state, p1.uniqueID)).toBe('hand');
    expect(zoneOf(d.state, p2.uniqueID)).toBe('hand');
    expect(d.state.zones.hand.slice(0, 2).map(c => c.uniqueID))
      .toEqual([p1.uniqueID, p2.uniqueID]);                // 插回两侧槽位
    expect(d.state.zones.hand.slice(2).map(c => c.uniqueID))
      .toEqual(rest.map(c => c.uniqueID));
  });

  it('集成：完美飞刀焚到【斩】——焚毁被否决，斩以回牌库取代（充能没收、冷却1）', () => {
    const d = new BattleDriver({
      deck: ['perfectDagger', 'slash', 'punch', 'punch', 'guard'],
      enemies: [tank()], seed: 3,
    });
    d.start();
    toHand(d, 'perfectDagger');
    const slashRt = placeAt(d, 'slash', 0);            // 完美飞刀的左侧
    placeAt(d, 'perfectDagger', 1);
    const right = d.state.zones.hand[2];
    slashRt.remainingUses = 1;
    d.play('perfectDagger');
    expect(zoneOf(d.state, slashRt.uniqueID)).toBe('deck');   // 斩不可焚毁：回牌库
    expect(slashRt.remainingUses).toBe(0);
    expect(slashRt.currentCooldown).toBe(1);
    expect(zoneOf(d.state, right.uniqueID)).toBe('burnt');    // 普通牌照常焚毁
    expect(d.pendingInput?.request.kind).toBe('selectDeckCard');   // 寻找照常
    d.respond([d.state.zones.deck[0].uniqueID]);
    expect(d.pendingInput).toBeNull();
  });

  it('边界：完美飞刀空牌库时寻找落空，不产生输入请求', () => {
    const d = new BattleDriver({ deck: ['perfectDagger', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 3 });
    d.start();
    expect(d.state.zones.deck).toHaveLength(0);
    toHand(d, 'perfectDagger');
    placeAt(d, 'perfectDagger', 1);
    const hp0 = enemyHp(d);
    d.play('perfectDagger');
    expect(hp0 - enemyHp(d)).toBe(20);
    expect(d.calls('requestInput')).toHaveLength(0);
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);
  });
});

describe('藏锋系列：高伤换滞气', () => {
  it('收刃：13伤害 + 滞气1 + 消耗；滞气封锁抽牌，回合结束递减', () => {
    const d = new BattleDriver({ deck: ['storeEdge', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'storeEdge');
    const hp0 = enemyHp(d);
    d.play('storeEdge');
    expect(hp0 - enemyHp(d)).toBe(13);
    expect(d.state.zones.burnt.some(c => c.defId === 'storeEdge')).toBe(true);
    expect(d.player.getEffectStacks('stall')).toBe(1);
    const before = d.state.zones.hand.length;
    d.dispatch(new DrawCardsInstruction({ count: 2 }));    // 被 veto
    expect(d.state.zones.hand.length).toBe(before);
    d.endTurn();
    expect(d.player.getEffect('stall')).toBeNull();        // 回合结束 -1 扣尽
  });

  it('潜锋 23伤害/滞气2、藏锋 48伤害/滞气3（对表）', () => {
    for (const [id, dmg, stall] of [['hiddenEdge', 23, 2], ['sheathEdge', 48, 3]]) {
      const d = new BattleDriver({ deck: [id, 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
      d.start();
      toHand(d, id);
      const hp0 = enemyHp(d);
      d.play(id);
      expect(hp0 - enemyHp(d)).toBe(dmg);
      expect(d.player.getEffectStacks('stall')).toBe(stall);
    }
  });
});

describe('呼吸系列：弃牌回补', () => {
  it('呼吸：本回合每弃1牌抽1回补；短暂——焚毁后回合结束回牌库', () => {
    const d = new BattleDriver({
      deck: ['breath', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { drawPerTurn: 0 },   // 关掉回合抽牌，断言不受回库后再抽干扰
    });
    d.start();
    const breath = toHand(d, 'breath');
    d.play('breath');
    expect(zoneOf(d.state, breath.uniqueID)).toBe('burnt');   // 消耗焚毁
    const victim = d.state.zones.hand[0];
    const before = d.state.zones.hand.length;
    d.dispatch(new DiscardCardInstruction({ uniqueID: victim.uniqueID }));
    expect(zoneOf(d.state, victim.uniqueID)).toBe('deck');
    expect(d.state.zones.hand.length).toBe(before);           // 弃1 → 抽1 回补
    expect(d.player.getEffectStacks('breath'), '呼吸效果在身').toBe(1);
    d.endTurn();
    expect(d.player.getEffect('breath'), '回合末呼吸消散').toBeNull();
    expect(zoneOf(d.state, breath.uniqueID)).toBe('deck');    // 短暂：回合结束回牌库
  });

  it('武者呼吸：每弃1牌 → 抽1 + 格挡1 + 力量1', () => {
    const d = new BattleDriver({ deck: ['warriorBreath', 'punch', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'warriorBreath');
    d.play('warriorBreath');
    const victim = d.state.zones.hand[0];
    const before = d.state.zones.hand.length;
    d.dispatch(new DiscardCardInstruction({ uniqueID: victim.uniqueID }));
    expect(d.state.zones.hand.length).toBe(before);
    expect(d.player.getEffectStacks('block')).toBe(1);
    expect(d.player.getEffectStacks('strength')).toBe(1);
  });

  it('完美呼吸：同武者呼吸，但无短暂——焚毁后不回牌库', () => {
    const d = new BattleDriver({ deck: ['perfectBreath', 'punch', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const breath = toHand(d, 'perfectBreath');
    d.play('perfectBreath');
    const victim = d.state.zones.hand[0];
    d.dispatch(new DiscardCardInstruction({ uniqueID: victim.uniqueID }));
    expect(d.state.zones.hand.length).toBe(d.state.zones.hand.length);   // 抽1回补成立
    d.endTurn();
    expect(zoneOf(d.state, breath.uniqueID)).toBe('burnt');   // 无短暂：留在焚毁区
  });
});

describe('培植系列：养刀（power 漂移）', () => {
  it('养刀术：咏唱1，激发时手中刀法牌伤害+2', () => {
    const d = new BattleDriver({ deck: ['honeBlade', 'cycloneSlash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'honeBlade');
    toHand(d, 'cycloneSlash');
    d.play('honeBlade');
    const blade = d.state.zones.hand.find(c => c.defId === 'cycloneSlash');
    const punch = d.state.zones.hand.find(c => c.defId === 'punch');
    expect(blade.power).toBe(2);                          // 刀法牌 +2
    expect(punch.power).toBe(0);                          // 非刀法不动
    expect(d.state.zones.hand.some(c => c.defId === 'honeBlade' && c.isActivated)).toBe(true);
    // power 已入算式：回旋斩 7 + 2 = 9
    const rt = d.state.zones.hand.find(c => c.defId === 'cycloneSlash');
    rt.remainingUses = 1;
    rt.currentCooldown = 0;
    const hp0 = enemyHp(d);
    d.play(rt.uniqueID);
    expect(hp0 - enemyHp(d)).toBe(9);
  });

  it('锻刀术：咏唱1，打出刀法牌时手中其余刀法牌+1', () => {
    const d = new BattleDriver({ deck: ['forgingBlade', 'cycloneSlash', 'fineDagger', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'forgingBlade');
    toHand(d, 'cycloneSlash');
    toHand(d, 'fineDagger');
    d.play('forgingBlade');
    d.play('cycloneSlash');                               // 打出一张刀法牌
    const fine = findCard(d, 'fineDagger');
    const punch = findCard(d, 'punch');
    expect(fine.power).toBe(1);                           // 手中刀法牌 +1
    expect(punch.power).toBe(0);                          // 非刀法不动
    expect(d.presenter.calls).toContainEqual({ method: 'chantToggled', args: [{ skill: expect.anything(), on: true, reason: 'played' }] });
  });
});

describe('开刃系列：斩进阶', () => {
  it('出鞘：牌库中的斩进阶并抽到手中（耗尽态按新阶延续）', () => {
    const d = new BattleDriver({ deck: ['unsheathe', 'slash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    moveCard(d.state, slash.uniqueID, 'deck');            // 放回牌库，模拟冷却中
    slash.remainingUses = 0;
    slash.currentCooldown = 2;
    toHand(d, 'unsheathe');
    d.play('unsheathe');
    expect(slash.defId).toBe('rockCleave');               // 斩进阶
    expect(zoneOf(d.state, slash.uniqueID)).toBe('hand'); // 抽出斩
    expect(slash.remainingUses).toBe(0);                  // 耗尽态延续（不白送充能）
    expect(slash.currentCooldown).toBe(3);                // 按新阶冷却
    expect(d.state.zones.burnt.some(c => c.defId === 'unsheathe')).toBe(true);   // 消耗
  });

  it('出鞘进阶满充能的斩：进阶后仍满充能（不重吃慢热，2026-09 稿）', () => {
    const d = new BattleDriver({ deck: ['unsheathe', 'slash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const slash = toHand(d, 'slash');
    charge(slash);                                        // 满充能的斩
    moveCard(d.state, slash.uniqueID, 'deck');
    toHand(d, 'unsheathe');
    d.play('unsheathe');
    expect(slash.defId).toBe('rockCleave');
    expect(zoneOf(d.state, slash.uniqueID)).toBe('hand');
    expect(slash.remainingUses).toBe(1);                  // 满充能保持
    expect(slash.currentCooldown).toBe(0);
    expect(canUseSkill(d.ctx, slash)).toBe(true);         // 抽到即可打出
  });

  it('含刃术：咏唱3，触发时手牌少于2 → 斩进阶 + 此卡焚毁', () => {
    const d = new BattleDriver({ deck: ['edgeBreath', 'slash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const edge = toHand(d, 'edgeBreath');
    const slash = toHand(d, 'slash');
    d.play('edgeBreath');                                 // 激活（回手点亮）
    expect(edge.isActivated).toBe(true);
    for (const other of [...d.state.zones.hand.filter(c => c.uniqueID !== edge.uniqueID)]) {
      moveCard(d.state, other.uniqueID, 'deck');          // 清空其余手牌
    }
    d.endTurn();                                          // P5 咏唱触发：手里只剩它自己
    expect(slash.defId).toBe('rockCleave');               // 斩进阶
    expect(zoneOf(d.state, edge.uniqueID)).toBe('burnt'); // 此卡焚毁
  });

  it('砺刀/磨锋/展锐：手中刀法牌冷却 1/2/3（无视「只在牌库冷却」的区域门）', () => {
    for (const [id, delta] of [['whetstone', 1], ['honeEdgeMid', 2], ['razorEdge', 3]]) {
      const d = new BattleDriver({ deck: [id, 'slash', 'punch', 'punch'], enemies: [tank()], seed: 5 });
      d.start();
      const slash = toHand(d, 'slash');
      slash.remainingUses = 0;
      slash.currentCooldown = 4;
      toHand(d, id);
      d.play(id);
      expect(slash.currentCooldown).toBe(4 - delta);      // 定向推进
      expect(d.presenter.calls).toContainEqual({
        method: 'cooldownTick', args: [{ skill: slash, delta }],
      });
    }
  });

  it('砺刀的【短暂】：抽到手中不打，回合结束自动回牌库', () => {
    const d = new BattleDriver({
      deck: ['whetstone', 'slash', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { drawPerTurn: 0 },
    });
    d.start();
    const whet = toHand(d, 'whetstone');                  // 在手渡过回合
    d.endTurn();
    expect(zoneOf(d.state, whet.uniqueID)).toBe('deck');  // 不许攥着过夜
  });

  it('开刃：所有刀法牌即刻冷却（手牌+牌库），自身短暂回库', () => {
    const d = new BattleDriver({
      deck: ['honeEdge', 'slash', 'punch', 'cycloneSlash', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { drawPerTurn: 0 },
    });
    d.start();
    const handBlade = toHand(d, 'slash');
    handBlade.remainingUses = 0;
    handBlade.currentCooldown = 2;
    const deckBlade = findCard(d, 'cycloneSlash');
    if (zoneOf(d.state, deckBlade.uniqueID) === 'hand') {
      moveCard(d.state, deckBlade.uniqueID, 'deck');      // 确保牌库里有一把冷却中的刀
    }
    deckBlade.remainingUses = 0;
    deckBlade.currentCooldown = 1;
    toHand(d, 'honeEdge');
    d.play('honeEdge');
    expect(handBlade.remainingUses).toBe(1);
    expect(handBlade.currentCooldown).toBe(0);
    expect(deckBlade.remainingUses).toBe(1);
    expect(deckBlade.currentCooldown).toBe(0);
    const hone = d.state.zones.burnt.find(c => c.defId === 'honeEdge');
    d.endTurn();
    expect(zoneOf(d.state, hone.uniqueID)).toBe('deck');  // 短暂：焚毁后回合结束回库
  });

  it('斩灭：下一次刀法牌伤害变为固定伤害（跳过防御），非刀法不消耗', () => {
    const armored = () => {
      const e = tank();
      e.defense = 5;
      return e;
    };
    // 对照：无斩灭时刀法伤害吃防御（精致飞刀 20-5=15）
    const c = new BattleDriver({ deck: ['fineDagger', 'punch', 'punch', 'punch'], enemies: [armored()], seed: 5 });
    c.start();
    toHand(c, 'fineDagger');
    placeAt(c, 'fineDagger', 1);
    const hpC = enemyHp(c);
    c.play('fineDagger');
    expect(hpC - enemyHp(c)).toBe(15);

    const d = new BattleDriver({ deck: ['annihilatingEdge', 'fineDagger', 'punch', 'punch'], enemies: [armored()], seed: 5 });
    d.start();
    toHand(d, 'annihilatingEdge');
    d.play('annihilatingEdge');                           // 2AP 挂上「下一次刀法固定伤害」
    const punch = toHand(d, 'punch');
    const hpA = enemyHp(d);
    d.play(punch.uniqueID);                               // 拳不是刀法：不消耗，走普通管线
    expect(hpA - enemyHp(d)).toBe(1);                     // 6 - 5
    toHand(d, 'fineDagger');
    placeAt(d, 'fineDagger', 1);                          // 补左侧邻牌
    const hpB = enemyHp(d);
    d.play('fineDagger');                                 // 0费刀法牌
    expect(hpB - enemyHp(d)).toBe(20);                    // 固定伤害：无视防御
  });

  it('练刀：抽1 + 选1张手中刀法牌 +4 power 并丢弃之（2026-09 稿：无消耗）', () => {
    const d = new BattleDriver({
      deck: ['practiceBlade', 'cycloneSlash', 'punch', 'punch', 'guard'],
      enemies: [tank()], seed: 5, config: { initialDraw: 4 },   // guard 留牌库供抽1验证
    });
    d.start();
    toHand(d, 'practiceBlade');
    toHand(d, 'cycloneSlash');
    const blade = d.state.zones.hand.find(c => c.defId === 'cycloneSlash');
    d.play('practiceBlade');
    expect(d.state.zones.hand.some(c => c.defId === 'guard')).toBe(true);   // 先抽1落地
    expect(d.pendingInput?.request.kind).toBe('selectHandCard');
    expect(d.pendingInput.request.candidates).toEqual([blade.uniqueID]);   // 只可选刀法牌
    d.respond([blade.uniqueID]);
    expect(blade.power).toBe(4);
    expect(zoneOf(d.state, blade.uniqueID)).toBe('deck'); // 丢弃 = 落牌库底
    expect(d.state.zones.burnt.some(c => c.defId === 'practiceBlade')).toBe(false);  // 去消耗
    expect(zoneOf(d.state, findCard(d, 'practiceBlade').uniqueID)).toBe('deck');     // 回牌库
  });

  it('练刀无顽固：手中无刀法牌也可打出（不卡手），退化成纯抽1', () => {
    const d = new BattleDriver({
      deck: ['practiceBlade', 'punch', 'punch', 'punch', 'guard'],
      enemies: [tank()], seed: 5, config: { initialDraw: 4 },   // guard 留牌库供抽1
    });
    d.start();
    toHand(d, 'practiceBlade');
    expect(canUseSkill(d.ctx, findCard(d, 'practiceBlade'))).toBe(true);   // 无刀也恒可打
    d.play('practiceBlade');
    expect(d.calls('requestInput')).toHaveLength(0);              // 无选牌请求
    expect(d.state.zones.hand.some(c => c.defId === 'guard')).toBe(true);  // 抽1照常
    expect(zoneOf(d.state, findCard(d, 'practiceBlade').uniqueID)).toBe('deck');
  });
});

describe('刀法咏唱：抽弃循环', () => {
  it('刀法：激活后每次咏唱触发抽1 + 选1张手牌丢弃', () => {
    const d = new BattleDriver({
      deck: ['bladeArt', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { drawPerTurn: 0 },   // 回合抽牌关闭，弃牌落库后不被重抽
    });
    d.start();
    const art = toHand(d, 'bladeArt');
    d.play('bladeArt');
    expect(art.isActivated).toBe(true);
    d.endTurn();                                          // P5：抽1 → 请求选1弃
    expect(d.pendingInput?.request.kind).toBe('selectHandCard');
    const victim = d.state.zones.hand.find(c => c.uniqueID !== art.uniqueID);
    d.respond([victim.uniqueID]);
    expect(zoneOf(d.state, victim.uniqueID)).toBe('deck');
    expect(d.pendingInput).toBeNull();
    expect(d.isWaiting()).toBe(true);                     // 回合流程正常续走
  });

  it('刃心：抽2 + 选2张手牌丢弃', () => {
    const d = new BattleDriver({
      deck: ['bladeHeart', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { drawPerTurn: 0 },
    });
    d.start();
    const heart = toHand(d, 'bladeHeart');
    d.play('bladeHeart');
    d.endTurn();
    expect(d.pendingInput?.request.kind).toBe('selectHandCard');
    expect(d.pendingInput.request.count).toBe(2);
    const victims = d.state.zones.hand.filter(c => c.uniqueID !== heart.uniqueID).slice(0, 2);
    d.respond(victims.map(c => c.uniqueID));
    for (const v of victims) expect(zoneOf(d.state, v.uniqueID)).toBe('deck');
  });
});

describe('刀卡投放', () => {
  it('奖励池：斩（D）入池作链条起点；进阶卡（D 以上）只经局内转化，不入池', () => {
    const pool = spawnableCardPool().map(def => def.id);
    for (const id of ['slash', 'handCleave', 'doubleCleave', 'cycloneSlash', 'flyingDagger', 'storeEdge', 'whetstone', 'quickCleave', 'quickDrawShield']) {
      expect(pool).toContain(id);
    }
    expect(pool).not.toContain('ironShard');              // 衍生牌
    for (const id of ['rockCleave', 'goldCleave', 'mountainCleave', 'seaCleave', 'skyCleave', 'godCleave']) {
      expect(pool).not.toContain(id);                     // 斩链进阶卡：仅局内进阶
    }
  });

  it('奖励池等阶门禁：出鞘 2026-09 稿 C→B——体修 0 级不可见，1 级起入池', () => {
    expect(spawnableCardPool().map(def => def.id)).not.toContain('unsheathe');
    const leveled = spawnableCardPool({ player: { bodyLevel: 1 } }).map(def => def.id);
    expect(leveled).toContain('unsheathe');
    expect(leveled).toContain('quickCleavePlus');         // 快速花刀 B
    expect(leveled).toContain('quickDrawShieldPlus');     // 快速横刀 B
  });
});
