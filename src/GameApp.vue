<template>
  <div id="app">
    <!-- 开始游戏界面 -->
    <StartScreen 
      v-if="gameState === 'start'" 
      @start-game="startGame"
    />
    
    <!-- 战斗界面 -->
    <BattleScreen 
      v-if="gameState === 'battle'"
      :player="player"
      :enemy="enemy"
      :battle-logs="battleLogs"
      @use-skill="useSkill"
      @end-turn="endPlayerTurn"
    />
    <!-- 休整界面 -->
    <RestScreen 
      v-if="gameState === 'rest'"
      :player="player"
      :rewards="rewards"
      :shop-items="shopItems"
      :should-prompt-tier="this.enemy && this.enemy.isBoss"
      @claim-money="claimMoney"
      @show-skill-rewards="showSkillRewards"
      @show-ability-rewards="showAbilityRewards"
      @buy-item="buyItem"
      @end-rest="endRest"
    />
    
    <AbilityRewardPanel
      :is-visible="isAbilityRewardVisible"
      :abilities="abilityRewards"
      @select-ability="claimAbility"
      @close="closeAbilityRewards"
    />
    
    <SkillRewardPanel
      :is-visible="isSkillRewardVisible"
      :skills="skillRewards"
      @select-skill="onSelectSkillForSlot"
      @close="closeSkillRewards"
    />
    
    <SkillSlotSelectionPanel
      :is-visible="isSkillSlotSelectionVisible"
      :skill="selectedSkillForSlot"
      :skill-slots="player.skillSlots"
      @select-slot="installSkillToSlot"
      @close="closeSkillSlotSelection"
    />
    
    <!-- 结束界面 -->
    <EndScreen 
      v-if="gameState === 'end'" 
      :is-victory="isVictory"
      @restart-game="restartGame"
    />
    
    <!-- 对话界面 -->
    <DialogScreen />
  </div>
</template>

<script>
import StartScreen from './components/StartScreen.vue'
import BattleScreen from './components/BattleScreen.vue'
import RestScreen from './components/RestScreen.vue'
import EndScreen from './components/EndScreen.vue'
import DialogScreen from './components/DialogScreen.vue'
import EnemyFactory from './data/enemyFactory.js'
import SkillManager from './data/skillManager.js'
import AbilityManager from './data/abilityManager.js'
import ItemManager from './data/itemManager.js'
import { processStartOfTurnEffects, processEndOfTurnEffects, processSkillActivationEffects, processDamageTakenEffects, processDamageDealtEffects, processPostAttackEffects } from './utils/effectProcessor.js'
import AbilityRewardPanel from './components/AbilityRewardPanel.vue'
import SkillRewardPanel from './components/SkillRewardPanel.vue'
import SkillSlotSelectionPanel from './components/SkillSlotSelectionPanel.vue'
import eventBus from './eventBus.js'
import * as dialogues from './data/dialogues.js'

// 从任意地方增添battleLog
export function addBattleLog (log) {
  eventBus.emit('add-battle-log', log);
}

// 任意攻击的结算逻辑（由skill和enemy调用）
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function launchAttack (attacker, target, damage) {
  
  // 攻击者对攻击的后处理
  let finalDamage = damage;
  if (attacker) {
    finalDamage = processPostAttackEffects(attacker, target, damage);
  }
  // 处理受到伤害时的效果
  finalDamage = processDamageTakenEffects(target, finalDamage);
  // 固定防御减免
  finalDamage = Math.max(finalDamage - target.defense, 0);
  const passThoughDamage = finalDamage;
  let hpDamage = 0;
  
  if (finalDamage > 0) {
    // 优先伤害护盾（如果有）
    const shieldDamage = Math.min(target.shield, finalDamage);
    target.shield -= shieldDamage;
    finalDamage -= shieldDamage;
    hpDamage = finalDamage;
    target.hp -= finalDamage;
    if(finalDamage > 0) {
      eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，造成 /red{${finalDamage}} 点伤害！`);
    } else {
      eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，被护盾拦下了！`);
    }
  } else {
    eventBus.emit('add-battle-log', `${attacker ? attacker.name : '未知'} 攻击了 ${target.name}，但不起作用！`);
  }
  
  // 检查目标是否死亡
  if (target.hp <= 0) {
    eventBus.emit('add-battle-log', `${target.name} 被击败了！`);
    return {dead: true, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
  }
  
  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
  
  return {dead: false, passThoughDamage: passThoughDamage, hpDamage: hpDamage};
}

export function upgradePlayerTier (player) {
  const tierUpgrades = { 0: 2, 2: 3, 3: 5, 5: 7, 7: 8, 8: 9 };
  if (tierUpgrades[player.tier] !== undefined) {
    player.tier = tierUpgrades[player.tier];
    player.maxActionPoints += 1;
    player.maxMana += 1;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    eventBus.emit('player-tier-upgraded', player);
    return true;
  }
  return false;
}

export function getPlayerTierFromTierIndex(tierIndex) {
  const tiers = [
    {tier: 0, name: '见习灵御'},
    {tier: 2, name: '普通灵御'},
    {tier: 3, name: '准高级灵御'},
    {tier: 5, name: '高级灵御'},
    {tier: 7, name: '准大师灵御'},
    {tier: 8, name: '大师灵御'},
    {tier: 9, name: '传奇灵御'}
  ];
  return tiers[tierIndex];
}

// 造成伤害的结算逻辑（由skill和enemy调用），和发动攻击不同，跳过攻击方攻击发动结算。
// @return {dead: target是否死亡, passThoughDamage: 真实造成的对护盾和生命的伤害总和, hpDamage: 对生命造成的伤害}
export function dealDamage (attacker, target, damage) {
  return launchAttack(null, target, damage);
}

// 任意获得护盾的结算逻辑
export function gainShield (caster, target, shield) {
  target.shield += shield;
  if(caster === target) {
    eventBus.emit('add-battle-log', `${target.name}获得了${shield}点护盾！`);
  } else {
    eventBus.emit('add-battle-log', `${target.name}从${caster.name}获得了${shield}点护盾！`);
  }
  // 更新技能描述（因为玩家状态可能已改变）
  eventBus.emit('update-skill-descriptions');
}

export default {
  name: 'App',
  components: {
    StartScreen,
    BattleScreen,
    RestScreen,
    EndScreen,
    DialogScreen,
    AbilityRewardPanel,
    SkillRewardPanel,
    SkillSlotSelectionPanel
  },
  data() {
      return {
        gameState: 'start', // 'start', 'battle', 'rest', 'end'
        // 移除了对话相关数据属性，现在通过事件总线处理
        isVictory: false,
        
        // 回合控制
        isEnemyTurn: false,
        
        // 玩家数据
        player: {
          name: "你",
          hp: 40,
          shield: 0,
          maxHp: 40,
          mana: 0,
          maxMana: 0,
          actionPoints: 3,
          maxActionPoints: 3,
          baseAttack: 3,
          baseMagic: 1,
          baseDefense: 0,
          money: 0,
          tier: 0, // 等阶
          skillSlots: [], // 技能槽，玩家可以在技能槽内保存技能。战斗开始时，从技能槽中保存的技能创建skills。
          skills: [], // skills仅在战斗时有效，用于存储当前战斗中玩家拥有的技能。在战斗开始前由skillSlots生成，在战斗结束后清空。
          effects: {}, // 合并effects到player对象中
          // SkillManager仅用于创建技能和保留技能模板，玩家拥有的技能保存在skillSlots内。
          skillManager: SkillManager.getInstance(),
          
          // 初始化时添加回调函数
          init() {
            // 初始化技能槽
            this.skillSlots = Array(5).fill(null);
          },
          // 应用治疗
          applyHeal(heal) {
            if (heal > 0) {
              this.hp += heal;
              this.hp = Math.min(this.hp, this.maxHp);
            }
          },
          // 计算属性
          get attack() {
            return this.baseAttack + (this.effects['力量'] || 0);
          },
          get magic() {
            return this.baseMagic + (this.effects['集中'] || 0);
          },
          get defense() {
            return this.baseDefense + (this.effects['坚固'] || 0);
          },

          // 随机移除stacks层效果
          removeEffects(stacks) {
            const effectNames = Object.keys(this.effects);
            for (let i = 0; i < stacks; i++) {
              if (effectNames.length === 0) break;
              const randomIndex = Math.floor(Math.random() * effectNames.length);
              const effectName = effectNames[randomIndex];
              this.removeEffect(effectName, 1);
              // 如果效果层数为0，移除效果名称
              if (!this.effects[effectName]) {
                effectNames.splice(randomIndex, 1);
              }
            }
          },

          // 随机移除负面效果
          // mode: 'random' 随机移除, 'highest-stack' 优先层数最高的
          // 'highest-stack-kind' 种类移除，优先层数最高种类
          // 'ramdom-kind' 种类移除，随机种类
          removeNegativeEffets(count, mode = 'random') {
            // TODO
          },
          
          // 添加效果方法
          addEffect(effectName, stacks = 1) {
            if(stacks == 0) return ;
            const previousStacks = this.effects[effectName] || 0;
            if (this.effects[effectName]) {
              this.effects[effectName] += stacks;
            } else {
              this.effects[effectName] = stacks;
            }
            if(this.effects[effectName] == 0) {
              delete this.effects[effectName];
            }
            // 触发效果变化事件
            eventBus.emit('effectChange', {
              target: 'player',
              effectName: effectName,
              deltaStacks: stacks,
              currStacks: this.effects[effectName] || 0,
              previosStacks: previousStacks
            });
          },
          
          // 移除效果方法
          removeEffect(effectName, stacks = 1) {
            this.addEffect(effectName, -stacks);
          },

          clearNegativeEffects () {
            // TODO
          }
        },
        
        // 敌人数据
        enemy: {
          // 初始为空，因为敌人数据在战斗开始时才会被设置（Enemy类）
        },
        
        // 战斗日志
        battleLogs: [],
        
        // 奖励数据
        rewards: {
          money: 0,
          skill: false,
          ability: false
        },
        
        // 奖励领取标志
        skillRewardClaimed: false,
        abilityRewardClaimed: false,
        

        
        // 战斗场次数
        battleCount: 0,
        
        // 能力奖励相关
        isAbilityRewardVisible: false,
        abilityRewards: [],
        
        // 技能奖励相关
    isSkillRewardVisible: false,
    skillRewards: [],
    
    // 技能槽选择相关
    isSkillSlotSelectionVisible: false,
    selectedSkillForSlot: null,
        
        // 能力管理器实例
        abilityManager: new AbilityManager(),
        // 商品管理器实例
        itemManager: new ItemManager()
      }
    },
  mounted() {
    // 初始化玩家效果管理器
    this.player.init();
    this.eventBus = eventBus;
    // 监听add-battle-log
    this.eventBus.on('add-battle-log', (value) => {
      this.battleLogs.push(value);
    });
    // 有时，外部会更新技能描述并发射更新事件，需要监听此事件并更新UI
    this.eventBus.on('update-skill-descriptions', () => {
        this.updateSkillDescriptions();
    });
    // 注册对话对事件总线的监听
    dialogues.registerListeners(eventBus);
    // 监听对话结束事件
    this.eventBus.on('dialog-ended', () => {
      // 如果是开场事件，开始战斗
      if (this.gameState === 'battle' && this.battleCount === 0) {
        this.startBattle();
      }
    });
  },
  beforeUnmount() {
    if(this.eventBus) {
      this.eventBus.off('add-battle-log');
      this.eventBus.off('update-skill-descriptions');
      dialogues.unregisterListeners(eventBus);
    }
  },
  computed: {
    shopItems() {
      // 使用商品管理器生成商店商品实例
      const items = this.itemManager.getRandomItems(3, this.player.tier);
      // 直接返回商品实例，不需要转换格式
      return items;
    }
  },
  methods: {
    // 更新所有技能的描述
    updateSkillDescriptions() {
      this.player.skills.forEach(skill => {
        if (typeof skill.regenerateDescription === 'function') {
          // 重新生成描述，传入玩家对象
          skill.description = skill.regenerateDescription(this.player);
        }
      });
    },
    
    startGame() {
      // 触发开场事件
      eventBus.emit('before-game-start');
      
      // 为玩家添加初始技能到第一个技能槽
      const initialSkill = this.player.skillManager.constructor.createSkill('拳打脚踢');
      this.player.skillSlots[0] = initialSkill;
      
      this.gameState = 'battle';
      // 注意：不在这里调用startBattle()，而是在对话结束后调用
    },
    
    startBattle() {
      this.battleCount++;
      
      // 生成敌人
      this.generateEnemy();

      // 战前事件
      eventBus.emit('before-battle', {
        battleCount: this.battleCount,
        player: this.player,
        enemy: this.enemy
      });
      
      // 从技能槽复制技能到战斗技能数组
      this.player.skills = this.player.skillSlots.filter(skill => skill !== null);
      // 赋值skill的inBattleIndex
      this.player.skills.forEach((skill, index) => {
        skill.inBattleIndex = index;
      });

      // 重置玩家回合
      this.player.actionPoints = this.player.maxActionPoints;
      
      // 调用技能的onBattleStart方法
      this.player.skills.forEach(skill => {
        skill.onBattleStart();
      });

      // 更新技能描述
      this.updateSkillDescriptions();
      
      // 添加战斗日志
      this.battleLogs = [`战斗 #${this.battleCount} 开始！`, `遭遇了 ${this.enemy.name}！`];
      
      // 开始游戏主循环
      this.gameState = 'battle';
      this.startPlayerTurn();
    },
    
    startPlayerTurn() {
      
      // 重置行动力
      this.player.actionPoints = this.player.maxActionPoints;
      
      // 进行技能冷却
      this.player.skills.forEach(skill => {
        skill.coldDown();
      });

      // 更新技能描述
      this.updateSkillDescriptions();

      // 回合开始时结算效果
      const isStunned = processStartOfTurnEffects(this.player);
      if (isStunned) {
        this.battleLogs.push('你被眩晕，跳过回合！');
        this.endPlayerTurn();
        return;
      }
      
      // 强制刷新操作面板渲染
      this.$forceUpdate();
      
      // 等待玩家操作
      // 玩家操作通过BattleScreen组件的事件处理
    },
    
    generateEnemy() {
      // 根据战斗场次数生成敌人
      const battleIntensity = this.battleCount;
      
      // 简单实现：在第7、15场战斗时生成Boss
      if (this.battleCount === 7 || this.battleCount === 15) {
        this.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, true);
      } else {
        // 普通敌人
        this.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, false);
      }
      
      // 初始化敌人效果管理器
      this.enemy.init();
    },
    
    // 计算攻击伤害
    calculateAttackDamage(attacker, defender, baseDamage) {
      let damage = Math.max(1, baseDamage - defender.defense);
      // 发动攻击时结算效果
      processDamageDealtEffects(attacker, damage);
      return damage;
    },
    
    useSkill(skill) {
      // 使用技能逻辑
      this.battleLogs.push(`你使用了 /blue{${skill.name}}！`);
      
      // 技能发动时结算效果
      processSkillActivationEffects(this.player);
      
      // 执行技能效果
      const result = skill.use(this.player, this.enemy);
      
      // 消耗行动力和魏启
      this.player.actionPoints -= 1;
      this.player.mana -= skill.manaCost;
      skill.remainingUses -= 1;
      
      // 检查敌人是否死亡（技能可能造成了伤害）
      if (this.enemy.hp <= 0) {
        this.battleLogs.push(`${this.enemy.name} 被击败了！`);
        this.endBattle(true);
        return;
      }
      
      // 更新技能描述（因为玩家状态可能已改变）
      this.updateSkillDescriptions();

      // 强制刷新操作面板渲染
      this.$forceUpdate();

      // 发射事件
      eventBus.emit('after-skill-use', {player: this.player, skill: skill, result: result});
    },
    
    enemyTurn() {
      // 敌人行动逻辑
      this.battleLogs.push(`/red{${this.enemy.name}} 的回合！`);
      
      // 触发敌人回合开始事件，通知BattleScreen组件
      eventBus.emit('enemy-turn-start');
      
      // 回合开始时结算效果
      const isStunned = processStartOfTurnEffects(this.enemy);
      if (isStunned) {
        this.battleLogs.push('敌人被眩晕，跳过回合！');
        setTimeout(() => {
          // 触发敌人回合结束事件，通知BattleScreen组件
          eventBus.emit('enemy-turn-end');
          this.startNextTurn();
        }, 800); // 缩短延迟时间
        return;
      }
    
      // 等待敌人行动完成（包括所有攻击动画）
      this.enemy.act(this.player, this.battleLogs).then(() => {
        // 看看玩家是不是逝了
        const isPlayerDead = this.player.hp <= 0;
        
        if (isPlayerDead) {
          this.endBattle(false);
          return;
        }

        // 结算敌人回合结束效果
        processEndOfTurnEffects(this.enemy);
        
        // 敌人行动结束后开始新回合
        this.startNextTurn();
        
        // 触发敌人行动结束事件，通知BattleScreen组件
        eventBus.emit('enemy-action-end');
        // 触发敌人回合结束事件，通知BattleScreen组件
        eventBus.emit('enemy-turn-end');
      });
    },
    
    endPlayerTurn() {
      // 回合结束时结算效果
      processEndOfTurnEffects(this.player);
      
      // 检查玩家是否死亡
      if (this.player.hp <= 0) {
        this.endBattle(false);
        return;
      }
      
      // 执行敌人回合
      this.enemyTurn();
    },
    
    startNextTurn() {
    
      // 敌人行动逻辑
      // 检查游戏是否结束
      if (this.player.hp <= 0) {
        this.endBattle(false);
        return;
      }
      
      if (this.enemy.hp <= 0) {
        this.endBattle(true);
        return;
      }
      
      this.battleLogs.push(`你的回合！`);
      // 开始新回合
      this.startPlayerTurn();
    },
    
    endBattle(isVictory) {
      // 清空玩家身上的所有效果
      this.player.effects = {};
      // 清空玩家身上的护盾
      this.player.shield = 0;
      // 清空战斗技能数组
      this.player.skills = [];

      // 锁定操作面板
      eventBus.emit('enemy-turn-start');
      
      // 弹出胜利信息
      this.battleLogs.push(isVictory ? "/green{你胜利了！}" : "/red{你失败了！}");

      // 添加延迟，让玩家体验到胜利或失败的感觉
      setTimeout(() => {
        // 解锁操作面板
        eventBus.emit('enemy-turn-end');
        
        // 战斗结束事件
        eventBus.emit('after-battle', {
          battleCount : this.battleCount,
          player: this.player,
          enemy: this.enemy,
          isVictory: isVictory
        });
        
        if (isVictory) {
          // 计算奖励
          this.calculateRewards();
          // 重置奖励领取标志
          this.skillRewardClaimed = false;
          this.abilityRewardClaimed = false;
          this.gameState = 'rest';
          // 特殊：第二场战斗结束时，直接提升玩家等阶，并附赠一点法力
          if(this.battleCount == 2) {
            this.player.maxMana += 1;
            upgradePlayerTier(this.player);
          }
        } else {
          // 玩家失败
          this.isVictory = false;
          this.gameState = 'end';
        }
      }, 1500); // 1.5秒延迟
    },
    
    calculateRewards() {
      // 计算战斗奖励
      this.rewards.money = Math.floor(Math.random() * 20) + 10;
      this.rewards.skill = true;
      
      // boss / 奇数次战斗后获得能力奖励
      this.rewards.ability = (this.battleCount % 2 === 1 || this.enemy.isBoss);
    },
    
    claimMoney() {
      this.player.money += this.rewards.money;
      this.rewards.money = 0;
    },
    
    showAbilityRewards() {
      // 检查能力奖励是否已经被领取过
      if (this.abilityRewardClaimed) {
        return;
      }
      // 显示能力奖励面板
      this.isAbilityRewardVisible = true;
      // 生成随机能力，根据战斗次数计算abundance值
      let abundance = Math.min(1.0, Math.min(this.battleCount * 0.05, 0.5));
      if(this.enemy.isBoss) abundance += 0.5;
      this.abilityRewards = this.abilityManager.getRandomAbilities(3, abundance);
      // 如果是boss战，直接提升灵御等阶。
      if(this.enemy.isBoss) {
        upgradePlayerTier(this.player);
      }
      // 标记能力奖励已显示
      this.abilityRewardClaimed = true;
    },
    
    claimAbility(ability) {
      // 领取能力奖励
      ability.apply(this.player);
      this.rewards.ability = false;
      this.isAbilityRewardVisible = false;
      this.battleLogs.push(`获得了能力：${ability.name}`);
      // 发射玩家领取能力奖励事件
      eventBus.emit('player-claim-ability', { ability: ability });
    },
    
    closeAbilityRewards() {
      // 关闭能力奖励面板
      this.isAbilityRewardVisible = false;
      this.rewards.ability = false;
    },
    
    showSkillRewards() {
      // 检查技能奖励是否已经被领取过
      if (this.skillRewardClaimed) {
        return;
      }
      
      // 显示技能奖励面板
      this.isSkillRewardVisible = true;
      // 生成随机技能，排除玩家已有的技能和同系列的技能
      console.log('Generating skill rewards...');
      this.skillRewards = SkillManager.getRandomSkills(3, this.player.skillSlots, this.player.tier);
      console.log('Generated skill rewards:', this.skillRewards);
      // 标记技能奖励已显示
      this.skillRewardClaimed = true;
    },
    
    // 当玩家在技能奖励面板选择技能时调用
    onSelectSkillForSlot(skill) {
      this.selectedSkillForSlot = skill;
      this.isSkillRewardVisible = false;
      this.isSkillSlotSelectionVisible = true;
    },
    
    // 安装技能到指定技能槽
    installSkillToSlot(slotIndex, skill) {
      // 检查技能是否已存在于技能槽中
      const existingSkillIndex = this.player.skillSlots.findIndex(s => s && s.name === skill.name);
      if (existingSkillIndex !== -1) {
        console.warn('Skill already exists in skill slot:', skill.name);
        // 可以选择不添加重复技能
        // return;
      }
      
      // 移除旧技能（如果存在）
      const oldSkill = this.player.skillSlots[slotIndex];
      // 啥都不用干，扔了就是。
      
      // 安装新技能
      const newSkill = SkillManager.createSkill(skill.name);
      this.player.skillSlots[slotIndex] = newSkill;
      
      this.rewards.skill = false;
      this.isSkillSlotSelectionVisible = false;
      this.battleLogs.push(`获得了技能：${skill.name}`);
      // 发射玩家领取技能奖励事件
      eventBus.emit('player-claim-skill', { skill: skill, slotIndex: slotIndex });
    },
    
    // 关闭技能槽选择面板
    closeSkillSlotSelection() {
      this.isSkillSlotSelectionVisible = false;
      this.selectedSkillForSlot = null;
    },
    
    closeSkillRewards() {
      // 关闭技能奖励面板
      this.isSkillRewardVisible = false;
      this.rewards.skill = false;
    },
    
    // buyItem方法已移至RestScreen.vue组件中实现
    buyItem(item) {
      // 此方法已废弃
    },
    
    endRest() {
      // 检查是否完成第15场战斗
      if (this.battleCount >= 15) {
        this.isVictory = true;
        this.gameState = 'end';
      } else {
        // 开始下一场战斗
        this.gameState = 'battle';
        this.startBattle();
      }
    },
    
    restartGame() {
      // 重置游戏状态
      this.gameState = 'start';
      this.isVictory = false;
      this.battleCount = 0;
      this.player.hp = this.player.maxHp;
      this.player.mana = 0;
      this.player.actionPoints = this.player.maxActionPoints;
      this.player.money = 0;
      this.player.skills = [];
      this.player.effects = {};
      this.player.skillManager = SkillManager.getInstance();
      this.battleLogs = [];
      
      // 注意：不在这里添加初始技能，而是在startGame方法中添加
    },
    
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>