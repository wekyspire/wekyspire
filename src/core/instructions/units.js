import BattleInstruction from '../kernel/BattleInstruction.js';

// 单位生命周期指令族：战斗中向场面加入新单位（当前唯一动词 = 生成；离场由
// 死亡结算与终局清理承担，不在此）。与 combat/effects 等指令族同构：
// 单阶段原子指令、无修饰量（PRE 只可否决不可改写）、POST 经 result 读明细。

// 单位生成：unit 实例由调用方给出（敌方召唤通常经敌人注册表 createUnit 产出，
// 保证 defId 可反查行为/立绘）。side 显式指派（与 createBattleState 的装配指派
// 同一语义，缺省 'enemy'——敌方召唤是主场景；召唤盟友传 'player'）。
// 敌方尾插 enemies：行动顺序排在现存敌人之后——本回合行动循环快照在召唤前
// 已取（aliveEnemies 返回过滤副本），生成单位下回合起参战。
// presenter.unitSpawned 为入场类节拍（sync 先 anim 后）：显示层先建视图再播
// 「立起」演出。可被 PRE 订阅否决（payload 无白名单字段）。
export class UnitSpawnInstruction extends BattleInstruction {
  constructor({ unit, side = null, source = null }, opts = {}) {
    super(opts);
    this.unit = unit;         // Unit（Enemy | Ally）
    this.side = side ?? unit.side ?? 'enemy';
    this.source = source;     // 召唤者 Unit | null（环境生成无来源，播报/演出寻址用）
  }

  execute(ctx) {
    const bs = ctx.battleState;
    this.unit.side = this.side;
    (this.side === 'player' ? bs.allies : bs.enemies).push(this.unit);
    this.result = { unit: this.unit, source: this.source };
    ctx.presenter?.unitSpawned?.({ source: this.source, unit: this.unit });
    return true;
  }
}
