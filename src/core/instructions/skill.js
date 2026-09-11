import BattleInstruction from '../kernel/BattleInstruction.js';
import { moveCard, zoneOf } from '../state/battleState.js';
import { getSkillDefinition } from '../skills/registry.js';
import {
  makeSkillCtx, deactivateChant, freeChantToggle, chantActivationLegal,
} from '../skills/helpers.js';
import { ConsumeManaInstruction, ConsumeActionPointsInstruction } from './resources.js';

// 使用技能：四阶段。
//   stage 0: 播报 + 提交 ConsumeSkillResourcesInstruction（费用/充能）——此刻卡仍在手，
//            skillUsed 同步快照与出牌前一致（费用可被 PRE 修饰/否决，卡未离手无需回滚）。
//            咏唱意图在此捕获：打出已激活咏唱 = 免费解除（_chantOff）。
//   stage 1: 出牌即离手——先捕获出牌时点手位（邻位/最左/唯一手牌类语义读「打出那一刻」，
//            回手落位也用它保持扇形稳定），解除路径先熄灭（离手不变量），
//            再 hand→pending（结算区，裸 moveCard 静默迁移：不产生指令/事件，
//            弃牌类订阅不可能误触发）；然后提交 ActivateSkillInstruction（执行 def.use，可多阶段）；
//            targetUniqueID（玩家指定目标）在此解析为存活单位 → sctx.target，
//            结算时才解析——点击到结算之间目标可能已死亡（解析失败落 null，走默认选靶）
//   stage 2: history.played++ + 咏唱发动合法性判定（结算中的卡已离手，先放回手位再算：
//            激活后加权手牌数 ≤ 手牌上限）。canUse 已挡常规路径，此处为嵌套强发兜底——
//            非法发动无效果（回手不点亮）。
//   stage 3: 收尾 zone 迁移——咏唱发动（合法）回手落原位 + 点亮激活 + 注册订阅；
//            咏唱解除按卡牌特性离场（消耗→焚毁，否则→牌库底）；非法强发回手不点亮；
//            消耗→burnt / 其余→deck 底（FIFO：打出即回库，无弃牌堆）+ 离场播报（cardBurnt/cardMoved）
//            ——离场动画因此成为 sequencer 节拍，串行队列天然保证"发动 → 效果 → 离场"的次序。
//            落位容差：卡已不在 pending = 效果逻辑已在结算中自行安置（如「回到牌库顶」
//            类自改去向），收尾不再搬动、不播离场——安置权归效果逻辑。
// costOverride: { mana?, actionPoint? } 费用覆写——嵌套出牌（万变拳"0AP 打出任意手牌"）
// 由技能逻辑直接提交 UseSkillInstruction，不经 playerUseSkill 的可用性检查。
export class UseSkillInstruction extends BattleInstruction {
  constructor({ skill, costOverride = null, targetUniqueID = null }, opts = {}) {   // skill = skillRuntime
    super(opts);
    this.skill = skill;
    this.costOverride = costOverride;
    this.targetUniqueID = targetUniqueID;
  }

  execute(ctx) {
    const sctx = makeSkillCtx(ctx, this.skill);
    switch (this._stage) {
      case 0:
        // 咏唱双态意图（费用豁免与收尾分流都读它；费用指令在其子节点执行时卡未离手）
        this._chantOff = sctx.def.cardMode === 'chant' && this.skill.isActivated;
        ctx.presenter?.skillUsed?.({ skill: this.skill, def: sctx.def });
        ctx.kernel.submitInstruction(
          new ConsumeSkillResourcesInstruction({ skill: this.skill, costOverride: this.costOverride }), this);
        return false;
      case 1: {
        // 出牌时点手位捕获（结算中自身已离手，位置类语义只能读这一刻；回手落位同用）
        this._handIndexAtPlay = ctx.battleState.zones.hand
          .findIndex(c => c.uniqueID === this.skill.uniqueID);
        // 打出已激活咏唱 = 免费解除：离手前先熄（播报/注销订阅在 deactivateChant 内）；
        // 解除目标随行（终止类群伤的软指定：选定目标恒最后命中）
        if (this._chantOff) deactivateChant(ctx, this.skill, 'played',
          this.targetUniqueID ? findAliveUnit(ctx, this.targetUniqueID) : null);
        moveCard(ctx.battleState, this.skill.uniqueID, 'pending');
        ctx.kernel.submitInstruction(new ActivateSkillInstruction({
          skill: this.skill,
          target: this.targetUniqueID ? findAliveUnit(ctx, this.targetUniqueID) : null,
          handIndexAtPlay: this._handIndexAtPlay,
        }), this);
        return false;
      }
      case 2: {
        ctx.battleState.history.turn.played += 1;
        ctx.battleState.history.battle.played += 1;
        // 发动合法性（嵌套强发兜底）：结算中的卡放回手位后按加权口径判定
        if (sctx.def.cardMode === 'chant' && !this._chantOff) {
          moveCard(ctx.battleState, this.skill.uniqueID, 'hand',
            { index: this._handIndexAtPlay ?? null });
          this._chantLegal = chantActivationLegal(ctx, this.skill, sctx.def);
          moveCard(ctx.battleState, this.skill.uniqueID, 'pending');
        }
        return false;
      }
      default: {
        if (zoneOf(ctx.battleState, this.skill.uniqueID) !== 'pending') return true; // 已被效果逻辑自行安置

        const def = sctx.def;
        if (def.cardMode === 'chant' && !this._chantOff) {
          // 咏唱发动：回手（落回出牌时点手位，扇形不跳位）；合法发动点亮激活 + 注册咏唱订阅
          // （owner = 卡牌，熄灭时按 owner 注销）；非法强发无效果（回手不点亮）
          moveCard(ctx.battleState, this.skill.uniqueID, 'hand',
            { index: this._handIndexAtPlay ?? null });
          if (this._chantLegal) {
            this.skill.isActivated = true;
            def.activated?.onEnable?.(sctx);
            for (const sub of def.activated?.subscriptions?.(sctx) ?? []) {
              ctx.kernel.addSubscription({ window: 'battle', ...sub, owner: this.skill.uniqueID });
            }
            ctx.presenter?.chantToggled?.({ skill: this.skill, on: true, reason: 'played' });
          }
        } else if (def.keywords?.includes('exhaust')) {
          // 消耗卡（含咏唱解除）：→ 焚毁区
          moveCard(ctx.battleState, this.skill.uniqueID, 'burnt');
          ctx.presenter?.cardBurnt?.({ card: this.skill });
        } else {
          // FIFO 循环：非消耗卡打出/解除咏唱后一律回牌库底（无弃牌堆，压力随离手释放）
          moveCard(ctx.battleState, this.skill.uniqueID, 'deck');
          ctx.presenter?.cardMoved?.({ card: this.skill, toZone: 'deck' });
        }
        return true;
      }
    }
  }
}

// 资源消耗：费用不直接扣，而是提交资源指令——费用修正（PRE 订阅）因此对技能费用生效。
// costOverride 覆写定义费用（嵌套出牌的费用豁免）；激活态咏唱打出恒免费（关停语义）；
// 充能消耗不受影响。
export class ConsumeSkillResourcesInstruction extends BattleInstruction {
  constructor({ skill, costOverride = null }, opts = {}) {
    super(opts);
    this.skill = skill;
    this.costOverride = costOverride;
  }

  execute(ctx) {
    const def = getSkillDefinition(this.skill.defId);
    if (this._stage === 0) {
      const free = freeChantToggle(def, this.skill);
      const rawMana = free ? 0 : this.costOverride?.mana ?? def.cost?.mana ?? 0;
      const rawAp = free ? 0 : this.costOverride?.actionPoint ?? def.cost?.actionPoint ?? 0;
      // 【X 费】cost 为 'X' = 打出时点的全部现有资源（NAMED「消耗为X」）。实付量记在
      // runtime.xCost 上供卡牌效果读取——支付先于 use()，效果读不到余额。
      const mana = rawMana === 'X' ? ctx.player.mana : rawMana;
      const ap = rawAp === 'X' ? ctx.player.actionPoints : rawAp;
      if (rawMana === 'X' || rawAp === 'X') this.skill.xCost = { mana, actionPoint: ap };
      if (mana > 0) ctx.kernel.submitInstruction(new ConsumeManaInstruction({ amount: mana }), this);
      if (ap > 0) ctx.kernel.submitInstruction(new ConsumeActionPointsInstruction({ amount: ap }), this);
      return false;
    }
    // 消耗一次充能，并按需启动冷却计时
    this.skill.remainingUses -= 1;
    const max = def.charges?.max ?? Infinity;
    const cd = def.charges?.cooldownTurns ?? 0;
    if (cd > 0 && this.skill.remainingUses < max && this.skill.currentCooldown === 0) {
      this.skill.currentCooldown = cd;
    }
    return true;
  }
}

// 激活技能：执行 def.use(sctx, stage)。def.use 返回 false 则推进其自有 stage 计数，
// 支持多阶段技能（选牌、二段结算等）。
// target：玩家指定的目标单位（存活校验已在提交前完成；可为 null——技能走默认选靶）。
// handIndexAtPlay：出牌时点手位（UseSkill stage 1 捕获；结算中自身已离手进 pending，
// 位置类语义经 helpers.handIndexAtPlay/handNeighborsAtPlay 读这一刻；canUse/预览路径无此字段）。
export class ActivateSkillInstruction extends BattleInstruction {
  constructor({ skill, target = null, handIndexAtPlay = null }, opts = {}) {
    super(opts);
    this.skill = skill;
    this.target = target;
    this.handIndexAtPlay = handIndexAtPlay;
    this._skillStage = 0;
  }

  execute(ctx) {
    const sctx = makeSkillCtx(ctx, this.skill);
    sctx.target = this.target;
    sctx.handIndexAtPlay = this.handIndexAtPlay;
    const done = sctx.def.use ? sctx.def.use(sctx, this._skillStage) : true;
    if (done === false) {
      this._skillStage += 1;
      return false;
    }
    return true;
  }
}

// 玩家指定目标的白名单解析：全场存活单位（敌/友/玩家），找不到或已死亡 → null
function findAliveUnit(ctx, uniqueID) {
  const all = [...ctx.battleState.enemies, ...ctx.battleState.allies, ctx.player];
  const unit = all.find(u => u.uniqueID === uniqueID);
  return unit && !unit.isDead() ? unit : null;
}

// 定向冷却推进：单卡推进/倒退 N 格（delta 可被 PRE 修饰）。正 = 充能推进（猛拳
// 「每打 1 牌冷却 1」等卡内加速），负 = 衰败（斩系反向）。无视 cooldownZones 区域门——
// 区域门控是自然冷却扫掠（SweepSkillCooldownInstruction）的职责，卡牌效果定向直达。
// 状态变更全在指令树内，可被 PRE veto/修饰。满充能（计时已尽）正向无处推进、
// 满充能衰败无处分反：静默落空、不播报。
export class SkillCooldownInstruction extends BattleInstruction {
  constructor({ skill, delta = 1 }, opts = {}) {
    super(opts);
    this.skill = skill;
    this.delta = delta;
  }

  get modifiablePayload() { return ['delta']; }
  buildPayload() { this.payload.delta = this.delta; }

  execute(ctx) {
    const def = getSkillDefinition(this.skill.defId);
    const max = def.charges?.max ?? Infinity;
    const cd = def.charges?.cooldownTurns ?? 0;
    const delta = this.payload.delta ?? this.delta;
    if (delta > 0) {
      let stepped = 0;
      while (stepped < delta && this.skill.currentCooldown > 0) {
        this.skill.currentCooldown -= 1;
        if (this.skill.currentCooldown === 0) {
          this.skill.remainingUses = Math.min(this.skill.remainingUses + 1, max);
          if (this.skill.remainingUses < max) this.skill.currentCooldown = cd; // 未满继续下一段充能
        }
        stepped += 1;
      }
      if (stepped > 0) ctx.presenter?.cooldownTick?.({ skill: this.skill, delta: stepped });
    } else if (delta < 0 && this.skill.remainingUses < max) {
      this.skill.currentCooldown += -delta;
      ctx.presenter?.cooldownTick?.({ skill: this.skill, delta });
    }
    return true;
  }
}

// 自然冷却扫掠（回合开始）：对 cooldownZones（默认 hand/deck）内计时未尽的每张卡，
// 展开一枚定向 SkillCooldownInstruction（delta 1）子节点——冷却路径与卡牌效果
// （加速/衰败）完全同源，单卡推进可被 PRE 逐卡 veto/修饰（如「咏唱中不冷却」类
// 未来规则无需改扫掠本体）。pending（结算区）不在默认集合：正在结算的卡不推进冷却。
export class SweepSkillCooldownInstruction extends BattleInstruction {
  execute(ctx) {
    for (const [zoneName, arr] of Object.entries(ctx.battleState.zones)) {
      for (const skill of arr) {
        const def = getSkillDefinition(skill.defId);
        const zones = def.cooldownZones ?? ['hand', 'deck'];
        if (!zones.includes(zoneName)) continue;
        const max = def.charges?.max ?? Infinity;
        const cd = def.charges?.cooldownTurns ?? 0;
        if (cd === 0 || skill.remainingUses >= max || skill.currentCooldown <= 0) continue;
        ctx.kernel.submitInstruction(new SkillCooldownInstruction({ skill, delta: 1 }), this);
      }
    }
    return true;
  }
}
