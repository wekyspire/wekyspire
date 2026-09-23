// GM 卡（调试模式）：开始界面勾选「调试模式」后，新开局直发一张；调试面板也能随时再发。
// 不进任何卡包/奖励池（canSpawnAsReward:false 声明；池过滤按注册表判归属，本卡
// type:normal 会被 packOf 归入基础包——r19 马拉松实测漏出即此路径），唯一发放点在
// runController 建局（debugMode 分支）与调试面板，因此正常游玩永远不会见到它。
import { registerSkill } from '../skills/registry.js';
import { aoeAttack, dealDamage, resolvedDamageText } from './cardKit.js';

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

// 调试重拳：0 费单体固定 50 伤——一拳（999 群伤）是「秒杀尺」，这把是「血刻度尺」：
// 把 Boss 血量精确拨到转段/机制阈值附近观察演出（如 pyro 的 hp<80 转段窗），
// 固定伤害不吃面板/修正流水线，每一下都恰好 -50，拨血可预期。
registerSkill({
  id: 'gmPunch50', name: '调试重拳', type: 'normal', tier: 'C',
  canSpawnAsReward: false,
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    dealDamage(sctx, 50, { fixed: true });
    return true;
  },
  describe: () => '造成50固定伤害',
  battleDescribe: () => '造成50固定伤害',
});
