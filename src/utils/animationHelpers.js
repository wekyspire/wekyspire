// animationHelpers.js - 动画指令封装辅助函数
// 提供常用动画指令的封装，简化调用

import animationSequencer from '../data/animationSequencer.js';
import frontendEventBus from '../frontendEventBus.js';

/**
 * 自动生成唯一 tag
 */
function genAutoTag(prefix = 'anim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 入队卡牌动画（通用）
 * @param {number|string} id - 卡牌 ID
 * @param {Object} animPayload - 动画载荷
 * @param {Object} options - 指令选项
 * @returns {string} 生成的 tag
 */
export function enqueueCardAnimation(id, animPayload, options = {}) {
  const autoTag = genAutoTag(`card-${id}`);
  
  animationSequencer.enqueueInstruction({
    tags: ['card-anim', autoTag, ...(options.tags || [])],
    waitTags: options.waitTags || ['all'],
    durationMs: animPayload.duration || 0,
    start: ({ emit, id: instructionId }) => {
      emit('animate-element', {
        id,
        instructionId,
        ...animPayload
      });
    }
  });
  
  return autoTag;
}

/**
 * 卡牌出现动画（从锚点飞入）
 * @param {number|string} id - 卡牌 ID
 * @param {string} fromAnchor - 起始锚点（默认 'deck'）
 * @param {string} toContainer - 目标容器（默认 'skills-hand'）
 * @param {Object} options - 选项
 */
export function enqueueCardAppear(id, fromAnchor = 'deck', toContainer = 'skills-hand', options = {}) {
  const duration = options.duration || 300;
  const startScale = options.startScale || 0.6;
  
  return enqueueCardAnimation(id, {
    from: { 
      anchor: fromAnchor, 
      scale: startScale, 
      opacity: 0 
    },
    to: { 
      scale: 1, 
      opacity: 1 
    },
    duration,
    ease: 'power2.out'
  }, {
    tags: ['card-appear'],
    waitTags: options.waitTags
  });
}

/**
 * 卡牌焚毁动画
 * @param {number|string} id - 卡牌 ID
 * @param {Object} options - 选项
 */
export function enqueueCardBurn(id, options = {}) {
  const totalDuration = options.duration || 850;
  const scaleUp = options.scaleUp || 1.15;
  
  // 第一阶段：放大
  const tag1 = enqueueCardAnimation(id, {
    to: { scale: scaleUp },
    duration: 350,
    particleEmit: {
      intervalMs: 70,
      burst: 10,
      particleConfig: {
        colors: ['#cf1818', '#ffd166', '#ff6f00'],
        size: [5, 10],
        speed: [40, 160],
        life: [800, 1400],
        gravity: 0,
        drag: [0.05, 0.05],
        zIndex: 6,
        spread: 1
      }
    }
  }, {
    tags: ['card-burn'],
    waitTags: options.waitTags
  });
  
  // 第二阶段：淡出
  const tag2 = enqueueCardAnimation(id, {
    to: { 
      opacity: 0, 
      rotate: 0 
    },
    duration: 500,
    particleEmit: {
      intervalMs: 70,
      burst: 10,
      particleConfig: {
        colors: ['#cf1818', '#ffd166', '#ff6f00'],
        size: [5, 10],
        speed: [40, 160],
        life: [800, 1400],
        gravity: 0,
        drag: [0.05, 0.05],
        zIndex: 6,
        spread: 1
      }
    }
  }, {
    tags: ['card-burn'],
    waitTags: [tag1]
  });
  
  return tag2;
}

/**
 * 卡牌飞向中心展示后回牌库
 * @param {number|string} id - 卡牌 ID
 * @param {Object} options - 选项
 */
export function enqueueCardCenterThenDeck(id, options = {}) {
  const holdMs = options.holdMs || 350;
  
  // 第一步：飞到中心
  const tag1 = enqueueCardAnimation(id, {
    anchor: 'center',
    to: { scale: 1.2 },
    duration: 350
  }, {
    waitTags: options.waitTags
  });
  
  // 停顿
  const tag2 = genAutoTag('hold');
  animationSequencer.enqueueInstruction({
    tags: [tag2],
    waitTags: [tag1],
    durationMs: holdMs,
    start: () => {}
  });
  
  // 第二步：飞回牌库
  const tag3 = enqueueCardAnimation(id, {
    anchor: 'deck',
    to: { 
      scale: 0.5, 
      rotate: 20 
    },
    duration: 550
  }, {
    waitTags: [tag2]
  });
  
  return tag3;
}

/**
 * 卡牌飞到牌库并淡出
 * @param {number|string} id - 卡牌 ID
 * @param {Object} options - 选项
 */
export function enqueueCardDropToDeck(id, options = {}) {
  const duration = options.duration || 400;
  
  // 飞向牌库并淡出
  const tag1 = enqueueCardAnimation(id, {
    anchor: 'deck',
    to: { 
      scale: 0.5, 
      rotate: 20,
      opacity: 0
    },
    duration,
    ease: 'power2.in'
  }, {
    waitTags: options.waitTags
  });
  
  return tag1;
}

/**
 * 卡牌原地淡入
 * @param {number|string} id - 卡牌 ID
 * @param {Object} options - 选项
 */
export function enqueueCardAppearInPlace(id, options = {}) {
  const duration = options.duration || 300;
  const finalScale = options.finalScale || 1;
  const fromOpacity = options.fromOpacity || 0;
  const toOpacity = options.toOpacity || 1;
  
  return enqueueCardAnimation(id, {
    from: { opacity: fromOpacity },
    to: { 
      scale: finalScale, 
      opacity: toOpacity 
    },
    duration,
    ease: 'power2.out'
  }, {
    tags: ['card-appear'],
    waitTags: options.waitTags
  });
}

/**
 * 延时（纯等待型指令）
 * @param {number} durationMs - 延时毫秒数
 * @param {Object} options - 选项
 * @returns {string} 生成的 tag
 */
export function enqueueDelay(durationMs = 0, options = {}) {
  const tag = genAutoTag('delay');
  
  animationSequencer.enqueueInstruction({
    tags: [tag, ...(options.tags || [])],
    waitTags: options.waitTags || ['all'],
    durationMs: Math.max(0, durationMs),
    start: () => {}
  });
  
  return tag;
}

/**
 * 面板受伤震动
 * @param {string} panelId - 面板 ID
 * @param {number} damage - 伤害值
 * @param {Object} options - 选项
 */
export function enqueuePanelHurt(panelId, damage = 0, options = {}) {
  const duration = Math.min(200 + damage * 2, 600);
  
  return animationSequencer.enqueueInstruction({
    tags: ['panel-anim', 'panel-hurt'],
    waitTags: options.waitTags || ['all'],
    durationMs: duration,
    start: ({ emit, id }) => {
      emit('apply-element-effect', {
        id: panelId,
        instructionId: id,
        effect: 'shake',
        intensity: Math.min(damage / 10, 5),
        duration
      });
    }
  });
}

/**
 * 面板击退
 * @param {string} panelId - 面板 ID
 * @param {string} direction - 方向 ('left' | 'right')
 * @param {number} distance - 距离
 * @param {Object} options - 选项
 */
export function enqueuePanelKnockback(panelId, direction = 'right', distance = 50, options = {}) {
  // 击退
  const tag1 = genAutoTag('knockback');
  animationSequencer.enqueueInstruction({
    tags: [tag1, 'panel-knockback'],
    waitTags: options.waitTags || ['all'],
    durationMs: 200,
    start: ({ emit, id }) => {
      emit('animate-element', {
        id: panelId,
        instructionId: id,
        to: { 
          x: `+=${direction === 'left' ? -distance : distance}`,
          y: 0
        },
        duration: 200,
        ease: 'power2.out'
      });
    }
  });
  
  // 回弹
  const tag2 = genAutoTag('knockback-return');
  animationSequencer.enqueueInstruction({
    tags: [tag2, 'panel-knockback-return'],
    waitTags: [tag1],
    durationMs: 300,
    start: ({ emit }) => {
      emit('animate-element-to-anchor', {
        id: panelId,
        duration: 300,
        ease: 'elastic.out(1, 0.5)'
      });
    }
  });
  
  return tag2;
}

/**
 * 恢复元素锚点跟踪（动画元素从任意状态切换到 tracking 状态）
 * @param {number|string} id - 元素 ID
 * @param {Object} options - 选项
 * @param {string} options.ease - 缓动函数
 * @param {number} options.durationMs - 动画时长（毫秒）
 * @param {Array<string>} options.waitTags - 等待的 tags
 * @returns {string} 生成的 tag
 */
export function enqueueAnimatableElementEnterTracking(id, options = {}) {
  const autoTag = genAutoTag(`enter-tracking-${id}`);
  
  animationSequencer.enqueueInstruction({
    tags: ['enter-tracking', autoTag, ...(options.tags || [])],
    waitTags: options.waitTags || ['all'],
    durationMs: options.durationMs || 0, // 仅动画元素的状态变更不阻塞动画队列
    start: ({ emit, id: instructionId }) => {
      emit('enter-element-tracking', {
        id,
        ease: options.ease,
        instructionId
      });
    }
  });
  
  return autoTag;
}

export default {
  enqueueCardAnimation,
  enqueueCardAppear,
  enqueueCardBurn,
  enqueueCardCenterThenDeck,
  enqueueCardDropToDeck,
  enqueueCardAppearInPlace,
  enqueueDelay,
  enqueuePanelHurt,
  enqueuePanelKnockback,
  enqueueAnimatableElementResumeTracking: enqueueAnimatableElementEnterTracking
};
