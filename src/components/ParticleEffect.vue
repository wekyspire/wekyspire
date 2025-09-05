<template>
  <div class="particle-container" ref="container">
    <!-- 粒子将通过JavaScript动态生成 -->
  </div>
</template>

<script>
export default {
  name: 'ParticleEffect',
  methods: {
    // 播放粒子动画
    play(count, size, color, duration, spawnRect) {
      this.createParticles(count, size, color, duration, spawnRect);
    },
    // 创建粒子
    createParticles(count, size, color, duration, spawnRect) {
      const container = this.$refs.container;
      container.innerHTML = '';
      
      // 默认生成区域为整个容器
      const rect = spawnRect || { x: 0, y: 0, width: 100, height: 100 };
      
      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // 设置粒子样式
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.backgroundColor = color;
        
        // 在指定矩形区域内随机生成初始位置
        // 使用padding确保粒子不会生成在边缘
        const padding = 5; // 5%的内边距
        const spawnX = rect.x + padding + Math.random() * (rect.width - padding * 2);
        const spawnY = rect.y + padding + Math.random() * (rect.height - padding * 2);
        
        // 设置初始位置
        particle.style.left = `${spawnX}%`;
        particle.style.top = `${spawnY}%`;
        
        // 随机运动方向和距离，确保粒子向四周逸散
        const angle = Math.random() * Math.PI * 2; // 随机角度
        const distance = 30 + Math.random() * 70; // 随机距离(30-100px)
        const posX = Math.cos(angle) * distance;
        const posY = Math.sin(angle) * distance;
        
        // 添加到容器
        container.appendChild(particle);
        
        // 执行动画
        setTimeout(() => {
          particle.style.transition = `all ${duration}ms ease-out`;
          particle.style.transform = `translate(${posX}px, ${posY}px)`;
          particle.style.opacity = '0';
          
          // 动画结束后移除粒子
          setTimeout(() => {
            if (particle.parentNode) {
              particle.parentNode.removeChild(particle);
            }
          }, duration);
        }, 10);
      }
    }
  }
}
</script>

<style scoped>
.particle-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.particle {
  position: absolute;
  border-radius: 50%;
  opacity: 1;
}
</style>