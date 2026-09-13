// 事件：毒藤温室（2026-09-14，木灵脉镜像教学）。
// 决策轴：生命换体系卡（瘴毒组尝鲜）；火灵脉持有者获得「净化」联动选项——
// 灵脉修为在事件里被看见，是「择维度」决策的事后甜味。
import { registerEvent } from '../../events/registry.js';
import { gainMoney, gainCard, damagePlayer } from '../../run/runEffects.js';

// 瘴毒组 D/C 尝鲜池（种子池同口径：不给卖血卡——0 练度卖血是负收益）
const SPOILS = ['poisonSting', 'miasma', 'rotLeafBlade', 'rootSnare'];

registerEvent({
  id: 'toxicGreenhouse',
  name: '毒藤温室',
  art: 'toxicGreenhouse',
  pages: [
    { speaker: '旁白', text: '这一层的窗棂被藤蔓撑破了。紫黑色的孢子悬浮在空气里，像一场不会落地的雪。' },
    { speaker: '旁白', text: '藤蔓深处结着几枚肥厚的毒菇——塔楼里的瘴毒之物，对懂行的人是宝贝。' },
  ],
  choices: (run) => {
    const list = [
      { id: 'pick', label: '屏息采撷毒菇', hint: '获得一张瘴毒卡；孢子入肺，失去 4 生命' },
    ];
    if ((run.player.leino?.fire ?? 0) >= 1) {
      list.push({ id: 'burn', label: '以火焰净化此地', hint: '火灵脉：烧净藤蔓，拾取遗落的 12 金' });
    }
    list.push({ id: 'leave', label: '绕道离开', hint: '什么都不碰' });
    return list;
  },
  resolve(run, choiceId, ctx) {
    if (choiceId === 'pick') {
      const lost = damagePlayer(ctx, 4, { source: '毒藤温室 · 孢子入肺' });
      const defId = SPOILS[Math.floor(run.rng.next() * SPOILS.length)];
      gainCard(ctx, defId, { source: '毒藤温室 · 毒菇' });
      return { pages: [{ speaker: '旁白', text: `（毒菇入袋的瞬间，孢子呛进肺里——损失 ${lost} 点生命。但你摸到的是货真价实的瘴毒。）` }] };
    }
    if (choiceId === 'burn') {
      gainMoney(ctx, 12, { source: '毒藤温室 · 净化' });
      return { pages: [{ speaker: '旁白', text: '（火焰舔过藤蔓，孢子在高热里噼啪作响。灰烬落定后，你在烧穿的墙缝里摸到一袋钱币。）' }] };
    }
    return { pages: [{ speaker: '旁白', text: '（你屏住呼吸绕了过去。孢子在身后继续飘落，像什么都没发生。）' }] };
  },
});
