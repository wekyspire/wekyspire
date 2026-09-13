// 银行机（bank）：屏幕文本 + 存/取款面板。逻辑自 RoomStage 原样下沉。
import { createBankMachineRig } from '../scenes/interactive/bankMachineRig.js';
import { buildBankPanel } from '../panels/index.js';

export function createBankMachine(ctx) {
  return {
    kinds: ['bank'],
    createRig: (entry) => createBankMachineRig({ object: entry.object, parts: entry.parts }),
    panel: (name, snap) => buildBankPanel(snap, { sceneChoice: true }),

    /** 银行机屏幕文本：**恒显示储蓄额度**（存款额），不是玩家携带的金币——机器讲的是
     * 账户余额，携带金币在顶端资源行。存款为 0 时也要显示「存款 0」。 */
    sync() {
      const bk = ctx.snap()?.bank;
      const rig = ctx.rigs().get('bank');
      if (!bk || !rig?.setScreen) return;
      rig.setScreen(`存款 ${bk.deposit ?? 0}`);
    },
  };
}
