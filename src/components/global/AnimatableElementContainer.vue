<template>
  <div class="animatable-elements-container">
    <!-- 卡牌层 -->
    <div class="cards-layer">
      <SkillCard
        v-for="skill in allSkills"
        :key="skill.uniqueID"
        :skill="skill"
        :player="player"
        :class="{ hidden: !isCardVisible(skill) }"
        :ref="el => registerCard(el, skill.uniqueID)"
        :preview-mode="false"
        @mousedown="onCardMouseDown(skill.uniqueID, $event)"
        @mouseenter="onCardHover(skill.uniqueID, $event)"
        @mouseleave="onCardLeave(skill.uniqueID, $event)"
        @click="onCardClick(skill.uniqueID, $event)"
      />
    </div>
  </div>
</template>

<script>
// AnimatableElementContainer
// 负责持有所有可动画元素的Vue元件与DOM实例，管理其生命周期，并注册到animator中
// 和animator配合实现复杂动画

import { computed, watch, nextTick, ref } from 'vue';
import SkillCard from './SkillCard.vue';
import { displayGameState } from '../../data/gameState.js';
import frontendEventBus from '../../frontendEventBus.js';
import animator from '../../utils/animator.js';

export default {
  name: 'AnimatableElementContainer',
  components: { SkillCard },
  setup() {
    const cardRefs = ref({});
    const registeredIds = ref(new Set()); // 跟踪已注册的 ID

    // 计算所有卡牌
    const allSkills = computed(() => {
      return displayGameState.player?.skills || [];
    });

    // 计算玩家对象
    const player = computed(() => {
      return displayGameState.player || null;
    });

    // 计算在场卡牌 ID（frontierSkills + activatedSkills）
    const visibleCardIds = computed(() => {
      const ids = new Set();
      
      // 手牌
      const frontier = displayGameState.player?.frontierSkills || [];
      frontier.forEach(s => {
        if (s?.uniqueID != null) ids.add(s.uniqueID);
      });
      
      // 激活技能
      const activated = displayGameState.player?.activatedSkills || [];
      activated.forEach(s => {
        if (s?.uniqueID != null) ids.add(s.uniqueID);
      });
      
      return ids;
    });

    // 判断卡牌是否可见
    const isCardVisible = (skill) => {
      return skill?.uniqueID != null && visibleCardIds.value.has(skill.uniqueID);
    };

    // 注册卡牌到 animator
    const registerCard = (el, uniqueID) => {
      if (!el || uniqueID == null) return;
      
      // 检查是否已经注册过
      if (registeredIds.value.has(uniqueID)) {
        // 只更新 ref 引用，不重复注册
        cardRefs.value[uniqueID] = el;
        return;
      }
      
      // 保存 ref 引用
      cardRefs.value[uniqueID] = el;
      
      // 等待 DOM 更新后注册到 animator
      nextTick(() => {
        const domEl = el.$el || el;
        if (domEl) {
          animator.register(uniqueID, domEl, 'card');
          registeredIds.value.add(uniqueID);
          console.log('[AnimatableElementContainer] Registered card:', uniqueID);
        }
      });
    };

    // 监听卡牌列表变化，处理注册/解除注册
    let prevSkillIds = [];
    watch(allSkills, (newSkills, oldSkills) => {
      const newIds = newSkills.map(s => s?.uniqueID).filter(id => id != null);
      
      // 找出移除的卡牌
      const removed = prevSkillIds.filter(id => !newIds.includes(id));
      removed.forEach(id => {
        animator.unregister(id);
        delete cardRefs.value[id];
        registeredIds.value.delete(id); // 从已注册集合中移除
        console.log('[AnimatableElementContainer] Unregistered card:', id);
      });
      
      prevSkillIds = newIds;
      console.log('[AnimatableElementContainer] All skills:', newIds.length, ', Registered:', registeredIds.value.size);
    }, { deep: true });

    // 交互事件处理
    const onCardMouseDown = (id, event) => {
      frontendEventBus.emit('card-drag-start', { 
        id, 
        x: event.clientX, 
        y: event.clientY 
      });
    };

    const onCardHover = (id, event) => {
      frontendEventBus.emit('card-hover', { id });
    };

    const onCardLeave = (id, event) => {
      frontendEventBus.emit('card-leave', { id });
    };

    const onCardClick = (id, event) => {
      frontendEventBus.emit('card-click', { 
        id, 
        x: event.clientX, 
        y: event.clientY 
      });
    };

    return {
      allSkills,
      player,
      isCardVisible,
      registerCard,
      onCardMouseDown,
      onCardHover,
      onCardLeave,
      onCardClick
    };
  }
};
</script>

<style scoped>
.animatable-elements-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: var(--z-animatable-elements, 100);
}

.cards-layer {
  position: absolute;
  inset: 0;
}

.cards-layer > * {
  position: absolute;
  pointer-events: auto;
  transform-origin: center center;
  will-change: transform, opacity;
}

.cards-layer > .hidden {
  visibility: hidden;
}
</style>
