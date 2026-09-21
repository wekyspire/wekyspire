import { createSkillRuntime } from '../state/skillRuntime.js';
import { BODY_STARTER_DECK } from '../content/bodySkills.js';

// 开局路线（2026-09-21 D2，杀戮尖塔式选角）：各体系有专属起始牌组 + 体系基础能力
// 开局即授予 + 灵脉直接 1 级（不占 6 次进阶额度）。这取代了旧「首进阶送基石卡 +
// 体系能力 + 种子包救火」的补丁结构——路线选择直接消除「全员体修开局 → 转型慢」。
//
// 对价（用户定 2026-09-21）：
//   · 灵脉路线 = leino 1 + 体系基石卡 + 体系能力，牌组由通用填充卡（拳/盾）补足；
//   · 体修路线啥都不拿（无灵脉可点）——补偿是体修基础能力「AP 上限 +1」（D1：
//     体修实质维持 4 AP，与法师的 3 AP 形成「体修吃 AP、法师吃魏启」分工轴），
//     以及拳/盾填充卡的晋升通道（见 promotion.js 的 FILLER_STARTERS 门禁）。
// 种子包新定位（D2-c）：首体系不再发种子包——它只在局中**第二体系 0→1** 时作为
// 骨架包出现（ascension.js 的 0→1 获赠逻辑天然满足：路线体系开局已是 1 级，
// 不会再触发首进阶赠送）。

const FILLER = Object.freeze(['punch', 'punch', 'punch', 'punch', 'guard', 'guard', 'guard']);
// 火路线填充加厚（2026-09-21 用户定：拳 4 盾 5）——基石三张已覆盖过牌/叠炎/回蓝，
// 填充偏防御，兜住自焚件（急燃自身燃烧 4）的血线
const FILLER_FIRE = Object.freeze(['punch', 'punch', 'punch', 'punch', 'guard', 'guard', 'guard', 'guard', 'guard']);

export const ROUTES = Object.freeze({
  body: Object.freeze({
    id: 'body', name: '体修', leino: null, ability: null, apBonus: 1,
    deck: Object.freeze([...BODY_STARTER_DECK]),
    blurb: '肉身成圣——没有灵脉天赐，全靠一拳一盾打出来（AP 上限 +1）',
  }),
  fire: Object.freeze({
    id: 'fire', name: '火灵脉', leino: 'fire', ability: 'fireVein', apBonus: 0,
    // 基石三张：火弹术（过牌）/ 点火（叠炎）/ 急燃 C（回蓝——C 位 2026-09-21 为此补回）
    deck: Object.freeze(['inflame', 'fireBolt', 'flashBurn', ...FILLER_FIRE]),
    blurb: '爆发与燃烧之脉——高蓝耗、高副作用，换爆炸输出',
  }),
  wood: Object.freeze({
    id: 'wood', name: '木灵脉', leino: 'wood', ability: 'woodVein', apBonus: 0,
    deck: Object.freeze(['poisonSting', 'breathOfLife', ...FILLER]),
    blurb: '再生与凋零之脉——以血养藤，以毒磨骨',
  }),
  air: Object.freeze({
    id: 'air', name: '空灵脉', leino: 'air', ability: 'airVein', apBonus: 0,
    deck: Object.freeze(['windBlade', 'atEase', ...FILLER]),
    blurb: '风行与闪避之脉——来无影，去无踪',
  }),
});

export const ROUTE_IDS = Object.freeze(Object.keys(ROUTES));

/**
 * 把路线授予落到 run 上（createRun 的唯一调用点；player 已就位于 run.player）。
 * 牌组只在牌组为空时铺设（读档/预构造 Player 的路线字段仍会被记录与授予——
 * 读档恢复时恢复的是现场，授予早已结算过；restoreRunFromSave 不经这里）。
 */
export function applyRoute(run, routeId) {
  const route = ROUTES[routeId];
  if (!route) throw new Error(`未知开局路线：${routeId}`);
  run.route = routeId;
  const p = run.player;
  if (!p.deck.length) p.deck = route.deck.map(id => createSkillRuntime(id));
  if (route.leino) {
    p.leino[route.leino] = Math.max(p.leino[route.leino] ?? 0, 1);
    if (route.ability && !p.abilities.includes(route.ability)) p.abilities.push(route.ability);
  }
  if (route.apBonus) {
    // 走 baseStats（与 gainMaxHp 同口径）——refreshRunModifiers 每次从基准重算，不会被抹
    p.baseStats.maxActionPoints = (p.baseStats.maxActionPoints ?? p.maxActionPoints) + route.apBonus;
    p.maxActionPoints += route.apBonus;
    p.actionPoints = p.maxActionPoints;
  }
  return run;
}
