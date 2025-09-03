<template>
  <div class="dialog-overlay" v-if="isVisible">
    <div class="dialog-screen">
      <div class="character-avatar">
        <img :src="currentDialog.avatar" :alt="currentDialog.character" v-if="currentDialog.avatar">
        <div v-else class="placeholder-avatar">{{ currentDialog.character }}</div>
      </div>
      <div class="dialog-content">
        <h3>{{ currentDialog.character }}</h3>
        <p>{{ currentDialog.text }}</p>
        <button @click="nextDialog">继续</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DialogScreen',
  props: {
    isVisible: {
      type: Boolean,
      default: false
    },
    currentDialog: {
      type: Object,
      default: () => ({
        character: '',
        text: '',
        avatar: ''
      })
    }
  },
  methods: {
    nextDialog() {
      this.$emit('next-dialog')
    }
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  z-index: 1000;
}

.dialog-screen {
  background-color: white;
  width: 80%;
  max-width: 600px;
  border-radius: 10px;
  display: flex;
  padding: 20px;
  margin-bottom: 20px;
}

.character-avatar {
  width: 100px;
  height: 100px;
  margin-right: 20px;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.placeholder-avatar {
  width: 100%;
  height: 100%;
  background-color: #eee;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: bold;
}

.dialog-content {
  flex: 1;
}

.dialog-content h3 {
  margin-top: 0;
}

button {
  padding: 10px 20px;
  float: right;
}
</style>