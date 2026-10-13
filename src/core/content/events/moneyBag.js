// 事件：钱袋（占位内容，等美术）。
// 三种抉择都是"拿走多少 / 翻找的赌"——效果由本文件**主动施加**（gainMoney/damagePlayer），
// 返回值只有叙事页。翻找用 run.rng 做确定性赌博（同种子同结果）。
import { registerEvent } from '../../events/registry.js';
import { gainMoney, damagePlayer } from '../../run/runEffects.js';

registerEvent({
  id: 'moneyBag',
  name: '钱袋',
  art: 'moneyBag',
  pages: [
    { speaker: '旁白', text: '地砖缝里卡着一只鼓鼓的钱袋。' },
    { speaker: '旁白', text: '或许是从前的旅人留在此处的东西。' },
  ],
  choices: () => [
    { id: 'takeAll', label: '收进腰包！', hint: '获得 15 金币' },
    { id: 'search', label: '先在四周翻一翻吧', hint: '随机事件' },
    { id: 'leave', label: '不予理睬', hint: '' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'search') {
      // 确定性赌博：run.rng（同种子同结果）
      if (run.rng.next() < 0.5) {
        gainMoney(ctx, 10, { source: '钱袋 · 四周翻找' });
        return { pages: [{ speaker: '旁白', text: '（袋口还塞着几枚零钱，今天的手气不错，获得 10 金币。）' }] };
      }
      const lost = damagePlayer(ctx, 5, { source: '钱袋 · 铁牌' });
      return { pages: [{ speaker: '旁白', text: `（你碰倒了倚在墙上的铁皮，砸了个正着，损失 ${lost} 生命。）` }] };
    }
    if (choiceId === 'leave') {
      return { pages: [{ speaker: '旁白', text: '（你走远了。）' }] };
    }
    gainMoney(ctx, 15, { source: '钱袋' });
    return { pages: [{ speaker: '旁白', text: '（沉甸甸的钱袋正好合手。）' }] };
  },
});
