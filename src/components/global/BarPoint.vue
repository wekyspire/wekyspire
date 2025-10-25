<template>
  <span 
    class="bar-point" 
    :class="{ 'filled': filled, 'empty': !filled, 'highlighted': highlighted }"
  ></span>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'BarPoint',
  props: {
    filled: {
      type: Boolean,
      default: false
    },
    highlighted: {
      type: Boolean,
      default: false
    },
    color: {
      type: String,
      default: '#000'
    },
    highlightColor: {
      type: String,
      default: '#fff'
    },
    lightenColor: {
      type: String,
      default: '#fff'
    }
  },
  data() {
    return {
      particleInterval: null
    };
  },
  mounted() {
    // 监听高亮状态变化
    if (this.highlighted) {
      this.$nextTick(() => {
        this.startParticleGeneration();
      });
    }
  },
  beforeUnmount() {
    // 清除粒子生成定时器
    this.stopParticleGeneration();
  },
  watch: {
    highlighted(newVal) {
      if (newVal) {
        this.startParticleGeneration();
      } else {
        this.stopParticleGeneration();
      }
    }
  },
  methods: {
    startParticleGeneration() {
      // 清除现有的定时器
      if (this.particleInterval) {
        clearInterval(this.particleInterval);
      }
      
      // 启动新的定时器
      this.particleInterval = setInterval(() => {
        // 生成粒子
        this.generateParticles();
      }, 500); // 每500毫秒生成一次粒子
    },
    stopParticleGeneration() {
      if (this.particleInterval) {
        clearInterval(this.particleInterval);
        this.particleInterval = null;
      }
    },
    generateParticles() {
      // 获取元素位置
      const rect = this.$el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // 生成粒子数组
      const particles = [];
      
      // 生成少量粒子
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: centerX + (Math.random() - 0.5) * 20, // 在点周围随机位置
          y: centerY + (Math.random() - 0.5) * 20, // 在点周围随机位置
          vx: (Math.random() - 0.5) * 50, // 随机水平速度
          vy: (Math.random() - 0.5) * 50 - 25, // 随机垂直速度，向上偏移
          color: this.highlightColor, // 使用高亮颜色
          life: 1000, // 生命周期1秒
          gravity: 100, // 重力
          size: 2 + Math.random() * 1 // 随机大小
        });
      }
      
      // 发射粒子生成事件
      frontendEventBus.emit('spawn-particles', particles);
    }
  }
};
</script>

<style scoped>
.bar-point {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 3px;
  border: 1px solid #ccc;
  transition: opacity 0.8s ease-in-out;
  opacity: 0;
  /* animation: fadeInOut 0.8s ease-in-out forwards; */
  background-color: v-bind(color);
}

.bar-point.filled {
  opacity: 1;
  animation: inoutFilled 0.8s ease-in-out forwards;
}

.bar-point.empty {
  background-color: #000 !important; /* 黑色 */
  opacity: 0.3;
}

.bar-point.highlighted {
  box-shadow: 0 0 5px v-bind(highlightColor);
  animation: inoutHighLighted 0.3s ease-in forwards;
  /* animation: inoutHighLighted 0.3s ease-out forwards; */
  animation: pulse 1s infinite, colorShift 1s infinite ease-in-out;
}

@keyframes inoutFilled {
  0% {
    background-color: v-bind(highlightColor);
  }
  100% {
    background-color: v-bind(color);
  }
}

@keyframes inoutHighLighted {
  0% {
    background-color: v-bind(color);
  }
  100% {
    background-color: v-bind(highlightColor);
  }
}

@keyframes colorShift {
  0% { background-color: v-bind(highlightColor); }
  50% { background-color: v-bind(lightenColor); }
  100% { background-color: v-bind(highlightColor); }
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 5px v-bind(highlightColor);
  }
  50% {
    box-shadow: 0 0 15px v-bind(highlightColor);
  }
  100% {
    box-shadow: 0 0 5px v-bind(highlightColor);
  }
}
</style>