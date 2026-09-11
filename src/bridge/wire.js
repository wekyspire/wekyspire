// wire：bridge 事件流 ↔ 直播传输格式的转换层（tools/broadcast.mjs 服务端推流、
// src/bridge/remoteBridge.js 浏览器端重放共用同一份实现，两端不会漂移）。
//
// 传输的基本单位是**指令描述符**（可序列化）：{ event, payload }。
// 为什么描述符够用：presenter 的每条指令都是
//   { tags, waitTags, durationMs, meta:{event,payload} }
//   start: ({id, meta, emit}) => emit(meta.event, {...meta.payload, _animId:id})
// —— start 只依赖放进去的数据（presenter.js:25-50），所以浏览器端能原样重建
// 一条新指令（_animId 由本地 sequencer 生成、本地回执闭环），旧 id 无需跨网同步。
//
// payload 过线的清洗（toWire）：presenter 把 core 的调用参数原样塞进 payload，
// 里面有 Unit 实例 / 技能定义对象 / live 卡 runtime——带原型方法、且是活引用。
// 本地 Stage 只从 payload 取 uniqueID 与标量（BattleStage.js:1258-1266 寻址、
// :902-908 读数值），数值面一律以 sync 快照为准，所以按 id 压平即可：
//   Unit        → { uniqueID, name, defId, hp, maxHp, shield }
//   技能定义    → { id, name, tier }
//   卡牌运行时  → { uniqueID, defId, isActivated, remainingUses }
//   （本项一般不会触发：live runtime 本身是纯数据对象，见下）
//   函数一律丢弃；普通对象/数组递归（带深度上限与环路保护）。
//
// **只压缩「活对象」，纯数据一律原样透传**——判据是「非普通对象（class 实例，
// 带原型方法）」或「自带函数字段（技能定义）」：
//   投影产物（projectUnit/projectCardFull）也是含 uniqueID+defId 的纯对象，
//   若一并按 id 压平，name/hp/maxHp/shield/text/cost/… 会被整片抹掉
//   （sync 快照里单位与卡面就全丢字段了——2026-09 踩过）。

import { ANIM_TIMING, EventNames } from './events.js';

/** 非可视化记账指令：presenter 用它在队列尾闸上发 BATTLE_END（presenter.js:71-78）。
 *  浏览器端按名特判（发本地 backendBus + 自完结），不当作动画播出。 */
export const WIRE_END_GATE = 'battle:end-gate';

/** 普通对象（字面量/JSON 产物）——投影数据都是这一类，必须逐字段保留。 */
function isPlainObject(v) {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 自有字段里有函数 → 活定义对象（技能/效果定义），需要按 id 压平。 */
function hasFunctionProp(v) {
  for (const k of Object.keys(v)) if (typeof v[k] === 'function') return true;
  return false;
}

/** payload → 可 JSON 序列化的纯数据（未知结构递归兜底，函数丢弃）。 */
export function toWire(value, depth = 0, seen = null) {
  if (value == null) return value ?? null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined;
  if (depth > 6) return undefined; // 深度上限：异常结构不把推流拖垮
  if (value instanceof Date) return value.toISOString();
  const guard = seen ?? new WeakSet();
  if (guard.has(value)) return undefined; // 环路保护
  guard.add(value);

  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const v = toWire(item, depth + 1, guard);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  // —— 活对象才压缩（顺序敏感：Unit 有 hp/maxHp 无 defId，卡 runtime 有 defId）——
  if (!isPlainObject(value) || hasFunctionProp(value)) {
    // 战斗单位（Unit class 实例，unit.js:8-30）
    if (typeof value.uniqueID === 'string' && 'hp' in value && 'maxHp' in value) {
      return {
        uniqueID: value.uniqueID,
        name: value.name ?? '',
        defId: value.defId ?? null,
        hp: value.hp,
        maxHp: value.maxHp,
        shield: value.shield ?? 0,
      };
    }
    // 技能定义（注册表对象，含 use/describe 等方法）
    if (typeof value.id === 'string' && typeof value.name === 'string'
      && (typeof value.describe === 'function' || typeof value.use === 'function')) {
      return { id: value.id, name: value.name, tier: value.tier ?? null };
    }
    // 卡牌运行时（带方法的变体；纯数据 runtime 走下面的普通递归，字段全保留）
    if (typeof value.uniqueID === 'string' && typeof value.defId === 'string') {
      return {
        uniqueID: value.uniqueID,
        defId: value.defId,
        isActivated: value.isActivated ?? false,
        remainingUses: value.remainingUses ?? null,
      };
    }
  }

  // 普通对象：原样递归（class 实例走这里时只保留自有可枚举标量）
  const out = {};
  for (const key of Object.keys(value)) {
    const v = toWire(value[key], depth + 1, guard);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** 指令描述符 → 可发送的记录：由 enqueueInstruction 的入参构造（服务端 tap 调用）。
 *  tags/waitTags/durationMs 一并过线——浏览器端按同参数重建，节拍依赖不漂移。
 *  （durationMs 非有限值（Infinity 兜底）时不发，浏览器端回落 ANIM_TIMING 同款兜底。） */
export function instructionRecord(opts = {}) {
  const w = opts.wire;
  if (!w?.event) return null;
  const rec = { t: 'i', event: w.event, payload: toWire(w.payload) ?? null };
  if (opts.tags !== undefined) rec.tags = [...opts.tags];
  if (opts.waitTags !== undefined) rec.waitTags = [...opts.waitTags];
  if (Number.isFinite(opts.durationMs)) rec.durationMs = opts.durationMs;
  return rec;
}

/**
 * 入队一条「可重建」的动画指令——presenter 与浏览器端重放共用同一实现。
 * durationMs 缺省按事件名取 ANIM_TIMING（presenter.js:27 同款兜底）。
 */
export function enqueueAnimInstruction(sequencer, {
  event, payload = null, tags, waitTags, durationMs,
} = {}) {
  return sequencer.enqueueInstruction({
    ...(tags !== undefined ? { tags } : {}),
    ...(waitTags !== undefined ? { waitTags } : {}),
    durationMs: durationMs ?? (ANIM_TIMING[event] ?? 2500),
    meta: { event, payload },
    wire: { event, payload },
    start: ({ id, meta, emit }) => emit(meta.event, { ...meta.payload, _animId: id }),
  });
}

/**
 * 浏览器端：把服务端推来的指令记录重建成本地指令。
 * @param buses {{ frontendBus, backendBus }} 本地总线（end-gate 在 backendBus 上发）
 * @returns {boolean} 是否已入队
 */
export function replayWireInstruction(sequencer, { frontendBus, backendBus }, rec) {
  if (!rec?.event) return false;
  if (rec.event === WIRE_END_GATE) {
    // 终局尾闸：与 presenter.js:71-78 同语义（发射即自完结，同步泵起后续）
    sequencer.enqueueInstruction({
      meta: { event: WIRE_END_GATE },
      wire: { event: rec.event, payload: rec.payload ?? null },
      durationMs: 0,
      start: ({ id }) => {
        backendBus.emit(EventNames.BATTLE_END, { result: rec.payload?.result ?? null });
        sequencer.finish(id);
      },
    });
    return true;
  }
  enqueueAnimInstruction(sequencer, {
    event: rec.event,
    payload: rec.payload,
    tags: rec.tags,
    waitTags: rec.waitTags,
    durationMs: rec.durationMs,
  });
  return true;
}
