import { advanceFloor } from './runFlow.js';
import { allSkills } from '../skills/registry.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import { packOf } from './rewards.js';
import { gainMaxMana, gainMaxHp } from './prep.js';

// 进阶事件（RUN_DESIGN §5.3）：训练开始那一刻达标 → 在房内直接进入（2026-09-18 训练改版：
// beginTraining 挂起、播完回房，无延后、无随机性；离房时的 completeRoom 检查保留为兜底）。
// 内容：选一条主维度升级 + 定量恢复（healAmount 10，2026-09 定案——全恢复使「跳过/点火」
// 无脑化，回满血留给 Boss 通关）+ 魏启上限提升 +（达标时）能力授予。
// 2026-09 追加：维度**首次 0→1** 时获赠体系基石卡与体系能力（FIRST_ASCENSION_GRANT），
// 再给「种子包」——九选三（可刷新一次），让新体系一次拿到可用的卡组骨架，
// 而不是靠后续单张奖励慢慢凑。
// 门槛数值全部占位（§9 留坑），能力授予池当前最小化为空。

// 可升级维度：木/空灵脉内容已实装（2026-09-14，WOOD/AIR_VEIN_CARDS），三维度全开放。
// 体修不再是灵脉维度——它走隐藏的 player.bodyLevel（进阶事件「跳过」时 +1）。
// player.leino 仍保留四键（旧档兼容），totalLeino 照旧求和（body 恒 0）。
export const LEINO_DIMENSIONS = ['fire', 'wood', 'air'];

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
  wood: Object.freeze({ cards: ['poisonSting', 'breathOfLife'], ability: 'woodVein' }),
  air: Object.freeze({ cards: ['windBlade', 'atEase'], ability: 'airVein' }),
});

// 种子池排除表：需要前置储备才生效的「组合件」出在九选三里等于废牌。
// 内容侧也可用 def.seedEligible === false 单卡标注；本表是当前统一调参位。
const SEED_EXCLUDED = new Set([
  // 火灵脉：添柴系（需手牌燃料）、需已有燃烧的控火术（散/收/扰/爆/聚/炼/无上）、
  // 燃烧转化/反哺（激热/镜燃；化焰 2026-09-21 删卡）、焰愈系（按自身燃烧缩放）、忍耐（需燃烧受伤）；
  // 控火术：燃 与 火墙链 可独立生效，保留在种子池中（灼 2026-09 改 B 阶，自然出 D/C 池；
  // 灭 2026-09-13 已删卡）
  'fuelTheFire', 'roaringFire', 'blazeUp', 'wildfire',
  'fireControlSpread', 'fireControlHarvest', 'fireControlDisturb',
  'fireControlDetonate', 'fireControlGather', 'fireControlRefine', 'fireControlSupreme',
  'heatSurge', 'mirrorBurn', 'flameHeal', 'patience',
  // 扩容批（2026-09-14）：需燃烧储备的收割/条件件（燃爆/热浪——同激热/焰愈口径；
  // 回火 2026-09-21 随设计稿删卡）
  'burnSnap', 'heatWave',
  // 体修：花刀/飞刀系（吃手牌与邻位）、呼吸系（吃弃牌）、培植/开刃/砺刀系（吃刀法牌）、
  // 斩进阶链（只经转化获得）、纯格挡转化（壁垒系）、完美门槛卡（精准一击/精心一击）、
  // 手牌数量条件咏唱（以无胜有/以有胜无）
  'handCleave', 'doubleCleave', 'flyingDagger', 'heavyDagger',
  'breath', 'warriorBreath', 'perfectBreath',
  'honeBlade', 'forgingBlade', 'edgeBreath', 'bloodEdge', 'unsheathe',
  'whetstone', 'honeEdgeMid', 'razorEdge', 'honeEdge', 'annihilatingEdge', 'practiceBlade',
  'bladeArt', 'bladeHeart',
  'barrier', 'fortress', 'bronzeCity', 'soulOfWar',
  // 混元链需弃牌引擎储备（同呼吸系口径；2026-09-21 大调收阶后链首是 hunYuanPlus）
  'hunYuanPlus',
  'carefulStrike',
  'fastRain', 'fastWind', // 需大回合铺垫才生效，种子池里是废牌
  // 木灵脉：卖血卡（0 练度卖血是负收益——血祭/血藤都带 'blood'）
  'bloodSacrifice', 'bloodVine',
]);

export function totalLeino(run) {
  const l = run.player.leino;
  return l.fire + l.wood + l.air + l.body;
}

// 触发判定（训练开始时调用，见 beginTraining；completeRoom 留作离房兜底）：训练次数达到
// 下一次进阶门槛且未封顶。门槛曲线：首进阶 1 次训练（第 2 层），此后每 2 次训练 +1 级
// （累计 1/3/5/7/9…）。
export function ascensionReady(run) {
  const count = run.player.ascensionCount;
  const need = ASCENSION_PLACEHOLDER.firstTrainings
    + count * ASCENSION_PLACEHOLDER.trainingsPerLevel;
  return count < ASCENSION_PLACEHOLDER.maxAscensions
    && run.player.trainingCount >= need;
}

// 能力授予池（2026-09-13 实装，设计稿 FIRE_VEIN_CARDS §1.4/§2.3 + BODY §1.4/§2.5/§3.4）：
//   灵脉 2 级 → 该维度**精英**池；3 级 + 体系内已持 ≥2 精英 → **大师**池（2026-09-14
//   用户定：大师需双精英垫背，不再是等级一到就开的捷径）；体修看隐藏 bodyLevel（同门槛）。
// 每次进阶至多授予一项（对话选择制）；已持有的不再出现，同池其余能力留给后续进阶
// 慢慢取（设计：一局后期约可解锁两个子体系卡池——想多取就得多投入进阶机会）。
const ABILITY_POOLS = Object.freeze({
  fire: Object.freeze({
    elite: Object.freeze(['pyroBlast', 'fireWard', 'scorchVein', 'fireBlower']),
    master: Object.freeze(['openerGambit', 'flameSever', 'flameDemonLord', 'sunSwallower']),
  }),
  wood: Object.freeze({
    elite: Object.freeze(['renew', 'blightLord']),
    master: Object.freeze(['forestHeart', 'plagueSource']),
  }),
  air: Object.freeze({
    elite: Object.freeze(['galeFury', 'wanderClouds']),
    master: Object.freeze(['windLord', 'voidness']),
  }),
  body: Object.freeze({
    elite: Object.freeze(['boxer', 'bladeMaster', 'warrior', 'parryFist', 'bladeUnity']),
    master: Object.freeze(['champion', 'bladeSaint', 'warEmperor', 'shieldedOffense', 'bladeSoul']),
  }),
});

// 能力授予候选：按当前修为聚合「已达标且未持有」的能力（授予幕间据此出选项）。
// 大师能力三铁律：①前置精英未持有则大师不入选（def.requires）；②已持有的能力
// 永不重复入选（下方 filter；chooseAscensionAbility 落账侧另有防御）；③**体系内
// 已持有 ≥2 个精英能力才开大师池**（2026-09-14 用户定：此前只看等级——第二次拿
// 能力就能直接拿大师，超模；大师必须有双精英垫背，成为体系深耕的终点而非捷径）。
export function abilityOffering(run) {
  const p = run?.player;
  if (!p) return [];
  const out = [];
  const ownedElites = (dim) => ABILITY_POOLS[dim].elite.filter(id => p.abilities.includes(id)).length;
  for (const dim of LEINO_DIMENSIONS) {
    const pool = ABILITY_POOLS[dim];
    if (!pool) continue;
    const lv = p.leino?.[dim] ?? 0;
    if (lv >= 2) out.push(...pool.elite);
    if (lv >= 3 && ownedElites(dim) >= 2) out.push(...pool.master);
  }
  const bodyLv = p.bodyLevel ?? 0;
  if (bodyLv >= 2) out.push(...ABILITY_POOLS.body.elite);
  if (bodyLv >= 3 && ownedElites('body') >= 2) out.push(...ABILITY_POOLS.body.master);
  return [...new Set(out)].filter(id => {
    if (p.abilities.includes(id)) return false;
    const req = getAbilityDefinition(id)?.requires;
    return !req || p.abilities.includes(req);
  });
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

// 该维度的种子池：D/C 基石卡 + 排除组合件 + 排除衍生/不可出池卡 + 进阶链只留链头。
// 深入卡一律不进（种子包发生在首次进阶，此刻必无任何精英能力，门禁必然没开）。
export function seedPool(run, dimension) {
  const chained = chainTargets();
  return allSkills().filter(def =>
    packOf(def) === dimension
    && (def.tier === 'D' || def.tier === 'C')
    && def.canSpawnAsReward !== false
    && def.seedEligible !== false
    && !def.deep
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
// 跳过不触发种子包（体修是初始体系，开局已有小 build），但同样消耗一次进阶机会
// ——这是故事模式暗线（体修大成）的成长通道。
// 跳过补偿（用户定 2026-09-14 收紧）：**只给 +3 生命上限与一次可选删卡**——不回血、
// 不提魏启。体修吃**牌组纯净度**，删卡就是这条路线的成型资源；血量/魏启这类通用
// 资源不再白送（此前四项全给，六路试玩里全跳过路线横扫 44/38/32 三席，「难成型、
// 成型后极强」的定位倒挂成最易成型路线）。第 7 轮裁决的 +3 生命上限保留——跳过
// 需要一根即时的、不依赖卡池的补偿杠杆。
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
  // 能力授予待选时同一次进阶事件不可再点火——否则「跳过（留着能力抉择）→ dim 火」
  // 一次事件吃两份奖励（shop 试玩报告抓出的双吃）；与上面种子卡守卫同一铁律。
  if (run.ascensionOffer) throw new Error('能力授予尚未选定');

  run.player.ascensionCount += 1;

  if (dimension === null) {
    run.player.bodyLevel = (run.player.bodyLevel ?? 0) + 1; // 跳过 → 精进体修（隐藏）
    gainMaxHp(run, 3); // 跳过补偿：+3 生命上限（走 gainMaxHp 抬 baseStats，PreBattle 重算不抹）
    // 跳过反哺（用户定 2026-09-13）：再赠一次**可选**删卡机会——与 Boss 奖励同一计数器，
    // 不删也行：机会在 prep/奖励面板的「使用删卡机会」按钮长期保留，进阶幕间收尾时也会
    // 就地弹一次全屏删卡界面（title「删一张卡」，可跳过）。
    run.pendingCardRemoval = (run.pendingCardRemoval ?? 0) + 1;
    return proceedAfterLevelUp(run);
  }

  // 灵脉路径：+1 魏启上限并回满、定量回血——点火即时战力（跳过路径已不给这两项，
  // 见函数头注释）。魏启上限提升必须走 gainMaxMana（同时抬 baseStats）——直写会被
  // 下一场 PreBattle 的 refreshRunModifiers 重算抹掉（2026-09-11 修的 bug：进阶 +1
  // 实际上从未生效）。
  gainMaxMana(run, ASCENSION_PLACEHOLDER.manaGain);
  run.player.mana = run.player.maxMana;                 // 全恢复（魏启）
  // 生命定量恢复（2026-09 试玩反馈定案：全恢复使「点火」无脑化，回满血留给 Boss 通关）
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + ASCENSION_PLACEHOLDER.healAmount);

  run.player.leino[dimension] += 1;
  // 首次 0→1：获赠体系基石卡与体系能力（FIRE_VEIN_CARDS §0）→ 开种子包（九选三），
  // 选定后再走能力授予/收尾。路线开局 2026-09-22 起灵脉等级也从 0 起步——起始牌组
  // 已含本维度基石卡，获赠表去重，只补能力（若路线没授）与种子包，不重复直发卡。
  if (run.player.leino[dimension] === 1) {
    const grant = FIRST_ASCENSION_GRANT[dimension];
    if (grant) {
      const owned = new Set(run.player.deck.map(c => c.defId));
      for (const defId of grant.cards) {
        if (!owned.has(defId)) run.player.deck.push(createSkillRuntime(defId));
      }
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
    if (run.player.abilities.includes(abilityId)) throw new Error(`能力已持有，不得重复领取：${abilityId}`);
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

// 进阶事件结束 → 推进到下一层 prep（advanceFloor 内部处理登顶终局）。
// 例外（2026-09-18 训练改版）：**房内升阶**——beginTraining 在训练开始那一刻挂起的进阶
// （gameStage 切 'ascension' 但 currentRoom/roomData 原地保留）播完后**切回 'room'**：
// 训练的可选段（4 选 1 抓卡 + 尾款升级）与篝火还等着，楼层推进仍由 completeRoom 负责。
function completeAscension(run) {
  if (run.currentRoom) {
    run.gameStage = 'room';
    return run;
  }
  return advanceFloor(run);
}
