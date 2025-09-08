<template>
  <div class="player-stats">
    <div class="stat">
      <span class="stat-label">💰 金钱:</span>
      <span class="stat-value">{{ player.money }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">💧 魏启:</span>
      <span class="stat-value">{{ player.mana }}/{{ player.maxMana }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">🔮 灵能:</span>
      <span class="stat-value">{{ player.magic }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">🛡️ 防御:</span>
      <span class="stat-value">{{ player.defense }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">🏅 等阶:</span>
      <span class="stat-value">{{ getPlayerTierLabel(player.tier) }}</span>
    </div>
  </div>
</template>

<script>
import { getPlayerTierLabel } from '../utils/tierUtils.js';
import eventBus from '../eventBus.js';

export default {
  name: 'PlayerBasicStats',
  props: {
    player: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      previousPlayer: {
        attack: this.player.attack,
        defense: this.player.defense,
        money: this.player.money,
        tier: this.player.tier,
        mana: this.player.mana,
        magic: this.player.magic
      }
    };
  },
  methods: {
    getPlayerTierLabel,
    
    // 生成浮动文字粒子
    spawnTextParticle(text, statElement, color = '#ffffff') {
      // console.log(text);
      const rect = statElement.getBoundingClientRect();
      // console.log(rect.top);
      const particles = [{
        x: rect.left + rect.width / 2,
        y: rect.top,
        vx: (Math.random() - 0.5) * 0.5, // 轻微的水平随机偏移
        vy: -80, // 向上漂浮
        // color: color,
        size: 14,
        life: 2000,
        gravity: 0, // 无重力
        fade: true,
        text: text,
        extraStyles: {
          color: color,
          fontWeight: 'bold',
          width: 'auto',
          fontSize: '20px'
        }
      }];
      
      // 通过事件总线发送粒子生成请求
      eventBus.emit('spawn-particles', particles);
    }
  },
  
  watch: {
    // 监听玩家属性变化
    player: {
      handler(newPlayer, oldPlayerVue) {
        if (newPlayer.money !== this.previousPlayer.money) {
          const diff = newPlayer.money - this.previousPlayer.money;
          const moneyStat = this.$el.querySelector('.stat:nth-child(1)');
          if (moneyStat) {
            const text = diff > 0 ? `+${diff}💰` : `${diff}💰`;
            this.spawnTextParticle(text, moneyStat, diff > 0 ? '#4caf50' : '#f44336');
          }
        }
        
        // 检查魏启变化
        if (newPlayer.mana !== this.previousPlayer.mana) {
          const diff = newPlayer.mana - this.previousPlayer.mana;
          const manaStat = this.$el.querySelector('.stat:nth-child(2)');
          if (manaStat && diff !== 0) {
            const text = diff > 0 ? `+${diff}💧` : `${diff}💧`;
            this.spawnTextParticle(text, manaStat, diff > 0 ? '#2196f3' : '#f44336');
          }
        }
        
        // 检查攻击力变化
        if (newPlayer.attack !== this.previousPlayer.attack) {
          const diff = newPlayer.attack - this.previousPlayer.attack;
          const attackStat = this.$el.querySelector('.stat:nth-child(3)');
          if (attackStat) {
            const text = diff > 0 ? `+${diff}⚔️` : `${diff}⚔️`;
            this.spawnTextParticle(text, attackStat, diff > 0 ? '#ff9800' : '#f44336');
          }
        }
        
        // 检查防御力变化
        if (newPlayer.defense !== this.previousPlayer.defense) {
          const diff = newPlayer.defense - this.previousPlayer.defense;
          const defenseStat = this.$el.querySelector('.stat:nth-child(4)');
          if (defenseStat) {
            const text = diff > 0 ? `+${diff}🛡️` : `${diff}🛡️`;
            this.spawnTextParticle(text, defenseStat, diff > 0 ? '#9c27b0' : '#f44336');
          }
        }
        
        // 检查灵能变化
        if (newPlayer.magic !== this.previousPlayer.magic) {
          const diff = newPlayer.magic - this.previousPlayer.magic;
          const magicStat = this.$el.querySelector('.stat:nth-child(5)');
          if (magicStat && diff !== 0) {
            const text = diff > 0 ? `+${diff}🔮` : `${diff}🔮`;
            this.spawnTextParticle(text, magicStat, diff > 0 ? '#2196f3' : '#f44336');
          }
        }

        // 检查等阶变化
        if (newPlayer.tier !== this.previousPlayer.tier) {
          const tierStat = this.$el.querySelector('.stat:nth-child(6)');
          if (tierStat) {
            const newTierLabel = this.getPlayerTierLabel(newPlayer.tier);
            this.spawnTextParticle(`🏅 ${newTierLabel}`, tierStat, '#ffd700');
          }
        }
        
        // 更新previousPlayer
        this.previousPlayer = {
          attack: newPlayer.attack,
          defense: newPlayer.defense,
          money: newPlayer.money,
          tier: newPlayer.tier,
          mana: newPlayer.mana,
          magic: newPlayer.magic
        };
      },
      deep: true
    }
  }
};
</script>

<style scoped>
.player-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  align-items: center;
  margin-right: 15px;
}

.stat-label {
  font-weight: bold;
  margin-right: 5px;
}
</style>