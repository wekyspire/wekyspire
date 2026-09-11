import BattleInstruction from '../kernel/BattleInstruction.js';
import { cloneSkillRuntime } from '../state/skillRuntime.js';
import { moveCard } from '../state/battleState.js';
import { enterBattle } from '../skills/helpers.js';
import { getSkillDefinition } from '../skills/registry.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { getRelicDefinition } from '../relics/registry.js';
import { activeRelics, refreshRunModifiers } from '../run/prep.js';
import { applyPendingDebuffsToBattle } from '../run/rooms/bank.js';
import { AddEffectInstruction } from './effects.js';
import { getEnemyDefinition } from '../enemies/registry.js';
import { getAllyDefinition } from '../allies/registry.js';
import { DrawCardsInstruction } from './cards.js';
import { TurnStartInstruction } from './turn.js';
import { DealDamageInstruction, ClearShieldInstruction } from './combat.js';

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

      // run 级数值修正：**进战第一件事**就把它从 baseStats 重算（base + Σ已激活遗物修正）。
      // 顺序很关键——必须早于下方"AP 置满"与能力/遗物的 onBattleStart：
      //   · 不重算就会踩"逐战叠加"的坑（PreBattle 重置护盾/效果/AP/魏启，但不重置 maxHp/防御）；
      //   · 放在能力之后则会**覆盖**能力/卡牌的战斗内增量（如「心宽」onBattleStart 里
      //     直接 maxHandSize += 2）——那是叠加在基准之上的增量，不是基准本身。
      // 传 battleState：把遗物声明的**本场**修正一起折入（battleState.modifiers 每场新建 = 0，
      // 所以本场动态修正在这里天然从零起算）。
      refreshRunModifiers(runState, battleState);

      // 跨战斗恶魔词条（银行机超额取款）：写本场标量（失明/抽牌惩罚/不回魏启/回合末死亡/持续伤害）
      // 并收集「战斗开始类效果」——它们作为本 stage 的子指令执行（在回合循环之前）
      const debuffEffects = applyPendingDebuffsToBattle(runState, battleState);
      for (const [effectId, stacks] of debuffEffects) {
        ctx.kernel.submitInstruction(new AddEffectInstruction({ target: player, effectId, stacks }));
      }

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
      // 遗物：挂载「已激活」的 = 装备中的 + 全部非槽位式（非槽位式恒生效、不需装备）
      for (const relicId of activeRelics(runState)) {
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

      // 护盾重置（回合开始）：**必须晚于回合开始的效果结算**——燃烧/中毒等"回合开始"伤害
      // 先结算（固定伤害按 EFFECTS.md 可被护盾吸收），随后才清盾。
      // 优先级分带（顺序敏感，改这里前先读这段）：
      //   默认 0   = 回合开始的结算类效果（燃烧/再生/纳气…）→ 看得到"上一轮留下的护盾"
      //   -50      = 本订阅（清盾）
      //   ≤ -100   = 回合开始的「出现类」效果（如「第二回合开始时获得12护盾」的光滑小圆盾）——
      //              它们必须排在清盾之后，否则刚发的盾会被立刻清掉。
      // 首回合不清：PreBattle 已把护盾置 0，而"战斗开始时获得护盾"的遗物刚发下来，
      // 清掉等于白给（黑山岩/拟钢碎片）。
      // 首回合豁免只给**玩家**：玩家的开局盾来自遗物（黑山岩/拟钢碎片），若在自己第一回合开始就清，
      // 等于白给。**敌方首回合照清**——敌方开局盾是设计好的"只护住玩家第一回合"
      // （沼泽伏击者 18 盾），清早了才是对的（既有用例「开局自带盾18」即此意图）。
      ctx.kernel.addSubscription({
        when: TurnStartInstruction,
        phase: 'post',
        priority: -50,
        filter: (instr, c) => instr.side === 'player'
          ? c.battleState.turn.count > 1
          : true,
        react: (instr, c) => {
          const targets = instr.side === 'player'
            ? [c.player]
            : c.battleState.enemies.filter(e => !e.isDead());
          for (const t of targets) {
            c.kernel.submitInstruction(new ClearShieldInstruction({ target: t }), instr);
          }
        },
        owner: 'core:shieldReset',
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
    // 战后重算：本场修正（battleState.modifiers 与遗物声明的 battleModifiers）随之出清。
    // 这不是"回滚"，就是同一个重算函数在战后被多调一次——幂等、无记账。
    refreshRunModifiers(ctx.runState, null);
    battleState.result = ctx.kernel.verdict;
    ctx.kernel.clearWindow('battle');
    ctx.presenter?.battleEnd?.({ result: ctx.kernel.verdict });
    return true;
  }
}
