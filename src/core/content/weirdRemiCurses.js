// 怪异的瑞米专属诅咒卡（BOSSES_4.md「怪异的瑞米」节）：诅咒输出流的核心压力件。
// 只经它塞入（AddCardInstruction），不入奖励池（Z 阶 + canSpawnAsReward:false 双保险）。
// 诅咒卡不带消耗、不离场：清理只能靠玩家牌组自身的纯化/焚卡手段——打出只是暂时
// 清手（回牌库底还会转回来），费用是清手的通行税。恶意是设计内的例外（消耗）。
//
// 行为全部走卡牌 modifier（def.modifiers 打包，见 quest_prompts/CARD_MODIFIERS.md）：
// 这套卡是 modifier 机制的首个内容消费者，抽到时/回合末/在手禁打等行为一律挂
// modifier，不在 def 上发明平行机制。

import { registerSkill } from '../skills/registry.js';
import { registerCardModifier } from '../skills/cardModifiers.js';
import { DealDamageInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction, DiscardCardInstruction } from '../instructions/cards.js';
import { ConsumeManaInstruction, ConsumeActionPointsInstruction } from '../instructions/resources.js';
import { getEffectDefinition, hasEffect } from '../effects/registry.js';
import { allAliveUnits } from '../state/battleState.js';

const CURSE_BASE = {
  type: 'normal', tier: 'Z',
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
};

// ---- modifier 定义 ----

// 忘却之种：抽到时随机失去一类增益的所有层数（「一类」= 一个效果 id 的全部层数）
registerCardModifier({
  id: 'wrForget', name: '忘却', icon: '🕳️', color: '#9a86c9',
  describe: () => '抽到此卡时：随机失去一类增益的所有层数',
  onDraw(mod, sctx, instr) {
    const buffs = sctx.player.effects.filter(e => e.stacks > 0
      && hasEffect(e.effectId) && getEffectDefinition(e.effectId).type === 'buff');
    if (buffs.length === 0) return;
    const pick = buffs[sctx.battleState.rng.int(0, buffs.length - 1)];
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target: sctx.player, effectId: pick.effectId, stacks: -pick.stacks,
    }), instr);
  },
});

// 歪曲之种：抽到时偷吃 1 魏启和 1 AP（资源指令走 clamp，不足吃到 0 为止）
registerCardModifier({
  id: 'wrDistort', name: '歪曲', icon: '🌀', color: '#c986b8',
  describe: () => '抽到此卡时：消耗1魏启和1AP',
  onDraw(mod, sctx, instr) {
    sctx.kernel.submitInstruction(new ConsumeManaInstruction({ amount: 1 }), instr);
    sctx.kernel.submitInstruction(new ConsumeActionPointsInstruction({ amount: 1 }), instr);
  },
});

// 痛楚之种：无法打出（unplayable 旗标）+ 抽到时受 7 伤
registerCardModifier({
  id: 'wrPain', name: '痛楚', icon: '🩸', color: '#c46a6a',
  unplayable: true,
  describe: () => '无法打出。抽到此卡时：受7伤害',
  onDraw(mod, sctx, instr) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: sctx.player, amount: 7, fixed: true, tags: ['wrPain'],
    }), instr);
  },
});

// 缄默之印：此卡在手时无法打出其余牌（自身可打——打出即换所有牌离手）
registerCardModifier({
  id: 'wrMute', name: '缄默', icon: '🤐', color: '#8a9ab0',
  mutesHand: true,
  describe: () => '此卡在手时，无法打出其余牌',
});

// 邪咒之种：回合结束仍在手时，场上所有负面状态转移给你（打出的通行税是它唯一的出口）
registerCardModifier({
  id: 'wrHex', name: '邪咒', icon: '☠️', color: '#7a6ac0',
  describe: () => '此卡回合结束仍在手时：场上所有负面状态转移给你',
  turnEndInHand(mod, sctx, instr) {
    for (const u of allAliveUnits(sctx.battleState, sctx.player)) {
      if (u === sctx.player) continue;
      for (const e of [...u.effects]) {
        if (e.stacks <= 0 || !hasEffect(e.effectId)) continue;
        if (getEffectDefinition(e.effectId).type !== 'debuff') continue;
        sctx.kernel.submitInstruction(new AddEffectInstruction({
          target: u, effectId: e.effectId, stacks: -e.stacks,
        }), instr);
        sctx.kernel.submitInstruction(new AddEffectInstruction({
          target: sctx.player, effectId: e.effectId, stacks: e.stacks,
        }), instr);
      }
    }
  },
});

// ---- 卡定义（行为经 modifiers 打包；打出本身只付通行税）----

// 忘却：3 魏启
registerSkill({
  ...CURSE_BASE,
  id: 'forget', image: 'forget', name: '忘却',
  cost: { mana: 3, actionPoint: 0 },
  modifiers: [{ modId: 'wrForget' }],
  use: () => true,
  describe: () => '抽到此卡时：随机失去一类增益的所有层数',
});

// 歪曲：3 AP
registerSkill({
  ...CURSE_BASE,
  id: 'distort', image: 'distort', name: '歪曲',
  cost: { mana: 0, actionPoint: 3 },
  modifiers: [{ modId: 'wrDistort' }],
  use: () => true,
  describe: () => '抽到此卡时：消耗1魏启和1AP',
});

// 痛楚：无法打出（无费用可付——本来也打不出）
registerSkill({
  ...CURSE_BASE,
  id: 'painCurse', image: 'painCurse', name: '痛楚',
  cost: { mana: 0, actionPoint: 0 },
  modifiers: [{ modId: 'wrPain' }],
  use: () => true,
  describe: () => '无法打出。抽到此卡时：受7伤害',
});

// 缄默：1AP，换所有牌（弃其余手牌 + 等量补抽——弃牌走指令，灵活等弃牌联动照常触发）
registerSkill({
  ...CURSE_BASE,
  id: 'hush', image: 'hush', name: '缄默',
  cost: { mana: 0, actionPoint: 1 },
  modifiers: [{ modId: 'wrMute' }],
  use(sctx) {
    const others = sctx.battleState.zones.hand
      .filter(c => c.uniqueID !== sctx.self.uniqueID);
    for (const c of others) {
      sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID: c.uniqueID }));
    }
    if (others.length > 0) {
      sctx.kernel.submitInstruction(new DrawCardsInstruction({ count: others.length, reason: 'swap' }));
    }
    return true;
  },
  describe: () => '换所有牌。此卡在手时，无法打出其余牌',
});

// 邪咒：1AP（打出只付通行税——避免回合末转移的唯一出口）
registerSkill({
  ...CURSE_BASE,
  id: 'evilHex', image: 'evilHex', name: '邪咒',
  cost: { mana: 0, actionPoint: 1 },
  modifiers: [{ modId: 'wrHex' }],
  use: () => true,
  describe: () => '此卡回合结束仍在手时：场上所有负面状态转移给你',
});

// 恶意：1AP，消耗。受 7 伤抽 3（活页范式：付代价的清障选择——打出即永久离场）
registerSkill({
  ...CURSE_BASE,
  id: 'malice', image: 'malice', name: '恶意',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 1 },
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: sctx.player, amount: 7, fixed: true, tags: ['malice'],
    }));
    sctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 3, reason: 'malice' }));
    return true;
  },
  describe: () => '受7伤害，抽3',
});
