<template>
  <div 
    class="hurt-animation-wrapper" 
    :class="{ 'hurt-shake': isShaking, 'hurt-effect': isHurt }"
    :style="[shakeStyle, hurtStyle]"
  >
    <slot></slot>
    <!-- 粒子溅射效果容器 -->
    <div class="particle-container" ref="particleContainer"></div>
    <!-- 治疗效果覆盖层 -->
    <div 
      v-if="isHealing" 
      class="heal-overlay" 
      :style="healStyle"
    ></div>
  </div>
</template>

<script>
import eventBus from '../eventBus.js';

export default {
  name: 'HurtAnimationWrapper',
  props: {
    unit: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      isShaking: false,
      isHurt: false,
      isHealing: false,
      shakeIntensity: 0,
      hurtIntensity: 0,
      particles: []
    };
  },
  computed: {
    shakeStyle() {
      if (!this.isShaking) return {};
      
      // 根据伤害强度计算震颤参数
      const intensity = Math.min(this.shakeIntensity / 10, 1); // 归一化强度
      const maxShake = 10 * intensity;
      const maxRotate = 2 * intensity;
      
      // 添加一个震动偏移量，使每次震动都不同
      const offsetX = (Math.random() - 0.5) * maxShake;
      const offsetY = (Math.random() - 0.5) * maxShake;
      const rotation = (Math.random() - 0.5) * maxRotate;
      
      return {
        transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`
      };
    },
    
    hurtStyle() {
      if (!this.isHurt) return {};
      
      // 根据伤害强度计算特效参数
      const intensity = Math.min(this.hurtIntensity / 50, 1); // 归一化强度
      const borderWidth = Math.min(Math.max(2, Math.floor(5 * intensity)), 10); // 边框厚度在1px到10px之间
      
      return {
        '--hurt-border-width': `${borderWidth}px`,
        '--hurt-opacity': Math.max(Math.min(intensity, 1), 0.2)
      };
    },
    
    healStyle() {
      if (!this.isHealing) return {};
      
      return {};
    }
  },
  mounted() {
    // 监听受伤事件
    eventBus.on('unit-hurt', this.handleUnitHurt);
  },
  beforeUnmount() {
    // 移除事件监听
    eventBus.off('unit-hurt', this.handleUnitHurt);
  },
  methods: {
    handleUnitHurt({ target, passThoughDamage, hpDamage }) {
      // 检查这个组件是否是受伤目标的父组件
      // 优先使用props中的unit属性
      if (this.unit && this.unit === target) {
        // 触发震颤和粒子效果
        this.triggerHurtAnimation(hpDamage);
        return;
      }
      
      // 如果没有props中的unit属性，则通过检查子组件的enemy或player属性来判断
      const parentComponent = this.$parent;
      
      if (parentComponent) {
        // 检查是否是EnemyStatusPanel并且受伤的是enemy
        if (parentComponent.$options.name === 'EnemyStatusPanel' && parentComponent.enemy === target) {
          // 触发震颤和粒子效果
          this.triggerHurtAnimation(hpDamage);
          return;
        }
        
        // 检查是否是PlayerStatusPanel并且受伤的是player
        if (parentComponent.$options.name === 'PlayerStatusPanel' && parentComponent.player === target) {
          // 触发震颤和粒子效果
          this.triggerHurtAnimation(hpDamage);
          return;
        }
      }
    },
    
    triggerHurtAnimation(damage) {
      // 如果无伤害，则啥都不干
      if(damage === 0) return ;
      
      // 如果是负数伤害（治疗）
      if (damage < 0) {
        // 设置治疗特效强度
        this.isHealing = true;
        
        // 触发治疗动画
        this.isHealing = true;
        // 创建治疗文本
        this.createDamageText(damage);
        // 在0.6秒后停止治疗特效
        setTimeout(() => {
          this.isHealing = false;
        }, 600);
        
        // 不执行其他动画效果
        return;
      }

      // 设置震颤强度
      this.shakeIntensity = damage;
      this.isShaking = true;
      
      // 设置受伤特效强度
      this.hurtIntensity = damage;
      this.isHurt = true;
      
      // 创建粒子效果
      this.createParticles(damage);
      // 创建伤害文本
      this.createDamageText(damage);
      
      // 根据伤害强度计算震颤持续时间
      const duration = Math.min(200 + damage * 2, 600); // 持续时间在200ms到600ms之间
      
      // 在一定时间后停止震颤
      setTimeout(() => {
        this.isShaking = false;
        this.shakeIntensity = 0;
      }, duration);
      
      // 在0.2秒后停止受伤特效
      setTimeout(() => {
        this.isHurt = false;
        this.hurtIntensity = 0;
      }, 200);
    },
    
    createDamageText(damage) {
      const container = this.$refs.particleContainer;
      if (!container) return;
      
      // 获取父元素尺寸
      const wrapper = this.$el;
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width;
      const wrapperHeight = wrapperRect.height;
      
      // 创建伤害文本元素
      const damageText = document.createElement('div');
      damageText.className = 'damage-text';
      
      // 设置文本内容和样式
      const isHealing = damage < 0;
      const text = isHealing ? `+${Math.abs(damage)}` : `-${damage}`;
      damageText.textContent = text;
      
      // 根据伤害/治疗设置颜色
      const color = isHealing ? '#00ff00' : '#ff0000';
      
      // 根据伤害/治疗量设置字体大小
      const damageValue = Math.abs(damage);
      const fontSize = Math.min(96, Math.max(24, 12 + damageValue / 4));
      
      // 设置初始位置（中心区域随机位置）
      const centerX = wrapperWidth / 2;
      const centerY = wrapperHeight / 2;
      const startX = centerX + (Math.random() - 0.5) * wrapperWidth * 0.3;
      const startY = centerY + (Math.random() - 0.5) * wrapperHeight * 0.3;
      
      damageText.style.color = color;
      damageText.style.fontSize = `${fontSize}px`;
      damageText.style.fontWeight = 'bold';
      damageText.style.position = 'absolute';
      damageText.style.left = `${startX}px`;
      damageText.style.top = `${startY}px`;
      damageText.style.transform = 'translate(-50%, -50%)';
      damageText.style.pointerEvents = 'none';
      damageText.style.zIndex = '20';
      damageText.style.opacity = '1';
      damageText.style.transition = 'opacity 0.3s';
      
      container.appendChild(damageText);
      
      // 动画参数
      const duration = isHealing ? 1000 + damageValue * 5 : 800 + damageValue * 3;
      const gravity = isHealing ? 0 : 0.0002; // 治疗文本不受重力影响
      let velocityX = (Math.random() - 0.5) * 0.005;
      let velocityY = isHealing ? -0.008 : -0.005 - Math.random() * 0.003;
      
      let startTime = null;
      let lastPosX = startX;
      let lastPosY = startY;
      
      const animate = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // 更新速度（受重力影响）
        velocityY += gravity;
        
        // 计算新位置
        const newX = lastPosX + velocityX * elapsed;
        const newY = lastPosY + velocityY * elapsed;
        
        // 更新位置
        damageText.style.left = `${newX}px`;
        damageText.style.top = `${newY}px`;
        
        // 淡出效果
        if (progress > 0.7) {
          damageText.style.opacity = `${1 - (progress - 0.7) / 0.3}`;
        }
        
        lastPosX = newX;
        lastPosY = newY;
        
        // 继续动画或移除元素
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          if (damageText.parentNode) {
            damageText.parentNode.removeChild(damageText);
          }
        }
      };
      
      requestAnimationFrame(animate);
    },
    
    createParticles(damage) {
      const container = this.$refs.particleContainer;
      if (!container) return;
      
      // 获取父元素尺寸
      const wrapper = this.$el;
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width;
      const wrapperHeight = wrapperRect.height;
      
      // 根据伤害大小确定粒子数量
      const particleCount = Math.min(Math.max(Math.floor(damage / 5), 20), 80);
      
      for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // 随机选择从哪个边界出发（0:上, 1:右, 2:下, 3:左）
        const edge = Math.floor(Math.random() * 4);
        let startX, startY;
        
        // 根据选择的边界设置初始位置
        switch (edge) {
          case 0: // 上边界
            startX = Math.random() * wrapperWidth;
            startY = 0;
            break;
          case 1: // 右边界
            startX = wrapperWidth;
            startY = Math.random() * wrapperHeight;
            break;
          case 2: // 下边界
            startX = Math.random() * wrapperWidth;
            startY = wrapperHeight;
            break;
          case 3: // 左边界
            startX = 0;
            startY = Math.random() * wrapperHeight;
            break;
        }
        
        // 计算从边界向外的飞散方向
        const centerX = wrapperWidth / 2;
        const centerY = wrapperHeight / 2;
        const angle = Math.atan2(startY - centerY, startX - centerX);
        
        const speed = 2 + Math.random() * 3; // 增加速度
        const size = (1 + Math.random() * 4) * Math.min(20, Math.max(2, damage / 4));
        
        // 随机颜色，主要是红色和橙色，少量黄色
        const hue = Math.random() * 60; // 0-60范围，红色到黄色
        const saturation = 80 + Math.random() * 20; // 80-100%饱和度
        const lightness = 40 + Math.random() * 20; // 40-60%亮度
        
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.backgroundColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        particle.style.borderRadius = `${Math.random() * 50}%`; // 随机圆角，使粒子形状多样化
        particle.style.left = `${startX}px`;
        particle.style.top = `${startY}px`;
        
        container.appendChild(particle);
        
        // 粒子动画 - 向外飞散
        const distance = (50 + Math.random() * 100) * Math.min(3, Math.max(1, damage / 50)); // 增加飞散距离
        const animation = particle.animate(
          [
            {
              transform: 'translate(-50%, -50%) scale(1)',
              opacity: 1
            },
            {
              transform: `translate(${Math.cos(angle) * distance * speed - 50}%, ${Math.sin(angle) * distance * speed - 50}%) scale(0)`,
              opacity: 0
            }
          ],
          {
            duration: (1300 + Math.random() * 1200) * Math.min(3, Math.max(1, damage / 100)), // 持续时间
            easing: 'cubic-bezier(0, .9, .57, 1)',
            fill: 'forwards'
          }
        );
        
        // 动画结束后移除粒子
        animation.onfinish = () => {
          if (particle.parentNode) {
            particle.parentNode.removeChild(particle);
          }
        };
      }
    }
  }
};
</script>

<style scoped>
.hurt-animation-wrapper {
  width: fit-content;
  height: fit-content;
  position: relative;
  transition: transform 0.1s ease;
  /* 受伤特效的默认变量 */
  --hurt-border-width: 0px;
  --hurt-opacity: 0;
  border: var(--hurt-border-width) solid rgba(255, 0, 0, var(--hurt-opacity));
  filter: drop-shadow(0 0 5px rgba(255, 0, 0, calc(var(--hurt-opacity) * 0.5)));
  transition: border 0.2s ease, filter 0.2s ease;
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

.particle-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* */
  overflow: visible;
}

.particle {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  pointer-events: none;
}

.damage-text {
  position: absolute;
  font-family: Arial, sans-serif;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
  will-change: transform, opacity;
  user-select: none;
}
</style>