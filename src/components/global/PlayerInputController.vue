<template>
  <div>
    <!-- 选择卡牌 Overlay -->
    <transition name="overlay-fade">
      <div v-if="ui.visible && ui.type==='selectCard'" class="player-input-overlay" @click.self="onCancel">
        <div class="overlay-panel">
          <h3>请选择卡牌</h3>
          <div class="cards">
            <button v-for="sk in ui.options.cards" :key="sk.uniqueID"
                    class="card-button" @click="selectCard(sk)">
              {{ sk.name }}
            </button>
          </div>
          <div class="actions">
            <button @click="onConfirm" :disabled="selected.length < ui.options.min || selected.length > ui.options.max">确认</button>
            <button v-if="ui.options.canCancel" @click="onCancel">取消</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 确认弹窗 -->
    <transition name="overlay-fade">
      <div v-if="ui.visible && ui.type==='confirm'" class="player-input-overlay" @click.self="onCancel">
        <div class="overlay-panel">
          <h3>{{ ui.options.message || '请确认' }}</h3>
          <div class="actions">
            <button @click="emitConfirm(true)">确认</button>
            <button v-if="ui.options.canCancel" @click="emitConfirm(false)">取消</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import backendEventBus from '../../backendEventBus.js';
import { backendGameState as gameState } from '../../data/gameState.js';

export default {
  name: 'PlayerInputController',
  data() {
    return {
      ui: {
        visible: false,
        type: null,
        instructionID: null,
        options: {},
      },
      selected: []
    };
  },
  created() {
    backendEventBus.on('REQUEST_PLAYER_INPUT', this.onRequest);
  },
  beforeUnmount() {
    backendEventBus.off('REQUEST_PLAYER_INPUT', this.onRequest);
  },
  methods: {
    onRequest(payload) {
      // payload: { instructionID, inputType, options }
      this.ui.visible = true;
      this.ui.type = payload.inputType;
      this.ui.instructionID = payload.instructionID;
      // 填充默认卡牌池（如未提供）
      const defaults = {};
      if (payload.inputType === 'selectCard') {
        const opts = payload.options || {};
        const scope = opts.scope || 'frontier';
        let cards = [];
        if (scope === 'frontier') cards = gameState.player.frontierSkills.slice();
        if (scope === 'deck') cards = gameState.player.backupSkills.slice();
        if (scope === 'activated') cards = gameState.player.activatedSkills.slice();
        if (scope === 'overlay') cards = gameState.player.overlaySkills.slice();
        const exclude = new Set(opts.exclude || []);
        cards = cards.filter(sk => !exclude.has(sk.uniqueID));
        this.ui.options = {
          cards,
          min: Math.max(1, opts.min || 1),
          max: Math.max(1, opts.max || 1),
          canCancel: opts.canCancel || false,
        };
      } else if (payload.inputType === 'confirm') {
        this.ui.options = payload.options || {};
      } else {
        this.ui.options = payload.options || {};
      }
      this.selected = [];
    },
    selectCard(skill) {
      const id = skill.uniqueID;
      const idx = this.selected.findIndex(x => x === id);
      if (idx >= 0) {
        this.selected.splice(idx, 1);
      } else {
        if (this.selected.length < this.ui.options.max) {
          this.selected.push(id);
        }
      }
    },
    onConfirm() {
      if (this.selected.length < this.ui.options.min || this.selected.length > this.ui.options.max) return;
      backendEventBus.emit('PLAYER_INPUT_RESPONSE', {
        instructionID: this.ui.instructionID,
        result: { selectedIDs: this.selected }
      });
      this.resetUI();
    },
    emitConfirm(val) {
      backendEventBus.emit('PLAYER_INPUT_RESPONSE', {
        instructionID: this.ui.instructionID,
        result: !!val
      });
      this.resetUI();
    },
    onCancel() {
      if(!this.ui.options.canCancel) return;
      // 取消：返回 null
      backendEventBus.emit('PLAYER_INPUT_RESPONSE', {
        instructionID: this.ui.instructionID,
        result: null
      });
      this.resetUI();
    },
    resetUI() {
      this.ui.visible = false;
      this.ui.type = null;
      this.ui.instructionID = null;
      this.ui.options = {};
      this.selected = [];
    }
  }
}
</script>

<style scoped>
.player-input-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}
.overlay-panel {
  background: #1e1e1e;
  color: #fff;
  border-radius: 8px;
  padding: 16px;
  min-width: 320px;
}
.cards {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.card-button {
  background: #333;
  color: #fff;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}
.card-button:hover { background: #444; }
.actions { display:flex; gap: 8px; justify-content: flex-end; }
</style>

