import mitt from 'mitt';

// DisplayModel（run 级显示状态权威）：被共享 sequencer 的节拍逐步推进的"第二状态面"。
//
// 与 AnimationSequencer 对等且同样跨层存活（battle / room / tower / cutscene）：
//   * sequencer = 时间/秩序权威（哪个增量何时应用、播多久、阻塞谁）
//   * 本模型    = 状态权威（前端显示状态真值，按队列游标折叠事件日志）
//   * 场景类（BattleStage / MapStage …）只是模型的视图，不拥有状态
// 后端结算可以任意领先前端——前端状态只在这里、且只被节拍推进。
//
// Phase 1 收编战斗卡牌注册表：卡对象与战斗同寿命，zone 迁移只是状态变化（无建毁），
// 差分翻动类 bug（幽灵抽牌 / 入手消失）由此根除。数值面（HP/资源）与房间/塔楼
// 区块随后续阶段迁入。
//
// 纯数据 + 迁移方法，不 import three；视图经事件订阅或由场景导演直接驱动
// （节拍 = 模型迁移 + 视图演出，当前阶段走后者，事件留给跨层视图与测试）。
//
// zone ∈ 'hand' | 'deck'
//      | 'held'（发动展示毕、等待离场节拍的停留位——布局跟踪让位）
// sequencer 串行保证：sync 应用时该卡的离场飞行必已落地，"飞行途中同 id 重生"
// 在结构上不可能发生。

export class DisplayModel {
  constructor() {
    this._bus = mitt();
    this.cards = new Map(); // uniqueID -> { zone, faceSig, prevPower }
  }

  /** 视图/测试订阅模型变化（'card-created' | 'card-zone' | 'card-removed' | 'battle-begin'）。 */
  on(event, handler) { return this._bus.on(event, handler); }

  /** 战斗边界（新 BattleStage 接管时）重置卡牌面：模型跨场存活，内容按场清空。 */
  beginBattle() {
    this.cards.clear();
    this._bus.emit('battle-begin', {});
  }

  get(id) { return this.cards.get(id) ?? null; }
  getZone(id) { return this.cards.get(id)?.zone ?? null; }

  /** 确保卡条目存在（首次见到时以 zone 落位）。幂等，返回条目。 */
  ensureCard(id, zone) {
    let entry = this.cards.get(id);
    if (!entry) {
      entry = { zone, faceSig: null, prevPower: null };
      this.cards.set(id, entry);
      this._bus.emit('card-created', { id, zone });
    }
    return entry;
  }

  /**
   * zone 迁移（状态权威的唯一入口；sync 对账与离场节拍共用）。
   * @returns {null | {from, to}} 发生变化时返回迁移记录（视图据此演出），否则 null。
   */
  setZone(id, zone) {
    const entry = this.ensureCard(id, zone);
    if (entry.zone === zone) return null;
    const from = entry.zone;
    entry.zone = zone;
    this._bus.emit('card-zone', { id, from, to: zone });
    return { from, to: zone };
  }

  /** 卡终结（焚毁）：条目出册。焚毁区不回流；未来"焚毁区捞回"机制须重建条目。 */
  removeCard(id) {
    if (!this.cards.delete(id)) return false;
    this._bus.emit('card-removed', { id });
    return true;
  }
}
