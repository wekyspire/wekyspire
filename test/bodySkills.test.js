import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js';
import { BattleDriver } from '../src/core/sdk/driver.js';
import { BODY_STARTER_DECK } from '../src/core/content/bodySkills.js';
import { RunDriver } from '../src/core/run/runDriver.js';
import { spawnableCardPool, chooseSkillReward } from '../src/core/run/rewards.js';
import { promoteCard } from '../src/core/run/promotion.js';
import { createRunState } from '../src/core/state/runState.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { makeSkillCtx, canUseSkill } from '../src/core/skills/helpers.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { zoneOf, moveCard } from '../src/core/state/battleState.js';
import { DrawCardsInstruction } from '../src/core/instructions/cards.js';
import { DealDamageInstruction, previewDamage } from '../src/core/instructions/combat.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';

// 体修·拳组合（BODY_CULTIVATION_CARDS §1 全批次）：真拳/崩拳/敏捷连击/虚形拳/
// 蓄力/肘击/太极/武学/深入卡。刀组合见 bladeSkills、拆组合见 blockSkills（各自测试文件）。

const enemyHp = (d) => d.state.enemies[0].hp;

// 高血木桩（沿用 slime 行为定义，仅改血量）：卡序/冷却/咏唱类用例需跨多回合打牌
function tank() {
  const e = getEnemyDefinition('slime').createUnit();
  e.maxHp = 200;
  e.hp = 200;
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
  for (const zone of ['hand', 'deck', 'burnt']) {
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

// 清空手牌中除指定卡外的所有卡（构造【后手】唯一手牌场景）
function keepOnly(d, defId) {
  for (const other of [...d.state.zones.hand.filter(c => c.defId !== defId)]) {
    moveCard(d.state, other.uniqueID, 'deck'); // 挪出置牌库底（FIFO）
  }
}

// 解锁冷却中的充能卡（cd 卡二次打出的测试布置）
function unlock(card) {
  card.currentCooldown = 0;
  card.remainingUses = 1;
  return card;
}

// 卡牌 sctx（battleDescribe 断言用）
function sctxOf(d, rt) {
  return makeSkillCtx(d.ctx, rt);
}

describe('真拳系列：纯伤害直线 + A 阶无资源消耗', () => {
  it('快拳 9 / 炮拳 12 / 真拳 15；真拳打出不动任何资源', () => {
    const d = new BattleDriver({
      deck: ['fastPunch', 'cannonFist', 'trueFist', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();

    let hp0 = enemyHp(d);
    d.play('fastPunch');
    expect(hp0 - enemyHp(d)).toBe(9);

    hp0 = enemyHp(d);
    d.play('cannonFist');
    expect(hp0 - enemyHp(d)).toBe(12);
    expect(d.player.actionPoints).toBe(1); // 已花 2AP

    // 真拳：0费0AP——伤害照常，AP/魏启纹丝不动
    const ap0 = d.player.actionPoints;
    const mana0 = d.player.mana;
    hp0 = enemyHp(d);
    d.play('trueFist');
    expect(hp0 - enemyHp(d)).toBe(15);
    expect(d.player.actionPoints).toBe(ap0);
    expect(d.player.mana).toBe(mana0);
  });
});

describe('崩拳系列：大冷却 + 出牌加速', () => {
  it('猛拳 14 伤进入 8 回合冷却；手中无自然冷却，每打出 1 牌冷却 1', () => {
    const d = new BattleDriver({
      deck: ['fierceFist', 'boomFist', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();

    const hp0 = enemyHp(d);
    d.play('fierceFist');
    expect(hp0 - enemyHp(d)).toBe(14);

    const fist = toHand(d, 'fierceFist');
    expect(fist.currentCooldown).toBe(8); // 冷却 8
    d.play('punch'); // 出牌加速 1
    expect(fist.currentCooldown).toBe(7);
    d.endTurn(); // 在手（cooldownZones 仅牌库）：无自然冷却
    expect(fist.currentCooldown).toBe(7);

    // 轰拳的打出同样给猛拳加速（含他人出牌）
    toHand(d, 'boomFist');
    const hp1 = enemyHp(d);
    d.play('boomFist');
    expect(hp1 - enemyHp(d)).toBe(24);
    expect(fist.currentCooldown).toBe(6);
  });

  it('崩拳 36 伤（A 阶顶点）', () => {
    const d = new BattleDriver({
      deck: ['collapseFist', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    const hp0 = enemyHp(d);
    d.play('collapseFist');
    expect(hp0 - enemyHp(d)).toBe(36);
  });
});

describe('敏捷连击系列：最左端抽牌', () => {
  it('敏捷连击：最左端打出抽 1，非最左端不抽', () => {
    const d = new BattleDriver({
      deck: ['agileCombo', ...Array(5).fill('punch')],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'agileCombo');
    placeAt(d, 'agileCombo', 0);

    const hp0 = enemyHp(d);
    const before = d.state.zones.hand.length;
    d.play('agileCombo');
    expect(hp0 - enemyHp(d)).toBe(7);
    expect(d.state.zones.hand).toHaveLength(before); // 离手 -1、抽 1 +1

    unlock(toHand(d, 'agileCombo'));
    placeAt(d, 'agileCombo', 1); // 非最左端
    const before2 = d.state.zones.hand.length;
    d.play('agileCombo');
    expect(d.state.zones.hand).toHaveLength(before2 - 1); // 无抽牌
  });

  it('疾速连击：最左端抽 2', () => {
    const d = new BattleDriver({
      deck: ['rapidCombo', ...Array(5).fill('punch')],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'rapidCombo');
    placeAt(d, 'rapidCombo', 0);
    const before = d.state.zones.hand.length;
    d.play('rapidCombo');
    expect(d.state.zones.hand).toHaveLength(before + 1); // 离手 -1、抽 2
  });

  it('暴风连击：11 伤，最左端抽 3', () => {
    const d = new BattleDriver({
      deck: ['stormCombo', ...Array(6).fill('punch')],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'stormCombo');
    placeAt(d, 'stormCombo', 0);
    const hp0 = enemyHp(d);
    const before = d.state.zones.hand.length;
    d.play('stormCombo');
    expect(hp0 - enemyHp(d)).toBe(11);
    expect(d.state.zones.hand).toHaveLength(before + 2); // 离手 -1、抽 3
  });
});

describe('虚形拳系列：【后手】档位', () => {
  it('仿形拳：非后手 7；后手 14（无抽牌）', () => {
    const d = new BattleDriver({
      deck: ['mimicFist', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'mimicFist');
    placeAt(d, 'mimicFist', 0); // 手中多牌 → 非后手

    let hp0 = enemyHp(d);
    d.play('mimicFist');
    expect(hp0 - enemyHp(d)).toBe(7);

    unlock(toHand(d, 'mimicFist'));
    keepOnly(d, 'mimicFist');
    expect(d.state.zones.hand).toHaveLength(1);
    hp0 = enemyHp(d);
    d.play('mimicFist');
    expect(hp0 - enemyHp(d)).toBe(14); // 7 + 7
    expect(d.state.zones.hand).toHaveLength(0); // 仿形拳后手无抽牌
  });

  it('伤害线：豹形拳后手 22（7+15）、虎形拳后手 34（7+27）', () => {
    const d = new BattleDriver({
      deck: ['leopardFist', 'tigerFist', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    unlock(toHand(d, 'leopardFist'));
    keepOnly(d, 'leopardFist');
    let hp0 = enemyHp(d);
    d.play('leopardFist');
    expect(hp0 - enemyHp(d)).toBe(22);

    unlock(toHand(d, 'tigerFist'));
    keepOnly(d, 'tigerFist');
    hp0 = enemyHp(d);
    d.play('tigerFist');
    expect(hp0 - enemyHp(d)).toBe(34);
  });

  it('抽牌线：蛇形拳后手 14+抽2、龙形拳后手 14+抽4', () => {
    const d = new BattleDriver({
      deck: ['snakeFist', 'dragonFist', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    unlock(toHand(d, 'snakeFist'));
    keepOnly(d, 'snakeFist');
    let hp0 = enemyHp(d);
    d.play('snakeFist');
    expect(hp0 - enemyHp(d)).toBe(14);
    expect(d.state.zones.hand).toHaveLength(2); // 后手抽 2

    unlock(toHand(d, 'dragonFist'));
    keepOnly(d, 'dragonFist');
    hp0 = enemyHp(d);
    d.play('dragonFist');
    expect(hp0 - enemyHp(d)).toBe(14);
    expect(d.state.zones.hand).toHaveLength(4); // 后手抽 4
  });

  it('虚形拳：后手抽满手牌；非后手无效果', () => {
    const d = new BattleDriver({
      deck: ['voidFist', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    unlock(toHand(d, 'voidFist'));
    keepOnly(d, 'voidFist');
    const hp0 = enemyHp(d);
    d.play('voidFist');
    expect(hp0 - enemyHp(d)).toBe(0); // 无伤害
    expect(d.state.zones.hand).toHaveLength(7); // 抽满手牌上限（默认 7）

    // 非后手：无任何效果（无伤害无抽牌）——抽满后手牌 8 张（7 punch + 自身），天然非后手
    unlock(toHand(d, 'voidFist'));
    placeAt(d, 'voidFist', 0);
    const before = d.state.zones.hand.length;
    d.play('voidFist');
    expect(d.state.zones.hand).toHaveLength(before - 1); // 仅离手
  });

  it('空形拳：后手 55 伤；非后手无效果', () => {
    const d = new BattleDriver({
      deck: ['emptyFist', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();

    // 非后手：0 伤害
    toHand(d, 'emptyFist');
    placeAt(d, 'emptyFist', 0);
    let hp0 = enemyHp(d);
    d.play('emptyFist');
    expect(hp0 - enemyHp(d)).toBe(0);

    unlock(toHand(d, 'emptyFist'));
    keepOnly(d, 'emptyFist');
    hp0 = enemyHp(d);
    d.play('emptyFist');
    expect(hp0 - enemyHp(d)).toBe(55);
  });
});

describe('蓄力系列：向牌库注入瞬击', () => {
  it('蓄力洗入 2 张瞬击；瞬击 0 费 7 伤抽 1 后焚毁', () => {
    const d = new BattleDriver({
      deck: ['chargeUp', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    d.play('chargeUp');
    expect(d.state.zones.deck.filter(c => c.defId === 'instantStrike')).toHaveLength(2);

    const hit = d.state.zones.deck.find(c => c.defId === 'instantStrike');
    moveCard(d.state, hit.uniqueID, 'hand');
    const before = d.state.zones.hand.length;
    const hp0 = enemyHp(d);
    const ap0 = d.player.actionPoints;
    d.play('instantStrike');
    expect(hp0 - enemyHp(d)).toBe(7);
    expect(d.state.zones.hand).toHaveLength(before); // 离手 + 抽 1
    expect(d.player.actionPoints).toBe(ap0); // 瞬击 0 费
    expect(zoneOf(d.state, hit.uniqueID)).toBe('burnt'); // 消耗
  });

  it('连击洗入 3 张、四重击洗入 4 张瞬击', () => {
    const d2 = new BattleDriver({
      deck: ['comboStrike', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d2.start();
    d2.play('comboStrike');
    expect(d2.state.zones.deck.filter(c => c.defId === 'instantStrike')).toHaveLength(3);

    const d3 = new BattleDriver({
      deck: ['quadrupleHit', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d3.start();
    d3.play('quadrupleHit');
    expect(d3.state.zones.deck.filter(c => c.defId === 'instantStrike')).toHaveLength(4);
  });

  it('无限连击：咏唱5 激活，每次咏唱触发洗入 4 张；解除时焚毁', () => {
    const d = new BattleDriver({
      deck: ['endlessCombo', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { initialDraw: 2 },
    });
    d.start();
    toHand(d, 'endlessCombo'); // 洗牌后可能不在起手，弄回手中
    d.play('endlessCombo'); // 发动（手牌 3 张：激活后加权 2+5=7 ≤ 7 合法）
    const rt = d.state.zones.hand.find(c => c.defId === 'endlessCombo');
    expect(rt.isActivated).toBe(true);

    d.endTurn(); // 回合 1 的 P5：洗入 4
    d.endTurn(); // 回合 2 的 P5：再洗入 4
    const strikes = [...d.state.zones.hand, ...d.state.zones.deck]
      .filter(c => c.defId === 'instantStrike');
    expect(strikes).toHaveLength(8);

    // 激活态再次打出 = 免费解除，因消耗焚毁
    d.play(rt.uniqueID);
    expect(zoneOf(d.state, rt.uniqueID)).toBe('burnt');
  });

  it('一瞬千击：发现 5 张瞬击直接入手，满手溢入牌库（§7.3）', () => {
    const d = new BattleDriver({
      deck: ['instantThousand', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'instantThousand');
    d.play('instantThousand');
    expect(d.state.zones.burnt.some(c => c.defId === 'instantThousand')).toBe(true);
    // 打出后手牌 3：发现 5 → 4 张入手至满 7，第 5 张溢入牌库
    expect(d.state.zones.hand.filter(c => c.defId === 'instantStrike')).toHaveLength(4);
    expect(d.state.zones.hand).toHaveLength(7);
    expect(d.state.zones.deck.filter(c => c.defId === 'instantStrike')).toHaveLength(1);
  });
});

describe('肘击系列：咏唱节拍伤害 + 牢大乘区', () => {
  it('肘击：激活后每次咏唱触发 4 伤（跨回合持续）；猛烈肘击 5 伤', () => {
    const d = new BattleDriver({
      deck: ['elbowStrike', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    d.play('elbowStrike'); // 发动回手点亮
    const rt = d.state.zones.hand.find(c => c.defId === 'elbowStrike');
    expect(rt.isActivated).toBe(true);

    const hp0 = enemyHp(d);
    d.endTurn(); // 回合 1 的 P5 触发
    expect(hp0 - enemyHp(d)).toBe(4);
    d.endTurn(); // 回合 2 的 P5 再触发
    expect(hp0 - enemyHp(d)).toBe(8);

    const d2 = new BattleDriver({
      deck: ['fierceElbow', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d2.start();
    d2.play('fierceElbow');
    const hp1 = enemyHp(d2);
    d2.endTurn();
    expect(hp1 - enemyHp(d2)).toBe(5);
  });

  it('牢大：激活后肘击伤害翻倍（4 → 8），且预估卡面同源', () => {
    const d = new BattleDriver({
      deck: ['elbowMaster', 'elbowStrike', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    d.play('elbowMaster'); // 0 费发动（费用缺省约定）
    d.play('elbowStrike');

    const hp0 = enemyHp(d);
    d.endTurn(); // P5：4 × 2 = 8
    expect(hp0 - enemyHp(d)).toBe(8);

    // A5 预估与结算同源：牢大的翻倍进肘击 battleDescribe 干跑
    const rt = d.state.zones.hand.find(c => c.defId === 'elbowStrike');
    expect(getSkillDefinition('elbowStrike').battleDescribe(sctxOf(d, rt))).toContain('8伤害');
  });
});

describe('太极系列：打出牌数 → 抽牌（跨回合计数）', () => {
  it('太极：每打出 4 张牌抽 1（第 4 张触发，自身不计）', () => {
    const d = new BattleDriver({
      deck: ['taiji', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5, config: { initialDraw: 5 },
      player: { maxActionPoints: 6 },
    });
    d.start();
    d.play('taiji'); // 发动驻手，不计入计数
    const rt = d.state.zones.hand.find(c => c.defId === 'taiji');
    expect(rt.isActivated).toBe(true);

    d.play('punch');
    d.play('punch');
    d.play('punch');
    expect(rt.chantCount).toBe(3);

    const before = d.state.zones.hand.length;
    d.play('punch'); // 第 4 张：触发抽 1
    expect(rt.chantCount).toBe(4);
    expect(d.state.zones.hand).toHaveLength(before); // 离手 -1、抽 1 +1
  });

  it('借力：每打出 6 张牌抽 1，余数跨回合保留', () => {
    const d = new BattleDriver({
      deck: ['leverage', ...Array(7).fill('punch')],
      enemies: [tank()], seed: 5, config: { initialDraw: 5 },
      player: { maxActionPoints: 6 },
    });
    d.start();
    d.play('leverage');
    const rt = d.state.zones.hand.find(c => c.defId === 'leverage');
    d.play('punch');
    d.play('punch');
    d.play('punch');
    expect(rt.chantCount).toBe(3);

    d.endTurn(); // 计数不清零
    expect(rt.chantCount).toBe(3);
    d.play('punch');
    d.play('punch');
    expect(rt.chantCount).toBe(5);
    const before = d.state.zones.hand.length;
    d.play('punch'); // 第 6 张：触发抽 1
    expect(rt.chantCount).toBe(6);
    expect(d.state.zones.hand).toHaveLength(before); // 离手 -1、抽 1 +1
  });
});

describe('武学系列：抽牌 → 随机敌人伤害', () => {
  it('入门：激活后每抽 1 牌对随机敌人 1 伤（回合开始抽 2 → 2 伤）', () => {
    const d = new BattleDriver({
      deck: ['novice', ...Array(6).fill('punch')],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'novice');
    d.play('novice');
    const rt = d.state.zones.hand.find(c => c.defId === 'novice');
    expect(rt.isActivated).toBe(true);

    const hp0 = enemyHp(d);
    d.endTurn(); // 回合 2 P3 抽 2 → 2 × 1 伤
    expect(hp0 - enemyHp(d)).toBe(2);
  });

  it('无双：每抽 1 牌 4 伤；循环中途杀光敌人时静默落空并胜利收尾', () => {
    const e = getEnemyDefinition('slime').createUnit();
    e.maxHp = 4;
    e.hp = 4;
    const d = new BattleDriver({
      deck: ['peerless', ...Array(5).fill('punch')],
      enemies: [e], seed: 5,
    });
    d.start();
    toHand(d, 'peerless');
    d.play('peerless');

    // 回合 2 P3 抽 2：第 1 抽 4 伤杀敌 → 胜利；第 2 抽无存活敌人 → 静默落空
    d.endTurn();
    expect(d.isFinished()).toBe(true);
    expect(d.verdict).toBe('victory');
  });
});

describe('深入卡：万变拳与假动作', () => {
  it('万变拳：下张打出的牌 0AP，再下一张恢复；换牌不吃免费', () => {
    const d = new BattleDriver({
      deck: ['wildFist', 'cannonFist', 'punch', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'wildFist');
    d.play('wildFist'); // 1AP
    expect(d.player.actionPoints).toBe(2);

    // 换牌（SwapCardInstruction 树）：不吃免费，免费保留
    toHand(d, 'punch');
    d.swap('punch'); // 首次 0 费
    toHand(d, 'punch');
    d.swap('punch'); // 第二次 1AP：正常扣费（filter 排除非打出树的 AP 消耗）
    expect(d.player.actionPoints).toBe(1);

    toHand(d, 'cannonFist');
    const hp0 = enemyHp(d);
    d.play('cannonFist'); // 万变拳免费：0AP，伤害照常
    expect(hp0 - enemyHp(d)).toBe(12);
    expect(d.player.actionPoints).toBe(1);

    toHand(d, 'punch');
    d.play('punch'); // 免费已一次性消耗：恢复扣费
    expect(d.player.actionPoints).toBe(0);
  });

  it('假动作：0费消耗，抽 2 牌洗入 2 虚无；虚无 0 费打出无效果且焚毁', () => {
    const d = new BattleDriver({
      deck: ['feint', ...Array(5).fill('punch')],
      enemies: [tank()], seed: 5,
    });
    d.start();
    toHand(d, 'feint');
    const handBefore = d.state.zones.hand.length;

    d.play('feint');
    expect(d.player.actionPoints).toBe(3);   // 2026-09 稿：0费（未写费用 → 缺省 0）
    expect(d.state.zones.hand).toHaveLength(handBefore + 1); // 抽 2、自身离手
    expect(d.state.zones.deck.filter(c => c.defId === 'voidCard')).toHaveLength(2);
    expect(d.state.zones.burnt.some(c => c.defId === 'feint')).toBe(true);

    const voidCard = d.state.zones.deck.find(c => c.defId === 'voidCard');
    moveCard(d.state, voidCard.uniqueID, 'hand');
    const hp0 = enemyHp(d);
    const ap0 = d.player.actionPoints;
    const hb = d.state.zones.hand.length;
    d.play(voidCard.uniqueID);
    expect(enemyHp(d)).toBe(hp0); // 无效果
    expect(d.player.actionPoints).toBe(ap0); // 0 费
    expect(d.state.zones.hand).toHaveLength(hb - 1);
    expect(zoneOf(d.state, voidCard.uniqueID)).toBe('burnt'); // 消耗
  });
});

describe('边界：空牌库 / 满手 / 无存活敌人', () => {
  it('空牌库：虚形拳后手「抽满」全部落空，不判负', () => {
    const d = new BattleDriver({
      deck: ['voidFist'], enemies: [tank()], seed: 5, config: { initialDraw: 1 },
    });
    d.start();
    expect(d.state.zones.hand).toHaveLength(1);
    expect(d.state.zones.deck).toHaveLength(0);
    d.play('voidFist');
    expect(d.state.zones.hand).toHaveLength(0);
    expect(d.isFinished()).toBe(false); // 牌库抽空不判负
  });

  it('满手：疾速连击最左抽 2 只进 1（加权满手截断）；满手注入抽牌完全落空', () => {
    const d = new BattleDriver({
      deck: ['rapidCombo', ...Array(8).fill('punch')],
      enemies: [tank()], seed: 5, config: { initialDraw: 7 },
    });
    d.start();
    toHand(d, 'rapidCombo');
    // 布置溢出的卡挪回牌库，恢复满手 7 张（rapidCombo 在内）
    while (d.state.zones.hand.length > 7) {
      const extra = d.state.zones.hand.find(c => c.defId !== 'rapidCombo');
      moveCard(d.state, extra.uniqueID, 'deck');
    }
    placeAt(d, 'rapidCombo', 0);
    d.play('rapidCombo'); // 打出后 6 张 → 抽 2：第 1 张到 7 满，第 2 张截断
    expect(d.state.zones.hand).toHaveLength(7);

    const before = d.state.zones.hand.length;
    d.dispatch(new DrawCardsInstruction({ count: 3 }));
    expect(d.state.zones.hand).toHaveLength(before); // 满手：抽牌全部落空
  });

  it('无存活敌人：武学循环中途敌死光，伤害静默落空（见武学用例）+ 预览退化为裸面板', () => {
    const d = new BattleDriver({
      deck: ['punch', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5,
    });
    d.start();
    // 无存活敌人的预览（收尾场景）：resolvedDamageText 退化为裸面板值，不抛错
    d.state.enemies[0].hp = 0;
    const rt = d.state.zones.hand[0];
    const def = getSkillDefinition(rt.defId);
    expect(() => def.battleDescribe(sctxOf(d, rt))).not.toThrow();
  });
});

describe('伤害干跑预估（previewDamage）', () => {
  it('吃 PRE 修正：目标格挡减半体现在预览值，且预览不消耗格挡层数', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    d.dispatch(new AddEffectInstruction({
      target: d.state.enemies[0], effectId: 'block', stacks: 2,
    }));

    const preview = previewDamage(d.ctx, { source: d.player, target: d.state.enemies[0], amount: 10 });
    expect(preview.damage).toBe(5); // 格挡减半
    expect(d.state.enemies[0].getEffectStacks('block')).toBe(2); // 预览未消耗

    const hp0 = enemyHp(d);
    d.play('punch'); // 6 → 减半 3，格挡 -1
    expect(hp0 - enemyHp(d)).toBe(3);
    expect(d.state.enemies[0].getEffectStacks('block')).toBe(1);
  });

  it('一次性触发（once 窗口"下次伤害翻倍"）预览翻倍且不被干跑消耗', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    d.kernel.addSubscription({
      when: DealDamageInstruction, phase: 'pre', window: 'once',
      filter: (instr) => instr.source === d.player,
      react: (instr) => instr.setPayload('damage', instr.payload.damage * 2),
    });

    expect(previewDamage(d.ctx, { source: d.player, target: d.state.enemies[0], amount: 6 }).damage).toBe(12);
    expect(d.kernel.subscriptions.some(s => s.window === 'once')).toBe(true); // 未被预览消耗

    const hp0 = enemyHp(d);
    d.play('punch');
    expect(hp0 - enemyHp(d)).toBe(12); // 真实结算翻倍，触发后被消耗
    expect(d.kernel.subscriptions.some(s => s.window === 'once')).toBe(false);
  });
});

describe('描述双轨（应用前 describe / 应用后 battleDescribe）', () => {
  it('仿形拳：应用前写全条件；应用后按是否后手切换结算', () => {
    const def = getSkillDefinition('mimicFist');
    expect(def.describe()).toBe('7伤害；/named{后手}：+7');

    const d = new BattleDriver({
      deck: ['mimicFist', 'punch', 'punch', 'punch'], enemies: [tank()], seed: 5,
    });
    d.start();
    const rt = toHand(d, 'mimicFist');
    placeAt(d, 'mimicFist', 0); // 手中多牌 → 非后手
    expect(def.battleDescribe(sctxOf(d, rt))).toBe('7伤害');
    keepOnly(d, 'mimicFist');
    expect(def.battleDescribe(sctxOf(d, rt))).toBe('14伤害');
  });
});

describe('体修卡组：晋升链与投放', () => {
  it('拳组合晋升链（promotesTo，真拳/崩拳/敏捷连击/虚形拳/蓄力/肘击/太极/武学）', () => {
    const run = createRunState({ seed: 1 });
    run.player.bodyLevel = 2; // 等阶门禁全开（A 封顶）：晋升链测试不受门禁干扰
    const chains = [
      ['punch', 'fastPunch'], ['fastPunch', 'cannonFist'], ['cannonFist', 'trueFist'],
      ['fierceFist', 'boomFist'], ['boomFist', 'collapseFist'],
      ['agileCombo', 'rapidCombo'], ['rapidCombo', 'stormCombo'],
      ['mimicFist', 'leopardFist'], ['leopardFist', 'tigerFist'],
      ['snakeFist', 'dragonFist'],
      ['chargeUp', 'comboStrike'], ['comboStrike', 'quadrupleHit'], ['quadrupleHit', 'instantThousand'],
      ['elbowStrike', 'fierceElbow'],
      ['leverage', 'redirect'], ['redirect', 'taiji'],
      ['novice', 'adept'], ['adept', 'peerless'],
    ];
    for (const [from] of chains) run.player.deck.push(createSkillRuntime(from));
    for (const [from, to] of chains) {
      const rt = run.player.deck.find(c => c.defId === from);
      promoteCard(run, rt.uniqueID);
      expect(rt.defId).toBe(to);
    }
  });

  it('奖励池：等阶门禁（无 run 上限 C），排除衍生牌/保险卡与 S 阶', () => {
    const pool = spawnableCardPool().map(def => def.id);
    // D/C 阶系列卡在池
    for (const id of ['fastPunch', 'fierceFist', 'agileCombo', 'rapidCombo', 'mimicFist',
      'chargeUp', 'comboStrike', 'elbowStrike', 'fierceElbow',
      'leverage', 'novice', 'feint']) {
      expect(pool).toContain(id);
    }
    // B+ 阶被门禁拦下（未进阶 run 缺省上限 C）
    for (const id of ['cannonFist', 'trueFist', 'collapseFist', 'snakeFist', 'elbowMaster', 'taiji']) {
      expect(pool).not.toContain(id);
    }
    // 衍生牌/保险卡/S 阶恒不入池
    for (const id of ['instantStrike', 'voidCard', 'badOmen', 'voidFist', 'emptyFist']) {
      expect(pool).not.toContain(id);
    }
  });

  it('情况不对：固有起手直接入手（不占抽牌位）；弃全手牌抽等量；打出即焚', () => {
    const d = new BattleDriver({
      deck: ['badOmen', 'punch', 'guard', 'duckHead', 'punch', 'guard'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    // 固有：开局在手、不在牌库；手牌 = 固有 1 + 初始抽 4
    expect(d.state.zones.hand.some(c => c.defId === 'badOmen')).toBe(true);
    expect(d.state.zones.deck.some(c => c.defId === 'badOmen')).toBe(false);
    expect(d.state.zones.hand.length).toBe(5);

    d.play('badOmen');
    // 自身消耗焚毁，不再出现在任何活区
    expect(d.state.zones.burnt.some(c => c.defId === 'badOmen')).toBe(true);
    expect(d.state.zones.hand.some(c => c.defId === 'badOmen')).toBe(false);
    // 等量重抽：手牌回到打出前数量 - 1（自身离手）；6 张卡全部仍在（无丢失）
    expect(d.state.zones.hand.length).toBe(4);
    const all = ['hand', 'deck', 'burnt', 'pending'].flatMap(z => d.state.zones[z]);
    expect(all.length).toBe(6);
  });

  it('肾上腺素：0 开销 +1AP 并抽 1，打出即消耗', () => {
    const d = new BattleDriver({
      deck: ['adrenaline', 'punch', 'punch', 'punch'],
      enemies: [tank()], seed: 5,
    });
    d.start();
    d.play('punch'); // 先花 1AP，给 +1AP 留出可观察余量
    const apBefore = d.player.actionPoints;
    const handBefore = d.state.zones.hand.length;
    const adr = d.state.zones.hand.find(c => c.defId === 'adrenaline');
    d.play('adrenaline');
    expect(d.player.actionPoints).toBe(apBefore + 1); // 0 开销净 +1AP
    expect(d.state.zones.hand.length).toBe(handBefore); // 自身离手 + 抽 1
    expect(zoneOf(d.state, adr.uniqueID)).toBe('burnt'); // 消耗
  });
});

describe('整局可玩性：体修起始卡组跑完整 run', () => {
  // 断言对象是「链路畅通」（起始卡组的 10 张卡全部可正常打出/结算/迁移，无死路），
  // 不是数值平衡。三点隔离并行内容噪声：
  //   1. 适度抬高血量——敌人数值随各体系并行调整会持续波动；
  //   2. 奖励只领拳组合卡、出牌白名单只打起始卡与拳组合——训练房/奖励可能入手
  //      需结算期选牌的其他体系卡，RunDriver 占位策略不支持输入请求（见 runDriver.js）；
  //   3. 平衡验收由批量 RunDriver 扫描另行负责。
  it('RunDriver 可杀穿 3 层（发育链路畅通）', () => {
    const safeIds = new Set([...BODY_STARTER_DECK]);
    const isSafe = (s) => safeIds.has(s.defId) || getSkillDefinition(s.defId).series === 'fist';
    const d = new RunDriver({
      seed: 42, totalFloors: 3, deck: [...BODY_STARTER_DECK],
      player: { maxHp: 60 },
      battlePolicy: (battle) => battle.ctx.battleState.zones.hand
        .find(s => canUseSkill(battle.ctx, s) && isSafe(s)),
    });
    d.onRewards = (run) => {
      const safe = run.rewards.skillChoices.find(id => getSkillDefinition(id).series === 'fist');
      chooseSkillReward(run, safe ?? null);
    };
    d.start().runToEnd();
    expect(d.result).toBe('victory');
  });
});
