// GM 卡（无敌模式）：开始界面勾选「无敌模式」后，新开局直发一张——流程验证工具。
// 不进任何卡包/奖励池（canSpawnAsReward:false 声明；池过滤按注册表判归属，本卡
// type:normal 会被 packOf 归入基础包——r19 马拉松实测漏出即此路径），唯一发放点在
// runController 建局（gmMode 分支），因此正常游玩永远不会见到它。
import { registerSkill } from '../skills/registry.js';
import { aoeAttack, resolvedDamageText } from './cardKit.js';

// 一拳：0 费群伤 999，固有（开局在手）。无消耗无冷却——每场随便打，速通验证用。
registerSkill({
  id: 'onePunch', name: '一拳', type: 'normal', tier: 'C',
  canSpawnAsReward: false,
  keywords: ['innate'],
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    aoeAttack(sctx, 999);
    return true;
  },
  describe: () => '对所有敌人造成999伤害',
  battleDescribe: (sctx) => `对所有敌人造成${resolvedDamageText(sctx, 999)}伤害`,
});
