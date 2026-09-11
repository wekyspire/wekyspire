import { registerRelic } from '../relics/registry.js';

// 占位遗物（§9 遗物具体设计留坑；内容 0~1 个起步，机制后续替换）

// 战号：战斗开始时获得 1 层力量（镜像 battleFocus 的被动钩子形态）
registerRelic({
  id: 'warHorn', name: '战号',
  description: '战斗开始时获得 1 层力量。',
  onBattleStart(ctx) {
    ctx.player.addEffect('strength', 1);
  },
});

// 山泉壶：战前主动使用一次，回复 5 点生命（prepUse 钩子形态验证）
registerRelic({
  id: 'springFlask', name: '山泉壶',
  description: '战前准备阶段主动使用：回复 5 点生命（每局 1 次）。',
  uses: 1,
  prepUse(run) {
    run.player.hp = Math.min(run.player.maxHp, run.player.hp + 5);
  },
});
