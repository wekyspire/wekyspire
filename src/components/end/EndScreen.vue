<template>
  <div class="end-screen">
    <h1>游戏结束</h1>
    <div v-if="isVictory">
      <p>恭喜你战胜了最终Boss！</p>
      <p>你成功完成了魏启尖塔的挑战！</p>
    </div>
    <div v-else>
      <p>很遗憾，你在战斗中失败了。</p>
      <p>不要气馁，再试一次吧！</p>
    </div>
    <button @click="restartGame">重新开始</button>
  </div>
</template>

<script>
export default {
  name: 'EndScreen',
  props: {
    isVictory: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    restartGame() {
      this.$emit('restart-game')
    }
  }
}
</script>

<style scoped>
.end-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

button {
  padding: 10px 20px;
  font-size: 18px;
  margin-top: 20px;
}
</style>