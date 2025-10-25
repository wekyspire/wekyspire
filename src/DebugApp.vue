<template>
  <div id="debug-app">
    <ArenaDebugScreen />
  </div>
</template>

<script>
import ArenaDebugScreen from './components/global/ArenaDebugScreen.vue';

export default {
  name: 'DebugApp',
  components: {
    ArenaDebugScreen
  }
};
</script>

<style>
#debug-app {
  height: 100vh;
  overflow: hidden;
  display: flex;
}

#debug-app > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>