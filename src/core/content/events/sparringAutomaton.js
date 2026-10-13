// 事件：打击机械

import { registerEvent } from '../../events/registry.js';
import { gainMoney, spendMoney, damagePlayer, upgradeCard } from '../../run/runEffects.js';
import { canPromoteRuntime } from '../../run/promotion.js';
import { getSkillDefinition } from '../../skills/registry.js';

registerEvent({
  id: 'sparringAutomaton',
  name: '打击机械',
  art: 'sparringAutomaton',
  pages: [
    { speaker: '旁白', text: '墙边立着一台似乎是训练设施的机械，断了一臂，胸前的投币口锈了一半。' },
    { speaker: '旁白', text: '它在原地空练同一套机械的招式，一遍，又一遍。' },
    { speaker: '旁白', text: '察觉到你靠近，它停下动作，把断臂转向你，似乎在邀请你参与进来。' },
  ],
  choices: (run) => [
    {
      id: 'repair', label: '向投币口投入10金币',
      hint: '随机升级一张卡牌',
      disabled: run.player.money < 10,
    },
    { id: 'spar', label: '很有精神！与我一战！', hint: '失去 6 生命，获得 28 金币' },
    { id: 'leave', label: '让它安静地继续练吧', hint: '' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'repair') {
      const candidates = run.player.deck.filter(c => canPromoteRuntime(c, run));
      if (candidates.length === 0) {
        return { pages: [
          { speaker: '旁白', text: '（它静静站了一会儿，吐出了刚刚从你这儿收下的钱。）' },
          { speaker: '旁白', text: '（你的路数，它已拆无可拆。）' }
        ] };
      }
      if (!spendMoney(ctx, 10, { source: '演武残机：投币' })) {
        return { pages: [{ speaker: '旁白', text: '（你摸了摸干瘪的钱袋）' }] };
      }
      const pick = candidates[Math.floor(run.rng.next() * candidates.length)];
      const before = getSkillDefinition(pick.defId).name;
      // 走 runEffects 原语（改 run + 记流水 + 声明「卡牌升级」变身演出——揭幕后播）
      const rt = upgradeCard(ctx, pick.uniqueID, null, { source: '演武残机 · 投币' });
      const after = getSkillDefinition(rt.defId).name;
      return { pages: [{ speaker: '旁白', text: `（它开始和你过招——「${before}」豁然贯通，化作「${after}」。）` }] };
    }
    if (choiceId === 'spar') {
      const lost = damagePlayer(ctx, 6, { source: '演武残机：过招' });
      gainMoney(ctx, 28, { source: '演武残机：彩头' });
      return { pages: [
        { speaker: '旁白', text: `（你挨了好几下，但最终漂亮地一拳放倒了机械）` },
        { speaker: '旁白', text: `（你撬开了它的储币匣，拿到了金币）` }
      ] };
    }
    return { pages: [{ speaker: '旁白', text: '（你决定不打扰它。）' }] };
  },
});
