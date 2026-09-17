// 事件：风语回廊（2026-09-14，空灵脉镜像教学）。
// 决策轴：生命换体系卡（御风组尝鲜）；空灵脉持有者获得「聆听」联动选项。
import { registerEvent } from '../../events/registry.js';
import { gainMoney, gainCard, damagePlayer } from '../../run/runEffects.js';

// 御风/咏唱组 D/C 尝鲜池（沐风给的是「自动化」的第一块拼图）
const WINDS = ['windBlade', 'lightness', 'bathWind', 'galeCombo', 'listenWind'];

registerEvent({
  id: 'whisperGallery',
  name: '风语回廊',
  art: 'whisperGallery',
  pages: [
    { speaker: '旁白', text: '回廊狭而高，风穿过箭窗时会学人说话——你听见自己的脚步声被提前念了出来。' },
    { speaker: '旁白', text: '风里有细碎的旋涡，推着你的衣角往前。懂风的人，能在这里借一把力。' },
  ],
  choices: (run) => {
    const list = [
      { id: 'borrow', label: '顺风练一趟身法', hint: '获得一张御风卡；迎风呛了几口，失去 3 生命' },
    ];
    if ((run.player.leino?.air ?? 0) >= 1) {
      list.push({ id: 'listen', label: '驻足聆听风语', hint: '空灵脉：风会告诉你钱藏在哪——+18 金' });
    }
    list.push({ id: 'leave', label: '捂住耳朵快步走过', hint: '风在身后念你的背影' });
    return list;
  },
  resolve(run, choiceId, ctx) {
    if (choiceId === 'borrow') {
      const lost = damagePlayer(ctx, 3, { source: '风语回廊 · 迎风' });
      const defId = WINDS[Math.floor(run.rng.next() * WINDS.length)];
      gainCard(ctx, defId, { source: '风语回廊 · 借力' });
      return { pages: [{ speaker: '旁白', text: `（你顺着风势起落，脚步轻快得不像自己——风把一式御风的影子塞进了你的记忆。迎风呛咳几声，损失 ${lost} 点生命。）` }] };
    }
    if (choiceId === 'listen') {
      gainMoney(ctx, 18, { source: '风语回廊 · 风语' });
      return { pages: [{ speaker: '旁白', text: '（风贴着你的耳朵说了三个数字。你在第三块松动的地砖下，摸出了前人藏的钱袋。）' }] };
    }
    return { pages: [{ speaker: '旁白', text: '（你快步走过回廊。风念完了你没听完的半句话，又去等下一个过路人。）' }] };
  },
});
