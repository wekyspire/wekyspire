<template>
  <span>
    <template v-for="(part, index) in parsedText" :key="index">
      <span v-if="part.type === 'text'" :style="part.style">{{ part.content }}</span>
      <span v-else-if="part.type === 'color'" :class="part.color">{{ part.content }}</span>
      <EffectIcon v-else-if="part.type === 'effect'" :effect-name="part.effectName" />
      <NamedEntity v-else-if="part.type === 'named'" :entity-name="part.content" />
    </template>
  </span>
</template>

<script>
import EffectIcon from './EffectIcon.vue';
import NamedEntity from './NamedEntity.vue';
import namedEntities from '../data/namedEntities.js';

export default {
  name: 'ColoredText',
  components: {
    EffectIcon,
    NamedEntity
  },
  props: {
    text: {
      type: String,
      required: true
    }
  },
  computed: {
    parsedText() {
      // 解析文本中的颜色标记、效果标记和命名实体标记
      // 例如："造成/red{10}点伤害" -> [{ type: 'text', content: '造成' }, { type: 'color', color: 'red', content: '10' }, { type: 'text', content: '点伤害' }]
      // 例如："获得2层/effect{防御}效果" -> [{ type: 'text', content: '获得2层' }, { type: 'effect', effectName: '防御' }, { type: 'text', content: '效果' }]
      // 例如："恢复/named{魏启}值" -> [{ type: 'text', content: '恢复' }, { type: 'named', content: '魏启', icon: 'mana', color: 'blue' }, { type: 'text', content: '值' }]
      const colorRegex = /\/(\w+)\{([^}]+)\}/g;
      const effectRegex = /\/effect\{([^}]+)\}/g;
      const namedRegex = /\/named\{([^}]+)\}/g;
      const parts = [];
      let lastIndex = 0;
      
      // 收集所有标记
      const allMatches = [];
      
      // 收集颜色标记
      let match;
      while ((match = colorRegex.exec(this.text)) !== null) {
        // 仅处理颜色
        if (match[1] === 'effect') {
          continue;
        }
        if (match[1] === 'named') {
          continue;
        }
        allMatches.push({
          index: match.index,
          lastIndex: colorRegex.lastIndex,
          type: 'color',
          color: match[1],
          content: match[2]
        });
      }
      
      // 重置正则表达式的lastIndex
      effectRegex.lastIndex = 0;
      
      // 收集效果标记
      while ((match = effectRegex.exec(this.text)) !== null) {
        allMatches.push({
          index: match.index,
          lastIndex: effectRegex.lastIndex,
          type: 'effect',
          effectName: match[1]
        });
      }
      
      // 重置正则表达式的lastIndex
      namedRegex.lastIndex = 0;
      
      // 收集命名实体标记
      while ((match = namedRegex.exec(this.text)) !== null) {
        const entityName = match[1];
        const entity = namedEntities[entityName];
        
        allMatches.push({
          index: match.index,
          lastIndex: namedRegex.lastIndex,
          type: 'named',
          content: entityName,
          icon: entity ? entity.icon : null,
          color: entity ? entity.color : null
        });
      }
      
      // 按索引排序
      allMatches.sort((a, b) => a.index - b.index);
      
      // 处理所有标记
      for (let i = 0; i < allMatches.length; i++) {
        const currentMatch = allMatches[i];
        
        // 添加匹配前的文本
        if (currentMatch.index > lastIndex) {
          parts.push({
            type: 'text',
            content: this.text.slice(lastIndex, currentMatch.index)
          });
        }
        
        // 添加当前标记
        parts.push(currentMatch);
        lastIndex = currentMatch.lastIndex;
      }
      
      // 添加最后剩余的文本
      if (lastIndex < this.text.length) {
        parts.push({
          type: 'text',
          content: this.text.slice(lastIndex)
        });
      }
      
      return parts;
    }
  }
}
</script>

<style scoped>
/* 预定义的颜色样式 */
.red {
  color: #ff4444;
}

.blue {
  color: #4444ff;
}

.green {
  color: #44ff44;
}

.purple {
  color: #ff44ff;
}

</style>