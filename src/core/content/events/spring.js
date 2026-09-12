// 事件：治愈泉（占位内容，等美术）。
// 喝/洗/走三选：回复量按最大生命比例动态算（hint 与效果同源，改一处即同变）。
import { registerEvent } from '../../events/registry.js';
import { healPlayer, grantManaBonus } from '../../run/runEffects.js';

const pct = (run, ratio) => Math.max(1, Math.ceil(run.player.maxHp * ratio));

registerEvent({
  id: 'spring',
  name: '治愈泉',
  art: 'spring',
  pages: [
    { speaker: '旁白', text: '墙根涌出一眼清泉，水面浮着细碎的微光。' },
    { speaker: '旁白', text: '泉边刻着半行字：“饮者……”——后半句被人磨平了。' },
  ],
  choices: (run) => [
    { id: 'drink', label: '痛饮一番', hint: `回复 ${pct(run, 0.25)} 点生命` },
    { id: 'wash', label: '只洗把脸，接一壶带在身上', hint: `回复 ${pct(run, 0.08)} 点生命，下一场战斗开局多得 1 点魏启` },
    { id: 'leave', label: '不碰它', hint: '（泉水在身后继续流。）' },
  ],
  resolve(run, choiceId, ctx) {
    if (choiceId === 'wash') {
      healPlayer(ctx, pct(run, 0.08), { source: '治愈泉 · 洗把脸' });
      grantManaBonus(ctx, 1, { source: '治愈泉 · 带一壶' });   // 与可乐同一机制（战斗开局兑现即清）
      return { pages: [{ speaker: '旁白', text: '（水是凉的。你把壶塞好——下次开打时，它会在你手边。）' }] };
    }
    if (choiceId === 'leave') {
      return { pages: [{ speaker: '旁白', text: '（你绕开了它。水声在背后慢慢远去。）' }] };
    }
    const heal = healPlayer(ctx, pct(run, 0.25), { source: '治愈泉' });
    return {
      pages: [{
        speaker: '旁白',
        text: heal > 0 ? `（伤口收了口，呼吸顺了——回复 ${heal} 点生命。）` : '（你已经不需要它了。）',
      }],
    };
  },
});
