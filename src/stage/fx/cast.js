// 命名寻址注册表（fx 架构脊柱之二，2026-09-22 定稿）：
// 剧本/相机/配方要驱动「火堆」「Boss」「主光源」时，不该知道具体类与 3D 层级——
// 一律经 cast 按名字拿句柄。命名约定（纯字符串前缀，查询用）：
//   unit:<uniqueID>      战斗单位视图（BattleStage 建视图时登记）
//   role:player          角色别名（BattleStage 登记）
//   prop:<名>            有交互声明的 PCG 道具（composeRoom notifiables，notify 按前缀圈选）
// 规划中、登记方随内容落地（Phase 5+，写剧本前确认有登记方，别照文档臆测）：
//   role:boss            Boss 战那只（暂无登记方——Boss 剧本目前经 args.unit 拿目标）
//   anchor:<名>          场景锚点（'bonfire' 等，PCG/房型搭建侧）
//   light:<名>           可调光灯（lighting 预设侧，供光照切换剧本）
// 句柄是任意对象（UnitObject / THREE.Light / 锚点数据），cast 不解释内容。
// 作用域 = 每个舞台实例一份；舞台销毁即 clear，不跨场景泄漏。

export class Cast {
  constructor() { this._map = new Map(); }

  /**
   * 登记。重名且句柄不同 → 告警替换（PCG 重建/读档恢复会重演搭建，重名属预期；
   * 告警留着——若两处代码抢同一个名字，多半是真 bug）。
   */
  register(name, handle) {
    if (name == null || handle == null) throw new Error('Cast.register: name 与 handle 必填');
    const prev = this._map.get(name);
    if (prev !== undefined && prev !== handle) {
      console.warn(`[fx/cast] 重名登记替换：${name}`);
    }
    this._map.set(name, handle);
    return handle;
  }

  /** 注销。给了 handle 时仅当仍是同一句柄才摘（防错摘后来者）。 */
  unregister(name, handle = undefined) {
    if (handle !== undefined && this._map.get(name) !== handle) return false;
    return this._map.delete(name);
  }

  get(name) { return this._map.get(name) ?? null; }
  has(name) { return this._map.has(name); }

  /** 前缀圈选（'light:' → 全部可调光灯）。返回 [{ name, handle }]。 */
  query(prefix) {
    const out = [];
    for (const [name, handle] of this._map) {
      if (name.startsWith(prefix)) out.push({ name, handle });
    }
    return out;
  }

  clear() { this._map.clear(); }
}

export function createCast() { return new Cast(); }
