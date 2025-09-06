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
      const rect = spawnRect || { xUV: 0, yUV: 0, widthUV: 1, heightUV: 1 };
      
      for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // 设置粒子样式
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.backgroundColor = color;
        
        // 在指定矩形区域内随机生成初始位置
        const spawnX = rect.xUV + Math.random() * rect.widthUV;
        const spawnY = rect.yUV + Math.random() * rect.heightUV;
        const spawnXPercentage = spawnX * 100;
        const spawnYPercentage = spawnY * 100;

        // 设置初始位置
        particle.style.left = `${spawnXPercentage}%`;
        particle.style.top = `${spawnYPercentage}%`;
        console.log(spawnXPercentage, spawnYPercentage)
        
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

// 不能使用 style : scoped，否则会导致.particle无法应用到particle DOM元素上，导致显示失败。
<style>
.particle-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  /* 移除z-index设置，由父组件控制 */
}

.particle {
  position: absolute;
  border-radius: 50%;
  opacity: 1;
}
</style>