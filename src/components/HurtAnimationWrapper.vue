<template>
  <div 
    class="hurt-animation-wrapper" 
    :class="{ 
      'hurt-shake': isShaking,
      'hurt-effect': isHurt,
      'evade-effect': isEvading,
      'dead-wrapper': isDead,
      'shielded-wrapper': isShielded
      }"
    :style="[hurtStyle, zIndexStyle]"
  >
    <slot></slot>
    <!-- 治疗效果覆盖层 -->
    <div 
      v-if="isHealing" 
      class="heal-overlay" 
    ></div>
    <!-- 死亡爆炸效果覆盖层 -->
    <div 
      v-if="isDead" 
      class="dead-overlay" 
    ></div>
  </div>
</template>

<script>
import frontendEventBus from '../frontendEventBus.js';
export default {
  name: 'HurtAnimationWrapper',
  props: {
    unit: { type: Object, default: null },
    zIndex: { type: Number, default: 1 }
  },
  data() {
    return {
      isShaking: false,
      isHurt: false,
      isEvading: false,
      isHealing: false,
      isDead: false,
      isShieldBroke: false,
      shakeIntensity: 0,
      hurtIntensity: 0,
      particles: [],
      _timers: []
    };
  },
  computed: {
    isShielded() {
      return (this.unit?.shield || 0) > 0;
    },
    hurtStyle() {
      if (!this.isHurt) return {};
      const intensity = Math.min(this.hurtIntensity / 50, 1);
      const borderWidth = Math.min(Math.max(2, Math.floor(5 * intensity)), 10);
      return {
        '--hurt-border-width': `${borderWidth}px`,
        '--hurt-opacity': Math.max(Math.min(intensity, 1), 0.2)
      };
    },
    zIndexStyle() {
      return { zIndex: this.zIndex };
    }
  },
  mounted() {
    frontendEventBus.on('unit-hurt', this.onUnitHurt);
    frontendEventBus.on('unit-death', this.onUnitDeath);
  },
  beforeUnmount() {
    this._clearTimers();
    frontendEventBus.off('unit-hurt', this.onUnitHurt);
    frontendEventBus.off('unit-death', this.onUnitDeath);
  },
  watch: {
    // 当 unit 实例切换时，重置动画状态，避免继承残留态
    unit() {
      this.isShaking = false;
      this.isHurt = false;
      this.isEvading = false;
      this.isHealing = false;
      this.isDead = false;
      this.hurtIntensity = 0;
      this.shakeIntensity = 0;
      this._clearTimers();
    }
  },
  methods: {
    onUnitHurt(payload = {}) {
      console.log(payload);
      const id = payload?.unitId;
      if (!id || id !== this.unit?.uniqueID) return;
      const hpDamage = payload?.hpDamage ?? 0;
      const passThroughDamage = payload?.passThroughDamage ?? 0;

      if (hpDamage === 0 && passThroughDamage === 0) {
        // 闪避
        this.isEvading = true;
        this._setTimer(() => { this.isEvading = false; }, 700);
        return;
      }

      if (hpDamage < 0) {
        // 治疗
        this.isHealing = true;
        this.createDamageText(hpDamage);
        this._setTimer(() => { this.isHealing = false; }, 600);
        return;
      }

      // 正常受伤
      this.shakeIntensity = hpDamage;
      this.isShaking = true;
      this.hurtIntensity = hpDamage;
      this.isHurt = true;

      // 粒子与文本
      const shieldDamage = passThroughDamage - hpDamage;
      if (hpDamage > 0) {
        this.createParticles(hpDamage, 0);
        this.createDamageText(hpDamage);
      }
      if(shieldDamage > 0) {
        this.createParticles(shieldDamage, 140);
        this.createDamageText(shieldDamage, true);
      }

      const duration = Math.min(200 + passThroughDamage * 2, 600);
      this._setTimer(() => { this.isShaking = false; this.shakeIntensity = 0; }, duration);
      this._setTimer(() => { this.isHurt = false; this.hurtIntensity = 0; }, 200);
    },

    onUnitDeath(payload = {}) {
      const id = payload?.unitId;
      if (!id || id !== this.unit?.uniqueID) return;
      // 玩家不触发死亡爆炸
      if (this.unit?.type === 'player') return;
      // 延续原来的死亡演出
      for (let i = 0; i < 7; i++) {
        this._setTimer(() => { this.createParticles(20); }, i * 200);
      }
      this._setTimer(() => { this.isShaking = true; this.shakeIntensity = 20; }, 900);
      this._setTimer(() => { this.isDead = true; }, 1400);
      this._setTimer(() => { this.createParticles(100); }, 1400);
    },

    _setTimer(fn, delay) {
      const id = setTimeout(fn, delay);
      this._timers.push(id);
      return id;
    },
    _clearTimers() {
      if (this._timers && this._timers.length) {
        for (const id of this._timers) clearTimeout(id);
        this._timers = [];
      }
    },

    createDamageText(damage, isShieldDamage = false) {
      const wrapper = this.$el;
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width;
      const wrapperHeight = wrapperRect.height;

      const isHealing = damage < 0;
      const text = isHealing ? `+${Math.abs(damage)}` : `-${damage}`;
      const color = isHealing ? '#00ff00' : (isShieldDamage ? '#666666' : '#ff0000');
      const damageValue = Math.abs(damage);
      const fontSize = Math.min(96, Math.max(24, 12 + damageValue / 4));

      const centerX = wrapperRect.left + wrapperWidth / 2;
      const centerY = wrapperRect.top + wrapperHeight / 2;
      const startX = centerX + (Math.random() - 0.5) * wrapperWidth * 0.3;
      const startY = centerY + (Math.random() - 0.5) * wrapperHeight * 0.3;

      const duration = Math.min(3000, isHealing ? (1000 - damageValue * 50) : (800 + damageValue * 30));
      const gravity = isHealing ? 0 : 1000;
      const velocityX = (Math.random() - 0.5) * 200;
      const velocityY = -200 - Math.random() * 200;

      const particle = {
        x: startX,
        y: startY,
        vx: velocityX,
        vy: velocityY,
        gravity: gravity,
        life: duration,
        size: fontSize,
        text: text,
        extraStyles: {
          color: color,
          userSelect: 'none',
          pointerEvents: 'none',
          fontSize: `${fontSize}px`,
          fontWeight: 'bold',
          zIndex: '20'
        }
      };
      frontendEventBus.emit('spawn-particles', [particle]);
    },

    createParticles(damageMagnitude, hueShift = 0) {
      const wrapperRect = this.$el.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width;
      const wrapperHeight = wrapperRect.height;

      const magnitude = Math.max(1, Math.abs(damageMagnitude));
      const particleCount = Math.min(Math.max(Math.floor(magnitude / 5), 20), 80);

      const particles = [];
      for (let i = 0; i < particleCount; i++) {
        const edge = Math.floor(Math.random() * 4);
        let startX = 0, startY = 0;
        switch (edge) {
          case 0: startX = Math.random() * wrapperWidth; startY = 0; break;
          case 1: startX = wrapperWidth; startY = Math.random() * wrapperHeight; break;
          case 2: startX = Math.random() * wrapperWidth; startY = wrapperHeight; break;
          case 3: startX = 0; startY = Math.random() * wrapperHeight; break;
        }
        const centerX = wrapperWidth / 2;
        const centerY = wrapperHeight / 2;
        const angle = Math.atan2(startY - centerY, startX - centerX);

        const speed = (8 + Math.random() * 12) * Math.max(1, Math.min(magnitude / 10, 8));
        const size = (1 + Math.random() * 4) * Math.min(20, Math.max(2, magnitude / 4));

        const hue = hueShift + Math.random() * 45;
        const saturation = 80 + Math.random() * 20;
        const lightness = 40 + Math.random() * 20;

        const absoluteX = wrapperRect.left + startX;
        const absoluteY = wrapperRect.top + startY;

        particles.push({
          x: absoluteX,
          y: absoluteY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: size,
          color: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
          life: (500 + Math.random() * 500) * Math.min(3, Math.max(1, magnitude / 100)),
          shape: 'circle',
          opacityFade: true,
          drag: 0.1,
          zIndex: 0
        });
      }
      frontendEventBus.emit('spawn-particles', particles);
    }
  }
};
</script>

<style scoped>
.hurt-animation-wrapper {
  width: fit-content;
  height: fit-content;
  position: relative;
  margin: 20px;
  transition: border 0.1s ease, filter 0.1s ease, transform 0.1s ease;
  /* 受伤特效的默认变量 */
  --hurt-border-width: 0px;
  --hurt-opacity: 0;
  border: var(--hurt-border-width) solid rgba(255, 0, 0, var(--hurt-opacity));
  filter: drop-shadow(0 0 5px rgba(255, 0, 0, calc(var(--hurt-opacity) * 0.5)));
}

.hurt-shake {
  animation: shake 0.3s ease-in-out;
}

.hurt-effect {
  /* 受伤时的特效 */
  border: var(--hurt-border-width) solid rgba(255, 0, 0, var(--hurt-opacity));
  filter: drop-shadow(0 0 5px rgba(255, 0, 0, calc(var(--hurt-opacity) * 0.5)));
  transition: border 0.2s ease, filter 0.2s ease;
}

.evade-effect {
  animation: evade-swing 0.3s ease-in-out;
}

@keyframes evade-swing {
  0% { transform: rotate(0deg); }
  50% { transform: translate(20px) rotate(3deg); }
  100% { transform: translate(0px) rotate(0deg); }
}

.heal-overlay {
  /* 治疗时的特效覆盖层 */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 255, 0, 0.6);
  pointer-events: none;
  z-index: 10;
  animation: heal-fadeout 0.6s forwards;
}

.dead-overlay {
  /* 死亡时的特效覆盖层 */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: white;
  pointer-events: none;
  z-index: 11;
  animation: dead-flash 0.6s forwards;
}

@keyframes shake {
  0% { transform: translate(0, 0) rotate(0); }
  10% { transform: translate(-2px, -1px) rotate(-0.5deg); }
  20% { transform: translate(2px, 1px) rotate(0.5deg); }
  30% { transform: translate(-2px, 1px) rotate(-0.5deg); }
  40% { transform: translate(2px, -1px) rotate(0.5deg); }
  50% { transform: translate(-1px, 2px) rotate(-0.5deg); }
  60% { transform: translate(1px, -2px) rotate(0.5deg); }
  70% { transform: translate(-1px, -1px) rotate(-0.5deg); }
  80% { transform: translate(1px, 1px) rotate(0.5deg); }
  90% { transform: translate(-1px, 1px) rotate(-0.5deg); }
  100% { transform: translate(0, 0) rotate(0); }
}

@keyframes heal-fadeout {
  0% { opacity: 0.6; }
  100% { opacity: 0; }
}

@keyframes dead-flash {
  0% { opacity: 0.3; background-color: red;}
  10% { opacity: 0; }
  20% { opacity: 0.6; background-color: red;}
  30% { opacity: 0; }
  40% { opacity: 1; background-color: black;}
  50% { opacity: 0; }
  60% { opacity: 1; background-color: red;}
  70% { opacity: 0.5;}
  100% { opacity: 1; background-color: white;}
}

/* 死亡时让元素看起来消失 */
.dead-wrapper {
  animation: dead-disappear 0.6s forwards;
}

@keyframes dead-disappear {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}

/* 有盾的时候，增加一个花哨的蓝色边框（盾牌） */
.shielded-wrapper {
  border: 5px solid #1E90FF;
  border-radius: 8px;
}
</style>