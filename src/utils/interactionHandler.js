// interactionHandler.js - 交互事件处理模块
// 核心职责：
// 1. 监听来自 AnimatableElementContainer 的基础交互事件
// 2. 结合游戏状态判断交互的有效性
// 3. 将有效交互转换为动画指令和/或后端指令

import frontendEventBus from '../frontendEventBus.js';
import backendEventBus, { EventNames } from '../backendEventBus.js';
import { displayGameState, backendGameState } from '../data/gameState.js';
import animationSequencer from '../data/animationSequencer.js';
import animator from './animator.js';

// 拖拽状态
let draggingCardId = null;
let dragStartPos = { x: 0, y: 0 };
let originalPos = { x: 0, y: 0 };

// 控制冻结标志（外部可设置以禁止交互）
let isControlDisabled = true;

/**
 * 初始化交互处理器
 */
export function initInteractionHandler() {
  // 监听卡牌拖拽开始
  frontendEventBus.on('card-drag-start', handleCardDragStart);
  
  // 监听卡牌悬浮
  frontendEventBus.on('card-hover', handleCardHover);
  frontendEventBus.on('card-leave', handleCardLeave);
  
  // 监听卡牌点击
  frontendEventBus.on('card-click', handleCardClick);

  // 监听控制面板禁用事件
  frontendEventBus.on('disable-controls', () => {
    isControlDisabled = true;
  });
  frontendEventBus.on('enable-controls', () => {
    isControlDisabled = false;
  });
}

/**
 * 判断当前是否允许拖拽
 */
function isDraggable() {
  // 在休整阶段允许拖拽重排
  return displayGameState.gameStage === 'rest';
}

/**
 * 判断卡牌是否可用
 */
function canUseSkill(skill) {
  if (!skill) return false;
  
  const player = backendGameState.player;
  if (!player) return false;
  
  const p = (player && typeof player.getModifiedPlayer === 'function') 
    ? player.getModifiedPlayer() 
    : player;
  
  return skill && typeof skill.canUse === 'function' && skill.canUse(p);
}

/**
 * 处理卡牌拖拽开始
 */
function handleCardDragStart({ id, x, y }) {
  // 检查是否允许拖拽
  if (!isDraggable()) return;
  
  // 记录拖拽状态
  draggingCardId = id;
  dragStartPos = { x, y };
  originalPos = { x, y }; // 可以从 animator 获取实际位置
  
  // 通知 animator 开始拖拽（暂停锚点跟踪）
  animator.startDragging(id);
  
  // 发送动画指令：提升卡牌
  animationSequencer.enqueueInstruction({
    tags: ['drag', `drag-${id}`],
    waitTags: ['dragBlocker'], // 低阻塞
    durationMs: 0,
    start: ({ emit }) => {
      emit('animate-element', {
        id,
        to: { scale: 1.1, zIndex: 9999 },
        duration: 100,
        ease: 'power1.out'
      });
    }
  });
  
  // 绑定全局鼠标监听
  window.addEventListener('mousemove', handleDragMove);
  window.addEventListener('mouseup', handleDragEnd);
}

/**
 * 处理拖拽移动
 */
function handleDragMove(event) {
  if (!draggingCardId) return;
  
  const dx = event.clientX - dragStartPos.x;
  const dy = event.clientY - dragStartPos.y;
  
  // 发送动画指令：实时更新位置
  animationSequencer.enqueueInstruction({
    tags: ['drag-move', `drag-${draggingCardId}`],
    waitTags: ['dragBlocker'],
    durationMs: 0,
    start: ({ emit }) => {
      emit('animate-element', {
        id: draggingCardId,
        to: { 
          x: originalPos.x + dx, 
          y: originalPos.y + dy 
        },
        duration: 0 // 即时响应
      });
    }
  });
  
  // 通知容器计算插槽位置
  frontendEventBus.emit('card-drag-move', { 
    id: draggingCardId, 
    x: event.clientX, 
    y: event.clientY 
  });
}

/**
 * 处理拖拽结束
 */
function handleDragEnd(event) {
  if (!draggingCardId) return;
  
  window.removeEventListener('mousemove', handleDragMove);
  window.removeEventListener('mouseup', handleDragEnd);
  
  const cardId = draggingCardId;
  draggingCardId = null;
  
  // 通知 animator 结束拖拽（恢复锚点跟踪）
  animator.stopDragging(cardId);
  
  // 判断拖拽目标
  const target = determineDropTarget(event.clientX, event.clientY);
  
  if (target === 'play-area') {
    // 向后端发送打出卡牌指令
    backendEventBus.emit(EventNames.PlayerOperations.PLAYER_USE_SKILL, cardId);
    
  } else if (target === 'reorder') {
    // 重排序（由容器处理）
    // 容器会监听 card-drag-move 并计算插入位置
    // 锚点跟踪已恢夏，卡牌会自动平滑移动到新位置
    
  } else {
    // 无效拖拽，但不需要手动飞回，锚点跟踪会自动处理
    // animator.stopDragging() 已经恢复了跟踪，卡牌会平滑归位
  }
}

/**
 * 判断拖拽放下的目标
 */
function determineDropTarget(x, y) {
  // 简化实现：根据 y 坐标判断
  // TODO: 实现更精确的碰撞检测
  
  const screenHeight = window.innerHeight;
  
  // 屏幕上半部分：打出卡牌
  if (y < screenHeight * 0.5) {
    return 'play-area';
  }
  
  // 屏幕下半部分：重排序
  return 'reorder';
}

/**
 * 处理卡牌悬浮
 */
function handleCardHover({ id }) {
  // 通知容器更新布局（容器会重新计算锚点）
  // 容器的 watch 会自动调用 animator.updateAnchors
  
  // 可选：发送动画指令，如显示提示框
  frontendEventBus.emit('show-card-tooltip', { id });
}

/**
 * 处理卡牌离开
 */
function handleCardLeave({ id }) {
  frontendEventBus.emit('hide-card-tooltip', { id });
}

/**
 * 处理卡牌点击
 */
function handleCardClick({ id, x, y }) {
  // 战斗阶段才允许点击打出
  if (displayGameState.gameStage !== 'battle') return;

  // 检查控制是否被冻结
  if(isControlDisabled) return;
  
  // 检查是否是玩家回合
  if (displayGameState.isEnemyTurn) return;

  // 卡牌使用
  {
    const skill = displayGameState.player?.frontierSkills?.find(s => s.uniqueID === id);
    if (skill && canUseSkill(skill)) {

      // 发送后端指令
      backendEventBus.emit(EventNames.PlayerOperations.PLAYER_USE_SKILL, id);

      // 生成粒子效果
      spawnParticlesAtPosition(x, y, skill.manaCost, skill.actionPointCost);
    }
  }
  // 卡牌解除激活
  {
    const skill = displayGameState.player?.activatedSkills?.find(s => s.uniqueID === id);
    if (skill && skill.isActivated) {
      // 发送后端指令
      backendEventBus.emit(EventNames.PlayerOperations.PLAYER_STOP_ACTIVATED_SKILL, id);
    }
  }
}

/**
 * 在指定位置生成粒子效果
 */
function spawnParticlesAtPosition(x, y, manaCost = 0, actionPointCost = 0) {
  const particles = [];
  
  // 魔法粒子
  if (manaCost > 0) {
    for (let i = 0; i < 2 + manaCost * 8; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100 - 50,
        color: '#2196f3',
        life: 2000,
        gravity: 400,
        size: 3 + Math.random() * 2
      });
    }
  }
  
  // 行动点粒子
  if (actionPointCost > 0) {
    for (let i = 0; i < 2 + actionPointCost * 8; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100 - 50,
        color: '#FFD700',
        life: 2000,
        gravity: 400,
        size: 3 + Math.random() * 2
      });
    }
  }
  
  if (particles.length > 0) {
    frontendEventBus.emit('spawn-particles', particles);
  }
}

export default {
  initInteractionHandler
};
