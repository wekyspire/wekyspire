<template>
  <div id="debug-app">
    <ArenaDebugScreen />
  </div>
</template>

<script>
import ArenaDebugScreen from './components/ArenaDebugScreen.vue';

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
  width: 100vw;
  overflow: hidden;
}
</style>