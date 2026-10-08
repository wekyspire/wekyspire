// 卡牌 modifier 机制：可挂载的卡牌修正实例（设计定稿 quest_prompts/CARD_MODIFIERS.md）。
//
// 核心抽象：有效卡视图 = def ⊕ 依序合成(卡上 modifiers 的 patch)——纯函数、随时重算、
// 永不落库（拉取式，与遗物 runModifiers / getStat 效果轨同哲学：摘除零成本、干跑安全、
// 序列化只存补丁不存结果）。
//
// modifier def 契约（plain object）：
//   { id, name, icon?, color?,
//     patch?: {                                  // 属性补丁（纯函数 fold，见下）
//       keywords?: { add?: [..], remove?: [..] },// 词条增删（只改视图不动 def）
//       cost?: { mana?: ops, ap?: ops },         // 费用（X 费免疫：按费种各自判定）
//       cooldown?: ops,                          // 冷却时长（无冷却卡以 0 为基，可 patch 出冷却）
//     },
//     mutesHand?: true,                          // 旗标：此卡在手时其余卡不可打出（缄默）
//     unplayable?: true,                         // 旗标：此卡不可打出
//     onAttach?(mod, sctx), onDetach?(mod, sctx),// 生命周期（挂载 / 一切除移除路径）
//     subscriptions?(mod, sctx) => [subs],       // 任意战斗事件订阅（全语法）
//     onDraw?(mod, sctx, instr)?,                // 糖：抽到本卡时
//     turnEndInHand?(mod, sctx, instr)?,         // 糖：回合结束仍在手时
//     describe?(mod)?, agent?() }
//
// 数值 ops = { set?, add?, min?, max? }：单条 modifier 内固定顺序 set→add→min→max；
// 跨 modifier 按卡上存储顺序 fold（后挂者后算）。min/max = 与常数取小/取大。
//
// 作用域：落点即作用域——战斗牌库是 run 牌组的克隆（battleRoot PreBattle），战斗中挂的
// modifier 随克隆丢弃；非战斗挂的（事件）写 player.deck 随存档持久。
//
// 订阅 owner = `${uniqueID}:mod:${modId}`（精确到单条 modifier，任意路径按 owner 注销）；
// 顺序铁律：先注销订阅、再跑 onDetach。

import { createRegistry } from '../registryFactory.js';
import { getSkillDefinition } from './registry.js';
import { zoneOf } from '../state/battleState.js';
// 下方指令类仅在函数体内引用（糖编译期/结算段），与 instructions/cards.js 构成的
// import 环在 ESM 下安全（双方都无模块顶层求值依赖）。
import { DrawCardsInstruction, BurnCardInstruction } from '../instructions/cards.js';
import { PlayerTurnEndInstruction } from '../instructions/turn.js';

const reg = createRegistry('卡牌modifier');

export const registerCardModifier = reg.register;
export const getCardModifier = reg.get;
export const hasCardModifierDef = reg.has;
export const allCardModifiers = reg.all;

// ---- 实例存取（唯一事实源：card.modifiers 数组，序即优先级）----

export function modsOf(rt) {
  return rt?.modifiers ?? [];
}

export function hasCardModifier(rt, modId) {
  return modsOf(rt).some((m) => m.modId === modId);
}

export function hasModifierFlag(rt, flag) {
  return modsOf(rt).some((m) => {
    const def = reg.has(m.modId) ? reg.get(m.modId) : null;
    return def?.[flag] === true;
  });
}

// 挂载实例：同 modId 不叠（原位覆盖 data/source，存储序不变——重挂保持既有优先级位置）
export function attachModifierInstance(rt, { modId, data = {}, source = null }) {
  if (!Array.isArray(rt.modifiers)) rt.modifiers = [];
  const inst = { modId, source, data };
  const i = rt.modifiers.findIndex((m) => m.modId === modId);
  if (i >= 0) {
    rt.modifiers[i] = inst;
    return { inst, refreshed: true };
  }
  rt.modifiers.push(inst);
  return { inst, refreshed: false };
}

export function detachModifierInstance(rt, modId) {
  if (!Array.isArray(rt.modifiers)) return null;
  const i = rt.modifiers.findIndex((m) => m.modId === modId);
  return i >= 0 ? rt.modifiers.splice(i, 1)[0] : null;
}

// 深拷贝（克隆/存档必经：modifiers 是引用类型，浅拷贝会让战斗内摘除污染 run 卡）
export function cloneModifiers(mods) {
  return (mods ?? []).map((m) => ({ ...m, data: { ...(m.data ?? {}) } }));
}

// ---- 数值 fold ----

function applyNumOps(v, ops) {
  if (ops == null) return v;
  if (typeof ops.set === 'number') v = ops.set;
  if (typeof ops.add === 'number') v += ops.add;
  if (typeof ops.min === 'number') v = Math.min(v, ops.min);
  if (typeof ops.max === 'number') v = Math.max(v, ops.max);
  return v;
}

// ---- 有效视图（纯函数）----

// 词条：基础 → 按 modifier 存储序 fold（单条内先增后删；remove 可删基础词条）
export function keywordsOf(rt) {
  const def = getSkillDefinition(rt.defId);
  let kw = [...(def.keywords ?? [])];
  for (const inst of modsOf(rt)) {
    const patch = reg.has(inst.modId) ? reg.get(inst.modId).patch : null;
    const k = patch?.keywords;
    if (!k) continue;
    for (const add of k.add ?? []) if (!kw.includes(add)) kw.push(add);
    for (const rm of k.remove ?? []) kw = kw.filter((x) => x !== rm);
  }
  return kw;
}

// 费用（蓝/AP）。合成序：定义费用 → modifier patch（X 费种免疫）→ legacy 末端合成
// （runtime costOverride = 末端 set，无覆写则 manaCostDelta / apCostShift = 末端 add）——
// 精确复刻既有「覆写压制增量」语义，读点统一后旧通道零行为回归（按费种各自判定，
// 单费种覆写不再误杀另一费种的增量——比旧全有全无口径更正）。
// 不做隐式 floor：负费与 apCostShift 负值同哲学，由结算侧 >0 判定自然钳零；
// 设计者需要钳制时用显式 max: 0。
export function costOf(rt, sctx = null) {
  const def = getSkillDefinition(rt.defId);
  const base = { mana: def.cost?.mana ?? 0, actionPoint: def.cost?.actionPoint ?? 0 };
  const out = {};
  for (const k of ['mana', 'actionPoint']) {
    let v = base[k];
    if (v !== 'X') {
      for (const inst of modsOf(rt)) {
        const patch = reg.has(inst.modId) ? reg.get(inst.modId).patch : null;
        v = applyNumOps(v, patch?.cost?.[k]);
      }
    }
    const ovK = rt.costOverride?.[k];
    if (typeof ovK === 'number') {
      v = ovK; // legacy 覆写 = 末端 set（含 X 基数的覆写，保持旧行为）
    } else if (v !== 'X') {
      if (k === 'mana' && sctx) v += def.manaCostDelta?.(sctx) ?? 0;
      if (k === 'actionPoint') v += rt.apCostShift ?? 0;
    }
    out[k] = v;
  }
  return out;
}

// 冷却时长：基数 = def.charges?.cooldownTurns ?? 0（无冷却卡以 0 为基，可被 patch 出
// 冷却）；只改时长取值，不直接触碰 currentCooldown（计时语义归指令层）。
export function cooldownOf(rt) {
  const def = getSkillDefinition(rt.defId);
  let v = def.charges?.cooldownTurns ?? 0;
  for (const inst of modsOf(rt)) {
    const patch = reg.has(inst.modId) ? reg.get(inst.modId).patch : null;
    v = applyNumOps(v, patch?.cooldown);
  }
  return v;
}

// def 形状的有效对象（喂 bakeCardFace 等吃 def 形状的消费方——烘焙链结构零改动，
// 挂上的词条自动进页脚词条行）。charges 保证存在（cooldown patch 可从无到有）。
export function effectiveDefOf(rt, sctx = null) {
  const def = getSkillDefinition(rt.defId);
  const cost = costOf(rt, sctx);
  return {
    ...def,
    keywords: keywordsOf(rt),
    cost: { ...def.cost, mana: cost.mana, actionPoint: cost.actionPoint },
    charges: { ...def.charges, cooldownTurns: cooldownOf(rt) },
  };
}

// ---- def 声明式打包（enterBattle 对账）----

// 摘除 def 来源且不属当前 defId 的旧项（转化/晋升换绑后重推导，防残留旧定义行为），
// 挂上当前 def.modifiers 声明的项（source = `def:${defId}`）。
// ⚠ 不跑 onDetach / 订阅清理：def 来源项的订阅在唯一换绑路径（leaveBattle→enterBattle）
// 已被前者的前缀注销整体拆除，战斗起手的克隆上更无订阅可言；纯数据对账即可。
export function rederiveDefModifiers(rt, def) {
  const tagged = `def:${def.id}`;
  if (Array.isArray(rt.modifiers)) {
    rt.modifiers = rt.modifiers.filter((m) => !(typeof m.source === 'string' && m.source.startsWith('def:') && m.source !== tagged));
  }
  for (const entry of def.modifiers ?? []) {
    const e = typeof entry === 'string' ? { modId: entry } : entry;
    attachModifierInstance(rt, { modId: e.modId, data: e.data ?? {}, source: tagged });
  }
}

// ---- 行为面编译（订阅注册）----

// 编译并注册单条 modifier 的全部订阅（通用 subscriptions + onDraw/turnEndInHand 糖）。
// sctx 捕获注册时的 { ...ctx, self, def }——其中的 kernel/battleState/player 引用在
// 战斗期内稳定（与 def.subscriptions 同一口径）。返回注册的订阅条目数组。
export function registerModifierHooks(ctx, sctx, inst) {
  const mdef = reg.get(inst.modId); // 未注册即抛：定义期错误应在挂载时暴露
  const owner = `${sctx.self.uniqueID}:mod:${inst.modId}`;
  const subs = [];
  if (mdef.subscriptions) subs.push(...mdef.subscriptions(inst, sctx));
  if (mdef.onDraw) {
    subs.push({
      when: DrawCardsInstruction,
      phase: 'post',
      filter: (instr) => (instr.result?.drawn ?? []).some((c) => c.uniqueID === sctx.self.uniqueID),
      react: (instr) => mdef.onDraw(inst, sctx, instr),
    });
  }
  if (mdef.turnEndInHand) {
    subs.push({
      when: PlayerTurnEndInstruction,
      phase: 'post',
      filter: (instr, c) => zoneOf(c.battleState, sctx.self.uniqueID) === 'hand',
      react: (instr, c) => mdef.turnEndInHand(inst, sctx, instr),
    });
  }
  return subs.map((sub) => ctx.kernel.addSubscription({ window: 'battle', ...sub, owner }));
}

// ---- 内建 modifier ----

// 锁定（焚毁烙印，原 card.locked 布尔的迁移目标）：回合结束时仍在手则被焚毁，
// 打出/弃置即免除——**不拦出牌**。结算与清标由施加方（Boss/敌人的回合末订阅）负责。
registerCardModifier({
  id: 'locked',
  name: '锁定',
  icon: '🔒',
  color: '#c9a86a',
  describe: () => '回合结束时仍在手牌中，此卡将被焚毁（打出或弃置即免除）',
  agent: () => '规则：此卡带锁定标记期间，回合结束时若仍在手牌区则被焚毁；打出、弃置或任何离手路径均免除并移除标记。锁定不阻止打出。',
});

// ---- 锁定烙印的回合末结算（施加方订阅的通用段，bosses.js/chapter2.js 共用）----
// 口径：本轮只结算「已在手」的锁定卡（回合末仍在手则焚毁），牌库里的标留给下一拍
// 继续等；清标区缺省手牌/焚毁/待结算（神兵蓄能口径：牌库的标要活到抽进手为止——
// 离手即免除；施加方如需连牌库一起清，传扩展 zones）。施加方自己包
// addSubscription（filter 带 !unit.isDead()——施加者死亡后不再结算）。
export function lockedCardsSettleReact(instr, c, zones = ['hand', 'burnt', 'pending']) {
  for (const card of [...c.battleState.zones.hand]) {
    if (hasCardModifier(card, 'locked') && zoneOf(c.battleState, card.uniqueID) === 'hand') {
      c.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: card.uniqueID }), instr);
    }
  }
  for (const zone of zones) {
    for (const card of c.battleState.zones[zone]) detachModifierInstance(card, 'locked');
  }
}
