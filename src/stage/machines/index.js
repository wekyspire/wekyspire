// 房间机器模块注册表：RoomStage 只做通用舞台机制（相机/浮标/面板停靠/拾取主干/状态栏），
// 不认识任何具体机器——**加新机器 = 加一个模块文件 + 在这里登记一行**。
// 数组顺序 = 义务门/点击吞没的优先级（老虎机的恶魔 roll 最优先，与重构前 _activate/_pendingRoomDuty 的顺序一致）。
import { createSlotMachine } from './slotMachine.js';
import { createVendingMachine } from './vendingMachine.js';
import { createBankMachine } from './bankMachine.js';
import { createCampTrainingMachine } from './campTraining.js';

export const MACHINE_FACTORIES = [
  createSlotMachine,       // 老虎机（+ 恶魔 roll 演出 + 离房安慰奖）
  createVendingMachine,    // 售货机（商店房；含溢出柜动态生成）
  createBankMachine,       // 银行机
  createCampTrainingMachine, // 合并房陈设（篝火/训练桩，无 rig 的样板）
];
