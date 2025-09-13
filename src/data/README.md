# 数据类和管理器使用说明

## 目录结构

- `skill.js`: 技能抽象类
- `effect.js`: 效果抽象类
- `enemy.js`: 敌人抽象类
- `skillManager.js`: 技能管理器
- `enemyFactory.js`: 敌人工厂类
- `skills/`: 具体技能实现
- `effects/`: 具体效果实现
- `enemies/`: 具体敌人实现

## 使用方法

### 技能

1. 创建新技能：继承`Skill`类并实现具体逻辑
2. 使用技能管理器，在技能管理器中注册技能，则此技能会在游戏中出现：
   ```javascript
   import SkillManager from './skillManager.js';
   const skillManager = SkillManager.getInstance();
   skillManager.registerSkill(PunchAndKick);
   ```

### 效果

简化后的效果系统使用名称->层数的字典来表示所有effect，不再需要创建具体的Effect子类。

1. 直接在Player或Enemy对象中添加/移除效果：
   ```javascript
   // 添加效果
   player.addEffect('坚固', 2); // 添加2层坚固效果
   
   // 获取效果层数
   const defenseStacks = player.effects['坚固'] || 0;
   
   // 移除效果
   player.removeEffect('坚固', 1); // 移除1层坚固效果
   ```
   
2. 状态修正型效果（如防御、力量等）通过在Player和Enemy对象中创建getter实现，无需手动处理。

### 敌人

1. 创建新敌人：继承`Enemy`类并实现具体逻辑
2. 使用敌人工厂：
   ```javascript
   import EnemyFactory from './enemyFactory.js';
   
   const enemy = EnemyFactory.generateRandomEnemy(1, false); // 普通敌人
   const boss = EnemyFactory.generateRandomEnemy(5, true); // Boss敌人
   ```