import BattleInstruction from '../kernel/BattleInstruction.js';
import { getEnemyDefinition, hasEnemy } from '../enemies/registry.js';

// 伤害结算：防御减免 → 护盾吸收（pierce 跳过护盾与防御）→ 扣 HP（不低于 minHp 地板）。
// payload 白名单 ['damage', 'pierce']：PRE 订阅可改伤害/穿透（斩灭翻倍、易伤加深等）。
// POST 订阅经 result 读结算明细（暴怒反击、受伤联动等）。
// tags：机制标记位（如 'aoe' 群伤 / 'burn' 燃烧），供 filter 识别（爆发"群伤单目标三倍"、
// 防火"燃烧结算跳过"），不可修饰。
// fixed（固定伤害，battle.md F2）：跳过修正步与防御步，仅护盾仍可吸收——payload 白名单
// 为空（伤害不可被 PRE 改写），但结算仍可被 veto（防火"跳过结算"）。中毒等环境伤害用。
// minHp 地板：经 getStat('minHp') 读轨（不灭等效果的 statModifiers 提供），默认 0。
export class DealDamageInstruction extends BattleInstruction {
  constructor({ source = null, target, amount, pierce = false, fixed = false, tags = [] }, opts = {}) {
    super(opts);
    this.source = source;       // Unit | null（环境伤害等无来源）
    this.target = target;       // Unit
    this.amount = amount;       // 基础伤害（不含攻击面板；攻击面板由调用方算入或经 PRE）
    this.basePierce = pierce;
    this.fixed = fixed;
    this.tags = tags;
  }

  get modifiablePayload() { return this.fixed ? [] : ['damage', 'pierce']; }

  buildPayload() {
    this.payload.damage = this.amount;
    this.payload.pierce = this.basePierce;
  }

  execute(ctx) {
    const target = this.target;
    // 过期目标守卫（2026-09-11 用户报）：目标缺失或已死 → **静默落空**。
    // 起因：多段伤害是一次性捕获目标后连打 N 段（各 content 自己写 for 循环），
    // 目标在中间段被击杀时，剩余段仍会结算并播放"虚空伤害"演出，且重复触发死亡。
    // 与「过期引用无害」的既有哲学一致（弃牌/换牌等指令的同款前置守卫）。
    if (!target || target.isDead()) {
      this.result = { damage: 0, defenseBlocked: 0, shieldAbsorbed: 0, dealt: 0, targetDead: true, skipped: true };
      return true;
    }
    const raw = this.fixed ? this.amount : this.payload.damage;
    const pierce = this.fixed ? false : this.payload.pierce;
    const defense = (pierce || this.fixed) ? 0 : target.getStat('defense');
    let dmg = Math.max(raw - defense, 0);
    const defenseBlocked = raw - dmg;

    let shieldAbsorbed = 0;
    if (!pierce && target.shield > 0) {
      shieldAbsorbed = Math.min(target.shield, dmg);
      target.shield -= shieldAbsorbed;
      dmg -= shieldAbsorbed;
    }

    target.hp = Math.max(target.hp - dmg, target.getStat('minHp'));

    this.result = {
      damage: raw,
      defenseBlocked,
      shieldAbsorbed,
      dealt: dmg,
      targetDead: target.isDead(),
    };

    // history（以我方阵营视角统计：瑞米等我方单位的输出/承伤都算在内）
    if (this.source?.side === 'player') {
      ctx.battleState.history.turn.damageDealt += dmg;
      ctx.battleState.history.battle.damageDealt += dmg;
    }
    if (target.side === 'player') {
      ctx.battleState.history.turn.damageTaken += dmg;
      ctx.battleState.history.battle.damageTaken += dmg;
    }

    ctx.presenter?.damage?.({
      source: this.source, target, dealt: dmg,
      defenseBlocked, shieldAbsorbed, pierce,
    });
    if (target.isDead()) {
      ctx.presenter?.unitDeath?.({ unit: target });
      // 亡语（敌人定义的 onDeath 钩子）：与 def.act 同上下文（actx = {...ctx, unit, def}）；
      // submitInstruction 的默认父节点 = 当前指令，故亡语作为「致死那一下」的子节点立即结算
      // ——不额外占节拍、不改回合序，也不需要新增一种「死亡指令」。
      if (target.defId && hasEnemy(target.defId)) {
        const def = getEnemyDefinition(target.defId);
        def?.onDeath?.({ ...ctx, unit: target, def });
      }
    }
    return true;
  }
}

// 致命预判（只读）：该伤害指令按当前 payload 结算后目标是否会死。
// 公式与上面 execute 同源（防御 → 护盾 → minHp 地板），供 PRE 订阅做「致命拦截」用
// （塞西莉亚之恩赐）；两者必须一起改，否则拦截会在临界值上判错。
export function wouldBeLethal(instr, target) {
  const raw = instr.fixed ? instr.amount : instr.payload.damage;
  const pierce = instr.fixed ? false : instr.payload.pierce;
  const defense = (pierce || instr.fixed) ? 0 : target.getStat('defense');
  let dmg = Math.max(raw - defense, 0);
  if (!pierce) dmg -= Math.min(target.shield, dmg);
  return target.hp - dmg <= target.getStat('minHp');
}

// 清空护盾（回合开始的护盾重置）。**执行时机必须晚于回合开始的效果结算**：
// 燃烧等「固定伤害」按 EFFECTS.md 可被护盾吸收，若先清盾再结算，护盾那一步永远读到 0，
// 燃烧就会事实上变成穿透（2026-09 修：此前正是这个顺序 bug）。
export class ClearShieldInstruction extends BattleInstruction {
  constructor({ target }, opts = {}) {
    super(opts);
    this.target = target; // Unit
  }

  execute() {
    this.target.shield = 0;
    return true;
  }
}

// 治疗：白名单 ['amount']，不超过 maxHp。
export class ApplyHealInstruction extends BattleInstruction {
  constructor({ target, amount }, opts = {}) {
    super(opts);
    this.target = target;
    this.amount = amount;
  }

  get modifiablePayload() { return ['amount']; }

  buildPayload() {
    this.payload.amount = this.amount;
  }

  execute(ctx) {
    const target = this.target;
    const before = target.hp;
    target.hp = Math.min(target.hp + this.payload.amount, target.maxHp);
    const healed = target.hp - before;
    this.result = { healed };

    if (target.side === 'player') {
      ctx.battleState.history.turn.healing += healed;
      ctx.battleState.history.battle.healing += healed;
    }
    ctx.presenter?.heal?.({ target, healed });
    return true;
  }
}

// 获得护盾：白名单 ['amount']。
export class GainShieldInstruction extends BattleInstruction {
  constructor({ target, amount }, opts = {}) {
    super(opts);
    this.target = target;
    this.amount = amount;
  }

  get modifiablePayload() { return ['amount']; }

  buildPayload() {
    this.payload.amount = this.amount;
  }

  execute(ctx) {
    this.target.shield += this.payload.amount;
    this.result = { gained: this.payload.amount };
    ctx.presenter?.shield?.({ target: this.target, gained: this.payload.amount });
    return true;
  }
}

// 伤害预估（卡面"应用后"描述用）：走真实 PRE 管线的干跑探针。
// 返回 { dodged, damage }——damage 为 PRE 修正后的伤害（斩灭翻倍、格挡减半、
// 闪避归零、易受加深等都吃进去），不含防御/护盾吸收（那是结算期对 HP 的影响，
// 非伤害本身）。只在等待玩家输入（泵静止）时调用；探针的子反应被丢弃，
// 真实状态不变（契约见 BattleKernel.preview）。
export function previewDamage(ctx, { source, target, amount, pierce = false, tags = [] }) {
  const probe = ctx.kernel.preview(
    new DealDamageInstruction({ source, target, amount, pierce, tags }), ctx);
  // 与 execute 的减防御地板同口径：预览不露出负值（虚弱压负面板时显示 -N 会误导）
  return { dodged: probe.cancelled, damage: Math.max(0, probe.payload.damage) };
}
