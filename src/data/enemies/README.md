# 敌人系统说明

敌人系统已重构为注册式架构，允许动态添加新敌人而无需修改核心工厂代码。

## 如何添加新敌人

1. 在`src/data/enemies/`目录下创建新的敌人文件（可参考`basic.js`或`boss.js`）
2. 定义敌人类，继承自`Enemy`基类
3. 实现构造函数和`act`方法
4. 在`enemyFactory.js`中导入新敌人
5. 在EnemyFactory构造函数中调用`this.registerEnemy()`注册新敌人

## 敌人类实现要求

- 必须继承自`Enemy`类
- 构造函数应调用`super(name, baseHp, baseAttack, baseMagic, baseDefense, battleIntensity)`
- 必须实现`act(player, battleLogs)`方法，定义敌人的战斗行为

## 示例

```javascript
// 示例敌人：火史莱姆
import Enemy from '../enemy.js';

class FireSlime extends Enemy {
  constructor(battleIntensity) {
    super('火史莱姆', 30, 8, 2, 1, battleIntensity);
    this.burnDamage = 3;
  }
  
  act(player, battleLogs) {
    // 实现战斗行为
  }
}

export { FireSlime };
```

在enemyFactory.js中注册：

```javascript
import { FireSlime } from './enemies/example.js';

// 在构造函数中
this.registerEnemy('fireSlime', FireSlime);
```