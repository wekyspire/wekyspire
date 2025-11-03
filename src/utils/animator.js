// animator.js - 新一代动画编排器
// 核心职责：
// 1. 管理可动画元素的 DOM 注册表
// 2. 执行来自 animationSequencer 的动画指令
// 3. 管理锚点信息，实现元素向锚点的"静息归位"
// 4. 提供适配器机制，支持不同类型元素的动画

import frontendEventBus from '../frontendEventBus.js';
import gsap from 'gsap';

const defaultEase = 'power2.out';

// ========== 状态与配置常量 ==========
const STATES = Object.freeze({
  IDLE: 'idle',
  TRACKING: 'tracking',
  ANIMATING: 'animating',
  DRAGGING: 'dragging'
});

// 跟踪动画的默认平滑时间（毫秒）与缓动
const DEFAULT_TRACKING_DURATION_MS = 300;
const DEFAULT_TRACKING_EASE = 'power1.out';

// ========== 适配器接口 ==========

/**
 * 卡牌适配器
 */
class CardAdapter {
  getDefaultProps(element) {
    const rect = element?.getBoundingClientRect?.();
    return {
      width: rect?.width || 198,
      height: rect?.height || 266
    };
  }

  beforeAnimate(element, animationPayload) {
    // 卡牌动画前的预处理
  }

  afterAnimate(element, animationPayload) {
    // 卡牌动画后的清理
  }

  getRestPosition(id, anchorsMap) {
    return anchorsMap.get(id) || null;
  }
}

/**
 * 单位面板适配器
 */
class UnitPanelAdapter {
  getDefaultProps(element) {
    const rect = element?.getBoundingClientRect?.();
    return {
      width: rect?.width || 300,
      height: rect?.height || 200
    };
  }

  beforeAnimate(element, animationPayload) {
    // 面板动画前的预处理
  }

  afterAnimate(element, animationPayload) {
    // 面板动画后的清理
  }

  getRestPosition(id, anchorsMap) {
    return anchorsMap.get(id) || null;
  }
}

// 适配器工厂
const adapters = {
  'card': new CardAdapter(),
  'unit-panel': new UnitPanelAdapter()
};

// ========== Animator 核心类 ==========
// Animator用于维护与播放可动画元素的动画和它们的状态
// 可动画元素的状态列表：'idle' | 'tracking' | 'animating' | 'dragging'
// 每个可动画元素在任意时刻能且仅能属于一个状态
// idle: 待命，无动画，保持元素现有动画参量不变。
// tracking: 元素正维持锚点跟踪，在锚点状态移动时，元素会平滑跟踪到锚点的目标状态。比如手牌。使用一个动态更新目标参数的长时动画实现
// animating: 元素正在执行指令动画（animate），比如刚刚打出、抽取、发动的卡牌
// dragging: 元素正被鼠标拖拽。这是一个特殊状态，一般用于被玩家使用鼠标拖拽中的卡牌上，一般用于在休整时切换排序和卡牌上下场
// 在没有外部干预情况下，状态仅会在自动切换至idle。若要切换到tracking、animating、dragging，则需要外部方法调用完成

class Animator {
  constructor() {
    // DOM 注册表: id -> { element, adapterType, adapter, anchor, state, currentTween, isDragging }
    this._registry = new Map();
    
    // 容器锚点表: containerKey -> Map<id, { x, y, scale?, rotation? }>
    this._containerAnchors = new Map();
    
    // 全局锚点: name -> { x, y }
    this._globalAnchors = new Map();

    // 全局锚点监听器：name -> handler（用于去重与清理）
    this._globalAnchorListeners = new Map();
    
    // 全局锚点跟踪配置（统一使用毫秒）
    this._anchorTrackingDurationMs = DEFAULT_TRACKING_DURATION_MS; // 默认锚点跟踪平滑动画持续时间（毫秒）
    this._anchorTrackingEase = DEFAULT_TRACKING_EASE;

    // 绑定事件监听
    this._bindEvents();
  }

  // 内部工具：安全杀死当前 tween 并清空引用
  _killCurrentTween(entry) {
    if (entry?.currentTween) {
      try { entry.currentTween.kill(); } catch (_) {}
      entry.currentTween = null;
    }
  }

  // 计算元素当前未缩放的基准尺寸（用于按中心对齐）
  _getBaseSize(element) {
    if (!element) return { width: 0, height: 0 };
    // 使用未受变换影响的布局尺寸，避免旋转与缩放对基准尺寸计算的干扰
    const ow = (typeof element.offsetWidth === 'number') ? element.offsetWidth : 0;
    const oh = (typeof element.offsetHeight === 'number') ? element.offsetHeight : 0;
    if (ow > 0 && oh > 0) return { width: ow, height: oh };
    // 兜底：用 rect 并除以当前缩放（若存在）
    const rect = element.getBoundingClientRect();
    const sx = parseFloat(gsap.getProperty(element, 'scaleX')) || 1;
    const sy = parseFloat(gsap.getProperty(element, 'scaleY')) || 1;
    const bw = sx ? rect.width / sx : rect.width;
    const bh = sy ? rect.height / sy : rect.height;
    return { width: bw, height: bh };
  }

  // 确保为 tracking 状态创建/更新 quickTo setters
  _ensureQuickSetters(entry, { durationMs, ease } = {}) {
    if (!entry || !entry.element) return;
    const dSec = Math.max(0.001, ((typeof durationMs === 'number' ? durationMs : this._anchorTrackingDurationMs) || DEFAULT_TRACKING_DURATION_MS) / 1000);
    const easing = ease || this._anchorTrackingEase;
    const el = entry.element;

    const cfgKey = `${dSec}|${easing}`;
    if (entry._quickCfgKey === cfgKey && entry._quick) return; // 已经存在且配置一致

    entry._quick = {
      x: gsap.quickTo(el, 'x', { duration: dSec, ease: easing, overwrite: true }),
      y: gsap.quickTo(el, 'y', { duration: dSec, ease: easing, overwrite: true }),
      scaleX: gsap.quickTo(el, 'scaleX', { duration: dSec, ease: easing, overwrite: true }),
      scaleY: gsap.quickTo(el, 'scaleY', { duration: dSec, ease: easing, overwrite: true }),
      rotation: gsap.quickTo(el, 'rotation', { duration: dSec, ease: easing, overwrite: true })
    };
    entry._quickCfgKey = cfgKey;
  }

  // 应用 tracking 目标（使用 quickTo 动态更新）
  _applyTrackingQuickTarget(entry, anchor, opts = {}) {
    if (!entry || !entry.element || !anchor) return;
    this._ensureQuickSetters(entry, opts);

    const el = entry.element;
    // 计算基于目标 scale 的中心对齐 x/y
    const base = this._getBaseSize(el);
    const csx = parseFloat(gsap.getProperty(el, 'scaleX')) || 1;
    const csy = parseFloat(gsap.getProperty(el, 'scaleY')) || 1;
    const targetScale = (anchor.scale != null) ? anchor.scale : Math.max(csx, csy);
    const x = anchor.x - (base.width * targetScale) / 2;
    const y = anchor.y - (base.height * targetScale) / 2;

    // 调用 quick setters 进行平滑跟踪
    if (entry._quick) {
      entry._quick.x(x);
      entry._quick.y(y);
      if (anchor.scale != null) {
        entry._quick.scaleX(targetScale);
        entry._quick.scaleY(targetScale);
      }
      if (anchor.rotation != null) entry._quick.rotation(anchor.rotation);
    }
  }

  /**
   * 初始化
   */
  init(options = {}) {
    
    // 设置全局锚点
    if (options.centerAnchorEl) {
      this.setGlobalAnchorEl('center', options.centerAnchorEl);
    }
    
    // 注意：不再从 overlayRefs 中设置 deckAnchorEl
    // deck 锚点应该由 ActionPanel 在 mounted 时设置为实际的 DeckIcon
    
    // 其他全局锚点
    Object.entries(options).forEach(([key, value]) => {
      if (key.endsWith('AnchorEl') && key !== 'centerAnchorEl' && key !== 'deckAnchorEl') {
        const name = key.replace(/AnchorEl$/, '');
        this.setGlobalAnchorEl(name, value);
      }
    });
  }

  /**
   * 绑定前端事件总线监听
   */
  _bindEvents() {
    // 监听动画元素指令
    frontendEventBus.on('animate-element', (payload) => {
      this.animate(payload);
    });
    
    // 新增：监听纯特效动画指令（用于桥接到 Pixi Overlay）
    frontendEventBus.on('animate-element-effect', (payload) => {
      this.animateEffect(payload);
    });

    // 监听动画到锚点指令
    frontendEventBus.on('animate-element-to-anchor', (payload) => {
      this.animateToAnchor(payload.id, payload.anchor || 'rest', payload);
    });
    
    // 进入跟踪状态指令
    frontendEventBus.on('enter-element-tracking', (payload) => {
      this.enterTracking(payload.id, payload);
    });

    // 标准化事件：进入某个状态
    frontendEventBus.on('enter-element-dragging', ({ id }) => this.enterDragging(id));
    frontendEventBus.on('enter-element-idle', ({ id }) => this.enterIdle(id));
  }

  // ========== 可动画元素注册表管理 ==========

  /**
   * 注册可动画元素
   * @param {string|number} id - 元素唯一标识
   * @param {HTMLElement} element - DOM 元素
   * @param {string} adapterType - 适配器类型 ('card' | 'unit-panel')
   */
  register(id, element, adapterType = 'card') {
    if (id == null || !element) {
      console.warn('[animator] register: invalid id or element', id, element);
      return;
    }

    const adapter = adapters[adapterType];
    if (!adapter) {
      console.warn('[animator] register: unknown adapter type', adapterType);
      return;
    }

    // 解除旧的注册
    if (this._registry.has(id)) {
      this.unregister(id);
    }

    this._registry.set(id, {
      element,
      adapterType,
      adapter,
      anchor: null,
      state: STATES.IDLE, // 当前状态
      currentTween: null, // 当前的 GSAP tween（无论是跟踪还是指令）
      isDragging: false
    });
    // 新注册的元素默认隐藏，避免在动画前一帧出现在 (0,0)
    try { element.style.visibility = element.style.visibility || 'hidden'; } catch (_) {}
  }

  /**
   * 解除可动画元素的注册
   */
  unregister(id) {
    if (id == null) return;
    
    const entry = this._registry.get(id);
    if (!entry) return;

    // 停止跟踪/动画/特效
    this._stopTracking(entry);
    this._killCurrentTween(entry);
    this._interruptEffect(entry);

    this._registry.delete(id);
  }

  /**
   * 获取已注册的 DOM 元素
   */
  getElement(id) {
    return this._registry.get(id)?.element || null;
  }

  // ========== 锚点管理 ==========

  /**
   * 更新容器的锚点信息
   * @param {string} containerKey - 容器标识
   * @param {Map<string|number, {x, y, scale?, rotation?}>} anchorsMap - 锚点目标动画参量映射
   */
  updateAnchors(containerKey, anchorsMap) {
    if (!containerKey || !anchorsMap) {
      console.warn('[animator] updateAnchors: invalid params', containerKey, anchorsMap);
      return;
    }

    // 过滤掉无效的锚点，防止 NaN 坐标污染注册表
    const safeMap = new Map();
    for (const [id, anchor] of anchorsMap.entries()) {
      if (!anchor) continue;
      const sx = Number.isFinite(anchor.x) ? anchor.x : null;
      const sy = Number.isFinite(anchor.y) ? anchor.y : null;
      const ss = anchor.scale == null || Number.isFinite(anchor.scale) ? anchor.scale : null;
      if (sx != null && sy != null) {
        // 复制一份，避免外部引用被后续修改
        const item = { x: sx, y: sy };
        if (ss != null) item.scale = ss;
        if (anchor.rotation != null && Number.isFinite(anchor.rotation)) item.rotation = anchor.rotation;
        safeMap.set(id, item);
      }
    }

    // 如果没有有效锚点，直接返回，不更新现有状态
    if (safeMap.size === 0) return;

    this._containerAnchors.set(containerKey, safeMap);

    // 更新注册表中的锚点引用
    for (const [id, anchor] of safeMap.entries()) {
      const entry = this._registry.get(id);
      if (entry) {
        entry.anchor = anchor;
        // 根据当前状态处理锚点更新
        if (entry.state === STATES.TRACKING) {
          // 使用 quickTo 平滑更新目标
          this._applyTrackingQuickTarget(entry, anchor);
        }
        // idle / animating 或 dragging 状态：和anchor无关，不干预
      }
    }
  }

  /**
   * 计算锚点目标属性（内部助手函数）
   * @private
   */
  _computeAnchorTargetProps(element, anchor) {
    if (!element || !anchor) return null;
    const base = this._getBaseSize(element);
    const csx = parseFloat(gsap.getProperty(element, 'scaleX')) || 1;
    const csy = parseFloat(gsap.getProperty(element, 'scaleY')) || 1;
    const currentScale = Math.max(csx, csy);
    const targetScale = (anchor.scale != null) ? anchor.scale : currentScale;
    return {
      x: anchor.x - (base.width * targetScale) / 2,
      y: anchor.y - (base.height * targetScale) / 2,
      scale: targetScale,
      rotation: anchor.rotation || 0
    };
  }

  /**
   * 创建锚点跟踪动画（锚点跟踪状态的核心逻辑，被多个方法复用）
   * @private
   * @param {Object} entry - 注册表项
   * @param {Object} anchor - 锚点对象
   * @param {Object} options - 选项
   * @param {number} [options.durationMs] - 跟踪持续时长（毫秒）
   * @param {string} [options.ease] - 缓动函数
   * @param {Function} [options.onComplete] - 完成回调（可选）
   * @param {Function} [options.onInterrupt] - 中断回调（可选）
   * @returns {Object} GSAP tween 对象
   */
  _createTrackingTween(entry, anchor, options = {}) {
    if (!entry || !anchor || !entry.element) return null;
    
    const { element } = entry;
    const targetProps = this._computeAnchorTargetProps(element, anchor);
    if (!targetProps) return null;
    
    // 使用默认配置或自定义参数（统一使用毫秒，to 时转换为秒）
    const durationMs = typeof options.durationMs === 'number' ? options.durationMs : this._anchorTrackingDurationMs;
    const durationSec = Math.max(0.001, (durationMs || DEFAULT_TRACKING_DURATION_MS) / 1000);
    const ease = options.ease || this._anchorTrackingEase;
    
    // 创建跟踪动画
    const tween = gsap.to(element, {
      ...targetProps,
      duration: durationSec,
      ease,
      overwrite: true,
      onComplete: () => {
        // 默认行为：完成后，清理tween，但仍保持 tracking 状态，如此，在锚点移动时可继续启动动画并继续跟踪
        if (entry.currentTween === tween) {
          entry.currentTween = null;
        }
        // 执行自定义回调
        if (options.onComplete) {
          options.onComplete();
        }
      },
      onInterrupt: () => {
        if (entry.currentTween === tween) {
          entry.currentTween = null;
        }
        // 执行自定义回调
        if (options.onInterrupt) {
          options.onInterrupt();
        }
      }
    });
    
    return tween;
  }
  
  // 工具：移除并替换指定全局锚点的 resize 监听（防止重复监听）
  _replaceGlobalAnchorResizeListener(name, handler) {
    const prev = this._globalAnchorListeners.get(name);
    if (prev && typeof window !== 'undefined') {
      try { window.removeEventListener('resize', prev); } catch (_) {}
    }
    if (handler) {
      this._globalAnchorListeners.set(name, handler);
      try { window.addEventListener('resize', handler, { passive: true }); } catch (_) {}
    } else {
      this._globalAnchorListeners.delete(name);
    }
  }

  /**
   * 应用锚点位置到元素（立即设置，无动画）
   */
  setGlobalAnchorEl(name, element) {
    if (!name) return;
    
    const updatePosition = () => {
      if(!element) {
        // 移除全局锚点与监听
        this._globalAnchors.delete(name);
        this._replaceGlobalAnchorResizeListener(name, null);
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect) {
        const anchor = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
        this._globalAnchors.set(name, anchor);
      }
    };

    updatePosition();
    // 使用替换逻辑避免重复监听
    this._replaceGlobalAnchorResizeListener(name, updatePosition);
  }

  /**
   * 设置全局锚点（直接坐标）
   */
  setGlobalAnchor(name, position) {
    if (!name || !position) return;
    this._globalAnchors.set(name, { x: position.x, y: position.y });
  }

  /**
   * 获取锚点坐标
   */
  getAnchorPoint(anchorName) {
    // 如果是对象形式的坐标，直接返回
    if (typeof anchorName === 'object' && anchorName.x != null && anchorName.y != null) {
      return { x: anchorName.x, y: anchorName.y };
    }

    // 从全局锚点获取
    if (typeof anchorName === 'string') {
      const global = this._globalAnchors.get(anchorName);
      if (global) {
        // console.log(`[animator] Using global anchor '${anchorName}':`, global);
        return global;
      }
      console.warn(`[animator] Global anchor '${anchorName}' not found, using screen center`);
    }

    // 默认返回屏幕中心
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
  }

  // ========== 动画执行 ==========

  /**
   * 切换到animating状态并执行动画指令，在duration后停止动画并回归idle状态。
   */
  animate(payload) {
    const { id, from = {}, to = {}, duration = 300, ease = defaultEase, anchor, instructionId } = payload;

    const entry = this._registry.get(id);
    if (!entry) {
      console.warn('[animator] animate: element not registered', id);
      if (instructionId) {
        frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
      }
      return;
    }

    const { element, adapter } = entry;

    // 1. 停止tracking状态的跟踪动画（如果正在进行）
    this._stopTracking(entry);
    // 1.1 若有特效，先中断并释放
    this._interruptEffect(entry);

    // 2. 杀死当前正在执行的动画（如果有）
    this._killCurrentTween(entry);

    // 3. 转换到 animating 状态
    entry.state = STATES.ANIMATING;

    // 前处理
    try { adapter.beforeAnimate(element, payload); } catch (_) {}

    // 构建起始属性 (from)
    const fromProps = {};

    // 处理 from.anchor
    if (from.anchor) {
      const anchorPoint = this.getAnchorPoint(from.anchor);
      const rect = element.getBoundingClientRect();
      fromProps.x = anchorPoint.x - rect.width / 2;
      fromProps.y = anchorPoint.y - rect.height / 2;
    }

    // 合并 from 属性（统一 rotation 命名）
    if (from.x != null) fromProps.x = from.x;
    if (from.y != null) fromProps.y = from.y;
    if (from.scale != null) fromProps.scale = from.scale;
    if (from.rotation != null) fromProps.rotation = from.rotation;
    if (from.rotate != null) fromProps.rotation = from.rotate; // 兼容别名
    if (from.opacity != null) fromProps.autoAlpha = from.opacity;

    // 如果有 from 属性，先立即设置到起始位置
    if (Object.keys(fromProps).length > 0) {
      gsap.set(element, fromProps);
      // 若元素仍处于隐藏状态且未指定 from.opacity，则在定位后再显现，避免 (0,0) 闪烁
      if (element.style.visibility === 'hidden' && from.opacity == null) {
        gsap.set(element, { autoAlpha: 1 });
      }
    } else {
      // 无 from 属性：若元素仍为隐藏，则直接显现
      if (element.style.visibility === 'hidden') {
        gsap.set(element, { autoAlpha: 1 });
      }
    }

    // 构建目标属性 (to)
    const toProps = {};

    // 处理顶层 anchor（目标锚点）
    if (anchor) {
      const anchorPoint = this.getAnchorPoint(anchor);
      const rect = element.getBoundingClientRect();
      toProps.x = anchorPoint.x - rect.width / 2;
      toProps.y = anchorPoint.y - rect.height / 2;
    }

    // 合并 to 属性（统一 rotation 命名）
    if (to.x != null) toProps.x = to.x;
    if (to.y != null) toProps.y = to.y;
    if (to.scale != null) toProps.scale = to.scale;
    if (to.rotation != null) toProps.rotation = to.rotation;
    if (to.rotate != null) toProps.rotation = to.rotate; // 兼容别名
    if (to.opacity != null) toProps.autoAlpha = to.opacity;

    // 4. 创建新的动画 tween
    const tween = gsap.to(element, {
      ...toProps,
      duration: Math.max(0.001, duration / 1000),
      ease,
      force3D: true,
      lazy: false,
      overwrite: true, // 强制覆盖，确保单一通道
      onComplete: () => {
        try { adapter.afterAnimate(element, payload); } catch (_) {}

        // 动画完成，回到 idle 状态（不自动恢复跟踪）
        if (entry.state === STATES.ANIMATING) {
          entry.state = STATES.IDLE;
        }
        entry.currentTween = null;

        // 通知完成
        if (instructionId) {
          frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
        }
      },
      onInterrupt: () => {
        // 被中断也要清理状态
        entry.currentTween = null;
        if (entry.state === STATES.ANIMATING) {
          entry.state = STATES.IDLE;
        }
        if (instructionId) {
          frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
        }
      }
    });

    // 保存当前 tween
    entry.currentTween = tween;
  }

  /**
   * 纯特效动画：不操作 DOM，仅向 Pixi Overlay 发出特效启动信号，并在 duration 后通知 sequencer 完成。
   * 典型：burn 焚毁、命中闪光等。
   */
  animateEffect(payload = {}) {
    const { id, effect = 'burn', duration = 850, instructionId, options = {} } = payload;
    if (id == null) {
      console.warn('[animator] animateEffect: missing id');
      if (instructionId) frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
      return;
    }

    let overlayName = null;
    switch (effect) {
      case 'burn':
        overlayName = 'pulse:burn';
        break;
      default:
        overlayName = `pulse:${effect}`;
        break;
    }

    try {
      frontendEventBus.emit('overlay:effect:add', { id, name: overlayName, options: { duration, ...options } });
    } catch (e) {
      console.warn('[animator] animateEffect: emit overlay failed', e);
    }

    setTimeout(() => {
      if (instructionId) frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
    }, Math.max(0, duration));
  }

  /**
   * 动画到锚点（快捷方法）
   */
  animateToAnchor(id, anchorName, options = {}) {
    this.animate({
      id,
      anchor: anchorName,
      to: {},
      duration: options.duration || 300,
      ease: options.ease || defaultEase,
      instructionId: options.instructionId
    });
  }

  /**
   * 应用震动效果
   */
  _applyShakeEffect(element, payload) {
    const { intensity = 2, duration = 300 } = payload;
    // 每次抖动的单程时长 50ms，往返一次 100ms
    const cycleMs = 100;
    const repeats = Math.max(0, Math.floor(duration / cycleMs) * 2); // 偶数次半程，保证回到原位

    return gsap.to(element, {
      x: `+=${intensity}`,
      duration: 0.05,
      repeat: repeats,
      yoyo: true,
      ease: 'power1.inOut'
      // 去掉 onComplete 的强制 x=0，避免覆盖原始位置
    });
  }

  /**
   * 停止跟踪动画（内部使用）
   */
  _stopTracking(entry) {
    if (!entry) return;
    if (entry.state === STATES.TRACKING && entry.currentTween) {
      entry.currentTween.kill();
      entry.currentTween = null;
    }
    // 结束 quickTo 产生的补间，避免影响下一次动画
    try { gsap.killTweensOf(entry.element, 'x,y,scaleX,scaleY,rotation'); } catch (_) {}
    entry._quick = null;
    entry._quickCfgKey = null;
  }

  // ========== 拖拽状态管理 ==========

  /**
   * 统一入口：进入拖拽状态（推荐使用）
   */
  enterDragging(id) {
    const entry = this._registry.get(id);
    if (!entry) return;

    // 停止跟踪动画（tracking状态）
    this._stopTracking(entry);
    // 中断特效
    this._interruptEffect(entry);

    // 杀死当前正在执行的动画（animating状态）
    this._killCurrentTween(entry);

    // 转换到 dragging 状态
    entry.state = STATES.DRAGGING;
    entry.isDragging = true;
  }

  // ========== 锚点跟踪 ==========
  /**
   * 进入锚点跟踪（从任意状态切换到 tracking 状态）
   * 每种状态仅保留一个入口方法：enterTracking
   * @param {string|number} id - 元素 ID
   * @param {Object} options - 选项
   * @param {number} [options.duration] - 跟踪平滑持续时长（毫秒），默认使用全局配置
   * @param {string} [options.ease] - 缓动函数
   * @param {string} [options.instructionId] - 指令 ID（用于通知完成）
   */
  enterTracking(id, options = {}) {
    const entry = this._registry.get(id);
    if (!entry) {
      console.warn('[animator] enterTracking: element not registered', id);
      // 不再释放 animation-instruction-finished（这是状态切换指令）
      return;
    }

    if (!entry.anchor) {
      console.warn('[animator] enterTracking: element has no anchor', id);
      // 不再释放 animation-instruction-finished（这是状态切换指令）
      return;
    }

    // 停止当前动画（如果有）
    this._stopTracking(entry);
    this._killCurrentTween(entry);
    // 中断特效
    this._interruptEffect(entry);

    // 转换到 tracking 状态
    entry.state = STATES.TRACKING;

    // 初始化 quickTo 并应用当前 anchor 目标
    this._ensureQuickSetters(entry, { durationMs: options.duration, ease: options.ease });
    this._applyTrackingQuickTarget(entry, entry.anchor, { durationMs: options.duration, ease: options.ease });

    // tracking 模式下不再使用 currentTween
    entry.currentTween = null;

    // 不释放 animation-instruction-finished（这是状态切换指令）
  }

  /**
   * 设置全局锚点跟踪配置（毫秒）
   */
  setAnchorTrackingConfig({ duration, ease } = {}) {
    if (duration != null) this._anchorTrackingDurationMs = duration;
    if (ease != null) this._anchorTrackingEase = ease;
  }

  /**
   * 主动进入 idle（提供统一的状态入口）
   */
  enterIdle(id) {
    const entry = this._registry.get(id);
    if (!entry) return;
    // 终止一切动画与拖拽
    this._killCurrentTween(entry);
    this._stopTracking(entry);
    this._interruptEffect(entry);
    entry.isDragging = false;
    entry.state = STATES.IDLE;
  }

  /**
   * 重置所有动画，清空registry
   */
  reset() {
    for (const [, entry] of this._registry.entries()) {
      this._killCurrentTween(entry);
      this._interruptEffect(entry);
    }
    this._registry.clear();
    this._containerAnchors.clear();

    // 清理全局锚点监听
    if (typeof window !== 'undefined') {
      for (const [name, handler] of this._globalAnchorListeners.entries()) {
        try { window.removeEventListener('resize', handler); } catch (_) {}
      }
    }
    this._globalAnchorListeners.clear();
  }

  /**
   * 调试工具：获取当前状态
   */
  getStatus() {
    const entries = [];
    for (const [id, entry] of this._registry.entries()) {
      entries.push({
        id,
        adapterType: entry.adapterType,
        state: entry.state,
        hasAnchor: !!entry.anchor,
        isDragging: entry.isDragging,
        hasTween: !!entry.currentTween
      });
    }
    return {
      registered: this._registry.size,
      containers: this._containerAnchors.size,
      globalAnchors: Array.from(this._globalAnchors.keys()),
      entries
    };
  }

  /**
   * 调试工具：打印状态
   */
  debug() {
    const status = this.getStatus();
    console.log('[animator] Status:', status);
    console.table(status.entries);
  }

  /**
   * 注册一个新的适配器类型（可扩展）
   * @param {string} type - 适配器类型名
   * @param {Object} adapter - 适配器实例，需实现 beforeAnimate/afterAnimate 等可选接口
   */
  registerAdapter(type, adapter) {
    if (!type || !adapter) return;
    adapters[type] = adapter;
  }

  /**
   * 直接设置某个元素的锚点（绕过容器批量更新），便于个别元素临时锚点调整
   * 若元素当前处于 tracking，则立即更新其跟踪目标
   * @param {string|number} id
   * @param {{x:number,y:number,scale?:number,rotation?:number}} anchor
   */
  setElementAnchor(id, anchor) {
    const entry = this._registry.get(id);
    if (!entry) {
      console.warn('[animator] setElementAnchor: element not registered', id);
      return;
    }
    entry.anchor = anchor || null;
    if (entry.anchor && entry.state === STATES.TRACKING) {
      // 使用 quickTo 平滑更新目标
      this._applyTrackingQuickTarget(entry, entry.anchor);
    }
  }

  // 结束当前正在进行的特效（若有），并通知完成（作为中断）
  _interruptEffect(entry) {
    if (!entry || !entry._effect) return;
    const { timerId, tween, instructionId } = entry._effect || {};
    try { if (timerId) clearTimeout(timerId); } catch (_) {}
    try { if (tween) tween.kill(); } catch (_) {}
    if (instructionId) {
      frontendEventBus.emit('animation-instruction-finished', { id: instructionId });
    }
    delete entry._effect;
  }

  /**
   * 获取指定适配器类型已注册元素的快照列表
   * @param {string} adapterType 例如 'card' | 'unit-panel'
   * @returns {Array<{ id: string, element: HTMLElement, adapterType: string }>}
   */
  getRegisteredByAdapter(adapterType) {
    const list = [];
    for (const [id, entry] of this._registry.entries()) {
      if (!entry?.element) continue;
      if (!adapterType || entry.adapterType === adapterType) {
        list.push({ id, element: entry.element, adapterType: entry.adapterType });
      }
    }
    return list;
  }

  /**
   * 获取指定适配器类型的元素几何快照（用于 Pixi overlay 精确对齐）
   * 返回: [{ id, cx, cy, baseW, baseH, rot, sx, sy, opacity }]
   */
  getTransformsSnapshotByAdapter(adapterType) {
    const list = [];
    for (const [id, entry] of this._registry.entries()) {
      if (!entry?.element) continue;
      if (adapterType && entry.adapterType !== adapterType) continue;
      const el = entry.element;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      // 读取 CSS 变换矩阵
      const cs = getComputedStyle(el);
      const t = cs.transform;
      let rot = 0, sx = 1, sy = 1;
      if (t && t !== 'none') {
        const m = new DOMMatrix(t);
        rot = Math.atan2(m.m12, m.m11);
        sx = Math.hypot(m.m11, m.m12);
        sy = Math.hypot(m.m21, m.m22);
      }
      let baseW = el.offsetWidth || 0;
      let baseH = el.offsetHeight || 0;
      if (!baseW || !baseH) {
        baseW = rect.width / (sx || 1);
        baseH = rect.height / (sy || 1);
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const opacity = parseFloat(cs.opacity) || 1;
      const visible = (cs.visibility !== 'hidden') && (cs.display !== 'none');
      list.push({ id, cx, cy, baseW, baseH, rot, sx, sy, opacity, visible });
    }
    return list;
  }
}

// 导出单例
const animator = new Animator();

// 添加到 window 以便调试
if (typeof window !== 'undefined') {
  window.__animator = animator;
  window.__debugAnimator = () => animator.debug();
}

export default animator;
