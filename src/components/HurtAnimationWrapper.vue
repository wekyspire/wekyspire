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
    :style="[shakeStyle, hurtStyle, zIndexStyle]"
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
import eventBus from '../eventBus.js';

export default {
  name: 'HurtAnimationWrapper',
  props: {
    unit: {
      type: Object,
      default: null
    },
    zIndex: {
      type: Number,
      default: 1
    }
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
      particles: []
    };
  },
  computed: {
    isShielded() {
      return this.unit.shield > 0;
    },
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

    zIndexStyle() {
      return {
        zIndex: this.zIndex
      }
    }
  },
  mounted() {
    // 监听受伤事件
    eventBus.on('unit-hurt', this.handleUnitHurt);
    // 监听battle-victory事件
    eventBus.on('battle-victory', this.handleBattleVictory);
  },
  beforeUnmount() {
    // 移除事件监听
    eventBus.off('unit-hurt', this.handleUnitHurt);
    eventBus.off('battle-victory', this.handleBattleVictory);
  },
  methods: {
    handleUnitHurt({ target, passThoughDamage, hpDamage }) {
      // 检查这个组件是否是受伤目标的父组件
      // 优先使用props中的unit属性
      if (this.unit && this.unit === target) {
        // 触发震颤和粒子效果
        this.triggerHurtAnimation(hpDamage, passThoughDamage);
        return;
      }
      
      // 如果没有props中的unit属性，则通过检查子组件的enemy或player属性来判断
      const parentComponent = this.$parent;
      
      if (parentComponent) {
        // 检查是否是EnemyStatusPanel并且受伤的是enemy
        if (parentComponent.$options.name === 'EnemyStatusPanel' && parentComponent.enemy === target) {
          // 触发震颤和粒子效果
          this.triggerHurtAnimation(hpDamage, passThoughDamage);
          return;
        }
        
        // 检查是否是PlayerStatusPanel并且受伤的是player
        if (parentComponent.$options.name === 'PlayerStatusPanel' && parentComponent.player === target) {
          // 触发震颤和粒子效果
          this.triggerHurtAnimation(hpDamage, passThoughDamage);
          return;
        }
      }
    },
    
    triggerHurtAnimation(hpDamage, passThoughDamage) {
      const damage = hpDamage;
      // 如果无伤害，且无穿透伤害，则认定为闪避，播放闪避动画并结束
      if(damage === 0 && passThoughDamage === 0) {
        this.isEvading = true;
        // 在0.7秒后停止闪避特效
        setTimeout(() => {
          this.isEvading = false;
        }, 700);
        // 不执行其他动画效果
        return;
      }
      
      // 如果是负数伤害（治疗）
      if (damage < 0) {
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
      
      // 如果hp受到伤害，则创建粒子效果（流血）
      if(damage > 0) {
        this.createParticles(damage, 0);
      } else {
        // 否然，如果是盾伤害，创建蓝色粒子效果
        this.createParticles(damage, 140);
      }
      // 创建伤害文本
      this.createDamageText(passThoughDamage);
      
      // 根据伤害强度计算震颤持续时间
      const duration = Math.min(200 + passThoughDamage * 2, 600); // 持续时间在200ms到600ms之间
      
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
    handleBattleVictory() {
      // 当胜利时，如果unit不是玩家，播放敌人死亡动画
      if(this.unit.type !== 'player') {
        // 持续生成大量粒子
        for(let i = 0; i < 7; i++) {
          setTimeout(() => {
            this.createParticles(20);
          }, i * 200);
        }
        // 最后播放爆炸动画：面板短暂剧烈震动
        setTimeout(() => {
          this.isShaking = true;
          this.shakeIntensity = 20;
        }, 900);
        // 面板发生闪烁，变成红色后变成纯白
        setTimeout(() => {
          this.isDead = true;
        }, 1400);
        // 爆炸时一次性生成大量粒子
        setTimeout(() => {
          this.createParticles(100);
        }, 1400);
      }
    },
    
    createDamageText(damage) {
      // 获取父元素尺寸
      const wrapper = this.$el;
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width;
      const wrapperHeight = wrapperRect.height;
      
      // 设置文本内容和样式
      const isHealing = damage < 0;
      const text = isHealing ? `+${Math.abs(damage)}` : `-${damage}`;
      
      // 根据伤害/治疗设置颜色
      const color = isHealing ? '#00ff00' : '#ff0000';
      
      // 根据伤害/治疗量设置字体大小
      const damageValue = Math.abs(damage);
      const fontSize = Math.min(96, Math.max(24, 12 + damageValue / 4));
      
      // 设置初始位置（中心区域随机位置）
      const centerX = wrapperRect.left + wrapperWidth / 2;
      const centerY = wrapperRect.top + wrapperHeight / 2;
      const startX = centerX + (Math.random() - 0.5) * wrapperWidth * 0.3;
      const startY = centerY + (Math.random() - 0.5) * wrapperHeight * 0.3;
      
      // 动画参数
      const duration = Math.min(
        3000,
        isHealing ? (1000 -damageValue * 50) : (800 + damageValue * 30)
      );
      const gravity = isHealing ? 0 : 1000; // 治疗文本不受重力影响
      let velocityX = (Math.random() - 0.5) * 200;
      let velocityY = -200 - Math.random() * 200;
      
      // 创建文本粒子配置
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
          // textShadow: '0 0 3px rgba(0, 0, 0, 0.5)',
          // fontFamily: 'Arial, sans-serif',
          userSelect: 'none',
          pointerEvents: 'none',
          fontSize: `${fontSize}px`,
          fontWeight: 'bold',
          zIndex: '20'
        }
      };
      
      // 通过事件总线发送粒子生成请求
      eventBus.emit('spawn-particles', [particle]);
    },
    
    createParticles(damage, hueShift = 0) {
      // 获取父元素尺寸（相对坐标）
      const wrapperWidth = this.$el.offsetWidth;
      const wrapperHeight = this.$el.offsetHeight;
      
      // 根据伤害大小确定粒子数量
      const particleCount = Math.min(Math.max(Math.floor(damage / 5), 20), 80);
      
      const particles = [];
      
      for (let i = 0; i < particleCount; i++) {
        // 随机选择从哪个边界出发（0:上, 1:右, 2:下, 3:左）
        const edge = Math.floor(Math.random() * 4);
        let startX, startY;
        
        // 根据选择的边界设置初始位置（相对坐标）
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
        
        const speed = (8 + Math.random() * 12) * Math.max(1, Math.min(damage / 10, 8)); // 增加速度
        const size = (1 + Math.random() * 4) * Math.min(20, Math.max(2, damage / 4));
        
        // 随机颜色，主要是红色和橙色，少量黄色
        const hue = hueShift + Math.random() * 45; // 0-45范围，红色到黄色
        const saturation = 80 + Math.random() * 20; // 80-100%饱和度
        const lightness = 40 + Math.random() * 20; // 40-60%亮度
        
        // 获取组件在屏幕上的绝对位置
        const wrapperRect = this.$el.getBoundingClientRect();
        const absoluteX = wrapperRect.left + startX;
        const absoluteY = wrapperRect.top + startY;
        
        particles.push({
          x: absoluteX,
          y: absoluteY,
          vx: Math.cos(angle) * speed ,
          vy: Math.sin(angle) * speed ,
          size: size,
          color: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
          life: (500 + Math.random() * 500) * Math.min(3, Math.max(1, damage / 100)),
          shape: 'circle',
          opacityFade: true,
          drag: 0.1,
          zIndex: 0
        });
      }
      
      // 通过事件总线发送粒子生成请求
      eventBus.emit('spawn-particles', particles);
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