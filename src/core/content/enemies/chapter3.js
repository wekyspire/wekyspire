// 章3 小怪（庄园，23~33 层普通池）。拆分自原 content/enemies.js（2026-09-24，内容零改动）。

import Enemy from '../../state/enemy.js';
import { registerEnemy } from '../../enemies/registry.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../../instructions/combat.js';
import { AddEffectInstruction } from '../../instructions/effects.js';

// ⑥ 石像卫士：高防厚血 + 再生续航——再生3 → 攻 → 盾 循环，考验破防与斩杀线
registerEnemy({
  difficulty: { base: 5, min: 4, max: 9, floorMin: 23, floorMax: 32 }, // 收窄（2026-09-16）：23-44→23-32，章4 血牛由禁书守卫/档案巨像承担
  id: 'gargoyle', name: '石像卫士',
  createUnit: () => new Enemy({ defId: 'gargoyle', name: '石像卫士', maxHp: 34, defense: 2 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase === 0) {
      // 再生递减（2026-09-14 马拉松修复）：首次 3 层，此后每次 -1、最低 1——
      // 原无限「再生3+盾6」循环让输出不足的卡组磨了 26~37 回合（d-free 实测），
      // 净回复收敛后马拉松自然收束；再生依旧，只是「拖得越久回得越少」。
      const times = (actx.unit._regenTimes ?? 0);
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'regen', stacks: Math.max(2, 6 - times), // 数值意识（2026-09-16）：3→6——中期 40-60 输出面前原值是薄纸
      }));
      actx.unit._regenTimes = times + 1;
    } else if (phase === 1) {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    } else {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 10 })); // 数值意识（2026-09-16）：6→10
    }
  },
  getIntention: (unit) => {
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      const next = Math.max(1, 3 - (unit._regenTimes ?? 0));
      return { kinds: ['buff'], note: `自身再生${next}` };
    }
    if (phase === 1) return { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') };
    return { kinds: ['defend'], note: '自身护盾+6' };
  },
});

// ⑧ 岩甲龟：龟缩（盾7 + 荆棘1）→ 重击 循环——盾棘一体的防御压迫，
// 打盾要吃反伤，绕盾要挨重击
registerEnemy({
  difficulty: { base: 4, min: 3, max: 7, floorMin: 23, floorMax: 32 }, // 收窄（2026-09-16）：23-40→23-32
  id: 'rockshell', name: '岩甲龟',
  createUnit: () => new Enemy({ defId: 'rockshell', name: '岩甲龟', maxHp: 30, defense: 1 }),
  act(actx) {
    if (actx.unit.actionIndex % 2 === 0) {
      actx.kernel.submitInstruction(new GainShieldInstruction({ target: actx.unit, amount: 10 })); // 数值意识（2026-09-16）：7→10
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'thorns', stacks: 1,
      }));
      // 缩壳蓄势（2026-09-14 马拉松修复）：双龟阵曾是「无风险马拉松」（32 层两份试玩
      // 死于 15~20+ 回合龟拳磨血）——每次缩壳 +1 蓄势，攻拍 10+atk 随之线性上涨，
      // 拖得越久龟拳越痛，磨盘战有时间账单。
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'focus', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 10 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 2 === 0
    ? { kinds: ['defend', 'buff'], note: '自身护盾7 + 荆棘1 + 蓄势+1' }
    : { kinds: ['attack'], hits: 1, damage: 10 + unit.getStat('attack') }),
});

// ㉑ 贪杯鬼（章3·滚雪球）：喝酒（自愈 5 + 力量 1）×2 → 醉拳 12，三拍循环。
// 拖得越久力量越高，但喝酒拍不输出——「趁它喝酒抢血」的窗口题（暗影刺客是蓄势，
// 贪杯鬼是自愈+力量双轴）。
registerEnemy({
  difficulty: { base: 6, min: 5, max: 9, floorMin: 23, floorMax: 30 }, // 收窄（2026-09-16）：23-36→23-30（醉鬼客厅模板区间）
  id: 'tippler', name: '贪杯鬼',
  createUnit: () => new Enemy({ defId: 'tippler', name: '贪杯鬼', maxHp: 30 }),
  act(actx) {
    const phase = actx.unit.actionIndex % 3;
    if (phase < 2) {
      actx.kernel.submitInstruction(new ApplyHealInstruction({ target: actx.unit, amount: 9 })); // 数值意识（2026-09-16）：5→9
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: actx.unit, effectId: 'strength', stacks: 1,
      }));
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: actx.unit, target: actx.player, amount: 12 + actx.unit.getStat('attack'),
      }));
    }
  },
  getIntention: (unit) => (unit.actionIndex % 3 < 2
    ? { kinds: ['buff'], note: '喝酒：自愈5，力量+1' }
    : { kinds: ['attack'], hits: 1, damage: 12 + unit.getStat('attack'), note: '醉拳' }),
});

// ㉒ 筹算灵（章3·反出牌量；2026-09-20 用户设计稿）——「出牌多就挨打」的记账敌人：
// 每拍固定「记账 → 起盾 → 攻 12」，护盾 = 3 + 你**上一回合**打出的牌数 × 2。
// 它考的不是数值而是节奏：多段小伤引擎（瞬击/碎铁/多段拳）打出的每一张牌都会变成
// 它的甲，出牌越多越打不穿、回合拖得越长越难破——破局只有三条路：压缩出牌量、
// 换大单发穿甲，或在它把账记厚之前结束战斗。放在 23-27 层（章3 庄园段），
// 与贪杯鬼（越拖越强）同为「渐强型」压力位，方向互补：贪杯鬼罚慢，筹算灵罚碎。
// 数值锚点：d=6/7/8 → 78/90/102 血（与贪杯鬼同档），攻击 12 + 面板（F1 同源算式）。
// 护盾不随难度缩放——它的强弱轴是玩家的出牌量，不是楼层。
// 意图预告读 unit._tally（上一回合的实际出牌数，act 时落账）：预告与实际严格同值；
// 首拍尚无台账时回落「本回合已打出数」，随出牌实时爬升，把记账规则当场演示给玩家。
registerEnemy({
  difficulty: { base: 7, min: 6, max: 8, floorMin: 23, floorMax: 27 },
  id: 'tallySpirit', name: '筹算灵',
  createUnit: () => new Enemy({ defId: 'tallySpirit', name: '筹算灵', maxHp: 30 }),
  act(actx) {
    const { unit, battleState: bs } = actx;
    const played = bs.history?.turn?.playedCards?.length ?? 0;
    unit._tally = played; // 台账：本次（刚结束的玩家回合）打出的牌数
    actx.kernel.submitInstruction(new GainShieldInstruction({
      target: unit, amount: 3 + played * 2,
    }));
    actx.kernel.submitInstruction(new DealDamageInstruction({
      source: unit, target: actx.player, amount: 12 + unit.getStat('attack'),
    }));
  },
  getIntention: (unit, bs) => {
    const tally = unit._tally ?? (bs?.history?.turn?.playedCards?.length ?? 0);
    return {
      kinds: ['attack', 'defend'],
      hits: 1,
      damage: 12 + unit.getStat('attack'),
      note: `记账：自身护盾+${3 + tally * 2}（按你上回合打出的 ${tally} 张牌）`,
    };
  },
});

// ㉖ 风狸（章3·御风镜像：等风停）——起风（闪避2）→ 风爪 攻2×3 → 突风 攻8 三拍循环。
// 闪避在它自己回合开始蒸发 1 层：起风后 2→1→0，每第三拍是零闪避的输出窗——玩家的
// 爆发牌要跟它的起风拍错开；单发重击被闪避白吃（垫一发小的再出大的），中毒/燃烧
// 绕过闪避（dot 是天然克制）。嗡嗡虫的章3 上位：那边教「先垫一发」，这边教「算风停」。
registerEnemy({
  difficulty: { base: 6, min: 5, max: 9, floorMin: 23, floorMax: 32 }, // 收窄（2026-09-16）：23-38→23-32
  id: 'windRaccoon', name: '风狸',
  createUnit: () => new Enemy({ defId: 'windRaccoon', name: '风狸', maxHp: 24 }),
  act(actx) {
    const { unit } = actx;
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) {
      actx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'dodge', stacks: 2 }));
    } else if (phase === 1) {
      for (let i = 0; i < 3; i++) {
        actx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: actx.player, amount: 2 + atk }));
      }
    } else {
      actx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: actx.player, amount: 8 + atk }));
    }
  },
  getIntention: (unit) => {
    const atk = unit.getStat('attack');
    const phase = unit.actionIndex % 3;
    if (phase === 0) return { kinds: ['buff'], note: '起风：自身闪避2（免疫攻击；中毒/燃烧可穿）' };
    if (phase === 1) return { kinds: ['attack'], hits: 3, damage: 2 + atk, note: '风爪' };
    return { kinds: ['attack'], hits: 1, damage: 8 + atk, note: '突风' };
  },
});
