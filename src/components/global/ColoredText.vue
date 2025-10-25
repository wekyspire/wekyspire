<template>
  <span>
    <template v-for="(part, index) in parsedText" :key="index">
      <span v-if="part.type === 'text'" :style="part.style">{{ part.content }}</span>
      <span v-else-if="part.type === 'color'" :class="part.color">{{ part.content }}</span>
      <EffectIcon v-else-if="part.type === 'effect'" :effect-name="part.effectName" />
      <NamedEntity v-else-if="part.type === 'named'" :entity-name="part.content" />
      <CardIcon v-else-if="part.type === 'skill'" :skill-name="part.content" :power-delta="part.powerDelta || 0" />
    </template>
  </span>
</template>

<script>
import EffectIcon from './EffectIcon.vue';
import NamedEntity from './NamedEntity.vue';
import CardIcon from './CardIcon.vue';
import namedEntities from '../../data/namedEntities.js';

export default {
  name: 'ColoredText',
  components: { EffectIcon, NamedEntity, CardIcon },
  props: { text: { type: String, required: true } },
  computed: {
    parsedText() {
      const colorRegex = /\/(\w+)\{([^}]+)\}/g; // 通用颜色（排除 effect/named/skill）
      const effectRegex = /\/effect\{([^}]+)\}/g;
      const namedRegex = /\/named\{([^}]+)\}/g;
      const skillRegex = /\/skill\{([^}]+)\}/g; // 允许后续在内容里追加 +N/-N
      const parts = [];
      let lastIndex = 0;
      const allMatches = [];
      let match;
      while ((match = colorRegex.exec(this.text)) !== null) {
        if (['effect','named','skill'].includes(match[1])) continue;
        allMatches.push({ index: match.index, lastIndex: colorRegex.lastIndex,
          type: 'color', color: match[1], content: match[2] });
      }
      effectRegex.lastIndex = 0;
      while ((match = effectRegex.exec(this.text)) !== null) {
        allMatches.push({ index: match.index, lastIndex: effectRegex.lastIndex, type: 'effect', effectName: match[1] });
      }
      namedRegex.lastIndex = 0;
      while ((match = namedRegex.exec(this.text)) !== null) {
        const entityName = match[1];
        const entity = namedEntities[entityName];
        allMatches.push({ index: match.index, lastIndex: namedRegex.lastIndex,
          type: 'named', content: entityName, icon: entity?.icon || null, color: entity?.color || null });
      }
      skillRegex.lastIndex = 0;
      while ((match = skillRegex.exec(this.text)) !== null) {
        const raw = match[1].trim();
        let skillName = raw;
        let powerDelta = 0;
        // 捕获末尾的 +N 或 -N（不含空格）
        const m2 = raw.match(/^(.*?)([+-]\d+)$/);
        if (m2) {
          skillName = m2[1].trim();
          powerDelta = parseInt(m2[2], 10) || 0;
        }
        allMatches.push({ index: match.index, lastIndex: skillRegex.lastIndex,
          type: 'skill', content: skillName, powerDelta });
      }
      allMatches.sort((a,b) => a.index - b.index);
      for (const cur of allMatches) {
        if (cur.index > lastIndex) parts.push({ type: 'text', content: this.text.slice(lastIndex, cur.index) });
        parts.push(cur);
        lastIndex = cur.lastIndex;
      }
      if (lastIndex < this.text.length) parts.push({ type: 'text', content: this.text.slice(lastIndex) });
      return parts;
    }
  }
}
</script>

<style scoped>
.red { color: #ff4444; }
.blue { color: #4444ff; }
.green { color: #44ff44; }
.purple { color: #ff44ff; }
</style>