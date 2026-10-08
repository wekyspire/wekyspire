// 施术演出模板系统（spellFx，2026-09-30 用户定「动画逻辑生成器」架构）：
// 类比 PCG 管线（生成器 → 物体生成器 → SDK）的三层——
//   · 基础块 SDK：fx/spells/blocks.js（cardFlare/arcProjectile/impactBurst/slashSweep/
//     punchImpact/fireBurst/lightPillar…）
//   · 模板生成器：本目录一文件一模板，`build(params)` 拼装基础块产出「动画逻辑本身」
//   · 决议链 + 节拍接线：本文件管施术拍（BASE → SERIES_SPELLS → CARD_SPELLS，
//     挂 _skillDisplay 节拍）；**伤害拍**（命中那一刻）归 damageFx.js
//     （resolveDamageFx + runDamageBeat，挂 _damageHit 节拍）。
//
// 模板契约（动画逻辑生成器）：
//   { defaults, build(params) → async (ctx, deps, notify) => void, warm?(deps) }
//   - 返回的 async 协程即动画逻辑；ctx = fx/script 的 ScriptContext
//     （tween/wait/spawn + 结构化 kill——被杀时后续语句不执行、onKill 清理必达）
//   - notify() = 通知 sequencer「本节拍完成，可进下一个动画」。时机归模板自选
//     （2026-09-30 用户定的三档口径）：
//       · 小卡 200~500ms：全程演完才 notify（短促刀光/抓伤）
//       · 大卡：主体落定即 notify（如爆炸开始后 ~700ms），余烬等无主资产后台散尽
//       · 依赖战斗实体不被打扰的强卡（摧山斩类：受击 billboard 断裂两半等）：
//         全程演完才 notify——sequencer 串行化即实体锁，后续节拍动不了它
//   - runner 保证 notify 幂等 + 异常/被杀兜底必达（节拍链永不被 Jam）
//   - notify 之后只许存在无主资产（ttl 粒子自然熄 / 灯强度 tween 归零 / gsap 自驱）；
//     自建 mesh/材质必须在 notify 前回收完毕（onKill 只兜异常路径）
//
// 决议链（stage 层表驱动——core 的技能 def 不加视觉字段，外观策略集中查表）：
//   CARD_SPELLS[defId]（逐卡覆写：换模板或调参数）→ SERIES_SPELLS[series]
//   （体系级 { id, params }）→ null（BASE = _skillDisplay 现行为原样，零回归）。
//   参数合并 defaults ← 体系行 ← 逐卡行。观战兼容：模板选择只用 defId/series
//   （两端同 bundle 反查），wire 契约零改动。
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { runScript } from '../script.js';
import { uniform, uv } from 'three/tsl';
import { spellQuad, linearColor, warmSpellQuad as warmVariant, compileWarmSpellQuads } from './blocks.js';
import { moonWarmQuad } from './moonArc.js';
import { punchShade, slashShade, projectileShade, ringFlashShade, fireBurstShade, beamShade, veilShade, fireOrbShade, qiGatherShade, groundRingShade } from './shaders.js';
import { emberBurst } from './emberBurst.js';
import { castFlare } from './castFlare.js';
import { fireballCast } from './fireballCast.js';
import { fireRainCast } from './fireRainCast.js';
import { igniteCast } from './igniteCast.js';
import { heavenCleave } from './heavenCleave.js';
import { fistCast } from './fistCast.js';
import { burnSurge } from './burnSurge.js';
import { sparkCast } from './sparkCast.js';
import { selfFlame } from './selfFlame.js';
import { fuelCast } from './fuelCast.js';
import { fireWhirlCast } from './fireWhirlCast.js';
import { FIRE_WHIRL_ORBIT, FIRE_WHIRL_ORBIT_CHANT } from '../gpu/fireWhirlOrbit.js';
import { bladeCast } from './bladeCast.js';
import { blockCast } from './blockCast.js';
import { manaCast } from './manaCast.js';
import { silenceCast } from './silenceCast.js';
import { chargeUpCast } from './chargeUpCast.js';
import { emptyFistCast } from './emptyFistCast.js';
import { voidFistCast } from './voidFistCast.js';
import { meltCast } from './meltCast.js';
import { siphonCast } from './siphonCast.js';
import { chantOffCast } from './chantOffCast.js';
import { sparkSalvo } from './sparkSalvo.js';

export { resolveDamageFx, runDamageBeat, slashScaleFor, punchScaleFor, fireScaleFor } from './damageFx.js';

// 模板注册表（一文件一模板，id 即登记键）
const TEMPLATES = {
  emberBurst, castFlare, fireballCast, fireRainCast, igniteCast, heavenCleave,
  fistCast, burnSurge, sparkCast, selfFlame, fuelCast, fireWhirlCast,
  bladeCast, blockCast, manaCast, silenceCast, chargeUpCast,
  emptyFistCast, voidFistCast, meltCast, siphonCast, sparkSalvo, chantOffCast,
};

// 体系级映射（series → { id, params }）。命中本体全在伤害拍的体系挂 castFlare
// （起手色参数化）；投射物体系挂各自的 cast 模板（落点爆在伤害拍）。
const SERIES_SPELLS = {
  ember:         { id: 'emberBurst' },                                   // 余烬系（旧先锋模板整链）
  blade:         { id: 'bladeCast' },                                    // 刀法：冷白刀光（四模式自动路由）
  block:         { id: 'blockCast' },                                    // 格挡/架势：光壁/气场（攻击链逐卡走 fistCast）
  fist:          { id: 'fistCast' },                                     // 体修：拳风破空（四模式）
  punch:         { id: 'fistCast' },                                     // 基石拳同体修
  fireBall:      { id: 'fireballCast' },                                 // 火球链+蓄热火球
  firstStrike:   { id: 'fireballCast' },                                 // 先发火弹/火矢/火球
  fireRain:      { id: 'fireRainCast', params: { aoe: true } },            // 火雨/火瀑（群伤全体落雨）
  ignite:        { id: 'igniteCast' },                                   // 点火/热浪
  burst:         { id: 'castFlare', params: { flareColor: 0xff9a3d } },  // 爆裂咏唱（新星在伤害拍）
  selfImmolate:  { id: 'castFlare', params: { flareColor: 0xffb066 } },  // 焰刃/玩火（火刀）
  // ---- 2026-10-02 火系铺量 ----
  burnDoubler:   { id: 'burnSurge', params: { scale: 1.5 } },            // 焚烧/星炎：燃烧翻倍
  spark:         { id: 'sparkCast' },                                    // 火花链（多段小伤连珠）
  fireWhirl:     { id: 'fireWhirlCast' },                                // 火焰旋风：主角火环外推
  flameHeal:     { id: 'selfFlame', params: {                            // 焰愈：金焰缠身
                     color: [1.0, 0.72, 0.30], hot: [1.2, 1.05, 0.70], ember: [1.0, 0.42, 0.08], core: 0xffc27a } },
  kindling:       { id: 'selfFlame', params: { form: 'wisp', scale: 0.75 } },  // 可燃血液（轻飘焰）
  fever:          { id: 'selfFlame', params: { ms: 380, scale: 0.9,         // 急燃/高热：急字当头——
                     sparks: { count: 18, speed: 14, ttl: 0.9, gravity: 15 } } },  // 火星密而蹿（与燃心决分档）
  fireWall:       { id: 'selfFlame', params: { form: 'veil', scale: 0.9 } },   // 火墙（火帘）
  magmaArmor:     { id: 'selfFlame', params: { form: 'veil',               // 熔岩铠甲：深红岩浆帘
                     color: [0.92, 0.20, 0.07], hot: [1.15, 0.68, 0.35], ember: [0.8, 0.10, 0.02], core: 0xff5a2a } },
  bloodFlame:     { id: 'selfFlame', params: { form: 'veil',               // 血焰：深红血幕
                     color: [0.95, 0.17, 0.09], hot: [1.15, 0.55, 0.40], ember: [0.75, 0.06, 0.05], core: 0xff4a3a } },
  willOWisp:      { id: 'selfFlame', params: { form: 'wisp',               // 鬼火：青白冷焰漂浮
                     color: [0.45, 0.95, 0.70], hot: [0.80, 1.10, 0.95], ember: [0.15, 0.55, 0.35], core: 0x7affc8,
                     sparks: { color: 0x8affd0 } } },
  mirrorBurn:    { id: 'selfFlame' },                                    // 镜燃
  fireChant:     { id: 'selfFlame' },                                    // 燃心决/绝炎/火焰披风（自燃件）
  fuel:          { id: 'fuelCast' },                                     // 添柴：焚卡回蓝
  pourOil:       { id: 'fuelCast' },                                     // 浇油（焚牌抽牌）
  condense:      { id: 'igniteCast', params: { selfSparks: true } },     // 焰涌链：点火+纳气
  shock:         { id: 'fireballCast', params: {                         // 爆裂冲击/轰灭：重弹平射
                     size: 6.0, projMs: 230, arcH: 1.5, color: [1.0, 0.36, 0.12], core: 0xff6a3d } },
  fireControl:   { id: 'castFlare', params: { flareColor: 0xff8a4d } },  // 控火术（0 费快件——短起手）
  fireControlFinder: { id: 'castFlare', params: { flareColor: 0xff8a4d } },
  // ---- 2026-10-02 核心卡批 ----
  fireTemper:    { id: 'manaCast', params: { from: 'card', fire: true,      // 淬炼：魏启回流（萃取火系镜像），
                     color: [0.52, 0.74, 1.22], hot: [1.30, 1.16, 0.80], core: 0x8ab4ff } }, // 热核金白淬闪
  relief:        { id: 'blockCast', params: { mode: 'ward',              // 泄压阀：魏启蓝转盾（泄压成墙）
                     color: [0.45, 0.70, 1.25], hot: [0.90, 1.08, 1.45], core: 0x6fa8ff } },
  silence:       { id: 'silenceCast' },                                  // 沉默：骤冷压暗（逐张熄光在 CHANT_TOGGLED 拍）
};

// 逐卡覆写（defId → { template, params }）：换模板或微调参数（同体系内单卡变体）。
const CARD_SPELLS = {
  // 火球链变体：连发双弹 / 大火球加重弹 / 白炽火球热核偏白
  fireBarrage:    { template: 'fireballCast', params: { shots: 2 } },
  greaterFireBall: { template: 'fireballCast', params: { size: 3.4, projMs: 380, arcH: 8 } },
  heatBallMaster: { template: 'fireballCast', params: { hot: [1.0, 0.95, 0.86], color: [1.0, 0.5, 0.2] } },
  // 先发链体量递进：小弹快掷 / 火矢平弧疾射 / 先发火球标准
  firstShot:      { template: 'fireballCast', params: { size: 1.7, projMs: 240, arcH: 3 } },
  firstArrow:     { template: 'fireballCast', params: { size: 1.4, projMs: 200, arcH: 1 } },
  // S/X 天斩：实体锁全演出 v2（压迫幕+fov 拉大+微震 → 白刃一闪+全屏白闪 →
  // 白金迸裂+冲天光柱+复原；击杀走立牌断裂两半）。A 摧山斩入档（轻量级）
  mountainCleave:  { template: 'heavenCleave', params: { grade: 'A' } },
  skyCleave:      { template: 'heavenCleave', params: { grade: 'S' } },
  godCleave:      { template: 'heavenCleave', params: { grade: 'X' } },
  // ---- 体修逐卡（2026-10-02）----
  // 重拳蓄力：重拳链/炮/真/虎（空形拳已迁 S 签名档）
  heavyFistC:     { template: 'fistCast', params: { mode: 'heavy' } },
  heavyFistB:     { template: 'fistCast', params: { mode: 'heavy' } },
  heavyFistA:     { template: 'fistCast', params: { mode: 'heavy' } },
  collapseFistS:  { template: 'fistCast', params: { mode: 'heavy', gatherMs: 520 } },
  cannonFist:     { template: 'fistCast', params: { mode: 'heavy' } },
  trueFist:       { template: 'fistCast', params: { mode: 'heavy', gatherMs: 520 } },
  tigerFist:      { template: 'fistCast', params: { mode: 'heavy' } },
  fullChargeC:     { template: 'fistCast', params: { mode: 'heavy', aoe: true } },      // 蓄满一击（群）
  fullChargeB: { template: 'fistCast', params: { mode: 'heavy', aoe: true } },
  fullSpirit:     { template: 'fistCast', params: { mode: 'heavy', aoe: true, gatherMs: 500 } },  // 全神一击（群）
  // S 签名（2026-10-02 批次3）：空形 = 静场蓄意（兑付在伤害拍 voidStrike——
  // 后手不成立则没有伤害拍，「打空就是空」）；虚形 = 七道虚影细流汇聚入体
  // （暧昧语言：不预判后手，成立则随后七牌入手兑现，不成立散作虚无）
  emptyFist:      { template: 'emptyFistCast' },   // S 空形拳
  voidFist:       { template: 'voidFistCast' },    // S 虚形拳
  // 连击多射：雨拳/乱拳/千手/万手
  rainFist:       { template: 'fistCast', params: { mode: 'rapid', shots: 3 } },
  wildFlurry:     { template: 'fistCast', params: { mode: 'rapid', shots: 3 } },
  thousandHands:  { template: 'fistCast', params: { mode: 'rapid', shots: 4, staggerMs: 80 } },
  myriadHands:    { template: 'fistCast', params: { mode: 'rapid', shots: 6, staggerMs: 65 } },   // S 万手
  // ---- 火系逐卡（2026-10-02）----
  burnBurstStar:  { template: 'burnSurge', params: { scale: 2.0, grand: true } },     // 星炎（×3，S）
  nirvana:        { template: 'selfFlame', params: { pillar: true, scale: 1.1,    // 涅槃（S）
                    color: [1.0, 0.72, 0.30], hot: [1.3, 1.1, 0.75], ember: [1.0, 0.42, 0.08], core: 0xffd27a } },
  flameHealA:      { template: 'selfFlame', params: { pillar: true, scale: 1.0,    // 焰愈（A）
                    color: [1.0, 0.72, 0.30], hot: [1.2, 1.05, 0.70], ember: [1.0, 0.42, 0.08], core: 0xffc27a } },
  // 群燃件（对所有敌人施加燃烧）：逐敌点火种
  warmUpC:         { template: 'igniteCast', params: { all: true } },
  warmUpB:      { template: 'igniteCast', params: { all: true } },
  warmUpA:     { template: 'igniteCast', params: { all: true, selfSparks: true } },  // 取暖（A）：己身也燃
  // 焚卡回蓝件的火咏唱变体
  smeltB:      { template: 'fuelCast' },
  smeltA:  { template: 'fuelCast' },
  // 焚尽牌库/手牌的决绝件（depth）
  lastStandB:      { template: 'fuelCast', params: { motes: 5, core: 0xff5a2a } },
  lastStandA: { template: 'fuelCast', params: { motes: 5, core: 0xff5a2a } },
  allIn:          { template: 'fuelCast', params: { motes: 6, core: 0xff5a2a } },
  // 庆典礼花（抽出所有爆裂术）：金焰缠身 + 火柱
  fireworkShow:   { template: 'selfFlame', params: { pillar: true, scale: 1.05,
                    color: [1.0, 0.75, 0.30], hot: [1.25, 1.1, 0.75], ember: [1.0, 0.45, 0.10], core: 0xffd27a,
                    sparks: { color: 0xffd27a, count: 24 } } },
  grandNewYear:   { template: 'selfFlame', params: { pillar: true, scale: 1.2,
                    color: [1.0, 0.70, 0.25], hot: [1.35, 1.15, 0.80], ember: [1.0, 0.40, 0.08], core: 0xffe08a,
                    sparks: { color: 0xffe08a, count: 30 } } },
  // ---- 刀法逐卡（2026-10-02 二批）----
  // 横劈链（群伤）：场景级横劈巨刀光（一记扫过敌阵，逐敌命中在伤害拍）
  cleave:           { template: 'bladeCast', params: { mode: 'cleave' } },
  powerCleave:      { template: 'bladeCast', params: { mode: 'cleave', cleaveMs: 245,
                        spanExtra: 24, cleaveShake: 0.8 } },
  riftCleave:       { template: 'bladeCast', params: { mode: 'cleave', cleaveMs: 280,
                        spanExtra: 28, cleaveShake: 1.3, moonHot: [4.2, 4.5, 5.4],
                        sweepColor: [0.50, 0.55, 1.10] } },   // 裂空劈（A）：更长更白热偏冷紫 + 大震
  // 飞刀链：小刀错峰连投
  flyingDaggerC:     { template: 'bladeCast', params: { mode: 'daggers' } },
  flyingDaggerB:      { template: 'bladeCast', params: { mode: 'daggers' } },
  flyingDaggerA: { template: 'bladeCast', params: { mode: 'daggers' } },
  returningDagger:  { template: 'bladeCast', params: { mode: 'daggers' } },
  fineDagger:       { template: 'bladeCast', params: { mode: 'daggers' } },
  perfectDagger:    { template: 'bladeCast', params: { mode: 'daggers' } },
  // 碎铁雨：天顶泼落
  ironRainB:         { template: 'bladeCast', params: { mode: 'cascade' } },
  ironRainA:        { template: 'bladeCast', params: { mode: 'cascade' } },
  // 磨刀链：绕身刀光掺金橙火星
  honeBladeC:        { template: 'bladeCast', params: { grindSparks: true } },
  honeBladeB:    { template: 'bladeCast', params: { grindSparks: true } },
  honeBladeA:  { template: 'bladeCast', params: { grindSparks: true } },
  sharpenC:        { template: 'bladeCast', params: { grindSparks: true } },
  sharpenB:      { template: 'bladeCast', params: { grindSparks: true } },
  honeEdge:         { template: 'bladeCast', params: { grindSparks: true } },
  sharpenA:        { template: 'bladeCast', params: { grindSparks: true } },
  forgingBladeC:     { template: 'bladeCast', params: { grindSparks: true } },
  forgingBladeB: { template: 'bladeCast', params: { grindSparks: true } },
  forgingBladeA: { template: 'bladeCast', params: { grindSparks: true } },
  practiceBladeC:    { template: 'bladeCast', params: { grindSparks: true } },
  practiceBladeB: { template: 'bladeCast', params: { grindSparks: true } },
  practiceBladeA: { template: 'bladeCast', params: { grindSparks: true } },
  unsheathe:        { template: 'bladeCast', params: { core: 0xeaf2ff } },   // 拔刀术（A）：更亮起手
  // ---- 格挡逐卡（2026-10-02 二批）----
  // 守·加盾链（ward：起手一亮即止，盾的读法归护盾罩 fx/shieldDome.js——随盾量常驻）
  shieldC:            { template: 'blockCast', params: { mode: 'ward' } },
  blockC:         { template: 'blockCast', params: { mode: 'ward' } },
  blockB:       { template: 'blockCast', params: { mode: 'ward' } },
  blockA:      { template: 'blockCast', params: { mode: 'ward' } },
  perfectBlock:     { template: 'blockCast', params: { mode: 'ward',
                      color: [0.75, 0.88, 1.30], hot: [1.25, 1.35, 1.55] } },   // S 完美格挡：更亮更挺
  fortressC:          { template: 'blockCast', params: { mode: 'ward' } },
  fortressB:         { template: 'blockCast', params: { mode: 'ward' } },
  bronzeCity:       { template: 'blockCast', params: { mode: 'ward',
                      color: [1.05, 0.80, 0.45], hot: [1.30, 1.10, 0.70], core: 0xd8a860 } },  // 铜城：金铜调
  shieldB:      { template: 'blockCast', params: { mode: 'ward' } },
  shieldA: { template: 'blockCast', params: { mode: 'ward' } },
  psiShield:        { template: 'blockCast', params: { mode: 'ward',
                      color: [0.75, 0.60, 1.25], hot: [1.15, 1.00, 1.50], core: 0xb494f0 } },  // 灵能盾：蓝紫
  greaterPsiShield: { template: 'blockCast', params: { mode: 'ward',
                      color: [0.75, 0.60, 1.25], hot: [1.15, 1.00, 1.50], core: 0xb494f0 } },
  // 守·气场主题变体：狂战血红 / 血拳深红 / 集结金
  berserkStance:    { template: 'blockCast', params: { color: [1.10, 0.32, 0.26], hot: [1.35, 0.70, 0.55], core: 0xe05a4a } },
  berserkMastery:   { template: 'blockCast', params: { color: [1.10, 0.32, 0.26], hot: [1.35, 0.70, 0.55], core: 0xe05a4a } },
  bloodFistB:        { template: 'blockCast', params: { color: [0.90, 0.22, 0.18], hot: [1.25, 0.55, 0.45], core: 0xc03830 } },
  bloodFistA:       { template: 'blockCast', params: { color: [0.90, 0.22, 0.18], hot: [1.25, 0.55, 0.45], core: 0xc03830 } },
  limberUpC:            { template: 'blockCast', params: { color: [1.10, 0.90, 0.40], hot: [1.35, 1.15, 0.70], core: 0xe8cc60 } },
  limberUpB:        { template: 'blockCast', params: { color: [1.10, 0.90, 0.40], hot: [1.35, 1.15, 0.70], core: 0xe8cc60 } },
  limberUpA:      { template: 'blockCast', params: { color: [1.10, 0.90, 0.40], hot: [1.35, 1.15, 0.70], core: 0xe8cc60 } },
  // 攻·掌腿破架（体修同源——走 fistCast 拳风，命中拍 punch 由 damageFx block 行承担）
  preciseStrikeC:    { template: 'fistCast', params: { mode: 'strike' } },
  doubleStrike:     { template: 'fistCast', params: { mode: 'rapid', shots: 2, staggerMs: 110 } },
  preciseStrikeB:       { template: 'fistCast', params: { mode: 'strike' } },
  preciseStrikeA:     { template: 'fistCast', params: { mode: 'strike' } },
  pluckStar:        { template: 'fistCast', params: { mode: 'heavy', gatherMs: 480 } },   // 摘星（S）
  dismantleC:      { template: 'fistCast', params: { mode: 'strike' } },
  dismantleB:      { template: 'fistCast', params: { mode: 'strike' } },
  pierceHeart:      { template: 'fistCast', params: { mode: 'heavy' } },                  // 穿心（A）
  sweepLegC:       { template: 'fistCast', params: { mode: 'strike' } },      // 重踏
  sweepLegB:        { template: 'fistCast', params: { mode: 'strike' } },
  sweepLegA:        { template: 'fistCast', params: { mode: 'heavy' } },
  whirlLeg:         { template: 'fistCast', params: { mode: 'heavy' } },       // 旋风腿（S）
  shatterHitC:       { template: 'fistCast', params: { mode: 'strike' } },
  shatterHitB:      { template: 'fistCast', params: { mode: 'strike' } },
  shatterHead:      { template: 'fistCast', params: { mode: 'heavy' } },
  endureB:       { template: 'fistCast', params: { mode: 'strike' } },
  // ---- 体修·非拳件（2026-10-02 核心卡批：series 'fist' 的兜底拳风对这些卡是语义错配）----
  // 蓄力链（洗入瞬击）：气团数 = 洗入数；一瞬千击 toHand（发现 5 张直接进手）
  chargeUp:         { template: 'chargeUpCast', params: { count: 2 } },
  comboStrike:      { template: 'chargeUpCast', params: { count: 3 } },
  quadrupleHit:     { template: 'chargeUpCast', params: { count: 4 } },
  instantThousand:  { template: 'chargeUpCast', params: { count: 5, toHand: true } },
  // 引擎咏唱激活（借力/太极/无限连击/变招/混元）：脚下气场环 = 「进架」语言，
  // 体修白气（守势灵蓝的低饱和近亲——环语相同、色相分家）；太极（S）热核更亮
  leverageC:        { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  leverageB:        { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  leverageA:        { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  taijiS:           { template: 'blockCast', params: {
                        color: [0.90, 0.92, 1.02], hot: [1.25, 1.25, 1.30], core: 0xe8ecf4 } },
  endlessCombo:     { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  shiftMoveB:       { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  shiftMoveA:       { template: 'blockCast', params: {
                        color: [0.86, 0.89, 0.98], hot: [1.10, 1.12, 1.20], core: 0xd8dce8 } },
  hunYuanS:         { template: 'blockCast', params: {
                        color: [0.90, 0.92, 1.02], hot: [1.25, 1.25, 1.30], core: 0xe8ecf4 } },
  // ---- 经济卡（无 series，逐卡挂 manaCast；魏启蓝 / 行动力黄）----
  extract:          { template: 'manaCast', params: { from: 'enemy' } },
  deepExtract:      { template: 'manaCast', params: { from: 'enemy', streams: 5 } },
  limitExtract:     { template: 'manaCast', params: { from: 'enemy', streams: 6, size: 2.0 } },
  drawQiC:           { template: 'manaCast', params: { from: 'around' } },
  drawQiB:       { template: 'manaCast', params: { from: 'around' } },
  squeezeQi:        { template: 'manaCast', params: { from: 'around', streams: 6, projMs: 260 } },
  manaJar:          { template: 'manaCast', params: { from: 'card' } },
  manaJarPlus:      { template: 'manaCast', params: { from: 'card' } },
  manaJarRoyal:     { template: 'manaCast', params: { from: 'card', streams: 5 } },
  manaJarLegend:    { template: 'manaCast', params: { from: 'card', streams: 6, size: 2.0 } },
  swiftManaJar:     { template: 'manaCast', params: { from: 'card', projMs: 240 } },
  swiftManaJarPlus: { template: 'manaCast', params: { from: 'card', projMs: 240, streams: 5 } },
  stimulant:        { template: 'manaCast', params: { from: 'card',                       // 兴奋剂：行动力黄
                      color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60], core: 0xf0d060 } },
  burstStimulant:   { template: 'manaCast', params: { from: 'card',
                      color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60], core: 0xf0d060, streams: 5 } },
  fullStimulant:    { template: 'manaCast', params: { from: 'card',
                      color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60], core: 0xf0d060, streams: 5 } },
  // ---- 遗物枪击卡（亮黄白细直弹道——枪火语言：仍走投射物，弹道细直平弧）----
  rapidFire:        { template: 'bladeCast', params: { mode: 'daggers',
                      color: [1.10, 1.02, 0.62], hot: [1.35, 1.28, 0.95], core: 0xf0e0a0 } },
  pointShot:        { template: 'bladeCast', params: { mode: 'slash', arcH: 0.15,
                      color: [1.10, 1.02, 0.62], hot: [1.35, 1.28, 0.95], core: 0xf0e0a0 } },
  piercingShot:     { template: 'bladeCast', params: { mode: 'slash', arcH: 0.10,
                      color: [1.10, 1.02, 0.62], hot: [1.35, 1.28, 0.95], core: 0xf0e0a0 } },
  // ---- 火系补量（2026-10-06：原 depth/melt 等 15 张零覆盖卡 + 特征卡签名）----
  // 回蓝件（余热/重燃/回响烈焰）：火焰能量回流语言——manaCast 火调（余温收聚）
  residualHeatA:   { template: 'manaCast', params: { from: 'around', fire: true,
                     color: [1.0, 0.55, 0.22], hot: [1.2, 0.95, 0.60], core: 0xff9a4d } },
  residualHeatB:   { template: 'manaCast', params: { from: 'around', fire: true,
                     color: [1.0, 0.55, 0.22], hot: [1.2, 0.95, 0.60], core: 0xff9a4d } },
  reignite:        { template: 'manaCast', params: { from: 'around', streams: 6, pillar: true, fire: true,   // S 重燃：余烬复燃
                     color: [1.0, 0.50, 0.18], hot: [1.3, 1.05, 0.65], core: 0xff8a3d } },
  echoingFlamesA:  { template: 'manaCast', params: { from: 'around', streams: 5, fire: true,   // 坟墓回蓝（战场余灰）
                     color: [0.80, 0.42, 0.25], hot: [1.05, 0.72, 0.45], core: 0xc87848 } },
  echoingFlamesB:  { template: 'manaCast', params: { from: 'around', streams: 5, fire: true,
                     color: [0.80, 0.42, 0.25], hot: [1.05, 0.72, 0.45], core: 0xc87848 } },
  // 积薪（弃牌回蓝 = 烧柴语言）
  stackFirewoodA:  { template: 'fuelCast', params: { motes: 2 } },
  stackFirewoodB:  { template: 'fuelCast', params: { motes: 3 } },
  stackFirewoodC:  { template: 'fuelCast', params: { motes: 3 } },
  // 烫手（抽4）/爆炸艺术（发现爆裂）/突破极限（透支魏启）：短起手——主演出在 UI 层
  hotHandsA:       { template: 'castFlare', params: { flareColor: 0xff7a4d } },
  hotHandsB:       { template: 'castFlare', params: { flareColor: 0xff7a4d } },
  hotHandsC:       { template: 'castFlare', params: { flareColor: 0xff7a4d } },
  explosiveArtA:   { template: 'castFlare', params: { flareColor: 0xff9a3d } },
  explosiveArtB:   { template: 'castFlare', params: { flareColor: 0xff9a3d } },
  explosiveArtC:   { template: 'castFlare', params: { flareColor: 0xff9a3d } },
  breakLimit:      { template: 'castFlare', params: { flareColor: 0xffd08a, ms: 280, scale: 1.55 } },
  // 熔融/熔毁：燃烧剥离（消耗自身燃烧→群虚弱）——新模板 meltCast
  meltDown:        { template: 'meltCast' },
  meltCollapse:    { template: 'meltCast', params: { staggerMs: 70 } },
  // ---- 消耗燃烧件（共享吸焰原语 siphonCast，2026-10-07）----
  gatherFlame:     { template: 'siphonCast', params: { from: 'all', to: 'self' } },   // 火源归一（全场→己）
  burnSnapB:       { template: 'siphonCast', params: { from: 'target', to: 'above' } }, // 燃爆（吸干变现）
  burnSnapA:       { template: 'siphonCast', params: { from: 'target', to: 'above' } },
  douseFlameB:     { template: 'siphonCast', params: { from: 'self', to: 'above' } },  // 灭火（驱散己焰）
  douseFlameA:     { template: 'siphonCast', params: { from: 'self', to: 'above' } },
  // 控火术：燃（赋予燃烧3——焰种原语点火语言）
  fireControlBurn: { template: 'igniteCast' },
  // 终极火花（S 随机×7）：七连预闪起手（伤害拍逐发乱射已有）——新模板 sparkSalvo
  ultimateSpark:   { template: 'sparkSalvo' },
  // 焰流飓风（S）：双段环叠浪
  flameHurricane:  { template: 'fireWhirlCast', params: { rings: 2 } },
  // 火雨链等阶体量：C 默认 1.8 → B 2.2 → A 火瀑 3.4（群伤全体落雨在体系行 aoe）
  fireRainB:       { template: 'fireRainCast', params: { aoe: true, size: 3.0 } },
  fireStream:      { template: 'fireRainCast', params: { aoe: true, size: 4.4, projMs: 420, dropH: 32 } },
  // 无上控火术（S 发现件）：金橙亮档起手
  fireControlSupreme: { template: 'castFlare', params: { flareColor: 0xffc86a, ms: 300, scale: 1.7 } },
  // 白炽（A）：白热核的自燃爆
  whiteFever:      { template: 'selfFlame', params: {
                     color: [1.0, 0.85, 0.60], hot: [1.35, 1.28, 1.10], ember: [1.0, 0.55, 0.25], core: 0xffe8b0 } },
  // 业火（A 反射引擎）：深红爆 + 内芯金
  karmaFire:       { template: 'selfFlame', params: {
                     color: [0.95, 0.28, 0.10], hot: [1.25, 0.95, 0.45], ember: [0.7, 0.06, 0.03], core: 0xff6a3a } },
  // 不灭火种（A 洗入余烬）：火种气团内聚（chargeUp 火调——洗入件同语言）
  eternalSpark:    { template: 'chargeUpCast', params: { count: 3,
                     color: [1.0, 0.60, 0.25], hot: [1.2, 1.0, 0.60], core: 0xffb066, accent: 0xffd97a } },
  // ---- 体修补量（2026-10-06：兽形拳族 / 龟系姿态 / S 引擎件）----
  // 兽形拳族：气劲色相分家（龙金 / 豹铜绿 / 蛇紫 / 仿灰）——形态走 fistCast 既有模式
  dragonFist:      { template: 'fistCast', params: { mode: 'strike', gatherMs: 360,
                     color: [1.0, 0.85, 0.42], hot: [1.40, 1.22, 0.72], core: 0xf0cc70 } },
  leopardFist:     { template: 'fistCast', params: { mode: 'strike',
                     color: [0.72, 0.80, 0.55], hot: [1.15, 1.25, 0.90], core: 0xb8c488 } },
  snakeFist:       { template: 'fistCast', params: { mode: 'strike',
                     color: [0.70, 0.52, 0.95], hot: [1.10, 0.95, 1.35], core: 0xa88ae8 } },
  mimicFist:       { template: 'fistCast', params: { mode: 'strike',
                     color: [0.72, 0.75, 0.80], hot: [1.05, 1.08, 1.15], core: 0xb8bcc4 } },
  // 龟系姿态：玄青调气场（「沉」的守势——与灵蓝守势分色相）
  divineTurtle:    { template: 'blockCast', params: {
                     color: [0.50, 0.78, 0.85], hot: [0.90, 1.20, 1.30], core: 0x84bcc4 } },
  mysticTurtle:    { template: 'blockCast', params: {
                     color: [0.50, 0.78, 0.85], hot: [0.90, 1.20, 1.30], core: 0x84bcc4 } },
  turtleStance:    { template: 'blockCast', params: {
                     color: [0.50, 0.78, 0.85], hot: [0.90, 1.20, 1.30], core: 0x84bcc4 } },
  // 大师姿态（金白）/ 武魂（破 = AP 的血橙）/ 无双（S 抽牌引擎的白金气场）
  heavenStance:    { template: 'blockCast', params: {
                     color: [1.00, 0.93, 0.75], hot: [1.30, 1.22, 1.02], core: 0xf0e4bc } },
  soulOfWar:       { template: 'blockCast', params: {
                     color: [1.00, 0.52, 0.28], hot: [1.30, 0.88, 0.62], core: 0xe0865a } },
  peerlessS:       { template: 'blockCast', params: {
                     color: [1.00, 0.95, 0.78], hot: [1.38, 1.26, 1.00], core: 0xf0e8c8 } },
  // 万变拳（S 选两卡免费发动）/ 坠机（A 肘击升阶）：选牌 UI 主场——短起手分调
  wildFistS:       { template: 'castFlare', params: { flareColor: 0xf2e7d2, ms: 280, scale: 1.55 } },
  crashLanding:    { template: 'castFlare', params: { flareColor: 0xd8dce8, ms: 260, scale: 1.5 } },
  // 肾上腺素（AP+抽牌）：能量入体 = manaCast AP 黄（与兴奋剂同语言）
  adrenalineA:     { template: 'manaCast', params: { from: 'card', streams: 3,
                     color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60], core: 0xf0d060 } },
  adrenalineB:     { template: 'manaCast', params: { from: 'card', streams: 3,
                     color: [1.10, 0.88, 0.30], hot: [1.35, 1.15, 0.60], core: 0xf0d060 } },
};

/**
 * 决议：defId → { template, params } | null。
 * @param {string} defId 技能 id（payload.def.id 或 skill.defId）
 */
export function resolveSpellFx(defId) {
  const card = CARD_SPELLS[defId];
  if (card) {
    const template = TEMPLATES[card.template];
    if (template) return { template, params: { ...(card.params ?? {}) } };
  }
  const def = (() => { try { return getSkillDefinition(defId); } catch { return null; } })();
  const row = SERIES_SPELLS[def?.series];
  const template = row ? TEMPLATES[row.id] : null;
  return template ? { template, params: { ...(row?.params ?? {}) } } : null;
}

/**
 * 在 ANIM_SKILL_USED 节拍内跑一次施术演出。
 * @returns {null | { done: Promise }} null = 未命中模板（调用方走 BASE 行为）；
 *   done = 协程整体落定（含 notify 之后的余烬段——调用方不必等它）
 */
export function runSpellFx({ defId, deps, notify, chantOff = false }) {
  let hit = resolveSpellFx(defId);
  if (!hit) return null;
  if (chantOff) {
    // 解除已激活咏唱：换用通用解除模板（收束熄灭——与激活演出分家），主题色
    // 继承激活行的参数（defaults ← 体系行 ← 逐卡行合并口径）
    const hp = { ...(hit.template.defaults ?? {}), ...hit.params };
    hit = { template: chantOffCast, params: { color: hp.color, hot: hp.hot, core: hp.core } };
  }
  deps.projectiles?.reset?.();   // 新一次施术拍：清掉上一张卡无人消费的抵达登记
  let notified = false;
  const notifySafe = () => { if (!notified) { notified = true; try { notify?.(); } catch (_) {} } };
  const fn = hit.template.build({ ...hit.params, _defId: defId });   // _defId：模板内反查 def（目标口径等）
  const h = runScript(async (ctx) => {
    try {
      await fn(ctx, deps, notifySafe);
    } finally {
      notifySafe();   // 模板忘调/异常/被杀：兜底必达，不 Jam 节拍链
    }
  }, { animator: deps.animator ?? null });
  // 节拍保险丝（ANIM_TIMING.SKILL_USED = 5s）强杀指令时协程由舞台 dispose 链兜底收
  return { done: h.promise };
}

/**
 * 战斗开场按卡组预告预热（shader 变体 compileAsync——Boss 房 charBurn 预热同款
 * 机制，2026-10-06 起真接通：WebGPU 首用管线异步编译 0.3~1.5s，不预热 = 首施法
 * 面片黑一拍。变体按 (shade, 常量色字面量) 缓存——同构新材质走共享程序缓存）。
 * @param {string[]} deckDefIds 卡组 defId 列表
 * @param {object} deps 舞台服务袋（renderer/camera）
 */
export function warmSpellFx(deckDefIds, deps) {
  // 固定字面量变体（伤害拍 punch/slash 的缺省色不随卡参数走，一次全覆盖）
  warmVariant('punch:default', () => spellQuad({
    shade: punchShade(uv(), uniform(0.5), linearColor([1.0, 0.92, 0.78]), linearColor([1.0, 0.98, 0.92]), linearColor([0.82, 0.92, 1.25])),
    width: 11.5, height: 7.6, name: 'warm:punch',
  }));
  warmVariant('slash:default', () => spellQuad({
    shade: slashShade(uv(), uniform(0.5), linearColor([1.0, 0.98, 0.92]), linearColor([0.5, 0.8, 1.6]), uniform(0.14), uniform(1), uniform(0.0)),
    width: 19, height: 6.2, name: 'warm:slash',
  }));
  // 逐卡变体：按真实参数（模板 defaults ← 体系行 ← 逐卡行合并）建该模板会用的 shade 面
  const seen = new Set();
  for (const id of deckDefIds ?? []) {
    const hit = resolveSpellFx(id);
    if (!hit || seen.has(hit.template)) continue;
    seen.add(hit.template);
    const build = WARM_VARIANTS.get(hit.template);
    if (!build) continue;
    const prm = { ...(hit.template.defaults ?? {}), ...hit.params };
    for (const v of build(prm)) warmVariant(v.key, v.mk);
  }
  // 粒子型施术（火旋风 GPU 池 custom 类型）：首次 compute 提交即编译管线——
  // 开场预激活两段（rateScale 0 不产粒子），避免首施法的 compute 编译卡顿
  if (deps?.worldPool && seen.has(TEMPLATES.fireWhirlCast)) {
    try {
      for (const t of [FIRE_WHIRL_ORBIT, FIRE_WHIRL_ORBIT_CHANT]) {
        deps.worldPool.setTypeActive(t, 1);
        deps.worldPool.setTypeRateScale(t, 0);
      }
    } catch (_) {}
  }
  compileWarmSpellQuads(deps?.renderer, deps?.camera);
}

// 变体构造器表：params → [{ key, mk } | ...]。key 含色字面量（同 shade 异色 =
// 异程序）。只收本批火系/体修词汇的 shade 面（blade/heavenCleave 走旧路径暂不预热）。
const projQuad = (p) => () => spellQuad({
  shade: projectileShade(uv(), uniform(5.0), linearColor(p.color), linearColor(p.hot)),
  width: 2.4, height: 2.4, name: 'warm:proj',
});
const fireOrbQuad = (p) => () => spellQuad({
  shade: fireOrbShade(uv(), uniform(5.0), linearColor(p.color), linearColor(p.hot), uniform(1.7)),
  width: 2.4, height: 2.4, name: 'warm:fireOrb',
});
const qiQuad = (p) => () => spellQuad({
  shade: qiGatherShade(uv(), uniform(6.0), uniform(0.8), linearColor(p.color), linearColor(p.hot)),
  width: 3.4, height: 3.4, name: 'warm:qi',
});
const gRingQuad = (p) => () => spellQuad({
  shade: groundRingShade(uv(), uniform(3.0), uniform(0.55), linearColor(p.color), linearColor(p.hot), uniform(1.7)),
  width: 15, height: 15, name: 'warm:groundRing',
});
const ringQuad = (p) => () => spellQuad({
  shade: ringFlashShade(uv(), uniform(0.6), linearColor(p.color), linearColor(p.hot), uniform(1.7)),
  width: 13, height: 13, name: 'warm:ring',
});
const fireQuad = (p) => () => spellQuad({
  shade: fireBurstShade(uv(), uniform(0.65), linearColor(p.color), linearColor(p.hot), linearColor(p.ember ?? [1, 0.2, 0.05]), uniform(1.7)),
  width: 12, height: 12, name: 'warm:fire',
});
const veilQuadOf = (p) => () => spellQuad({
  shade: veilShade(uv(), uniform(0.62), linearColor(p.color), linearColor(p.hot), uniform(1.7)),
  width: 6.8, height: 13, name: 'warm:veil',
});
const beamQuad = (p) => () => spellQuad({
  shade: beamShade(uv(), uniform(0.4), linearColor(p.color), linearColor(p.hot)),
  width: 5, height: 34, name: 'warm:beam',
});
const keyOf = (tag, p) => `${tag}:${(p.color ?? []).join(',')}|${(p.hot ?? []).join(',')}|${(p.ember ?? []).join(',')}|${p.form ?? ''}`;
const WARM_VARIANTS = new Map([
  [TEMPLATES.bladeCast, (p) => p.mode === 'cleave'
    ? [{ key: `moon:${(p.moonHot ?? []).join(',')}`, mk: moonWarmQuad(p) }]
    : []],
  [TEMPLATES.fistCast, (p) => [{ key: keyOf('qi', p), mk: qiQuad(p) }]],
  [TEMPLATES.fireballCast, (p) => [{ key: keyOf('fireOrb', p), mk: fireOrbQuad(p) }]],
  [TEMPLATES.igniteCast, (p) => [{ key: keyOf('fireOrb', p), mk: fireOrbQuad(p) }]],
  [TEMPLATES.fuelCast, (p) => [{ key: keyOf('fireOrb', p), mk: fireOrbQuad(p) }]],
  [TEMPLATES.manaCast, (p) => [
    p.fire ? { key: keyOf('fireOrb', p), mk: fireOrbQuad(p) } : { key: keyOf('proj', p), mk: projQuad(p) },
    { key: keyOf('ring', p), mk: ringQuad(p) }]],
  [TEMPLATES.chargeUpCast, (p) => [{ key: keyOf('proj', p), mk: projQuad(p) }, { key: keyOf('ring', p), mk: ringQuad(p) }]],
  [TEMPLATES.sparkSalvo, (p) => [{ key: keyOf('fireOrb', p), mk: fireOrbQuad(p) }]],
  [TEMPLATES.meltCast, (p) => [{ key: keyOf('fireOrb', p), mk: fireOrbQuad(p) }]],
  [TEMPLATES.selfFlame, (p) => p.form === 'veil'
    ? [{ key: keyOf('veil', p), mk: veilQuadOf(p) }]
    : p.form === 'wisp'
      ? [{ key: keyOf('proj', p), mk: projQuad(p) }]
      : [{ key: keyOf('fire', p), mk: fireQuad(p) }, { key: keyOf('beam', p), mk: beamQuad(p) }]],
  [TEMPLATES.burnSurge, (p) => [{ key: keyOf('fire', p), mk: fireQuad(p) }, { key: keyOf('beam', p), mk: beamQuad(p) }]],
  [TEMPLATES.blockCast, (p) => [{ key: keyOf('groundRing', p), mk: gRingQuad(p) }]],
  [TEMPLATES.fireWhirlCast, (p) => [{ key: keyOf('groundRing', p), mk: gRingQuad(p) }]],
  [TEMPLATES.emberBurst, (p) => [{ key: keyOf('proj', p), mk: projQuad(p) }, { key: keyOf('ring', p), mk: ringQuad(p) }]],
]);
