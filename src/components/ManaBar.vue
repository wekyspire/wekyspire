<template>
  <div class="mana-bar">
    <div class="mana-text">💧魏启 {{ player.mana }}/{{ player.maxMana }}</div>
    <div class="mana-dots">
      <span 
        v-for="(dot, index) in manaDots" 
        :key="index" 
        class="mana-dot" 
        :class="{ 'filled': dot.filled, 'empty': !dot.filled }"
      ></span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ManaBar',
  props: {
    player: {
      type: Object,
      required: true
    }
  },
  computed: {
    // 计算魏启圆点
    manaDots() {
      const dots = [];
      for (let i = 0; i < this.player.maxMana; i++) {
        dots.push({
          filled: i < this.player.mana
        });
      }
      return dots;
    }
  }
};
</script>

<style scoped>
.mana-bar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.mana-dots {
  display: flex;
  margin-right: 10px;
}

.mana-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 3px;
  border: 1px solid #ccc;
}

.mana-dot.filled {
  background-color: #2196f3; /* 蓝色 */
}

.mana-dot.empty {
  background-color: #000; /* 黑色 */
}

.mana-text {
  font-size: 14px;
  font-weight: bold;
}
</style>