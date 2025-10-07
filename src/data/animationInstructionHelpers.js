// animationInstructionHelpers.js — 状态同步相关助手
// 从 animationDispatcher 拷贝并抽取：captureSnapshot 与 applyProjectionToDisplay
// 另外提供 enqueueState，便于将一次状态同步作为指令推入 animationSequencer

import {toRaw, watch} from 'vue';
import { backendGameState, displayGameState } from './gameState.js';
import animationSequencer from './animationSequencer.js';
import frontendEventBus from '../frontendEventBus.js';

// 内部：S 子集规则
function isWritableProperty(target, key) {
  // 在原始对象及其原型链上查找属性描述符，避免向仅 getter 的访问器属性赋值
  let cur = toRaw(target);
  let desc = undefined;
  while (cur) {
    desc = Object.getOwnPropertyDescriptor(cur, key);
    if (desc) break;
    cur = Object.getPrototypeOf(cur);
  }
  if (!desc) return true; // 未定义则可安全写入（会创建自有属性）
  if (typeof desc.get === 'function' && typeof desc.set !== 'function') return false; // getter-only
  if (Object.prototype.hasOwnProperty.call(desc, 'writable') && desc.writable === false) return false; // 数据属性非可写
  return true;
}

function isSKey(key) {
  return typeof key !== 'string' || !key.endsWith('_');
}

// projectToS：将 backendGameState 投影为轻量快照，仅包含 S 字段，同时保留原型链
function projectToS(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const raw = toRaw(value);

  if (Array.isArray(raw)) {
    // 维持为普通数组；若未来存在自定义 Array 子类，可按需设置原型
    const arr = new Array(raw.length);
    seen.set(value, arr);
    for (let i = 0; i < raw.length; i++) {
      arr[i] = projectToS(raw[i], seen);
    }
    return arr;
  }

  // 为对象创建与后端节点相同的原型
  const proto = Object.getPrototypeOf(raw) || Object.prototype;
  const out = Object.create(proto);
  seen.set(value, out);

  // 仅复制 S 字段，且避免向 getter-only / 不可写属性赋值
  for (const key of Object.keys(raw)) {
    if (!isSKey(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    // 如果后端自身就是 getter-only，也不需要写入该字段
    if (desc && typeof desc.get === 'function' && typeof desc.set !== 'function') continue;
    const v = raw[key];
    if (typeof v === 'function') continue;

    // 跳过不可写字段（考虑到原型链上可能定义为 getter-only）
    if (!isWritableProperty(out, key)) continue;

    out[key] = projectToS(v, seen);
  }
  return out;
}

function getIdKeyFromArray(arr) {
  if (!Array.isArray(arr)) return null;
  for (const el of arr) {
    if (el && typeof el === 'object') {
      if ('uniqueID' in el) return 'uniqueID';
      if ('id' in el) return 'id';
    }
  }
  return null;
}

function createInstanceFromSnapshotNode(node) {
  if (node && typeof node === 'object') {
    const proto = Object.getPrototypeOf(toRaw(node));
    return Object.create(proto || Object.prototype);
  }
  return {};
}

function reconcileArrayById(sArr, dArr) {
  const idKey = getIdKeyFromArray(sArr);
  if (!idKey) return false;
  // Build id -> dest element map
  const dstMap = new Map();
  for (let i = 0; i < dArr.length; i++) {
    const el = dArr[i];
    if (el && typeof el === 'object' && idKey in el) dstMap.set(el[idKey], el);
  }

  const newArr = new Array(sArr.length);
  for (let i = 0; i < sArr.length; i++) {
    const sEl = sArr[i];
    if (sEl && typeof sEl === 'object' && idKey in sEl) {
      const id = sEl[idKey];
      let target = dstMap.get(id);
      if (!target) target = createInstanceFromSnapshotNode(sEl);
      applyProjectionToDisplay(sEl, target);
      newArr[i] = target;
    } else if (sEl && typeof sEl === 'object') {
      let target = createInstanceFromSnapshotNode(sEl);
      applyProjectionToDisplay(sEl, target);
      newArr[i] = target;
    } else {
      newArr[i] = sEl;
    }
  }
  dArr.splice(0, dArr.length, ...newArr);
  return true;
}

// 将 S 投影快照合并到显示层，仅写入/删除 S 字段，保留实例/方法（使用快照的原型）
export function applyProjectionToDisplay(src, dst) {
  if (Array.isArray(src) && Array.isArray(dst)) {
    const done = reconcileArrayById(src, dst);
    if (done) return;

    const len = src.length;
    for (let i = 0; i < len; i++) {
      const sEl = src[i];
      const dEl = dst[i];
      if (sEl && typeof sEl === 'object') {
        if (dEl && typeof dEl === 'object') {
          applyProjectionToDisplay(sEl, dEl);
        } else {
          const inst = createInstanceFromSnapshotNode(sEl);
          applyProjectionToDisplay(sEl, inst);
          dst[i] = inst;
        }
      } else {
        dst[i] = sEl;
      }
    }
    if (dst.length > len) dst.splice(len);
    return;
  }

  // 删除 dst 中 S 字段但 src 不再包含的键
  for (const key of Object.keys(dst)) {
    if (!isSKey(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(dst, key);
    if (desc && typeof desc.get === 'function' && typeof desc.set !== 'function') continue;
    if (typeof dst[key] === 'function') continue;
    if (!Object.prototype.hasOwnProperty.call(src, key)) {
      try { delete dst[key]; } catch (_) {}
    }
  }

  // 将 src 的键写入到 dst
  for (const key of Object.keys(src)) {
    if (!isWritableProperty(dst, key)) continue;
    const sVal = src[key];
    const dVal = dst[key];

    if (Array.isArray(sVal)) {
      if (Array.isArray(dVal)) {
        applyProjectionToDisplay(sVal, dVal);
      } else {
        const arr = new Array(0);
        dst[key] = arr;
        applyProjectionToDisplay(sVal, arr);
      }
      continue;
    }

    if (sVal && typeof sVal === 'object') {
      const sProto = Object.getPrototypeOf(toRaw(sVal));
      if (dVal && typeof dVal === 'object' && !Array.isArray(dVal)) {
        try {
          const dstProto = Object.getPrototypeOf(dVal);
          if (sProto && dstProto !== sProto) {
            Object.setPrototypeOf(dVal, sProto);
          }
        } catch (_) {}
        applyProjectionToDisplay(sVal, dVal);
      } else {
        let obj = Object.create(sProto || Object.prototype);
        applyProjectionToDisplay(sVal, obj);
        dst[key] = obj;
      }
      continue;
    }

    if (dst[key] !== sVal) dst[key] = sVal;
  }
}

// 捕获一次后台状态快照
export function captureSnapshot() {
  return projectToS(backendGameState);
}

// 默认的状态同步“虚拟动画”时长
export const DEFAULT_STATE_CHANGE_DURATION = 200;

function computeWaitTags(options = {}) {
  const explicit = options.waitTags;
  const legacyBlock = options.blockBeforePreviousAnimations;
  if (Array.isArray(explicit)) return explicit;
  if (legacyBlock === true) return ['all'];
  if (legacyBlock === false) return []; // 不等待任何前序
  return ['all']; // 默认等待全部
}

// 对外暴露：将一次状态同步作为指令推入 sequencer
export function enqueueState({ snapshot, durationMs, waitTags } = {}) {
  const snap = snapshot || captureSnapshot();
  const dur = typeof durationMs === 'number' ? durationMs : DEFAULT_STATE_CHANGE_DURATION;
  return animationSequencer.enqueueInstruction({
    tags: ['state'],
    waitTags: waitTags || ['all'],
    durationMs: dur,
    start: () => {
      try {
        applyProjectionToDisplay(snap, displayGameState);
      } catch (err) {
        console.error('[animationInstructionHelpers] applyProjectionToDisplay failed:', err);
      }
    }
  });
}

// 内部：监听 backendGameState 变化，标记为脏
// 如果backendGameState为脏，则在任何enqueueInstruction调用前，自动插入一次enqueueState，并清除脏标记
let backendStateDirty = false;
let endOfTickStateSycnScheduled = false;
function scheduleEndOfTickCheck() {
  if (endOfTickStateSycnScheduled) return;
  endOfTickStateSycnScheduled = true;
  setTimeout(() => {
    endOfTickStateSycnScheduled = false;
    if (backendStateDirty) {
      // tick 结束仍有未同步的变更，强制入队一次当前快照（默认带屏障）
      enqueueState();
    }
  }, 0);
}

export function registerBackendStateWatcher() {
  watch(backendGameState, () => {
    backendStateDirty = true;
    scheduleEndOfTickCheck();
  }, {deep: true, flush: "sync"});
}

export function enqueueInstruction(payload) {
  if(backendStateDirty) {
    // 在入队任何新指令前，先入队一次状态同步
    enqueueState();
    backendStateDirty = false;
  }
  return animationSequencer.enqueueInstruction(payload);
}

// 兼容：延时（纯等待型指令）
export function enqueueDelay(durationMs = 0, { tags = [], waitTags } = {}) {
  return enqueueInstruction({
    tags,
    waitTags,
    durationMs: Math.max(0, durationMs),
    start: () => {},
  });
}

// 兼容原接口：enqueueUI(name, payload = {}, options = {})
// 根据 name 路由到更清晰的助手，或退回到通用事件指令
export function enqueueUI(name, payload = {}, options = {}) {
  switch (name) {
    case 'lockControl':
      return enqueueLockControl(options);
    case 'unlockControl':
      return enqueueUnlockControl(options);
    case 'spawnParticles':
      return enqueueParticles(payload?.particles || payload, options);
    case 'playSound':
      return enqueueSound(payload, options);
    case 'popMessage':
      return enqueuePopMessage(payload, options);
    case 'displayDialog':
      return enqueueDialog(payload, options);
    case 'addBattleLog':
    case 'addBattleLogUI':
      return enqueueBattleLog(payload, options);
    case 'clearBattleLog':
    case 'clearBattleLogUI':
      return enqueueClearBattleLog(options);
    case 'animateCardById':
      return enqueueAnimateCardById(payload, options);
    case 'clearCardAnimations':
      return enqueueClearCardAnimations(options);
    case 'idle':
      // No-op, immediate finish
      return enqueueInstruction({ tags: ['ui'], waitTags: computeWaitTags(options), durationMs: 0, start: () => {} });
    default: {
      // 通用：将 name → 事件名（尽量贴近原约定），无完成回调，立即完成
      const eventName = uiNameToEvent(name);
      return enqueueInstruction({
        tags: ['ui'],
        waitTags: computeWaitTags(options),
        durationMs: options.duration ?? 0,
        start: ({ emit }) => { try { emit(eventName, payload); } catch (_) {} },
      });
    }
  }
}

function uiNameToEvent(name) {
  switch (name) {
    case 'spawnParticles': return 'spawn-particles';
    case 'playSound': return 'play-sound';
    case 'popMessage': return 'pop-message';
    case 'displayDialog': return 'display-dialog';
    case 'addBattleLog':
    case 'addBattleLogUI': return 'add-battle-log';
    case 'clearBattleLog':
    case 'clearBattleLogUI': return 'clear-battle-log';
    case 'animateCardById': return 'animate-card-by-id';
    case 'clearCardAnimations': return 'clear-card-animations';
    default: return name;
  }
}

// 粒子（同步，无需等待完成）
export function enqueueParticles(particles = [], { tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('spawn-particles', particles); } catch (_) {} },
  });
}

// 音效（同步，无需等待完成）
export function enqueueSound(payload = {}, { tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('play-sound', payload); } catch (_) {} },
  });
}

// 飘字/消息（同步，无需等待完成）
export function enqueuePopMessage(payload = {}, { tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('pop-message', payload); } catch (_) {} },
  });
}

// 战斗日志（同步，无需等待完成）
export function enqueueBattleLog(payload = {}, { tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('add-battle-log', payload); } catch (_) {} },
  });
}
export function enqueueClearBattleLog({ tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('clear-battle-log'); } catch (_) {} },
  });
}

export function enqueueDialog(dialogItems = [], { tags = ['ui'], waitTags, durationMs = Infinity, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ id, emit }) => {
      const handler = () => {
        frontendEventBus.off('dialog-ended', handler);
        frontendEventBus.emit('animation-instruction-finished', { id });
      };
      frontendEventBus.on('dialog-ended', handler);
      try { emit('display-dialog', dialogItems); } catch (_) { frontendEventBus.off('dialog-ended', handler); }
    },
  });
}

export function enqueueAnimateCardById(payload = {}, { tags = ['ui'], waitTags, durationMs = Infinity, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ id, emit }) => {
      const token = id;
      const onFinished = (msg = {}) => {
        const t = msg?.token;
        if (t === token) {
          frontendEventBus.off('animation-card-by-id-finished', onFinished);
          frontendEventBus.emit('animation-instruction-finished', { id });
        }
      };
      frontendEventBus.on('animation-card-by-id-finished', onFinished);
      try { emit('animate-card-by-id', Object.assign({}, payload || {}, { completionToken: token })); }
      catch (_) { frontendEventBus.off('animation-card-by-id-finished', onFinished); }
    },
  });
}

export function enqueueClearCardAnimations({ tags = ['ui'], waitTags, durationMs = 0, ...rest } = {}) {
  return enqueueInstruction({
    tags,
    waitTags: waitTags ?? computeWaitTags(rest),
    durationMs,
    start: ({ emit }) => { try { emit('clear-card-animations'); } catch (_) {} },
  });
}

// 控制锁定/解锁
export function enqueueLockControl(options = {}) {
  return enqueueInstruction({
    tags: ['ui', 'locking'],
    waitTags: ['unlocking', 'mount'], // 锁定时不等待任何前序（除了解锁锁定和前端组件挂载），尽快生效，防止二次点击
    durationMs: options.duration ?? 0,
    start: () => { frontendEventBus.emit('disable-controls'); },
  });
}
export function enqueueUnlockControl(options = {}) {
  return enqueueInstruction({
    tags: ['ui', 'unlocking'],
    waitTags: ['all'], // 解锁时总是等待所有前序动画完成，避免过早解锁，防止误操作
    durationMs: options.duration ?? 0,
    start: () => { frontendEventBus.emit('enable-controls'); },
  });
}

// 受伤/治疗动画指令：由后端调用，以动画节奏发送到前端
export function enqueueHurtAnimation({ unitId, hpDamage = 0, passThroughDamage = 0 } = {}) {
  // 计算一个与现有实现接近的时长：
  const isHealing = hpDamage < 0;
  const durationMs = isHealing ? 400 : Math.min(200 + Math.max(0, passThroughDamage) * 2, 600);
  return enqueueInstruction({
    tags: ['ui'],
    waitTags: ['all'],
    durationMs,
    start: ({ emit }) => {
      try { emit('unit-hurt', { unitId, hpDamage, passThroughDamage }); } catch (_) {}
    }
  });
}

// 死亡动画指令
export function enqueueUnitDeath({ unitId } = {}) {
  // 参考 HurtAnimationWrapper：抖动/闪烁/爆炸总计 ~1400ms
  const durationMs = 1500;
  return enqueueInstruction({
    tags: ['ui'],
    waitTags: ['all'],
    durationMs,
    start: ({ emit }) => {
      try { emit('unit-death', { unitId }); } catch (_) {}
    }
  });
}

export default {
  captureSnapshot,
  applyProjectionToDisplay,
  enqueueState,
  enqueueDelay,
  enqueueUI,
  enqueueParticles,
  enqueueSound,
  enqueueBattleLog,
  enqueueClearBattleLog,
  enqueuePopMessage,
  enqueueDialog,
  enqueueAnimateCardById,
  enqueueClearCardAnimations,
  enqueueLockControl,
  enqueueUnlockControl,
  DEFAULT_STATE_CHANGE_DURATION,
  enqueueHurtAnimation,
  enqueueUnitDeath,
};
