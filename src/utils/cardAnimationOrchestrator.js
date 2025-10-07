// 全局卡牌动画编排器（DOM + GSAP）
// 仅管理“卡牌相关”的复杂动画，不负责其它类型动画。
// 特性：
// - 對每一張卡片（按 uniqueID）維護一個“異步動畫播放隊列”：
//   同一張卡的動畫指令會按順序串行執行，不會相互打斷；不同卡片的動畫可並發播放。
// - 透過 animateById 進行動畫調度與 ghost 創建，其他路徑不再創建 ghost。

import frontendEventBus from '../frontendEventBus.js';
import gsap from 'gsap';
import cardDomRegistry, { getCardEl } from './cardDomRegistry.js';

/*
通用卡牌轉動畫事件機制（新增）
---------------------------------
為支持“卡牌在多個前端容器之間轉移”且保持鬆耦合，新增以下事件：
  card-transfer-start
  card-transfer-end

事件在 orchestrator 內部於每次 animateById 任務真正開始前/完成後發射。
載荷（payload）結構：
{
  id: <number|string>,            // 卡牌唯一ID
  kind: <string>,                 // 動畫種類（appearFromAnchor / centerThenDeck / flyToDeckFade / exhaust ...）
  type: <string>,                 // 語義化轉移類型（如 'appear' / 'move' / 'focus' / 'exhaust' 等，具體由調用方或自動推斷）
  from: <string|undefined>,       // 來源容器標識（可選）
  to: <string|undefined>,         // 目標容器標識（可選）
  token: <string>,                // 唯一標記（如果調用方未提供將自動生成）
  phase: 'start' | 'end'          // 事件階段
}

當前僅在 kind === 'appearFromAnchor' 且調用方未提供 transfer 時自動生成：
  { type: 'appear', from: options.anchor || 'deck', to: options.toContainer || 'skills-hand' }

調用方也可在觸發 'animate-card-by-id' 時傳入自定義 transfer 對象，以覆蓋/補充以上字段。

容器組件（如 SkillsHand）應監聽 card-transfer-end，匹配自身 containerKey === payload.to 後再執行顯示/狀態更新，避免硬編碼某個舊事件名。
*/

const defaultEase = 'power2.out';

const orchestrator = {
  overlayEl: null,
  centerAnchorEl: null,
  deckAnchorEl: null,
  ghostContainerEl: null,
  // 记录：按ID缓存ghost，确保连续指令可复用状态
  // id -> { ghost, baseRect, startEl }
  _ghostRegistry: new Map(),
  // 管理在中心展示的卡片ID列表（按加入顺序）
  _centerIds: [],
  _layoutCenterDurationMs: 220,
  // 全局“时代戳”（reset代次）。当 resetAllGhosts 发生时用于屏蔽旧任务
  _epoch: 0,
  _bumpEpoch() { this._epoch++; return this._epoch; },
  // 排空模式：用于 resetAllGhosts 等待“之前提交”的动画自然结束
  _draining: false,
  _drainEpoch: null,

  // 公共步骤构建器：在不同入口（animateById/后端）共享
  buildSteps: {
    flyToCenter({ scale = 1.2, durationMs = 350, holdMs = 0 } = {}) {
      return [
        { toAnchor: 'center', scale, duration: durationMs, ease: defaultEase, holdMs }
      ];
    },
    centerThenDeck({ centerHoldMs = 350, totalMs = 900 } = {}) {
      const first = 350;
      const rest = Math.max(300, totalMs - first - centerHoldMs);
      return [
        { toAnchor: 'center', scale: 1.2, duration: first, ease: defaultEase, holdMs: centerHoldMs },
        { toAnchor: 'deck', scale: 0.5, rotate: 20, duration: rest, ease: 'power2.in' }
      ];
    },
    flyToDeckFade({ durationMs = 400 } = {}) {
      return [
        { toAnchor: 'deck', scale: 0.5, rotate: 20, duration: durationMs, ease: 'power2.in' },
        { opacity: 0, duration: 120 }
      ];
    },
    exhaustBurn({ durationMs = 500, scaleUp = 1.15, particle = {} } = {}) {
      // particle: { intervalMs, burst, particleConfig }
      const t1 = Math.max(80, Math.floor(durationMs * 0.35));
      const t2 = Math.max(120, durationMs - t1);
      const emitCfg = {
        intervalMs: particle.intervalMs ?? 70,
        burst: particle.burst ?? 10,
        particleConfig: {
          colors: (particle.particleConfig && particle.particleConfig.colors) || ['#cf1818', '#ffd166', '#ff6f00'],
          size: (particle.particleConfig && particle.particleConfig.size) || [5, 10],
          speed: (particle.particleConfig && particle.particleConfig.speed) || [40, 160],
            // life: ms
          life: (particle.particleConfig && particle.particleConfig.life) || [800, 1400],
          gravity: (particle.particleConfig && particle.particleConfig.gravity) ?? 0,
          drag: (particle.particleConfig && particle.particleConfig.drag) || [0.05, 0.05],
          zIndex: (particle.particleConfig && particle.particleConfig.zIndex) ?? 6,
          spread: (particle.particleConfig && particle.particleConfig.spread) || 1
        }
      };
      return [
        // 放大阶段，同时持续冒粒子
        { scale: scaleUp, duration: t1, ease: defaultEase, emitParticles: emitCfg },
        // 淡出阶段
        { rotate: 0, opacity: 0, duration: t2, ease: 'power1.in', emitParticles: emitCfg }
      ];
    },
    appearFromAnchor({ durationMs = 300 } = {}) {
      // 已废弃 toBase：统一使用 toCard:true 将卡牌对齐到其当前 DOM 位置
      return [
        { toCard: true, scale: 1, opacity: 1, duration: durationMs, ease: defaultEase }
      ];
    }
  },

  init({ overlayEl, centerAnchorEl, deckAnchorEl, ghostContainerEl }) {
    this.overlayEl = overlayEl;
    this.centerAnchorEl = centerAnchorEl;
    this.deckAnchorEl = deckAnchorEl;
    this.ghostContainerEl = ghostContainerEl;
    try {
      window.addEventListener('resize', () => { try { this._layoutCenter(); } catch (_) {} }, { passive: true });
    } catch (_) {}
  },
  // 中心管理：注册/移除/清空
  _addToCenter(id) {
    if (id == null) return;
    if (!this._centerIds.includes(id)) this._centerIds.push(id);
    this._layoutCenter();
  },
  _removeFromCenter(id) {
    if (id == null) return;
    const idx = this._centerIds.indexOf(id);
    if (idx >= 0) {
      this._centerIds.splice(idx, 1);
      this._layoutCenter();
    }
  },
  _clearCenter() {
    if (this._centerIds.length > 0) {
      this._centerIds.splice(0, this._centerIds.length);
    }
  },
  // 根据 centerAnchor 对 _centerIds 的幽灵进行横向排布（改：直接使用 left/top，不再依赖 baseRect 偏移）
  _layoutCenter() {
    try {
      if (!this._centerIds.length) return;
      const count = this._centerIds.length;
      const anchor = this.getAnchorPoint('center');
      const gap = 220; // 卡片横向间隔
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        const id = this._centerIds[i];
        const entry = this._ghostRegistry.get(id);
        if (!entry) continue;
        const { ghost, baseRect } = entry;
        const targetCenter = { x: anchor.x + (i - half) * gap, y: anchor.y };
        const targetLeft = targetCenter.x - baseRect.width / 2;
        const targetTop = targetCenter.y - baseRect.height / 2;
        try {
          // 归零平移 transform，防止遗留 x/y 影响绝对定位
          gsap.set(ghost, { x: 0, y: 0 });
          gsap.to(ghost, { left: targetLeft, top: targetTop, scale: 1.2, duration: Math.max(0.001, this._layoutCenterDurationMs / 1000), ease: defaultEase });
          ghost.style.zIndex = String(100 + i);
        } catch (_) {}
      }
    } catch (_) {}
  },

  // 工具：测量/锚点/换算
  getRect(el) { return el?.getBoundingClientRect?.() || null; },
  getAnchor(nameOrEl) {
    if (!nameOrEl) return null;
    if (typeof nameOrEl === 'string') {
      if (nameOrEl === 'center') return this.centerAnchorEl;
      if (nameOrEl === 'deck') return this.deckAnchorEl;
      return null;
    }
    return nameOrEl;
  },
  getAnchorPoint(nameOrEl) {
    if (!nameOrEl) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (typeof nameOrEl === 'object' && typeof nameOrEl.x === 'number' && typeof nameOrEl.y === 'number') {
      return { x: nameOrEl.x, y: nameOrEl.y };
    }
    const el = this.getAnchor(nameOrEl);
    const r = this.getRect(el);
    if (!r) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: r.left, y: r.top };
  },
  createGhostFromEl(startEl, startRect) {
    if (!this.ghostContainerEl || !startEl || !startRect) return null;
    const ghost = startEl.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${startRect.left}px`,
      top: `${startRect.top}px`,
      margin: '0',
      transformOrigin: 'center center',
      pointerEvents: 'none',
    });
    ghost.classList.add('animation-ghost');
    this.ghostContainerEl.appendChild(ghost);
    // 移除旧的平移 transform，只保留 scale/rotate 等
    gsap.set(ghost, { x: 0, y: 0, force3D: true });
    // 禁用克隆来的 CSS 动画，避免与 GSAP transform 冲突
    ghost.classList.remove('activating');
    ghost.style.animation = 'none';
    ghost.style.animationName = 'none';
    return ghost;
  },


  // 通用粒子发射（基于配置）
  _emitParticles(ghost, { burst = 10, particleConfig = {} } = {}) {
    if (!ghost) return;
    try {
      const r = ghost.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const cfg = particleConfig || {};
      const colors = cfg.colors || ['#cf1818', '#ffd166', '#ff6f00'];
      const sizeRange = cfg.size || [5, 10];
      const speedRange = cfg.speed || [40, 160];
      const lifeRange = cfg.life || [800, 1400];
      const dragRange = cfg.drag || [0.05, 0.05];
      const gravity = cfg.gravity ?? 0;
      const spread = cfg.spread || 1; // 乘以卡片宽高
      const zIndex = cfg.zIndex ?? 6;
      const particles = [];
      for (let i = 0; i < burst; i++) {
        const angle = (Math.random() * Math.PI * 2);
        const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
        const life = lifeRange[0] + Math.random() * (lifeRange[1] - lifeRange[0]);
        const color = colors[Math.floor(Math.random() * colors.length)] || '#ffffff';
        const drag = dragRange[0] + Math.random() * (dragRange[1] - dragRange[0]);
        particles.push({
          x: cx + (Math.random() - 0.5) * (r.width * spread),
          y: cy + (Math.random() - 0.5) * (r.height * spread),
          vx, vy, color, life, gravity, size, opacity: 1, zIndex, drag,
        });
      }
      frontendEventBus.emit('spawn-particles', particles);
    } catch (_) {}
  },

  // 内部：按ID确保存在ghost（仅 animateById 调用）
  _ensureGhostById(id, startEl, options = {}) {
    const { initialFromAnchor = null, startScale = 0.6, fade = true, hideStart = true, killOnReuse = true, preGhostInvisible = false } = options;
    if (id !== null && id !== undefined && this._ghostRegistry.has(id)) {
      const entry = this._ghostRegistry.get(id);
      if (killOnReuse) { try { gsap.killTweensOf(entry.ghost); } catch (_) {} }
      return entry;
    }
    if (!startEl) return null;
    const baseRect = this.getRect(startEl);
    if (!baseRect) return null;
    const ghost = this.createGhostFromEl(startEl, baseRect);
    if (!ghost) return null;
    if (hideStart) { try { startEl.style.visibility = 'hidden'; } catch (_) {} }
    if (initialFromAnchor) {
      const anchorPoint = this.getAnchorPoint(initialFromAnchor);
      const left = anchorPoint.x - baseRect.width / 2;
      const top = anchorPoint.y - baseRect.height / 2;
      ghost.style.left = `${left}px`;
      ghost.style.top = `${top}px`;
      gsap.set(ghost, { scale: startScale, autoAlpha: fade ? 0 : 1, x: 0, y: 0, force3D: true });
    } else {
      // 直接使用原位置；为避免之后使用 left/top 出现偏移，保持 x/y 为 0
      gsap.set(ghost, { scale: 1, autoAlpha: preGhostInvisible ? 0 : 1, x: 0, y: 0, force3D: true });
    }
    const entry = { ghost, baseRect, startEl };
    if (id !== null && id !== undefined) this._ghostRegistry.set(id, entry);
    return entry;
  },
  _cleanupGhostById(id, { restoreStart = false } = {}) {
    if (id === null || id === undefined) return;
    const entry = this._ghostRegistry.get(id);
    if (!entry) return;
    const { ghost, startEl } = entry;
    try { gsap.killTweensOf(ghost); } catch (_) {}
    try { ghost.remove(); } catch (_) {}
    // 优先还原注册表内的 card DOM，兜底尝试 startEl
    const originalEl = getCardEl(id) || startEl;
    if (restoreStart) { try { originalEl.style.visibility = ''; } catch (_) {} }
    this._ghostRegistry.delete(id);
  },

  // 使用“已存在”的ghost执行 steps；本函数不创建 ghost（改：基于 ghost 当前绝对 left/top 计算）
  async playCardSequenceById(startEl, id, steps = [], options = {}) {
    if (!this.overlayEl) return;
    const { hideStart = true, endMode = 'keep', scheduledEpoch, revealGhostOnStart = true } = options;
    if (this._draining) {
      if (scheduledEpoch !== this._drainEpoch) return;
    } else if (scheduledEpoch !== undefined && scheduledEpoch !== this._epoch) {
      return;
    }
    let entry = this._ghostRegistry.get(id);
    if (!entry) {
      console.warn("[cardAnimationOrchestrator] 无法执行动画：找不到幽灵", id, startEl, steps, options);
      return;
    }

    const { ghost, baseRect, startEl: registeredStartEl } = entry;

    try {
      const originEl = startEl || registeredStartEl;
      if (hideStart && originEl && originEl.style.visibility !== 'hidden') originEl.style.visibility = 'hidden';
    } catch (_) {}
    if (revealGhostOnStart) { try { gsap.set(ghost, { autoAlpha: 1 }); } catch (_) {} }

    try { gsap.killTweensOf(ghost); } catch (_) {}
    // 确保无残留平移
    gsap.set(ghost, { x: 0, y: 0 });

    // 当前 left/top（数值）
    let curLeft = parseFloat(ghost.style.left) || (ghost.getBoundingClientRect().left);
    let curTop = parseFloat(ghost.style.top) || (ghost.getBoundingClientRect().top);

    const tl = gsap.timeline();

    for (const step of steps) {
      // 自定义 lambda：在该处即时执行（插入到时间轴）
      if (typeof step.call === 'function') {
        tl.add(() => {
          try { step.call({ ghost, baseRect, orchestrator: this }); } catch (_) {}
        });
        // 支持 call 后的等待
        if (step.holdMs && step.holdMs > 0) tl.to(ghost, { left: `+=0`, duration: step.holdMs / 1000, ease: 'none' });
        continue;
      }

      const { duration = 350, ease = defaultEase, holdMs = 0, emitParticles } = step;
      const props = {};

      // 计算目标 left/top
      if (step.toPoint) {
        const targetLeft = step.toPoint.x - baseRect.width / 2;
        const targetTop = step.toPoint.y - baseRect.height / 2;
        props.left = targetLeft;
        props.top = targetTop;
        curLeft = targetLeft; curTop = targetTop;
      } else if (step.toAnchor) {
        const p = this.getAnchorPoint(step.toAnchor); // p 为目标中心
        const targetLeft = p.x - baseRect.width / 2;
        const targetTop = p.y - baseRect.height / 2;
        props.left = targetLeft; props.top = targetTop;
        curLeft = targetLeft; curTop = targetTop;
      } else if (step.delta) {
        const dx = step.delta.dx || 0;
        const dy = step.delta.dy || 0;
        const targetLeft = curLeft + dx;
        const targetTop = curTop + dy;
        props.left = targetLeft; props.top = targetTop;
        curLeft = targetLeft; curTop = targetTop;
      } else if (step.toCard) { /* 动态对齐到指定卡片（或自身ID）当前 DOM 位置 */
        try {
          const targetId = step.toCard === true ? id : step.toCard;
          const targetEl = getCardEl(targetId);
          const rect = targetEl ? this.getRect(targetEl) : null;
          if (rect) {
            const targetLeft = rect.left + rect.width / 2 - baseRect.width / 2;
            const targetTop = rect.top + rect.height / 2 - baseRect.height / 2;
            props.left = targetLeft; props.top = targetTop;
            curLeft = targetLeft; curTop = targetTop;
          }
        } catch (_) {}
      }

      if (typeof step.scale === 'number') props.scale = step.scale;
      if (typeof step.rotate === 'number') props.rotate = step.rotate;
      if (typeof step.opacity === 'number') props.autoAlpha = step.opacity;

      // 构建 tween，并在需要时添加 onUpdate 节流触发粒子
      if (emitParticles) {
        const interval = Math.max(10, emitParticles.intervalMs || 70);
        const burst = Math.max(1, emitParticles.burst || 8);
        let lastEmit = -1;
        tl.to(ghost, {
          ...props,
          duration: Math.max(0.001, duration / 1000),
          ease,
          onUpdate: () => {
            const elapsed = tl.time() * 1000; // timeline time in ms
            if (lastEmit < 0 || elapsed - lastEmit >= interval) {
              lastEmit = elapsed;
              try { orchestrator._emitParticles(ghost, { burst, particleConfig: emitParticles.particleConfig }); } catch (_) {}
            }
          }
        });
      } else {
        tl.to(ghost, { ...props, duration: Math.max(0.001, duration / 1000), ease });
      }

      if (holdMs > 0) tl.to(ghost, { left: '+=0', duration: holdMs / 1000, ease: 'none' });
    }

    await new Promise(resolve => {
      tl.eventCallback('onComplete', () => { resolve(); });
      tl.play(0);
    });

    // 结束策略
    if (endMode === 'restore') this._cleanupGhostById(id, { restoreStart: true });
    else if (endMode === 'destroy') this._cleanupGhostById(id, { restoreStart: false });
  },

  // 重置所有ghost
  async resetAllGhosts({ restoreStart = true } = {}) {
    // 建立“排空屏障”：记录此刻的epoch，并立即推进到下一代，阻断之后提交的新动画
    const drainEpoch = this._epoch;
    this._draining = true;
    this._drainEpoch = drainEpoch;
    this._bumpEpoch();

    // 截取当前各ID队列的末尾promise，等待它们结算（表示“此刻之前提交”的动画都已完成”）
    const tails = Array.from(_idChains.values()).map(p => p.catch(() => {}));
    try { await Promise.all(tails); } catch (_) {}

    // 执行清理：注册表 + DOM 兜底
    for (const id of Array.from(this._ghostRegistry.keys())) {
      this._cleanupGhostById(id, { restoreStart });
    }
    try {
      if (this.ghostContainerEl) {
        const nodes = Array.from(this.ghostContainerEl.querySelectorAll('.animation-ghost'));
        for (const n of nodes) {
          try { gsap.killTweensOf(n); } catch (_) {}
          try { n.remove(); } catch (_) {}
        }
      }
    } catch (_) {}

    // 清空中心展示列表
    try { this._clearCenter(); } catch (_) {}

    // 清空队列并关闭“排空模式”
    try { if (typeof _idChains?.clear === 'function') _idChains.clear(); } catch (_) {}
    this._draining = false;
    this._drainEpoch = null;
  },
};

// Helper to animate by id (backend-driven)
const _idChains = new Map();
async function animateById({ id, kind, options = {}, steps, hideStart, completionToken, transfer }) {
  // 预创建 ghost
  try {
    const preEl = getCardEl(id);
    if (preEl && orchestrator.overlayEl) {
      const preOpts = { hideStart: false, killOnReuse: false };
      if (kind === 'appearFromAnchor') {
        preOpts.initialFromAnchor = options.anchor || 'deck';
        preOpts.startScale = (options && options.startScale) != null ? options.startScale : 0.6;
        preOpts.fade = (options && options.fade) != null ? options.fade : true;
      } else {
        preOpts.preGhostInvisible = true;
      }
      orchestrator._ensureGhostById(id, preEl, preOpts);
    }
  } catch (_) {}

  // 若调用方未提供 transfer 且是 appearFromAnchor，自动生成一份基础转移描述
  if (!transfer && kind === 'appearFromAnchor') {
    transfer = {
      type: 'appear',
      from: options.anchor || 'deck',
      to: options.toContainer || 'skills-hand'
    };
  }
  // 生成 token（可由外部预先提供）
  if (transfer) {
    if (!transfer.token) transfer.token = `${Date.now()}-${id}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const scheduledEpoch = orchestrator._epoch;
  const run = async () => {
    if (orchestrator._draining) {
      if (scheduledEpoch !== orchestrator._drainEpoch) {
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        return;
      }
    } else if (scheduledEpoch !== orchestrator._epoch) {
      if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
      return;
    }
    const el = getCardEl(id) || null;

    // 通用：在真正开始播放前发出转移动画开始事件
    if (transfer) {
      try { frontendEventBus.emit('card-transfer-start', { id, kind, ...transfer, phase: 'start' }); } catch (_) {}
    }

    const emitEnd = (extra = {}) => {
      if (transfer) {
        try { frontendEventBus.emit('card-transfer-end', { id, kind, ...transfer, phase: 'end', ...extra }); } catch (_) {}
      }
    };

    if (Array.isArray(steps) && steps.length) {
      await orchestrator.playCardSequenceById(el, id, steps, { scheduledEpoch, hideStart: hideStart !== false, ...(options || {}) });
      emitEnd();
      if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
      return;
    }

    switch (kind) {
      case 'appearFromAnchor': {
        const { durationMs = 300, startScale = 0.6, fade = true } = options || {};
        const built = orchestrator.buildSteps.appearFromAnchor({ durationMs });
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: true, endMode: 'restore', initialFromAnchor: (options.anchor || 'deck'), startScale, fade });
        try { frontendEventBus.emit('card-appear-finished', { id }); } catch (_) {}
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        break;
      }
      case 'centerThenDeck': {
        const built = orchestrator.buildSteps.centerThenDeck(options || {});
        try { orchestrator._removeFromCenter(id); } catch (_) {}
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: hideStart !== false, endMode: 'destroy' });
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        break;
      }
      case 'flyToCenter': {
        const built = orchestrator.buildSteps.flyToCenter(options || {});
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: hideStart !== false, endMode: 'keep' });
        try { orchestrator._addToCenter(id); } catch (_) {}
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        break;
      }
      case 'flyToDeckFade':
      case 'drop': {
        const built = orchestrator.buildSteps.flyToDeckFade(options || {});
        try { orchestrator._removeFromCenter(id); } catch (_) {}
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: hideStart !== false, endMode: 'destroy' });
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        break;
      }
      case 'exhaust':
      case 'burn': {
        const built = orchestrator.buildSteps.exhaustBurn(options || {});
        try { orchestrator._removeFromCenter(id); } catch (_) {}
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: hideStart !== false, endMode: 'destroy' });
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
        break;
      }
      default: {
        const built = orchestrator.buildSteps.flyToCenter(options || {});
        await orchestrator.playCardSequenceById(el, id, built, { scheduledEpoch, hideStart: hideStart !== false, endMode: 'keep' });
        try { orchestrator._addToCenter(id); } catch (_) {}
        emitEnd();
        if (completionToken) try { frontendEventBus.emit('animation-card-by-id-finished', { token: completionToken }); } catch (_) {}
      }
    }
  };
  const prev = _idChains.get(id) || Promise.resolve();
  const safePrev = prev.catch(() => {});
  const next = safePrev.then(() => run());
  _idChains.set(id, next);
  next.finally(() => { if (_idChains.get(id) === next) _idChains.delete(id); });
  return next;
}

frontendEventBus.on('animate-card-by-id', async (payload = {}) => { try { await animateById(payload || {}); } catch (_) {} });
frontendEventBus.on('clear-card-animations', () => { orchestrator.resetAllGhosts({ restoreStart: true }); try { orchestrator._clearCenter(); } catch (_) {} });
export { animateById }; export default orchestrator;

