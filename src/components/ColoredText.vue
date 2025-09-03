<template>
  <span>
    <template v-for="(part, index) in parsedText" :key="index">
      <span v-if="part.type === 'text'" :style="part.style">{{ part.content }}</span>
      <span v-else-if="part.type === 'color'" :class="part.color">{{ part.content }}</span>
      <EffectIcon v-else-if="part.type === 'effect'" :effect-name="part.effectName" />
    </template>
  </span>
</template>

<script>
import EffectIcon from './EffectIcon.vue';

export default {
  name: 'ColoredText',
  components: {
    EffectIcon
  },
  props: {
    text: {
      type: String,
      required: true
    }
  },
  computed: {
    parsedText() {
      // 解析文本中的颜色标记和效果标记
      // 例如："造成/red{10}点伤害" -> [{ type: 'text', content: '造成' }, { type: 'color', color: 'red', content: '10' }, { type: 'text', content: '点伤害' }]
      // 例如："获得2层/effect{防御}效果" -> [{ type: 'text', content: '获得2层' }, { type: 'effect', effectName: '防御' }, { type: 'text', content: '效果' }]
      const colorRegex = /\/(\w+)\{([^}]+)\}/g;
      const effectRegex = /\/effect\{([^}]+)\}/g;
      const parts = [];
      let lastIndex = 0;
      let match;
      
      // 先处理效果标记
      const effectMatches = [];
      let effectMatch;
      while ((effectMatch = effectRegex.exec(this.text)) !== null) {
        effectMatches.push({
          index: effectMatch.index,
          lastIndex: effectRegex.lastIndex,
          effectName: effectMatch[1]
        });
      }
      
      // 重置正则表达式的lastIndex
      colorRegex.lastIndex = 0;
      
      // 处理颜色标记和效果标记
      let i = 0;
      let j = 0;
      
      while (i < this.text.length || j < effectMatches.length) {
        let nextColorMatch = null;
        let nextEffectMatch = null;
        
        // 获取下一个颜色标记
        if (colorRegex.lastIndex < this.text.length) {
          nextColorMatch = colorRegex.exec(this.text);
          if (!nextColorMatch) {
            colorRegex.lastIndex = this.text.length;
          }
        }
        
        // 获取下一个效果标记
        if (j < effectMatches.length) {
          nextEffectMatch = effectMatches[j];
        }
        
        // 确定下一个要处理的标记
        let nextMatch = null;
        let matchType = null;
        
        if (nextColorMatch && nextEffectMatch) {
          if (nextColorMatch.index < nextEffectMatch.index) {
            nextMatch = nextColorMatch;
            matchType = 'color';
          } else {
            nextMatch = nextEffectMatch;
            matchType = 'effect';
          }
        } else if (nextColorMatch) {
          nextMatch = nextColorMatch;
          matchType = 'color';
        } else if (nextEffectMatch) {
          nextMatch = nextEffectMatch;
          matchType = 'effect';
        }
        
        // 添加匹配前的文本
        if (nextMatch && nextMatch.index > lastIndex) {
          parts.push({
            type: 'text',
            content: this.text.slice(lastIndex, nextMatch.index)
          });
        } else if (!nextMatch && lastIndex < this.text.length) {
          parts.push({
            type: 'text',
            content: this.text.slice(lastIndex)
          });
        }
        
        // 处理匹配到的标记
        if (nextMatch) {
          if (matchType === 'color') {
            // 添加颜色标记部分
            parts.push({
              type: 'color',
              color: nextMatch[1],
              content: nextMatch[2]
            });
            lastIndex = colorRegex.lastIndex;
          } else if (matchType === 'effect') {
            // 添加效果标记部分
            parts.push({
              type: 'effect',
              effectName: nextMatch.effectName
            });
            lastIndex = nextMatch.lastIndex;
            j++;
          }
        } else {
          break;
        }
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