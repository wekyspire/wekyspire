import BattleInstruction from '../kernel/BattleInstruction.js';
import { cloneSkillRuntime } from '../state/skillRuntime.js';
import { moveCard } from '../state/battleState.js';
import { enterBattle } from '../skills/helpers.js';
import { getSkillDefinition } from '../skills/registry.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { getRelicDefinition } from '../relics/registry.js';
import { getEnemyDefinition } from '../enemies/registry.js';
import { getAllyDefinition } from '../allies/registry.js';
import { DrawCardsInstruction } from './cards.js';
import { DealDamageInstruction } from './combat.js';

// 战斗根指令：完成 = 战斗结束。子节点固定为 战前 → 回合循环 → 战后。
export class BattleRootInstruction extends BattleInstruction {
  execute() { return true; } // 实体逻辑全在子节点；loop 中本节点不会被执行到
}

// 战前准备：重置玩家战斗字段 → 克隆构筑进牌库并初始化充能 → 洗牌 →
// 注册技能/能力订阅（window:'battle'）→ 能力 onBattleStart → 初始意图 → 初始抽牌
export class PreBattleInstruction extends BattleInstruction {
  execute(ctx) {
    if (this._stage === 0) {
      const { player, battleState, runState } = ctx;

      // 玩家战斗字段重置（hp/money/deck 等 run 级不动）：
      // 魏启为战斗内资源——入战置为上限一半（下取整，battle.md §6），自然恢复走回合开始 +1
      player.shield = 0;
      player.clearEffects();
      player.actionPoints = player.maxActionPoints;
      player.mana = Math.floor(player.maxMana / 2);

      // 构筑牌组：克隆 runtime 进牌库，洗牌后逐卡走"进入战斗"元语（充能初始化 + 常驻订阅）
      battleState.zones.deck = player.deck.map(rt => cloneSkillRuntime(rt));
      battleState.rng.shuffle(battleState.zones.deck);
      for (const skill of battleState.zones.deck) enterBattle(ctx, skill);
      // 固有（named 术语，keywords 'innate'）：游戏开始时在牌库中的固有卡直接入手——
      // 不占初始抽牌位，起手必然见到（鬼抽保险「情况不对」等）。裸 moveCard 静默迁移：
      // 首个 battleStart 快照自然覆盖显示
      for (const skill of [...battleState.zones.deck]) {
        if (getSkillDefinition(skill.defId).keywords?.includes('innate')) {
          moveCard(battleState, skill.uniqueID, 'hand');
        }
      }
      // 能力：onBattleStart + 常驻订阅
      for (const abilityId of player.abilities) {
        const def = getAbilityDefinition(abilityId);
        def.onBattleStart?.(ctx);
        for (const sub of def.subscriptions?.(ctx) ?? []) {
          ctx.kernel.addSubscription({ window: 'battle', ...sub, owner: `ability:${abilityId}` });
        }
      }
      // 遗物：仅挂载装备中的（§6.3），钩子机制同能力
      for (const relicId of player.equippedRelics ?? []) {
        const def = getRelicDefinition(relicId);
        def.onBattleStart?.(ctx);
        for (const sub of def.subscriptions?.(ctx) ?? []) {
          ctx.kernel.addSubscription({ window: 'battle', ...sub, owner: `relic:${relicId}` });
        }
      }

      // 玩家最后攻击目标追踪（瑞米索敌口径：跟随主角最后攻击过的敌人）。
      // POST = 攻击已结算；直接写 battleState 标量（纯记账，非世界变更）。
      ctx.kernel.addSubscription({
        when: DealDamageInstruction,
        phase: 'post',
        filter: (instr, c) => instr.source === c.player && instr.target?.side === 'enemy',
        react: (instr, c) => { c.battleState.lastPlayerTarget = instr.target.uniqueID; },
        owner: 'tracker:lastPlayerTarget',
      });

      // 初始意图预览（getIntention 第二参传 battleState：读场面状态的意图要用）；
      // 盟友（瑞米等）同规则——AIUnit 意图不是敌方专利
      for (const e of battleState.enemies) {
        const def = getEnemyDefinition(e.defId);
        e.intention = def.getIntention ? def.getIntention(e, battleState) : { kinds: ['unknown'] };
      }
      for (const a of battleState.allies) {
        const def = getAllyDefinition(a.defId);
        a.intention = def.getIntention ? def.getIntention(a, battleState) : { kinds: ['unknown'] };
      }

      ctx.presenter?.battleStart?.({ battleState, runState });
      return false;
    }
    if (this._stage === 1) {
      ctx.kernel.submitInstruction(
        new DrawCardsInstruction({ count: ctx.battleState.config.initialDraw }), this);
      return false;
    }
    return true;
  }
}

// 战后清理：清扫结算区残留（终局 abort 杀死结算子树时，正在发动的卡会滞留 pending——
// 费用已付视作已打出，裸 moveCard 落牌库底、不播报）→ 清空玩家战斗内字段（效果/护盾
// 不跨战斗——PreBattle 亦有同款重置，此处清的是战后到下场前的观察窗口，防 run 层
// 读者读到上战残留）→ 注销全部 battle 窗口订阅 → 播报结果。
// 终局时内核 abort 的是 TurnLoop（不是根），本指令因此能正常执行到。
export class PostBattleInstruction extends BattleInstruction {
  execute(ctx) {
    const { battleState } = ctx;
    for (const rt of [...battleState.zones.pending]) {
      moveCard(battleState, rt.uniqueID, 'deck');
    }
    ctx.player.clearEffects();
    ctx.player.shield = 0;
    battleState.result = ctx.kernel.verdict;
    ctx.kernel.clearWindow('battle');
    ctx.presenter?.battleEnd?.({ result: ctx.kernel.verdict });
    return true;
  }
}
