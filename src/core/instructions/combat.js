import BattleInstruction from '../kernel/BattleInstruction.js';
import { getEnemyDefinition, hasEnemy } from '../enemies/registry.js';

// ==== 伤害两原语（2026-09-15 用户定架构）====
//
// 伤害拆「结算（发动）」与「应用（受击）」两个原语、两个阶段：
//
//   DealDamageInstruction（结算原语·第一阶段）
//     ├─ 字段：source 来源 / type 类型（'major' 主级 | 'minor' 附级）/
//     │        属性（pierce 穿透 / fixed 固定）/ tags 机制标记 / skill 卡牌引用
//     ├─ PRE：发动侧修饰流水线（武术姿态加成、斩灭改固定、聚爆/起手式……）
//     │        ——**发动侧订阅只认主级**（附级伤害不触发任何加成与特效附加）
//     ├─ POST：发动侧响应（以攻为守、控火术：灼、炎魔上燃……）
//     └─ execute：未被取消 → 把「类型 + 属性 + 来源 + 最终数字」透传，插入 ↓
//
//   ApplyDamageInstruction（应用原语·第二阶段）
//     ├─ PRE：受击侧最后修正（格挡减半）与**致命拦截**（闪避 veto、无人战体/塞西莉亚
//     │        之恩赐的免死改判）——「奇迹阻止即将让人死亡的伤害」类监听挂这里，
//     │        它们不关心伤害出自什么千奇百怪的原因
//     ├─ execute：固定公式（防御减免 → 护盾吸收 → 扣 HP → minHp 地板 → 死亡亡语）
//     └─ POST：受击侧响应（荆棘反伤、忍耐回格挡、暴怒叠层、鼓腹蟾膨胀……）
//              ——**受击侧的「响应类」订阅只认主级**；「掉血检测类」（准备出招的
//              受伤旗标、死亡检测）不筛类型
//
// 两个维度正交：**类型（主/附级）管触发哪些钩子，属性（普通/穿透/固定）管结算公式**。
// 附级伤害（荆棘反伤、精通/无双抽卡伤害、燃烧/中毒 tick、亡语直伤、遗物被动、卖血）
// 照走防御/护盾公式（「可被护盾挡」是既有语义），但不吃任何加成、不触发任何响应。
//
// tags：机制标记位（如 'aoe' 群伤 / 'burn' 燃烧），供 filter 识别（爆发"群伤单目标三倍"、
// 防火"燃烧结算跳过"），不可修饰。
// fixed（固定伤害，battle.md F2）：跳过修正步与防御步，仅护盾仍可吸收——payload 白名单
// 为空（伤害不可被 PRE 改写），但结算仍可被 veto（防火"跳过结算"）。中毒等环境伤害用。
// minHp 地板：经 getStat('minHp') 读轨（不灭等效果的 statModifiers 提供），默认 0。
export class DealDamageInstruction extends BattleInstruction {
  constructor({ source = null, target, amount, pierce = false, fixed = false, tags = [], skill = null, type = 'major' }, opts = {}) {
    super(opts);
    this.source = source;       // Unit | null（环境伤害等无来源）
    this.target = target;       // Unit
    this.amount = amount;       // 基础伤害（不含攻击面板；攻击面板由调用方算入或经 PRE）
    this.basePierce = pierce;
    this.fixed = fixed;
    this.tags = tags;
    this.skill = skill;         // 造成此伤害的卡牌 runtime（dealDamage 透传；环境/敌方直造为 null）
    this.type = type;           // 'major' 主级（出牌/敌方行动的直接伤害）| 'minor' 附级
                                // （反伤/抽卡伤害/tick/亡语等被动伤害）——跨原语透传到应用原语
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
    // 结算原语未被取消 → 插入应用原语（子节点）。**两段式**（return false）：应用原语
    // 连同其 POST 子树完整结算后本指令才完成——本原语的 POST 订阅才能读到回填后的
    // 结算明细。旧版此处 return true：POST 先于子节点执行，result 恒为占位 0
    // （dealt>0 类订阅全部静默失效：肾上腺素/以攻为守/炎魔/控火灼，2026-09-17 修）。
    if (this._stage === 0) {
      const apply = new ApplyDamageInstruction({
        source: this.source,
        target,
        amount: this.fixed ? this.amount : this.payload.damage,
        pierce: this.fixed ? false : this.payload.pierce,
        fixed: this.fixed,
        type: this.type,
        tags: this.tags,
        skill: this.skill,
      });
      this._apply = apply;
      ctx.kernel.submitInstruction(apply, this);
      return false;
    }
    // 应用原语被 veto（闪避/免死改判）→ 未执行、result 未置 → 结算明细置零并标记
    // cancelled，发动侧 POST 订阅（filter 读 dealt>0）天然忽略。
    this.result = this._apply.result ?? {
      damage: 0, defenseBlocked: 0, shieldAbsorbed: 0, dealt: 0, cancelled: true,
    };
    return true;
  }
}

// 应用原语（受击侧）：固定结算公式 + 受击响应位。公式只此一处（防住即免燃、
// 忍耐 dealt>0 等口径都读 result.dealt = 实际生命损失）。
export class ApplyDamageInstruction extends BattleInstruction {
  constructor({ source = null, target, amount, pierce = false, fixed = false, tags = [], skill = null, type = 'major' }, opts = {}) {
    super(opts);
    this.source = source;
    this.target = target;
    this.amount = amount;       // 结算原语的最终数字（已过发动侧修饰）
    this.basePierce = pierce;
    this.fixed = fixed;
    this.tags = tags;
    this.skill = skill;
    this.type = type;
  }

  // 受击侧只可改数字（格挡减半）；穿透属性是发动侧定死的结算口径，不可改
  get modifiablePayload() { return this.fixed ? [] : ['damage']; }

  buildPayload() {
    this.payload.damage = this.amount;
  }

  execute(ctx) {
    const target = this.target;
    // 双保险守卫（结算原语已查过；应用原语也可能被直接构造）
    if (!target || target.isDead()) {
      this.result = { damage: 0, defenseBlocked: 0, shieldAbsorbed: 0, dealt: 0, targetDead: true, skipped: true };
      return true;
    }
    const raw = this.fixed ? this.amount : this.payload.damage;
    const pierce = this.fixed ? false : this.basePierce;
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

// 致命预判（只读）：该**应用原语**按当前 payload 结算后目标是否会死。
// 公式与 ApplyDamageInstruction.execute 同源（防御 → 护盾 → minHp 地板），供应用原语的
// PRE 订阅做「致命拦截」用（无人战体死亡协议、塞西莉亚之恩赐）；两者必须一起改，
// 否则拦截会在临界值上判错。
export function wouldBeLethal(instr, target) {
  const raw = instr.fixed ? instr.amount : instr.payload.damage;
  const pierce = instr.fixed ? false : instr.basePierce;
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

// 伤害预估（卡面"应用后"描述用）：走真实 PRE 管线的干跑探针——**两段**（两原语同构）：
// 先干跑结算原语（发动侧修饰：斩灭翻倍、姿态加成……），再用其最终数字干跑应用原语
// （受击侧修正：格挡减半、闪避 veto……）。少一段预览就会丢那一侧的修正。
// 返回 { dodged, damage }——damage 为两侧修正后的伤害，不含防御/护盾吸收（那是结算期
// 对 HP 的影响，非伤害本身）。只在等待玩家输入（泵静止）时调用；探针的子反应被丢弃，
// 真实状态不变（契约见 BattleKernel.preview）。
export function previewDamage(ctx, { source, target, amount, pierce = false, tags = [] }) {
  const settle = ctx.kernel.preview(
    new DealDamageInstruction({ source, target, amount, pierce, tags }), ctx);
  const apply = ctx.kernel.preview(
    new ApplyDamageInstruction({
      source, target,
      amount: settle.cancelled ? 0 : settle.payload.damage,
      pierce: settle.payload.pierce ?? pierce,
      tags,
    }), ctx);
  // 与 execute 的减防御地板同口径：预览不露出负值（虚弱压负面板时显示 -N 会误导）
  return { dodged: settle.cancelled || apply.cancelled, damage: Math.max(0, apply.payload.damage) };
}
