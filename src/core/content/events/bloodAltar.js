// 事件：血祭祭坛（2026-09-14）。
// 决策轴：**生命上限比例 / 金币 → 遗物**（事件池里唯一的遗物交易点）。
// 血价按最大生命 15% 计（事件不致死，floor 1 兜底）；遗物走统一抽选 SDK（C/B 档）。
import { registerEvent } from '../../events/registry.js';
import { gainRelic, spendMoney, damagePlayer } from '../../run/runEffects.js';
import { draftRelic } from '../../relics/draft.js';
import { getRelicDefinition } from '../../relics/registry.js';

const pct = (run) => Math.max(1, Math.ceil(run.player.maxHp * 0.15));

registerEvent({
  id: 'bloodAltar',
  name: '血祭祭坛',
  art: 'bloodAltar',
  pages: [
    { speaker: '旁白', text: '石阶尽头立着一座黑石祭坛，槽纹里凝着暗红。坛上的铭文只有一句：「以物易物。」' },
    { speaker: '旁白', text: '你感到它在打量你——打量你的血，和你的钱袋。' },
  ],
  choices: (run) => [
    { id: 'blood', label: '献血', hint: `失去 ${pct(run)} 点生命，换一件遗物` },
    {
      id: 'gold', label: '献金',
      hint: '-30 金，换一件遗物',
      disabled: run.player.money < 30,
    },
    { id: 'leave', label: '它不配', hint: '转身下楼' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'blood') {
      const lost = damagePlayer(ctx, pct(run), { source: '血祭祭坛 · 献血' });
      const relicId = draftRelic(run, { rarity: ['C', 'B'] });
      if (relicId) gainRelic(ctx, relicId, { source: '血祭祭坛' });
      const name = relicId ? getRelicDefinition(relicId).name : '什么都没有';
      return { pages: [{ speaker: '旁白', text: `（血顺着槽纹爬满坛面——损失 ${lost} 点生命。石缝里「咔」地吐出一物：${name}。祭坛吃饱后，安静得像块普通的石头。）` }] };
    }
    if (choiceId === 'gold') {
      if (!spendMoney(ctx, 30, { source: '血祭祭坛 · 献金' })) {
        return { pages: [{ speaker: '旁白', text: '（你把钱袋倒过来晃了晃。祭坛沉默着，假装没看见。）' }] };
      }
      const relicId = draftRelic(run, { rarity: ['C', 'B'] });
      if (relicId) gainRelic(ctx, relicId, { source: '血祭祭坛' });
      const name = relicId ? getRelicDefinition(relicId).name : '什么都没有';
      return { pages: [{ speaker: '旁白', text: `（金币在坛面上排成一列，被槽纹一枚枚吞了进去。最后一声脆响后，它吐出了：${name}。）` }] };
    }
    return { pages: [{ speaker: '旁白', text: '（你转身下楼。背后的槽纹似乎亮了一瞬，又暗了下去——它等得起。）' }] };
  },
});
