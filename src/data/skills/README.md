# 技能系统说明

## 添加新技能

1. 在`skills/`目录下创建新的技能文件，或在现有文件中添加新技能类
2. 技能类需要继承自`Skill`基类
3. 在`skillManager.js`中导入新技能类
4. 在`SkillManager`构造函数中注册新技能

## 技能类实现要求

- 必须继承自`Skill`基类
- 构造函数中调用`super()`设置基本属性
- 实现`use()`方法定义技能效果
- 可选实现`regenerateDescription()`方法动态生成描述
- 可选重写`canUse()`方法定义使用条件

## 示例

```javascript
import Skill from '../skill.js';

export class ExampleSkill extends Skill {
  constructor() {
    super('技能名称', '技能类型', 技能等阶, '技能描述', 魏启消耗, 最大使用次数, '技能系列名称');
  }

  use(player, enemy) {
    if (super.use()) {
      // 实现技能效果
      return true;
    }
    return false;
  }
}
```