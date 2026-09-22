// 常驻 FX 附件系统（buff 光环 / 咏唱点亮 / 敌人特殊状态 overlay 的宿主侧管理器，
// 2026-09-22，fx-architecture-plan 定稿）：常驻 FX = 「在/不在」的状态件，不进节拍队列；
// 由显示状态 diff 驱动（set 方法），不做一次性编排（那是 script.js 剧本的领域）。
//
// 每个 aura 走四态状态机：entering → active → exiting → dead。
// - attach/detach 只改意图并打断在途剧本，同步返回；enter/exit 过渡一律
//   fire-and-forget（runScript 起），转态由剧本收尾回调自己完成。
// - attach 幂等（entering/active 重入 no-op）；exiting 重入 = exit 可打断
//   （kill 退出剧本直接回 active，不重演 enter，有 def.reenter 才调）。
// - detach 打断 entering 时若 def.exit 存在则照播 exit（视觉连续），否则瞬收。
// - dispose()（宿主死亡）全部瞬收：kill 剧本 + def.dispose + 摘 group，
//   不播 exit（不在尸体上放烟花）。
// - 过渡剧本内只做演出，kill 钩子不触发自身转态（转态全在本文件的收尾回调里）。
import * as THREE from 'three';
import { runScript } from './script.js';

export class AuraHost {
  /** @param {{object3D: object}} opts object3D：宿主 Three 对象（aura 的 group 挂它下面） */
  constructor({ object3D }) {
    this._object3D = object3D;
    this._records = new Map(); // key → { aura, script|null }
  }

  /**
   * 挂一个常驻 FX。def = { enter?, exit?, dispose?, reenter? }。
   * @returns aura 实例（entering/active 重入返回既有实例）
   */
  attach(key, def) {
    const rec = this._records.get(key);
    if (rec) {
      const st = rec.aura._state;
      if (st === 'entering' || st === 'active') return rec.aura; // 幂等 no-op
      if (st === 'exiting') {
        // exit 可打断：kill 退出剧本，直接回 active（不重演 enter）
        if (rec.script) { rec.script.kill(); rec.script = null; }
        rec.aura._state = 'active';
        if (typeof def.reenter === 'function') this._safe(() => def.reenter(rec.aura));
        return rec.aura;
      }
      // dead 记录不应残留在表里（防御性清理，落到下方当新建处理）
      this._records.delete(key);
    }
    const aura = {
      key,
      def,
      host: this,
      group: new THREE.Group(), // aura 的视觉根，自动挂宿主 object3D 下
      data: {},                 // def 侧自由暂存（emitter 引用等）
      _state: 'entering',
    };
    const record = { aura, script: null };
    this._records.set(key, record);
    this._object3D.add(aura.group);
    if (typeof def.enter === 'function') {
      record.script = runScript(async () => { await def.enter(aura); }, { animator: null });
      record.script.promise.then(({ killed }) => {
        // 收尾转态：仅当仍在 entering 且未被 kill（kill 路径由触发方负责转态）
        if (!killed && aura._state === 'entering') aura._state = 'active';
      });
    } else {
      aura._state = 'active'; // 无 enter 过渡：立即就位
    }
    return aura;
  }

  detach(key) {
    const rec = this._records.get(key);
    if (!rec) return;
    const { aura } = rec;
    if (aura._state === 'exiting') return; // 已在退场，不重复
    if (aura._state === 'entering' && rec.script) {
      rec.script.kill(); // kill enter 剧本（中断在途过渡）
      rec.script = null;
    }
    aura._state = 'exiting';
    if (typeof aura.def.exit === 'function') this._playExit(rec);
    else this._teardown(rec); // 无 exit：瞬收
  }

  /** 批量对齐显示状态：desired: Map<key, def>，diff——多了 attach、少了 detach、都在不动。 */
  set(desired) {
    for (const [key, def] of desired) {
      if (!this._records.has(key)) this.attach(key, def);
    }
    for (const key of [...this._records.keys()]) {
      if (!desired.has(key)) this.detach(key);
    }
  }

  /** 是否持有该 key（含过渡中）。 */
  has(key) { return this._records.has(key); }

  /** 取 aura 实例（读 data/group 用）；不存在返回 null。 */
  get(key) {
    const rec = this._records.get(key);
    return rec ? rec.aura : null;
  }

  /** 宿主死亡/场景拆除：全部瞬收——kill 剧本 + dispose + 摘 group，不播 exit。 */
  dispose() {
    for (const rec of [...this._records.values()]) {
      const { aura } = rec;
      aura._state = 'dead';
      if (rec.script) { rec.script.kill(); rec.script = null; }
      this._records.delete(aura.key);
      if (typeof aura.def.dispose === 'function') this._safe(() => aura.def.dispose(aura));
      if (aura.group.parent) aura.group.parent.remove(aura.group);
    }
  }

  // exit 过渡剧本：完成后 teardown；被 kill（attach 重入 / dispose）则转态由触发方负责
  _playExit(rec) {
    const { aura } = rec;
    rec.script = runScript(async () => { await aura.def.exit(aura); }, { animator: null });
    rec.script.promise.then(({ killed }) => {
      if (killed) return;
      if (aura._state === 'exiting') this._teardown(rec);
    });
  }

  // 瞬收：dispose + 摘 group + 记录删除（状态置 dead 后剧本收尾回调自然失配）
  _teardown(rec) {
    const { aura } = rec;
    aura._state = 'dead';
    if (rec.script) { rec.script.kill(); rec.script = null; }
    this._records.delete(aura.key);
    if (typeof aura.def.dispose === 'function') this._safe(() => aura.def.dispose(aura));
    if (aura.group.parent) aura.group.parent.remove(aura.group);
  }

  // 钩子调用兜底：def 侧异常不许炸穿宿主管理器
  _safe(fn) {
    try { fn(); } catch (err) { console.error('[fx/aura] 钩子异常（已吞）:', err); }
  }
}
