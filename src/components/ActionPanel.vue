<template>
  <div class="action-panel" :class="{ 'disabled': !isPlayerTurn || isControlDisabled }">
    <ActivatedSkillsBar
      :player="player"
      :is-player-turn="isPlayerTurn"
      :is-control-disabled="isControlDisabled"
    />
    <SkillsHand
      :player="player"
      :skills="player?.frontierSkills || []"
      :is-control-disabled="isControlDisabled"
      :is-player-turn="isPlayerTurn"
      :instant-appear="false"
    />

    <!-- 使用独立的 DeckIcon 组件作为牌库图标与锚点 -->
    <DeckIcon
      ref="deckAnchor"
      :count="backupSkillsCount"
      :names="backupSkillsPreview"
      :top-skill="topBackupSkill"
      :player="player"
      @click="onDeckClick"
    />

    <BurntSkillsIcon
      v-if="player?.burntSkills?.length > 0"
      :count="player.burntSkills.length"
      :player="player"
      @click="onBurntSkillsClick"
    />

    <!-- 卡牌列表覆盖面板（通用） -->
    <CardsDisplayOverlayPanel
      v-if="showDeckOverlay || showBurntSkillsOverlay"
      :skills="showDeckOverlay ? (player?.backupSkills || []) : (player?.burntSkills || [])"
      :player="player"
      :title="showDeckOverlay ? '牌库' : '坟地'"
      @close="showDeckOverlay = false; showBurntSkillsOverlay = false"
    />

    <button @click="onDropSkillButtonClicked" :disabled="!canDropSkill">⚡1 丢弃头部技能</button>
    <button @click="onEndTurnButtonClicked" :disabled="!isPlayerTurn || isControlDisabled">结束回合</button>
  </div>
</template>

<script>
import SkillsHand from './SkillsHand.vue';
import ActivatedSkillsBar from './ActivatedSkillsBar.vue';
import DeckIcon from './DeckIcon.vue';
import BurntSkillsIcon from './BurntSkillsIcon.vue';
import CardsDisplayOverlayPanel from './CardsDisplayOverlayPanel.vue';
import frontendEventBus from '../frontendEventBus.js';
import backendEventBus, { EventNames } from '../backendEventBus';
import orchestrator from '../utils/cardAnimationOrchestrator.js';
import {backendGameState} from "../data/gameState";

export default {
  name: 'ActionPanel',
  components: { SkillsHand, ActivatedSkillsBar, DeckIcon, BurntSkillsIcon, CardsDisplayOverlayPanel },
  props: {
    player: { type: Object, required: true },
    isPlayerTurn: { type: Boolean, default: true }
  },
  data() {
    return {
      showDeckOverlay: false,
      showBurntSkillsOverlay: false,
      isControlDisabled: true // 可以通过外部事件控制面板禁用
    };
  },
  computed: {
    canDropSkill() {
      const canDropSkillV = backendGameState.player.canDropFirstSkill();
      return (this.isPlayerTurn && !this.isControlDisabled && canDropSkillV);
    },
    backupSkillsCount() {
      return (this.player?.backupSkills || []).length;
    },
    backupSkillsPreview() {
      // 预览前5张后备技能名称
      const list = (this.player?.backupSkills || []).slice(0, 5);
      return list.map(s => s?.name || '(未知技能)');
    },
    topBackupSkill() {
      return (this.player?.backupSkills || [])[0] || null;
    }
  },
  mounted() {
    // 将动画的“牌库锚点”指向 DeckIcon 的根元素
    this.$nextTick(() => {
      const r = this.$refs.deckAnchor;
      const el = r && r.$el ? r.$el : r;
      if (el) orchestrator.deckAnchorEl = el;
    });
    // 监听控制面板禁用事件
    frontendEventBus.on('disable-controls', () => {
      console.log('ActionPanel: disable-controls received');
      this.isControlDisabled = true;
    });
    frontendEventBus.on('enable-controls', () => {
      this.isControlDisabled = false;
    });
  },
  beforeUnmount() {
    frontendEventBus.off('disable-controls');
    frontendEventBus.off('enable-controls');
  },
  methods: {
    onEndTurnButtonClicked() {
      backendEventBus.emit(EventNames.Battle.PLAYER_END_TURN);
    },
    onDropSkillButtonClicked() {
      backendEventBus.emit(EventNames.Battle.PLAYER_DROP_SKILL);
    },
    onDeckClick() {
      // 打开牌库覆盖面板，并隐藏悬浮tooltip
      this.showDeckOverlay = true;
      frontendEventBus.emit('tooltip:hide');
    },
    onBurntSkillsClick() {
      const burntSkills = this.player?.burntSkills || [];
      if (burntSkills.length === 0) return;
      // 打开烧毁技能覆盖面板
      this.showBurntSkillsOverlay = true;
      // 隐藏悬浮tooltip
      frontendEventBus.emit('tooltip:hide');
    }
  }
};
</script>

<style scoped>
/***** 操作面板 *****/
.action-panel {
  position: absolute;
  bottom: 0;
  width: 100%;
  padding: 15px;
}

.action-panel.disabled {
  /* filter: brightness(50%); */
  pointer-events: none;
}

/* DeckIcon 自带样式，不再在此定义 */
</style>
