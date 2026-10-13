// 事件：泉水。
// 喝/洗/走三选：回复量按最大生命比例动态算（hint 与效果同源，改一处即同变）。
import { registerEvent } from '../../events/registry.js';
import { healPlayer, grantManaBonus } from '../../run/runEffects.js';

const pct = (run, ratio) => Math.max(1, Math.ceil(run.player.maxHp * ratio));

registerEvent({
  id: 'spring',
  name: '泉水',
  art: 'spring',
  pages: [
    { speaker: '旁白', text: '墙根涌出一眼清泉，水面浮着细碎的微光。' },
  ],
  choices: (run) => [
    { id: 'drink', label: '痛饮一番', hint: `回复 ${pct(run, 0.25)} 生命` },
    { id: 'wash', label: '洗把脸，然后接一壶泉水带着', hint: `回复 ${pct(run, 0.08)} 生命，下一场战斗开始时，回复 3 魏启` },
    { id: 'leave', label: '不碰它', hint: '' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'wash') {
      healPlayer(ctx, pct(run, 0.08), { source: '治愈泉：洗脸' });
      grantManaBonus(ctx, 3, { source: '治愈泉：带一壶' });   // 与可乐同一机制（战斗开局兑现即清）
      return { pages: [{ speaker: '旁白', text: '（水冰凉冷冽，你装上满满一壶。）' }] };
    }
    if (choiceId === 'leave') {
      return { pages: [{ speaker: '旁白', text: '（水声在你的背后远去。）' }] };
    }
    const heal = healPlayer(ctx, pct(run, 0.25), { source: '治愈泉' });
    return {
      pages: [{
        speaker: '旁白',
        text: heal > 0 ? `（回复 ${heal} 生命。）` : '（你已经不需要它了。）',
      }],
    };
  },
});
