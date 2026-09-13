// 事件：断剑决斗者（2026-09-14）。
// 决策轴：**金币换卡牌晋升**（现在事件池里唯一的晋升渠道）+ 生命换金币的赌。
// 晋升目标 = 牌组内随机一张可晋升卡（run.rng 确定性）；无可晋升卡则交易不成立（不扣钱）。
import { registerEvent } from '../../events/registry.js';
import { gainMoney, spendMoney, damagePlayer } from '../../run/runEffects.js';
import { canPromoteRuntime, promoteCard } from '../../run/promotion.js';
import { getSkillDefinition } from '../../skills/registry.js';

registerEvent({
  id: 'brokenDuelist',
  name: '断剑决斗者',
  art: 'brokenDuelist',
  pages: [
    { speaker: '旁白', text: '一个剑客坐在路中央，膝上横着一柄断成两截的剑。他抬头看你，眼睛亮得吓人。' },
    { speaker: '剑客', text: '「剑断了，人还没断。赶路的人——做个交易吗？」' },
  ],
  choices: (run) => [
    {
      id: 'repair', label: '出 10 金帮他修剑',
      hint: '他为你指点一二：随机一张可晋升的卡获得晋升',
      disabled: run.player.money < 10,
    },
    { id: 'spar', label: '与他过招', hint: '失去 6 生命；赢得漂亮，+20 金' },
    { id: 'leave', label: '不打扰他', hint: '他的路他自己走' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'repair') {
      const candidates = run.player.deck.filter(c => canPromoteRuntime(c, run));
      if (candidates.length === 0) {
        return { pages: [{ speaker: '剑客', text: '「你的路数已经齐了，没什么可指的。」（他摆摆手，没有收你的钱。）' }] };
      }
      if (!spendMoney(ctx, 10, { source: '断剑决斗者 · 修剑' })) {
        return { pages: [{ speaker: '旁白', text: '（你摸了摸钱袋——不够。他看了一眼，就重新闭上了眼睛。）' }] };
      }
      const pick = candidates[Math.floor(run.rng.next() * candidates.length)];
      const before = getSkillDefinition(pick.defId).name;
      promoteCard(run, pick.uniqueID);
      const afterCard = run.player.deck.find(c => c.uniqueID === pick.uniqueID);
      const after = getSkillDefinition(afterCard.defId).name;
      return { pages: [{ speaker: '剑客', text: `「好剑配好人。」他起身，只点拨了你三句话——你的「${before}」豁然贯通，化作「${after}」。` }] };
    }
    if (choiceId === 'spar') {
      const lost = damagePlayer(ctx, 6, { source: '断剑决斗者 · 过招' });
      gainMoney(ctx, 20, { source: '断剑决斗者 · 彩头' });
      return { pages: [{ speaker: '剑客', text: `「痛快！」断剑在他手里快得看不见——你挨了好几下（损失 ${lost} 点生命），但他最后笑着把一袋彩头抛给你：「下次带柄好剑来。」` }] };
    }
    return { pages: [{ speaker: '旁白', text: '（你绕开了他。走出很远，身后传来一声断剑归鞘的轻响。）' }] };
  },
});
