import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 注册全部内容（含 commonSkills 纳气卡）
import { BattleDriver } from '../src/core/sdk/driver.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { zoneOf, moveCard } from '../src/core/state/battleState.js';
import { canUseSkill } from '../src/core/skills/helpers.js';
import { AddEffectInstruction } from '../src/core/instructions/effects.js';

// 新内容结算验证：虚形拳系列（唯一手牌条件）与 COMMON 通用单卡（汲取/激发/魏启罐）。

function tank() {
  const e = getEnemyDefinition('slime').createUnit();
  e.maxHp = 500;
  e.hp = 500;
  return e;
}

const enemyHp = (d) => d.state.enemies[0].hp;

// 把指定 defId 的卡弄回手牌（从任意 zone；已在手则原样返回）
function toHandKeep(d, defId) {
  const card = [d.state.zones.deck, d.state.zones.burnt]
    .flat().find(c => c.defId === defId);
  if (card) moveCard(d.state, card.uniqueID, 'hand');
  return d.state.zones.hand.find(c => c.defId === defId);
}
const toHand = toHandKeep;

// 清空手牌中除指定卡外的所有卡（构造「唯一手牌」）
function keepOnly(d, defId) {
  for (const other of [...d.state.zones.hand.filter(c => c.defId !== defId)]) {
    moveCard(d.state, other.uniqueID, 'deck'); // 挪走置牌库底（弃牌堆已不存在，FIFO）
  }
}

describe('虚形拳系列：后手条件', () => {
  it('豹形拳：后手时增伤，非后手只 7 伤', () => {
    const d = new BattleDriver({ deck: ['leopardFist', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    let hp0 = enemyHp(d);
    d.play('leopardFist'); // 手中多牌
    expect(hp0 - enemyHp(d)).toBe(7);

    const leopard = toHand(d, 'leopardFist');
    leopard.currentCooldown = 0;
    leopard.remainingUses = 1;
    keepOnly(d, 'leopardFist');
    hp0 = enemyHp(d);
    d.play('leopardFist');
    expect(hp0 - enemyHp(d)).toBe(22); // 7 + 15（后手）
  });

  it('空形拳：后手时 55 伤（无 canUse 门槛，非后手无效果）', () => {
    const d = new BattleDriver({ deck: ['emptyFist', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const fist = d.state.zones.hand.find(c => c.defId === 'emptyFist');
    expect(canUseSkill(d.ctx, fist)).toBe(true); // 非后手也可打出（但无效果）

    toHandKeep(d, 'emptyFist');
    keepOnly(d, 'emptyFist');
    const hp0 = enemyHp(d);
    d.play('emptyFist');
    expect(hp0 - enemyHp(d)).toBe(55);
  });
});

describe('COMMON：汲取/激发/魏启罐', () => {
  it('纯化：1MP 换纳气2 + 3护盾，下回合开始兑现魏启', () => {
    const d = new BattleDriver({ deck: ['purify', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start(); // 半满1 + 回合恢复1 = 2
    const mana0 = d.player.mana;
    d.play('purify');
    expect(d.player.mana).toBe(mana0 - 1); // 支付 1MP
    expect(d.player.shield).toBe(3);
    expect(d.player.getEffectStacks('naqi')).toBe(2);
    d.endTurn(); // 下回合开始：+1 常规 + 纳气整取 2
    expect(d.player.mana).toBe(Math.min(mana0 - 1 + 3, d.player.maxMana));
    expect(d.player.getEffectStacks('naqi')).toBe(0);
  });

  it('魏启罐：0 费消耗品，纳气兑现即归零', () => {
    const d = new BattleDriver({ deck: ['manaJar', 'manaJarPlus', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    const jar = d.state.zones.hand.find(c => c.defId === 'manaJar');
    const mana0 = d.player.mana;
    d.play('manaJar');
    expect(zoneOf(d.state, jar.uniqueID)).toBe('burnt'); // 消耗
    expect(d.player.mana).toBe(mana0); // 0 费
    expect(d.player.getEffectStacks('naqi')).toBe(1);
    d.play('manaJarPlus'); // 叠加到 3 层
    expect(d.player.getEffectStacks('naqi')).toBe(3);
    d.endTurn();
    expect(d.player.mana).toBe(d.player.maxMana); // min(2+1+3, 3) = 3 抵上限
    expect(d.player.getEffectStacks('naqi')).toBe(0); // 一次性整取
  });

  it('激发：2MP 换 2AP（获取不截断，可超上限）', () => {
    const d = new BattleDriver({ deck: ['stimulant', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start(); // 魏启 2
    const ap0 = d.player.actionPoints;
    d.play('punch'); // -1AP → 2
    const stim = d.state.zones.hand.find(c => c.defId === 'stimulant');
    d.play('stimulant');
    expect(d.player.mana).toBe(0); // 支付 2MP
    expect(d.player.actionPoints).toBe(ap0 + 1); // (ap0-1) + 2
    expect(zoneOf(d.state, stim.uniqueID)).toBe('burnt'); // 消耗
  });
});

// 龟缩木桩（rockshell：首个敌方回合只上盾，第二个敌方回合攻击 10）——
// 跨回合类用例需要确定的敌方伤害节奏
function turtle() {
  const e = getEnemyDefinition('rockshell').createUnit();
  e.maxHp = 300;
  e.hp = 300;
  return e;
}

describe('灵能护盾系列（2026-09 稿：MP 换纯护盾）', () => {
  it('灵力护盾 C / 灵能护盾 B：2MP，冷却1：12/18 护盾', () => {
    for (const [id, shield] of [['psiShield', 12], ['greaterPsiShield', 18]]) {
      const d = new BattleDriver({
        deck: [id, 'punch', 'punch'], enemies: [tank()], seed: 5, player: { maxMana: 4 },
      });
      d.start(); // 魏启 = floor(4/2) = 2，回合开始 +1 = 3
      toHand(d, id);
      d.play(id);
      expect(d.player.shield, id).toBe(shield);
      expect(d.player.mana, id).toBe(1); // 3 - 2MP
    }
  });
});

describe('新散卡（2026-09 稿）：早有防备 / 盼盼小面包 / 午休', () => {
  it('早有防备：固有——不占抽牌位起手在手；1MP 9护盾，消耗', () => {
    const d = new BattleDriver({
      deck: ['prePrepared', 'punch', 'punch'], enemies: [tank()], seed: 5,
      player: { maxMana: 2 }, config: { initialDraw: 0 },
    });
    d.start();
    expect(d.state.zones.hand.map(c => c.defId)).toEqual(['prePrepared']); // 固有起手在手
    d.play('prePrepared');
    expect(d.player.shield).toBe(9);
    expect(d.player.mana).toBe(1); // (1 + 回合恢复1) - 1MP
    expect(d.state.zones.burnt.some(c => c.defId === 'prePrepared')).toBe(true);
  });

  it('盼盼小面包：1AP 恢复3生命', () => {
    const d = new BattleDriver({ deck: ['panpanBread', 'punch', 'punch'], enemies: [tank()], seed: 5 });
    d.start();
    toHand(d, 'panpanBread');
    d.player.hp = 10;
    d.play('panpanBread');
    expect(d.player.hp).toBe(13);
    expect(d.state.zones.burnt.some(c => c.defId === 'panpanBread')).toBe(true);
  });

  it('午休：晕眩1 + 治疗8——下回合开始回血清层，且行动段被跳过', () => {
    const d = new BattleDriver({
      deck: ['noonNap', 'punch', 'punch'], enemies: [turtle()], seed: 5,
      config: { drawPerTurn: 0 },
    });
    d.start();
    toHand(d, 'noonNap');
    d.play('noonNap');
    expect(d.player.getEffectStacks('stun')).toBe(1);
    expect(d.player.getEffectStacks('mend')).toBe(8);
    d.player.hp = 10;
    // 敌方回合1（上盾）→ 回合2开始：治疗+8 整取清零 + 晕眩跳过行动段（无 WAIT）
    // → 敌方回合2（攻击10）→ 回合3 等待玩家输入
    d.endTurn();
    expect(d.player.hp).toBe(10 + 8 - 10);
    expect(d.state.turn.count).toBe(3);
    expect(d.player.getEffectStacks('stun')).toBe(0);
    expect(d.player.getEffect('mend')).toBeNull();
  });

  it('晕眩（敌方单位）：被晕眩的敌人跳过行动，层数-1', () => {
    const d = new BattleDriver({ deck: ['punch', 'punch', 'punch'], enemies: [turtle()], seed: 5 });
    d.start();
    const enemy = d.state.enemies[0];
    d.dispatch(new AddEffectInstruction({ target: enemy, effectId: 'stun', stacks: 1 }));
    const hp0 = d.player.hp;
    d.endTurn();
    expect(d.player.hp).toBe(hp0);                    // 被晕住：本回合没打过来
    expect(enemy.shield).toBe(0);                     // 也没上盾（行动整个跳过）
    expect(enemy.getEffectStacks('stun')).toBe(0);    // 跳过行动消耗 1 层
  });
});

describe('高速魏启罐系列（2026-09-12 设计稿新增）：即时回蓝', () => {
  it('高速魏启罐（B）：打出立刻获得 2 魏启（纳气是下回合整取，这张是当场到账）', () => {
    const d = new BattleDriver({ deck: ['swiftManaJar', 'punch'], enemies: [tank()], seed: 5, player: { maxMana: 5 } });
    d.start();
    d.player.mana = 0;
    d.play('swiftManaJar');
    expect(d.player.mana).toBe(2);
    expect(d.state.zones.burnt.some(c => c.defId === 'swiftManaJar')).toBe(true);   // 消耗
  });

  it('高速大魏启罐（A）：获得 4 魏启；仍受上限截断', () => {
    const d = new BattleDriver({ deck: ['swiftManaJarPlus', 'punch'], enemies: [tank()], seed: 5, player: { maxMana: 3 } });
    d.start();
    d.player.mana = 0;
    d.play('swiftManaJarPlus');
    expect(d.player.mana).toBe(3);   // 上限 3：4 点被截断
  });
});

describe('HeLiCoPtEr（A，2026-09-12 设计稿新增）', () => {
  it('将所有手牌变换为 0 开销**猛烈肘击**（肘击系列的免费形态，吃牢大翻倍）', () => {
    const d = new BattleDriver({
      deck: ['helicopter', 'punch', 'guard', 'punch'],
      enemies: [tank()], seed: 5, config: { initialDraw: 3 },
    });
    d.start();
    const others = d.state.zones.hand.filter(c => c.defId !== 'helicopter');
    expect(others.length).toBeGreaterThan(0);
    d.play('helicopter');
    const deformed = d.state.zones.hand.filter(c => c.defId === 'fierceElbowFree');
    expect(deformed).toHaveLength(others.length);              // 全部换绑成免费猛烈肘击
    const def = getSkillDefinition('fierceElbowFree');
    expect(def.name).toBe('猛烈肘击');                          // 与既有的同名（玩梗原意）
    expect(def.cost).toEqual({ mana: 0, actionPoint: 0 });      // 0 开销
    expect(def.cardMode).toBe('chant');                        // 肘击系列的形态：咏唱1
    expect(def.canSpawnAsReward).toBe(false);                  // 只经局内转化获得，不进奖励池
    // 0 费 + 咏唱1：手里全是它也能全部点亮（发动不花 AP）
    expect(canUseSkill(d.ctx, deformed[0])).toBe(true);
  });

  it('变换出的猛烈肘击吃牢大翻倍（elbow 标记同一口径）', () => {
    const d = new BattleDriver({
      deck: ['helicopter', 'elbowMaster', 'punch', 'punch'],
      enemies: [tank()], seed: 7, config: { initialDraw: 3, drawPerTurn: 0 },
    });
    d.start();
    toHand(d, 'helicopter');                                   // 起手没摸到就调进手（初始抽牌是随机的）
    d.play('elbowMaster');                                     // 激活牢大
    d.play('helicopter');                                      // 手牌 → 0 费猛烈肘击
    const elbow = d.state.zones.hand.find(c => c.defId === 'fierceElbowFree');
    d.player.actionPoints = 5;
    d.play(elbow.uniqueID);                                    // 点亮咏唱（P5 每回合打随机伤害）
    const hp0 = enemyHp(d);
    d.endTurn();                                               // 触发 P5：5 伤害 → 牢大翻倍 = 10
    expect(hp0 - enemyHp(d)).toBe(10);
  });
});
