// 事件：演武残机（2026-09-14；前身「断剑决斗者」被用户裁决删除——塔是冷清的世界，
// 不该有路边坐着聊天的活人 NPC；机制原样保留，换皮到游戏化时代留下的演武机械上：
// 与售货机/老虎机/银行机同源，都是「会吃金币的塔内设施」，不会说话）。
// 决策轴：**金币换卡牌晋升**（现在事件池里唯一的晋升渠道）+ 生命换金币的赌。
// 晋升目标 = 牌组内随机一张可晋升卡（run.rng 确定性）；无可晋升卡则交易不成立（不扣钱）。
import { registerEvent } from '../../events/registry.js';
import { gainMoney, spendMoney, damagePlayer, upgradeCard } from '../../run/runEffects.js';
import { canPromoteRuntime } from '../../run/promotion.js';
import { getSkillDefinition } from '../../skills/registry.js';

registerEvent({
  id: 'sparringAutomaton',
  name: '演武残机',
  art: 'sparringAutomaton',
  pages: [
    { speaker: '旁白', text: '墙边立着一台演武机械，断了一臂，胸前的投币口锈了一半。它还在原地空练同一套拆招，一遍，又一遍。' },
    { speaker: '旁白', text: '察觉到你靠近，它停下动作，把断臂转向你——摆出一个「请」的演练手势。' },
  ],
  choices: (run) => [
    {
      id: 'repair', label: '喂它 10 金',
      hint: '它陪你拆解招式：随机一张可晋升的卡获得晋升',
      disabled: run.player.money < 10,
    },
    { id: 'spar', label: '跟它过招', hint: '失去 6 生命；赢了撬开储币匣，+20 金' },
    { id: 'leave', label: '让它安静练吧', hint: '破风声一下，又一下' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'repair') {
      const candidates = run.player.deck.filter(c => canPromoteRuntime(c, run));
      if (candidates.length === 0) {
        return { pages: [{ speaker: '旁白', text: '（它静静站了一会儿，没有收你的钱，重新转回去空练——你的路数，它已拆无可拆。）' }] };
      }
      if (!spendMoney(ctx, 10, { source: '演武残机 · 投币' })) {
        return { pages: [{ speaker: '旁白', text: '（你摸了摸钱袋——不够。它等了一会儿，重新转回去空练。）' }] };
      }
      const pick = candidates[Math.floor(run.rng.next() * candidates.length)];
      const before = getSkillDefinition(pick.defId).name;
      // 走 runEffects 原语（改 run + 记流水 + 声明「卡牌升级」变身演出——揭幕后播）
      const rt = upgradeCard(ctx, pick.uniqueID, null, { source: '演武残机 · 投币' });
      const after = getSkillDefinition(rt.defId).name;
      return { pages: [{ speaker: '旁白', text: `（金币落进投币口，齿轮重新咬合。它陪你把那式动作拆了七遍——你的「${before}」豁然贯通，化作「${after}」。然后它退回墙边，继续空练。）` }] };
    }
    if (choiceId === 'spar') {
      const lost = damagePlayer(ctx, 6, { source: '演武残机 · 过招' });
      gainMoney(ctx, 20, { source: '演武残机 · 彩头' });
      return { pages: [{ speaker: '旁白', text: `（断臂快得看不清——你挨了好几下（损失 ${lost} 点生命），但最终撬开了它胸前的储币匣：20 金彩头滚落一地。它退回去继续空练，像什么都没发生。）` }] };
    }
    return { pages: [{ speaker: '旁白', text: '（你放轻脚步走开了。身后，断臂的破风声一下，又一下。）' }] };
  },
});
