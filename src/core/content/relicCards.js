import { registerSkill } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { attackDamage, addCard, drawCards } from './cardKit.js';

// 遗物生成的衍生牌（RELICS.md 2026-09-11 第二批）。
// 四张牌都 `canSpawnAsReward: false`——它们**不进任何卡包/训练抓牌/商店**，
// 只由对应遗物在战斗开始时生成（与〈碎铁〉同一口径，见 bladeSkills.js 的 ironShard）。
// 卡面文本只写效果语言，费用/关键词（消耗/短暂/冷却）走徽章与页脚，不复述。

// 〈速射〉：阿罗那 III 战斗开始时加入手牌。
registerSkill({
  id: 'rapidFire', name: '速射', type: 'normal', tier: 'D', series: 'relic',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 5);
    return true;
  },
  describe: () => '5伤害',
});

// 〈点射〉：黑火 H-3 战斗开始时洗入牌库。
registerSkill({
  id: 'pointShot', name: '点射', type: 'normal', tier: 'D', series: 'relic',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 10);
    drawCards(sctx, 1, { reason: 'pointShot' });
    return true;
  },
  describe: () => '10伤害，抽1',
});

// 〈压制射击〉：祈祷制度战斗开始时洗入牌库。
registerSkill({
  id: 'suppressionFire', name: '压制射击', type: 'normal', tier: 'D', series: 'relic',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  use(sctx) {
    for (const e of aliveEnemies(sctx.battleState)) attackDamage(sctx, 15, { target: e, tags: ['aoe'] });
    drawCards(sctx, 1, { reason: 'suppressionFire' });
    return true;
  },
  describe: () => '15伤害（所有敌人），抽1',
});

// 〈贯穿射击〉：低语苍鹰 Z 战斗开始时洗入牌库。
registerSkill({
  id: 'piercingShot', name: '贯穿射击', type: 'normal', tier: 'D', series: 'relic',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 3 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 18, { pierce: true });
    drawCards(sctx, 1, { reason: 'piercingShot' });
    return true;
  },
  describe: () => '18穿透伤害，抽1',
});
