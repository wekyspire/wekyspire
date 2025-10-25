<template>
  <div class="player-stats">
    <div class="stat">
      <span class="stat-label">💰 金钱:</span>
      <span class="stat-value">{{ player.money }}</span>
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
import { getPlayerTierLabel } from '../../utils/tierUtils.js';
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'PlayerBasicStats',
  props: {
    player: {
      type: Object,
      required: true
    },
    showMana: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {
      previousPlayer: {
        defense: this.player.defense,
        money: this.player.money,
        tier: this.player.tier,

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
      frontendEventBus.emit('spawn-particles', particles);
    },

    // 触发数值栏目的缩放动画（类似层数变化的“跳动”效果）
    triggerStatBump(statElement) {
      if (!statElement) return;
      // 重启动画
      statElement.classList.remove('stat-bump');
      // 强制回流以重新应用动画
      // eslint-disable-next-line no-unused-expressions
      statElement.offsetWidth;
      statElement.classList.add('stat-bump');
      // 动画结束后清理类，便于下次再次触发
      const handler = () => {
        statElement.classList.remove('stat-bump');
        statElement.removeEventListener('animationend', handler);
      };
      statElement.addEventListener('animationend', handler);
    }
  },
  
  watch: {
    // 监听玩家属性变化
    player: {
      handler(newPlayer) {
        if (newPlayer.money !== this.previousPlayer.money) {
          const diff = newPlayer.money - this.previousPlayer.money;
          const moneyStat = this.$el.querySelector('.stat:nth-child(1)');
          if (moneyStat) {
            const text = diff > 0 ? `+${diff}💰` : `${diff}💰`;
            this.spawnTextParticle(text, moneyStat, diff > 0 ? '#4caf50' : '#f44336');
            this.triggerStatBump(moneyStat);
          }
        }
        
        // 检查防御力变化
        if (newPlayer.defense !== this.previousPlayer.defense) {
          const diff = newPlayer.defense - this.previousPlayer.defense;
          const defenseStat = this.$el.querySelector('.stat:nth-child(3)');
          if (defenseStat) {
            const text = diff > 0 ? `+${diff}🛡️` : `${diff}🛡️`;
            this.spawnTextParticle(text, defenseStat, diff > 0 ? '#9c27b0' : '#f44336');
            this.triggerStatBump(defenseStat);
          }
        }
        
        // 检查灵能变化
        if (newPlayer.magic !== this.previousPlayer.magic) {
          const diff = newPlayer.magic - this.previousPlayer.magic;
          const magicStat = this.$el.querySelector('.stat:nth-child(2)');
          if (magicStat && diff !== 0) {
            const text = diff > 0 ? `+${diff}🔮` : `${diff}🔮`;
            this.spawnTextParticle(text, magicStat, diff > 0 ? '#2196f3' : '#f44336');
            this.triggerStatBump(magicStat);
          }
        }

        // 检查等阶变化
        if (newPlayer.tier !== this.previousPlayer.tier) {
          const tierStat = this.$el.querySelector('.stat:nth-child(4)');
          if (tierStat) {
            const newTierLabel = this.getPlayerTierLabel(newPlayer.tier);
            this.spawnTextParticle(`🏅 ${newTierLabel}`, tierStat, '#ffd700');
            this.triggerStatBump(tierStat);
          }
        }
        
        // 更新previousPlayer
        this.previousPlayer = {
          defense: newPlayer.defense,
          money: newPlayer.money,
          tier: newPlayer.tier,

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
  /* 在动画期间更平滑 */
  will-change: transform;
}

.stat-label {
  font-weight: bold;
  margin-right: 5px;
}

/* 使用全局的 .stat-bump 动画（见 src/assets/common.css） */
</style>