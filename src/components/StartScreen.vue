<template>
  <div class="start-screen">
    <h1>魏启乱斗</h1>
    <button @click="startGame">开始游戏</button>
  </div>
</template>

<script>
export default {
  name: 'StartScreen',
  methods: {
    startGame() {
      this.$emit('start-game')
    }
  }
}
</script>

<style scoped>
.start-screen {
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