<template>
  <div class="test-effect-display">
    <h2>效果显示测试</h2>
    
    <div class="test-section">
      <h3>技能描述中的效果引用</h3>
      <div class="skill-card">
        <div class="skill-name">测试技能1</div>
        <div class="skill-description">
          <ColoredText :text="testSkill1.description" />
        </div>
      </div>
      
      <div class="skill-card">
        <div class="skill-name">测试技能2</div>
        <div class="skill-description">
          <ColoredText :text="testSkill2.description" />
        </div>
      </div>
    </div>
    
    <div class="test-section">
      <h3>独立的效果图标</h3>
      <div class="effect-icons">
        <EffectIcon effectName="防御" />
        <EffectIcon effectName="集中" />
        <EffectIcon effectName="力量" />
      </div>
    </div>
    
    <div class="test-section">
      <h3>效果增删测试</h3>
      <div class="effect-test">
        <button @click="addEffect">添加效果</button>
        <button @click="removeEffect">移除效果</button>
        <div class="player-effects">
          <div 
            v-for="(value, key) in player.effects" 
            :key="key" 
            class="effect-icon"
            :style="{ color: getEffectColor(key) }"
          >
            {{ getEffectIcon(key) }}<strong>{{ value }}</strong>
          </div>
        </div>
        <!-- 玩家伤害文本容器 -->
        <div class="damage-text-container" ref="playerDamageTextContainer"></div>
      </div>
    </div>
  </div>
</template>

<script>
import ColoredText from './ColoredText.vue';
import EffectIcon from './EffectIcon.vue';
import testSkills from '../data/testSkill.js';
import effectDescriptions from '../data/effectDescription.js';

export default {
  name: 'TestEffectDisplay',
  components: {
    ColoredText,
    EffectIcon
  },
  data() {
    return {
      testSkill1: testSkills[0],
      testSkill2: testSkills[1],
      player: {
        effects: {}
      }
    };
  },
  methods: {
    addEffect() {
      // 模拟添加效果
      const effectName = '防御';
      const stacks = 1;
      const previousStacks = this.player.effects[effectName] || 0;
      
      if (this.player.effects[effectName]) {
        this.player.effects[effectName] += stacks;
      } else {
        this.player.effects[effectName] = stacks;
      }
      
      // 触发效果变化事件
      this.showEffectChangeText('player', effectName, stacks, previousStacks);
    },
    removeEffect() {
      // 模拟移除效果
      const effectName = '防御';
      const stacks = 1;
      const previousStacks = this.player.effects[effectName] || 0;
      
      if (this.player.effects[effectName]) {
        this.player.effects[effectName] -= stacks;
        if (this.player.effects[effectName] <= 0) {
          delete this.player.effects[effectName];
        }
        
        // 触发效果变化事件
        this.showEffectChangeText('player', effectName, -stacks, previousStacks);
      }
    },
    // 显示效果变化文本
    showEffectChangeText(target, effectName, stacks, previousStacks) {
      // 添加调试日志
      console.log('Effect change:', { target, effectName, stacks, previousStacks });
      
      // 检查参数是否有效
      if (!effectName || isNaN(stacks)) {
        console.error('Invalid effect parameters:', { target, effectName, stacks, previousStacks });
        return;
      }
      
      // 创建效果变化文本元素
      const effectText = document.createElement('div');
      effectText.className = 'effect-change-text';
      
      // 获取效果颜色
      const effectColor = this.getEffectColor(effectName);
      
      // 根据层数变化设置文本内容和样式
      if (stacks > 0) {
        effectText.innerHTML = `获得 <span style="color: ${effectColor}">${effectName}</span> x${stacks}`;
      } else {
        effectText.innerHTML = `失去 <span style="color: #cccccc">${effectName}</span> x${Math.abs(stacks)}`;
      }
      
      // 设置样式
      effectText.style.color = effectColor;
      effectText.style.fontSize = '24px';
      effectText.style.fontWeight = 'bold';
      effectText.style.position = 'absolute';
      effectText.style.zIndex = '1000';
      
      // 将效果变化文本添加到对应的容器中
      if (target === 'player' && this.$refs.playerDamageTextContainer) {
        this.$refs.playerDamageTextContainer.appendChild(effectText);
      }
      
      // 添加动画效果
      effectText.style.opacity = '1';
      effectText.style.transform = 'translateY(0)';
      
      // 一段时间后淡出并移除
      setTimeout(() => {
        effectText.style.transition = 'opacity 1s, transform 1s';
        effectText.style.opacity = '0';
        effectText.style.transform = 'translateY(-50px)';
        
        // 动画结束后移除元素
        setTimeout(() => {
          if (effectText.parentNode) {
            effectText.parentNode.removeChild(effectText);
          }
        }, 1000);
      }, 1000);
    },
    // 获取效果图标
    getEffectIcon(effectName) {
      return effectDescriptions[effectName]?.icon || '❓';
    },
    // 获取效果颜色
    getEffectColor(effectName) {
      return effectDescriptions[effectName]?.color || '#000000';
    }
  }
};
</script>

<style scoped>
.test-effect-display {
  padding: 20px;
}

.test-section {
  margin-bottom: 30px;
}

.skill-name {
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 8px;
}

.skill-description {
  font-size: 14px;
  text-align: center;
}

.effect-icons {
  display: flex;
  gap: 10px;
}
</style>