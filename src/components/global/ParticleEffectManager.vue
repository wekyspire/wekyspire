<template>
  <div class="particle-effect-manager">
    <div 
      v-for="particle in particles" 
      :key="particle.id"
      class="particle"
      :style="getParticleStyle(particle)"
    >
      <!-- 粒子文本 -->
      <span v-if="particle.text" class="particle-text">{{ particle.text }}</span>
      <!-- 粒子贴图 -->
      <img v-if="particle.texture" :src="particle.texture" :style="getTextureStyle(particle)" class="particle-texture" />
    </div>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js'

export default {
  name: 'ParticleEffectManager',
  data() {
    return {
      particles: [],
      nextId: 1,
      animationFrameId: null
    }
  },
  mounted() {
    // 监听spawn-particles事件
    frontendEventBus.on('spawn-particles', this.spawnParticles);

    // 开始动画循环
    this.animate();
  },
  beforeUnmount() {
    // 清理事件监听
    frontendEventBus.off('spawn-particles', this.spawnParticles);

    // 取消动画循环
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  },
  methods: {
    /**
     * 监听事件总线上的spawnParticles事件
     * @param {Array} particles - 粒子数组
     */
    spawnParticles(particles) {
      particles.forEach(particle => {
        // 添加唯一ID和初始时间
        particle.id = this.nextId++;
        particle.startTime = performance.now();
        particle.lastUpdateTime = performance.now();
        
        // 设置默认值
        particle.x = particle.x || particle.absoluteX || 0;
        particle.y = particle.y || particle.absoluteY || 0;
        particle.vx = particle.vx || 0;
        particle.vy = particle.vy || 0;
        particle.life = particle.life || 1000; // 默认生命周期1秒
        particle.gravity = particle.gravity || 0;
        particle.customForce = particle.customForce || null; // 自定义受力函数
        particle.customTrajectory = particle.customTrajectory || null; // 自定义轨迹函数
        particle.size = particle.size || 5; // 默认大小
        particle.opacity = particle.opacity !== undefined ? particle.opacity : 1; // 默认不透明度
        particle.fadeIn = particle.fadeIn !== undefined ? particle.fadeIn : false; // 默认无fade in
        particle.opacityFade = particle.opacityFade !== undefined ? particle.opacityFade : true; // 默认fade
        particle.sizeFade = particle.sizeFade !== undefined ? particle.sizeFade : true; // 默认fade
        particle.rotation = particle.rotation || 0; // 默认旋转角度
        particle.drag = particle.drag !== undefined ? particle.drag : 0; // 默认drag为0
        particle.zIndex = particle.zIndex !== undefined ? particle.zIndex : 1; // 默认z-index为1
        particle.update = particle.update || null; // 自定义更新函数
        particle.text = particle.text || null; // 文本内容，可以包含emoji
        particle.texture = particle.texture || null; // 贴图
        particle.extraStyles = particle.extraStyles || {}; // 额外样式
        
        // 添加到粒子数组
        this.particles.push(particle);
      });
    },
    
    /**
     * 动画循环
     */
    animate() {
      const currentTime = performance.now();
      
      // 更新粒子
      this.particles = this.particles.filter(particle => {
        const elapsed = currentTime - particle.startTime;
        const delta = currentTime - particle.lastUpdateTime;
        particle.lastUpdateTime = currentTime;
        
        // 检查是否超过生命周期
        if (elapsed > particle.life) {
          return false; // 移除粒子
        }
        
        // 更新粒子状态
        this.updateParticle(particle, currentTime, delta / 1000); // 转换为秒
        
        return true; // 保留粒子
      });
      
      // 继续动画循环
      this.animationFrameId = requestAnimationFrame(this.animate);
    },
    
    /**
     * 更新单个粒子的状态
     * @param {Object} particle - 粒子对象
     * @param {number} deltaTime - 间隔时间（秒）
     */
    updateParticle(particle, currentTime, deltaTime) {
      // 如果有自定义轨迹函数，优先使用
      if (typeof particle.customTrajectory === 'function') {
        particle.customTrajectory(particle, deltaTime);
      } else {
        // 使用内置位置更新逻辑

        // 应用自定义受力逻辑
        if (typeof particle.customForce === 'function') {
          const force = particle.customForce(particle, deltaTime);
          particle.vx += force.x * deltaTime;
          particle.vy += force.y * deltaTime;
        }
        
        // 应用重力
        particle.vy += particle.gravity * deltaTime;
        
        // 应用drag（阻力）
        if (particle.drag > 0) {
          const dragFactor = Math.pow(Math.max(1 - particle.drag, 0.0001), deltaTime);
          particle.vx *= dragFactor;
          particle.vy *= dragFactor;
        }
        
        // 更新位置
        particle.x += particle.vx * deltaTime;
        particle.y += particle.vy * deltaTime;
      }

      // 更新Opacity
      if (particle.opacityFade) {
        const elapsed = currentTime - particle.startTime;
        const t = (particle.life - elapsed) / particle.life;
        particle.opacity = particle.fadeIn ? (Math.min(1 - t, t) * 2) : (1 - t);
      }
      
      // 更新其他属性（如大小、颜色、不透明度等）
      if (particle.update) {
        particle.update(particle, deltaTime);
      }
    },
    
    /**
     * 获取粒子的样式
     * @param {Object} particle - 粒子对象
     * @returns {Object} 样式对象
     */
    getParticleStyle(particle) {
      let fadedSize = particle.size;
      if(particle.sizeFade) {
        fadedSize *= (particle.life - (performance.now() - particle.startTime)) / particle.life;
      }
      const generatedStyles = {
        position: 'absolute',
        left: particle.x + 'px',
        top: particle.y + 'px',
        width: fadedSize + 'px',
        height: fadedSize + 'px',
        backgroundColor: particle.color || 'none',
        opacity: particle.opacity,
        transform: `rotate(${particle.rotation}deg)`,
        zIndex: particle.zIndex
      };
      // 如果particle有extraStyles，合并到generatedStyles
      if (particle.extraStyles) {
        Object.assign(generatedStyles, particle.extraStyles);
      }
      return generatedStyles;
    },
    
    /**
     * 获取贴图的样式
     * @param {Object} particle - 粒子对象
     * @returns {Object} 样式对象
     */
    getTextureStyle(particle) {
      return {
        width: '100%',
        height: '100%',
        // 可以添加更多贴图样式属性
      };
    }
  }
}
</script>

<style scoped>
.particle-effect-manager {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* 确保粒子不影响用户交互 */
  z-index: var(--z-particles);
  overflow: hidden; /* 防止粒子溢出 */
}

.particle {
  position: absolute;
  /* 其他样式在getParticleStyle中动态设置 */
}

.particle-text {
  font-size: inherit;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.particle-texture {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>