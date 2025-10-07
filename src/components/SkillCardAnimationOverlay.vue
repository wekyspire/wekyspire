<template>
  <div class="skill-card-animation-overlay" v-if="visibleAny" :style="overlayRootStyle">
    <!-- 冷却覆盖层（绿色淡入-旋转标识-淡出） -->
    <div v-if="cooldownPulseKey" class="cooldown-overlay" :key="cooldownPulseKey">
      <div class="cooldown-spinner" />
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
      cooldownPulseColor: '#30c060', // 仍保留变量，若未来需要不同色可用
      upgradeFlash: false,
      upgradeTimer: null
    };
  },
  computed: {
    visibleAny() { return !this.disabled && (this.cooldownPulseKey || this.upgradeFlash); },
    overlayRootStyle() { return { pointerEvents: 'none' }; }
  },
  watch: {
    disabled(val) { if (val) this.resetAll(); },
    skill() { this.resetAll(); }
  },
  mounted() { frontendEventBus.on('skill-card-overlay-effect', this.onOverlayEffect); },
  beforeUnmount() { frontendEventBus.off('skill-card-overlay-effect', this.onOverlayEffect); this.clearUpgradeTimer(); },
  methods: {
    resetAll() { this.cooldownPulseKey = 0; this.upgradeFlash = false; this.clearUpgradeTimer(); },
    onOverlayEffect(payload = {}) {
      try {
        const id = this.skill?.uniqueID;
        if (!id || payload.id !== id || this.disabled) return;
        const t = payload.type;
        if (t === 'cooldown-tick') {
          if(payload.deltaCooldown > 0) return;  // 仅在正向冷却时触发
          // 重新触发绿色覆盖动画
          this.cooldownPulseKey = Date.now();
          return;
        }
        if (t === 'upgrade-flash') { this.triggerUpgradeFlash(payload.durationMs); }
      } catch (_) {}
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
/* 新：冷却覆盖动画 */
.cooldown-overlay {
  position:absolute; inset:0;
  border-radius:6px;
  background:linear-gradient(135deg,#33c26a,#1d9f4e);
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
/* 中央旋转刷新标识（顺时针一圈） */
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
  -webkit-mask: radial-gradient(circle 55% at 50% 50%, transparent 52%, #000 53%);
          mask: radial-gradient(circle 55% at 50% 50%, transparent 52%, #000 53%);
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
