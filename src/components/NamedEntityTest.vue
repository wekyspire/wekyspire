<template>
  <div>
    <h1>命名实体测试</h1>
    <ColoredText text="这是一个测试文本，包含/named{魏启}和/named{行动力}的命名实体。" />
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';

export default {
  name: 'NamedEntityTest',
  components: {
    ColoredText
  }
};
</script>

<style scoped>
</style>