import Unit from './unit.js';

// 玩家初始生命上限（全局常量，2026-09 抽出：初始生命会随平衡反复调整，
// 一切断言/装配都引用此常量，禁止再写裸数字）。运行时成长（遗物/事件加血）另算。
export const PLAYER_BASE_HP = 50;
// 初始金币（2026-09-11 用户定：开局给 30 金——前期能买得起一件 30 金量级的药剂/C 遗物，
// 而不是「一层收入只够二选一」）。所有建局入口都走 Player 的缺省值，故改这一处即全局生效。
export const PLAYER_BASE_MONEY = 30;

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
    this.money = opts.money ?? PLAYER_BASE_MONEY;
    this.deck = [];                 // run 级卡组：[skillRuntime]
    this.abilities = [];            // [abilityId]
    this.leino = {};                // 灵脉等级 { fire: 1, ... }
    // 隐藏体修等级：不随灵脉加点增长，只在进阶事件「跳过」时 +1（故事模式暗线，
    // 见 RUN_DESIGN；决定体修卡包的等阶门禁）。
    this.bodyLevel = opts.bodyLevel ?? 0;
    // 手牌上限（加权口径：激活的咏唱卡按咏唱值 chantWeight 计多张——咏唱与手牌
    // 压力统一为同一资源）。旧档无此字段时读取侧 ?? 10 兜底。
    this.maxHandSize = opts.maxHandSize ?? 7;

    // 基础值（run 级修正的基准）：遗物的 run 级加成（行动力上限/魏启上限/防御…）
    // **不写进这些字段**，而是每次由 refreshRunModifiers 从 baseStats + Σ已激活遗物修正重算。
    // 原因：PreBattle 每战重置护盾/效果/AP/魏启，却**不重置** maxHp/attack/defense——
    // 「战斗开始时防御+2」若直接累加会逐战叠加（每十层 +20）。拾取型的永久成长
    // （超硬法棍 +5 最大生命）走 gainMaxHp()，同时抬 baseStats，故不会被重算抹掉。
    this.baseStats = {
      maxHp: this.maxHp,
      maxMana: this.maxMana,
      maxActionPoints: this.maxActionPoints,
      attack: this.attack,
      defense: this.defense,
      maxHandSize: this.maxHandSize,
      ...opts.baseStats,
    };
  }
}
