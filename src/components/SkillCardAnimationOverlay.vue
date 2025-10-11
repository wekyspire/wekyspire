<template>
  <div class="skill-card-animation-overlay" v-if="visibleAny" :style="overlayRootStyle">
    <!-- 冷却覆盖层（颜色/方向根据 deltaCooldown 动态变化） -->
    <div v-if="cooldownPulseKey" class="cooldown-overlay" :key="cooldownPulseKey" :style="cooldownOverlayStyle">
      <div class="cooldown-spinner" :style="cooldownSpinnerStyle" />
    </div>
    <!-- 升级闪光 -->
    <div v-if="upgradeFlash" class="upgrade-flash" />
  </div>
</template>

<script>
import frontendEventBus from '../frontendEventBus.js';
export default {
  name: 'SkillCardAnimationOverlay',
  props: { skill: { type: Object, required: true }, disabled: { type: Boolean, default: false } },
  data() {
    return {
      cooldownPulseKey: 0,
      // 颜色对：primary / secondary（用于线性渐变）
      cooldownPrimary: '#33c26a',
      cooldownSecondary: '#1d9f4e',
      spinnerReverse: false,
      upgradeFlash: false,
      upgradeTimer: null
    };
  },
  computed: {
    visibleAny() { return !this.disabled && (this.cooldownPulseKey || this.upgradeFlash); },
    overlayRootStyle() { return { pointerEvents: 'none' }; },
    cooldownOverlayStyle() {
      return {
        background: `linear-gradient(135deg, ${this.cooldownPrimary}, ${this.cooldownSecondary})`
      };
    },
    cooldownSpinnerStyle() {
      return {
        animationDirection: this.spinnerReverse ? 'reverse' : 'normal'
      };
    }
  },
  watch: {
    disabled(val) { if (val) this.resetAll(); },
    skill() { this.resetAll(); }
  },
  mounted() { frontendEventBus.on('skill-card-overlay-effect', this.onOverlayEffect); },
  beforeUnmount() { frontendEventBus.off('skill-card-overlay-effect', this.onOverlayEffect); this.clearUpgradeTimer(); },
  methods: {
    resetAll() {
      this.cooldownPulseKey = 0;
      // 恢复默认绿色冷却动画
      this.cooldownPrimary = '#33c26a';
      this.cooldownSecondary = '#1d9f4e';
      this.spinnerReverse = false;
      this.upgradeFlash = false;
      this.clearUpgradeTimer();
    },
    onOverlayEffect(payload = {}) {
      try {
        const id = this.skill?.uniqueID;
        if (!id || payload.id !== id || this.disabled) return;
        const t = payload.type;
        if (t === 'cooldown-tick') {
          const delta = Number(payload.deltaCooldown);
          if (!Number.isFinite(delta)) {
            // 未提供或非法值：按普通正向冷却处理
            this.applyCooldownVisual('green');
          } else if (delta < 0) {
            // 反向冷却：红色 + 反向旋转
            this.applyCooldownVisual('red');
          } else if (delta >= 2) {
            // 跨多格冷却：鲜黄色
            this.applyCooldownVisual('yellow');
          } else {
            // 正常正向冷却：绿色
            this.applyCooldownVisual('green');
          }
          // 重新触发覆盖动画
          this.cooldownPulseKey = Date.now();
          return;
        }
        if (t === 'upgrade-flash') { this.triggerUpgradeFlash(payload.durationMs); }
      } catch (_) {}
    },
    applyCooldownVisual(mode) {
      if (mode === 'red') {
        this.cooldownPrimary = '#e53935';
        this.cooldownSecondary = '#c62828';
        this.spinnerReverse = true;
      } else if (mode === 'yellow') {
        this.cooldownPrimary = '#ffd400';
        this.cooldownSecondary = '#ffb300';
        this.spinnerReverse = false;
      } else { // green default
        this.cooldownPrimary = '#33c26a';
        this.cooldownSecondary = '#1d9f4e';
        this.spinnerReverse = false;
      }
    },
    triggerUpgradeFlash(durationMs) {
      const d = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : 1000;
      this.upgradeFlash = false;
      this.$nextTick(() => {
        this.upgradeFlash = true;
        this.clearUpgradeTimer();
        this.upgradeTimer = setTimeout(() => { this.upgradeFlash = false; }, d);
      });
    },
    clearUpgradeTimer() { if (this.upgradeTimer) { clearTimeout(this.upgradeTimer); this.upgradeTimer = null; } }
  }
};
</script>

<style scoped>
.skill-card-animation-overlay { position:absolute; inset:0; z-index:5; display:flex; justify-content:center; align-items:center; }
/* 冷却覆盖动画（颜色由 :style 注入） */
.cooldown-overlay {
  position:absolute; inset:0;
  border-radius:6px;
  /* 背景颜色由 :style 注入 */
  opacity:0;
  display:flex; align-items:center; justify-content:center;
  animation: cooldownOverlayFlash 440ms ease-out forwards;
  overflow:hidden;
}
@keyframes cooldownOverlayFlash {
  0% { opacity:0; transform:scale(.95); }
  12% { opacity:0.92; transform:scale(1); }
  70% { opacity:0.88; }
  100% { opacity:0; transform:scale(1.03); }
}
/* 中央旋转刷新标识（顺/逆时针取决于 animation-direction） */
.cooldown-spinner {
  width:34px; height:34px; position:relative;
  animation: cooldownSpin 440ms linear forwards;
}
.cooldown-spinner::before, .cooldown-spinner::after {
  content:""; position:absolute; inset:0; border-radius:50%;
}
/* 半弧：用渐变 + mask 形成开口环 */
.cooldown-spinner::before {
  background:conic-gradient(from 0deg, rgba(255,255,255,0.95) 0deg, rgba(255,255,255,0.95) 300deg, rgba(255,255,255,0) 300deg, rgba(255,255,255,0) 360deg);
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 52%, #000 53%);
          mask-image: radial-gradient(circle at 50% 50%, transparent 52%, #000 53%);
  filter: drop-shadow(0 0 4px rgba(255,255,255,.7));
}
/* 中心亮点 */
.cooldown-spinner::after {
  width:10px; height:10px; margin:auto; top:0; bottom:0; left:0; right:0;
  background:radial-gradient(circle at 50% 50%, #fff 0%, rgba(255,255,255,0.15) 70%);
  transform:scale(.55);
}
@keyframes cooldownSpin { 0% { transform:rotate(0deg);} 100% { transform:rotate(360deg);} }

/* 升级闪光（保持原有样式） */
.upgrade-flash { position:absolute; inset:-4px; border-radius:8px; overflow:hidden; pointer-events:none; }
.upgrade-flash::before, .upgrade-flash::after { content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none; }
.upgrade-flash::before { background:radial-gradient(circle at 50% 50%, rgba(255,220,120,0.9) 0%, rgba(255,180,50,0.55) 35%, rgba(255,140,0,0.25) 55%, rgba(255,120,0,0) 70%); animation:upgradeFlashCore 1s ease-out forwards; filter:blur(1px) saturate(1.3); }
.upgrade-flash::after { border:2px solid rgba(255,200,80,0.85); animation:upgradeFlashRing 1s ease-out forwards; box-shadow:0 0 8px 2px rgba(255,180,60,0.55), 0 0 18px 6px rgba(255,150,40,0.35); }
@keyframes upgradeFlashCore { 0%{opacity:0;transform:scale(.4);}10%{opacity:1;transform:scale(.75);}45%{opacity:.85;transform:scale(1);}70%{opacity:.65;transform:scale(1.05);}100%{opacity:0;transform:scale(1.2);} }
@keyframes upgradeFlashRing { 0%{opacity:0;transform:scale(.6);}15%{opacity:1;transform:scale(.85);}55%{opacity:.9;transform:scale(1.05);}100%{opacity:0;transform:scale(1.25);} }
</style>
