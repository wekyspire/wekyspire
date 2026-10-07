import { registerSkill } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { PlayerTurnInstruction } from '../instructions/turn.js';
import { attackDamage, addEffect, drawCards, resolvedDamageText } from './cardKit.js';

// 遗物生成的衍生牌（RELICS.md / SPECIAL_CARDS.md）。
// 六张牌都 `canSpawnAsReward: false`——它们**不进任何卡包/训练抓牌/商店**，
// 只由对应遗物在战斗开始时生成（与〈碎铁〉同一口径，见 bladeSkills.js 的 ironShard）；
// 等阶只是账务口径（枪械四件记 C，〈盗取时间〉〈挥舞〉按稿记 S）。
// 卡面文本只写效果语言，费用/关键词（消耗/短暂/冷却）走徽章与页脚，不复述。

// 〈速射〉：阿罗那 III 战斗开始时加入手牌。
registerSkill({
  id: 'rapidFire', name: '速射', type: 'normal', tier: 'C', series: 'relic',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 13);
    return true;
  },
  describe: () => '13伤害',
});

// 〈点射〉：黑火 H-3 战斗开始时洗入牌库。
registerSkill({
  id: 'pointShot', name: '点射', type: 'normal', tier: 'C', series: 'relic',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 16);
    drawCards(sctx, 1, { reason: 'pointShot' });
    return true;
  },
  describe: () => '16伤害，抽1',
});

// 〈压制射击〉：祈祷制度战斗开始时洗入牌库。
registerSkill({
  id: 'suppressionFire', name: '压制射击', type: 'normal', tier: 'C', series: 'relic',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  use(sctx) {
    for (const e of aliveEnemies(sctx.battleState)) attackDamage(sctx, 19, { target: e, tags: ['aoe'] });
    drawCards(sctx, 1, { reason: 'suppressionFire' });
    return true;
  },
  describe: () => '19群伤，抽1',
});

// 〈贯穿射击〉：低语苍鹰 Z 战斗开始时洗入牌库。
registerSkill({
  id: 'piercingShot', name: '贯穿射击', type: 'normal', tier: 'C', series: 'relic',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 3 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 23, { pierce: true });
    drawCards(sctx, 1, { reason: 'piercingShot' });
    return true;
  },
  describe: () => '23/named{穿透}伤害，抽1',
});

// 〈盗取时间〉：鸟羽战斗开始时插入牌库底。S 级额外回合：结束本回合，
// 并立刻开始你的新一回合（跳过一次敌方回合——敌方整段不发生，含其回合开始效果）。
registerSkill({
  id: 'stealTime', name: '盗取时间', type: 'normal', tier: 'S', series: 'relic',
  cost: { mana: 0, actionPoint: 3 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  use(sctx) {
    // 与流程层 playerEndTurn 同一手笔：当前玩家回合置 endRequested，本卡结算完按正常
    // 回合结束链走（咏唱触发/盟友行动/回合末结算/尾弃照常）；跳过标记由回合循环消费
    const turn = sctx.kernel.stack.find(i => i instanceof PlayerTurnInstruction);
    if (turn) turn.endRequested = true;
    sctx.battleState.skipEnemyTurns = (sctx.battleState.skipEnemyTurns ?? 0) + 1;
    return true;
  },
  describe: () => '结束回合，并立刻开始你的新一回合。',
});

// 〈挥舞〉：戟战斗开始时洗入牌库。
registerSkill({
  id: 'greatSweep', name: '挥舞', type: 'normal', tier: 'S', series: 'relic',
  cost: { mana: 0, actionPoint: 4 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    attackDamage(sctx, 101);
    addEffect(sctx, 'pure', 1);
    return true;
  },
  describe: () => '101伤害，/effect{纯净}1',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 101)}，/effect{纯净}1`,
});
