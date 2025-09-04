# GameApp 事件总线事件文档

本文档记录了在 GameApp.vue 中发射的所有与游戏流程相关的事件总线事件。

## 事件列表

### 1. `before-game-start`
- **触发时机**：游戏开始时，在 `startGame` 方法中触发。
- **用途**：触发开场对话。

### 2. `before-battle`
- **触发时机**：每场战斗开始前，在 `startBattle` 方法中触发。
- **参数**：
  - `battleCount`：战斗场次数
  - `player`：玩家状态
  - `enemy`：敌人状态
- **用途**：触发战前对话。

### 3. `after-battle`
- **触发时机**：每场战斗结束后，在 `endBattle` 方法中触发。
- **参数**：
  - `battleCount`：战斗场次数
  - `player`：玩家状态
  - `enemy`：敌人状态
  - `isVictory`：是否胜利
- **用途**：触发战后对话。

### 4. `player-claim-ability`
- **触发时机**：玩家领取能力奖励后，在 `claimAbility` 方法中触发。
- **参数**：
  - `ability`：获得的能力
- **用途**：通知其他组件玩家获得了新能力。

### 5. `player-claim-skill`
- **触发时机**：玩家领取技能奖励后，在 `installSkillToSlot` 方法中触发。
- **参数**：
  - `skill`：获得的技能
  - `slotIndex`：技能安装的槽位索引
- **用途**：通知其他组件玩家获得了新技能。

## 事件监听

这些事件在 `dialogues.js` 中被监听，用于触发相应的对话序列。

### 新增事件监听

#### `player-claim-skill`
- **监听目的**：在玩家第一次获得可多次充能技能时触发瑞米的教程对话。
- **参数**：
  - `skill`：获得的技能对象