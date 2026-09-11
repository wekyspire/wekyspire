import { advanceFloor } from './runFlow.js';
import { allSkills } from '../skills/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import { packOf } from './rewards.js';
import { gainMaxMana } from './prep.js';

// 进阶事件（RUN_DESIGN §5.3）：离开训练房时训练次数达标 → 直接进入（无延后、无随机性）。
// 内容：选一条主维度升级 + 恢复全部状态 + 魏启上限提升 +（达标时）能力授予。
// 2026-09 追加：维度**首次 0→1** 时获赠体系基石卡与体系能力（FIRST_ASCENSION_GRANT），
// 再给「种子包」——九选三（可刷新一次），让新体系一次拿到可用的卡组骨架，
// 而不是靠后续单张奖励慢慢凑。
// 门槛数值全部占位（§9 留坑），能力授予池当前最小化为空。

// 可升级维度：木/空灵脉内容待实装，先屏蔽（用户 2026-09 定）；内容落地后加回。
// 体修不再是灵脉维度——它走隐藏的 player.bodyLevel（进阶事件「跳过」时 +1）。
// player.leino 仍保留四键（旧档兼容），totalLeino 照旧求和（body 恒 0）。
export const LEINO_DIMENSIONS = ['fire'];

export const ASCENSION_PLACEHOLDER = {
  firstTrainings: 1,    // 首进阶门槛：第 2 层训练房即触发（快速特化，用户 2026-09 定）
  trainingsPerLevel: 2, // 之后每 2 次训练 +1 级（累计 1/3/5/7/9 → 第 2/14/26/34/42 层）
  maxAscensions: 6,     // 总进阶次数封顶（含「跳过」；§5.1 数值锚点）
  manaGain: 1,          // 每次进阶魏启上限提升量
  healAmount: 10,       // 每次进阶恢复生命量（2026-09 试玩反馈：全恢复碾压营地，定为定量恢复）
};

// 种子包规格：抽 N 张互不重复的基石卡，任选 M 张入牌组，可刷新 R 次。
export const SEED_OFFERING = Object.freeze({ cards: 9, picks: 3, rerolls: 1 });

// 首次进入体系的获赠表（FIRE_VEIN_CARDS §0，2026-09 定）：基石卡直入牌组 +
// 体系能力自动授予，然后才开种子包九选三。点火原占种子包必出位（seedGuaranteed），
// 改为获赠直发后该标记移除——九选三回到纯自选，不再强制复发已有基石。
export const FIRST_ASCENSION_GRANT = Object.freeze({
  fire: Object.freeze({ cards: ['inflame', 'fireBolt'], ability: 'fireVein' }),
});

// 种子池排除表：需要前置储备才生效的「组合件」出在九选三里等于废牌。
// 内容侧也可用 def.seedEligible === false 单卡标注；本表是当前统一调参位。
const SEED_EXCLUDED = new Set([
  // 火灵脉：添柴系（需手牌燃料）、需已有燃烧的控火术（灭/散/收/扰/爆/聚/炼/无上）、
  // 燃烧转化/反哺（激热/化焰/镜燃）、焰愈系（按自身燃烧缩放）、忍耐（需燃烧受伤）；
  // 控火术：燃 与 火墙 可独立生效，保留在种子池中（灼 2026-09 改 B 阶，自然出 D/C 池）
  'fuelTheFire', 'roaringFire', 'blazeUp', 'wildfire',
  'fireControlExtinguish', 'fireControlSpread', 'fireControlHarvest', 'fireControlDisturb',
  'fireControlDetonate', 'fireControlGather', 'fireControlRefine', 'fireControlSupreme',
  'heatSurge', 'meltFlame', 'mirrorBurn', 'flameHeal', 'patience',
  // 体修：花刀/飞刀系（吃手牌与邻位）、呼吸系（吃弃牌）、培植/开刃/砺刀系（吃刀法牌）、
  // 斩进阶链（只经转化获得）、纯格挡转化（壁垒系）、完美门槛卡（精准一击/精心一击）、
  // 手牌数量条件咏唱（以无胜有/以有胜无）
  'handCleave', 'doubleCleave', 'flyingDagger', 'heavyDagger',
  'breath', 'warriorBreath', 'perfectBreath',
  'honeBlade', 'forgingBlade', 'edgeBreath', 'bloodEdge', 'unsheathe',
  'whetstone', 'honeEdgeMid', 'razorEdge', 'honeEdge', 'annihilatingEdge', 'practiceBlade',
  'bladeArt', 'bladeHeart',
  'barrier', 'fortress', 'bronzeCity', 'soulOfWar',
  'perfectStrike', 'carefulStrike',
  'fastRain', 'fastWind', // 需大回合铺垫才生效，种子池里是废牌
]);

export function totalLeino(run) {
  const l = run.player.leino;
  return l.fire + l.wood + l.air + l.body;
}

// 触发判定（离开训练房时调用）：训练次数达到下一次进阶门槛且未封顶。
// 门槛曲线：首进阶 1 次训练（第 2 层），此后每 2 次训练 +1 级（累计 1/3/5/7/9…）。
export function ascensionReady(run) {
  const count = run.player.ascensionCount;
  const need = ASCENSION_PLACEHOLDER.firstTrainings
    + count * ASCENSION_PLACEHOLDER.trainingsPerLevel;
  return count < ASCENSION_PLACEHOLDER.maxAscensions
    && run.player.trainingCount >= need;
}

// 能力授予候选（占位）：授予池最小化为空；达标标准与池内容见 §9，后续替换。
export function abilityOffering(_run) {
  return [];
}

// ---- 种子包（首次 0→1）----

// 进阶链只开链头（链中最低级）：凡被任何卡的 promotesTo 指向的定义都不是链头，
// 从种子池剔除——高阶形态由局外晋升获得，同链 D/C 并列出现是噪音（用户 2026-09 定）。
// 注意只认 promotesTo（局外晋升链）；battlePromotesTo（斩局内转化链）与晋升无关，
// 且斩链进阶卡已被 canSpawnAsReward === false 排除。
function chainTargets() {
  const targets = new Set();
  for (const def of allSkills()) {
    if (def.promotesTo) for (const id of [def.promotesTo].flat()) targets.add(id);
  }
  return targets;
}

// 该维度的种子池：D/C 基石卡 + 排除组合件 + 排除衍生/不可出池卡 + 进阶链只留链头
export function seedPool(run, dimension) {
  const chained = chainTargets();
  return allSkills().filter(def =>
    packOf(def) === dimension
    && (def.tier === 'D' || def.tier === 'C')
    && def.canSpawnAsReward !== false
    && def.seedEligible !== false
    && !SEED_EXCLUDED.has(def.id)
    && !chained.has(def.id));
}

// 抽 N 张互不重复（走 run rng；exclude 用于刷新时优先避开已出现过的卡）。
// 必出卡（def.seedGuaranteed === true，如火的点火——体系的燃烧入口，九选三缺它等于
// 发不出体系骨架）始终占位，不受刷新避让影响；落位洗牌，必出卡不固定占头部格子。
export function rollSeedCards(run, dimension, exclude = []) {
  const excluded = new Set(exclude);
  let pool = seedPool(run, dimension).filter(def => !excluded.has(def.id));
  if (pool.length < SEED_OFFERING.cards) pool = seedPool(run, dimension); // 池子太小：允许重复出现
  const picks = pool.filter(def => def.seedGuaranteed === true);
  const remaining = pool.filter(def => def.seedGuaranteed !== true);
  while (picks.length < SEED_OFFERING.cards && remaining.length) {
    const i = run.rng.int(0, remaining.length - 1);
    picks.push(remaining.splice(i, 1)[0]);
  }
  for (let i = picks.length - 1; i > 0; i--) { // Fisher–Yates 落位洗牌（同走 run rng）
    const j = run.rng.int(0, i);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.map(def => def.id);
}

// 刷新：重抽九张（优先排除已见卡），消耗一次刷新机会，清空已选
export function rerollSeedOffering(run) {
  const off = run.cardOffering;
  if (!off) throw new Error('当前没有待选的种子卡');
  if (off.rerollsLeft <= 0) throw new Error('没有可用的刷新次数');
  off.rerollsLeft -= 1;
  off.cards = rollSeedCards(run, off.dimension, off.seen);
  off.seen = [...new Set([...off.seen, ...off.cards])];
  off.picks = [];
  return run;
}

// 选定三张种子卡入牌组 → 继续进阶事件（能力授予 / 收尾）
export function chooseSeedCards(run, defIds) {
  const off = run.cardOffering;
  if (!off) throw new Error('当前没有待选的种子卡');
  if (!Array.isArray(defIds) || defIds.length !== SEED_OFFERING.picks) {
    throw new Error(`种子卡必须选 ${SEED_OFFERING.picks} 张`);
  }
  if (new Set(defIds).size !== defIds.length) throw new Error('种子卡不可重复');
  for (const id of defIds) {
    if (!off.cards.includes(id)) throw new Error(`种子卡不在候选中：${id}`);
  }
  for (const id of defIds) run.player.deck.push(createSkillRuntime(id));
  run.cardOffering = null;
  return proceedAfterLevelUp(run);
}

// ---- 进阶事件主流程 ----

// 结算进阶事件。dimension = 灵脉维度 id，或 null = 「跳过」（体修隐藏等级 +1）。
// 跳过不触发种子包（体修是初始体系，开局已有小 build），但同样消耗一次进阶机会、
// 享受全恢复与魏启上限提升——这是故事模式暗线（体修大成）的成长通道。
export function chooseAscension(run, dimension = null) {
  if (run.gameStage !== 'ascension') {
    throw new Error(`run 阶段不符：期望 'ascension'，实际 '${run.gameStage}'`);
  }
  if (dimension !== null && !LEINO_DIMENSIONS.includes(dimension)) {
    throw new Error(`未知灵脉维度：${dimension}`);
  }
  if (run.player.ascensionCount >= ASCENSION_PLACEHOLDER.maxAscensions) {
    throw new Error('进阶次数已封顶');
  }
  if (run.cardOffering) throw new Error('种子卡尚未选定');

  run.player.ascensionCount += 1;
  // 魏启上限提升：必须走 gainMaxMana（同时抬 baseStats）——直写会被下一场 PreBattle 的
  // refreshRunModifiers 重算抹掉（2026-09-11 修的 bug：进阶 +1 实际上从未生效）。
  gainMaxMana(run, ASCENSION_PLACEHOLDER.manaGain);
  run.player.mana = run.player.maxMana;                 // 全恢复（魏启）
  // 生命定量恢复（2026-09 试玩反馈定案：全恢复使「跳过/点火」无脑化，回满血留给 Boss 通关）
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + ASCENSION_PLACEHOLDER.healAmount);

  if (dimension === null) {
    run.player.bodyLevel = (run.player.bodyLevel ?? 0) + 1; // 跳过 → 精进体修（隐藏）
    return proceedAfterLevelUp(run);
  }

  run.player.leino[dimension] += 1;
  // 首次 0→1：获赠体系基石卡与体系能力（FIRE_VEIN_CARDS §0）→ 开种子包（九选三），
  // 选定后再走能力授予/收尾
  if (run.player.leino[dimension] === 1) {
    const grant = FIRST_ASCENSION_GRANT[dimension];
    if (grant) {
      for (const defId of grant.cards) run.player.deck.push(createSkillRuntime(defId));
      if (grant.ability && !run.player.abilities.includes(grant.ability)) {
        run.player.abilities.push(grant.ability);
      }
    }
    if (seedPool(run, dimension).length > 0) {
      const cards = rollSeedCards(run, dimension);
      run.cardOffering = {
        dimension,
        cards,
        picks: [],
        seen: [...cards],
        rerollsLeft: SEED_OFFERING.rerolls,
      };
      return run;
    }
  }
  return proceedAfterLevelUp(run);
}

// 能力授予抉择（offering 为空时不会被调用；null = 跳过）
export function chooseAscensionAbility(run, abilityId = null) {
  if (!run.ascensionOffer) throw new Error('当前没有待授予的能力');
  if (abilityId !== null) {
    if (!run.ascensionOffer.includes(abilityId)) throw new Error(`能力不在授予候选中：${abilityId}`);
    run.player.abilities.push(abilityId);
  }
  run.ascensionOffer = null;
  return completeAscension(run);
}

// 升级后的统一收尾：能力授予（有候选则挂起）→ 推进下一层
function proceedAfterLevelUp(run) {
  const offering = abilityOffering(run);
  if (offering.length) {
    run.ascensionOffer = offering; // 有待选能力 → 留一步授予抉择
    return run;
  }
  return completeAscension(run);
}

// 进阶事件结束 → 推进到下一层 prep（advanceFloor 内部处理登顶终局）
function completeAscension(run) {
  return advanceFloor(run);
}
