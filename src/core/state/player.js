import Unit from './unit.js';

// 玩家初始生命上限（全局常量，2026-09 抽出：初始生命会随平衡反复调整，
// 一切断言/装配都引用此常量，禁止再写裸数字）。运行时成长（遗物/事件加血）另算。
export const PLAYER_BASE_HP = 50;

// 玩家：run 级实体，跨战斗存活。hp/money/deck/abilities/leino 是持久状态；
// 魏启（mana）为战斗内资源——入战置为上限一半、每回合开始 +1（battle.md §6），
// 字段寄存在此仅供战斗流程读写；shield/effects/actionPoints 同为战斗内重置与推进。
export default class Player extends Unit {
  constructor(opts = {}) {
    super({ name: '玩家', maxHp: PLAYER_BASE_HP, ...opts }); // 缺省对齐真实开局（runController 同源）
    this.side = 'player';
    this.maxMana = opts.maxMana ?? 3;
    this.mana = this.maxMana;
    this.maxActionPoints = opts.maxActionPoints ?? 3;
    this.actionPoints = this.maxActionPoints;
    this.money = opts.money ?? 0;
    this.deck = [];                 // run 级卡组：[skillRuntime]
    this.abilities = [];            // [abilityId]
    this.leino = {};                // 灵脉等级 { fire: 1, ... }
    // 隐藏体修等级：不随灵脉加点增长，只在进阶事件「跳过」时 +1（故事模式暗线，
    // 见 RUN_DESIGN；决定体修卡包的等阶门禁）。
    this.bodyLevel = opts.bodyLevel ?? 0;
    // 手牌上限（加权口径：激活的咏唱卡按咏唱值 chantWeight 计多张——咏唱与手牌
    // 压力统一为同一资源）。旧档无此字段时读取侧 ?? 10 兜底。
    this.maxHandSize = opts.maxHandSize ?? 7;
  }
}
