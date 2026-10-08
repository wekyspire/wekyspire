import { advanceFloor } from './runFlow.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import { gainMaxMana, gainMaxHp } from './prep.js';

// 进阶事件（RUN_DESIGN §5.3）：训练开始那一刻达标 → 在房内直接进入（训练改版：
// beginTraining 挂起、播完回房，无延后、无随机性；离房时的 completeRoom 检查保留为兜底）。
// 内容：选一条主维度升级 + 定量恢复（healAmount 10——定量恢复把「跳过/点火」的选择还给规划，回满血留给 Boss 通关）+ 魏启上限提升 +（达标时）能力授予。
// 维度**首次 0→1** 时获赠体系基石卡与体系能力（FIRST_ASCENSION_GRANT）；
// 无种子包（九选三已删）——灵脉开局等级 0 起步、起始牌组已含基石卡，
// 进阶只保留获赠直发，不再开包挑选。
// 门槛数值全部占位（§9 留坑），能力授予池当前最小化为空。

// 可升级维度：当前仅火（木/空两系卡牌已移除，待重做后再开）。
// 体修不再是灵脉维度——它走隐藏的 player.bodyLevel（进阶事件「跳过」时 +1）。
// player.leino 仍保留四键（旧档兼容），totalLeino 照旧求和（body 恒 0）。
export const LEINO_DIMENSIONS = ['fire'];

export const ASCENSION_PLACEHOLDER = {
  firstTrainings: 1,    // 首进阶门槛：第 2 层训练房即触发（快速特化）
  trainingsPerLevel: 2, // 之后每 2 次训练 +1 级（累计 1/3/5/7/9 → 第 2/14/26/34/42 层）
  maxAscensions: 6,     // 总进阶次数封顶（含「跳过」；§5.1 数值锚点）
  manaGain: 1,          // 每次进阶魏启上限提升量
  healAmount: 10,       // 每次进阶恢复生命量（定量恢复；全恢复会碾压营地）
};

// 首次进入体系的获赠表（FIRE_VEIN_CARDS §0）：基石卡直入牌组 + 体系能力自动授予，
// 即首次进阶的全部卡牌收益。
export const FIRST_ASCENSION_GRANT = Object.freeze({
  fire: Object.freeze({ cards: ['igniteC', 'fireBolt'], ability: 'fireVein' }),
});

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

// 能力授予池（设计稿 FIRE_VEIN_CARDS §1.4/§2.3 + BODY §1.4/§2.5/§3.4）：
//   灵脉 2 级 → 该维度**精英**池；3 级 + 体系内已持 ≥2 精英 → **大师**池
//   用户定：大师需双精英垫背，不再是等级一到就开的捷径）；体修看隐藏 bodyLevel（同门槛）。
// 每次进阶至多授予一项（对话选择制）；已持有的不再出现，同池其余能力留给后续进阶
// 慢慢取（设计：一局后期约可解锁两个子体系卡池——想多取就得多投入进阶机会）。
const ABILITY_POOLS = Object.freeze({
  fire: Object.freeze({
    elite: Object.freeze(['pyroBlast', 'fireWard', 'scorchVein', 'fireBlower']),
    master: Object.freeze(['openerGambit', 'flameSever', 'flameDemonLord', 'sunSwallower']),
  }),
  body: Object.freeze({
    elite: Object.freeze(['boxer', 'bladeMaster', 'warrior', 'parryFist', 'bladeUnity']),
    master: Object.freeze(['champion', 'bladeSaint', 'warEmperor', 'shieldedOffense', 'bladeSoul']),
  }),
});

// 能力授予候选：按当前修为聚合「已达标且未持有」的能力（授予幕间据此出选项）。
// 大师能力三铁律：①前置精英未持有则大师不入选（def.requires）；②已持有的能力
// 永不重复入选（下方 filter；chooseAscensionAbility 落账侧另有防御）；③**体系内
// 已持有 ≥2 个精英能力才开大师池**（只看等级会让第二次拿
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

// ---- 进阶事件主流程 ----

// 结算进阶事件。dimension = 灵脉维度 id，或 null = 「跳过」（体修隐藏等级 +1）。
// 跳过同样消耗一次进阶机会——这是故事模式暗线（体修大成）的成长通道。
// 跳过补偿：**只给 +3 生命上限与一次可选删卡**——不回血、
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
  // 能力授予待选时同一次进阶事件不可再点火——否则「跳过（留着能力抉择）→ dim 火」
  // 一次事件吃两份奖励（shop 试玩报告抓出的双吃）。
  if (run.ascensionOffer) throw new Error('能力授予尚未选定');

  run.player.ascensionCount += 1;

  if (dimension === null) {
    run.player.bodyLevel = (run.player.bodyLevel ?? 0) + 1; // 跳过 → 精进体修（隐藏）
    gainMaxHp(run, 3); // 跳过补偿：+3 生命上限（走 gainMaxHp 抬 baseStats，PreBattle 重算不抹）
    // 跳过反哺：再赠一次**可选**删卡机会——与 Boss 奖励同一计数器，
    // 不删也行：机会在 prep/奖励面板的「使用删卡机会」按钮长期保留，进阶幕间收尾时也会
    // 就地弹一次全屏删卡界面（title「删一张卡」，可跳过）。
    run.pendingCardRemoval = (run.pendingCardRemoval ?? 0) + 1;
    return proceedAfterLevelUp(run);
  }

  // 灵脉路径：+1 魏启上限并回满、定量回血——点火即时战力（跳过路径已不给这两项，
  // 见函数头注释）。魏启上限提升必须走 gainMaxMana（同时抬 baseStats）——直写会被
  // 下一场 PreBattle 的 refreshRunModifiers 重算抹掉（回蓝在重算前入账会被清零；
  // 实际上从未生效）。
  gainMaxMana(run, ASCENSION_PLACEHOLDER.manaGain);
  run.player.mana = run.player.maxMana;                 // 全恢复（魏启）
  // 生命定量恢复（回满血留给 Boss 通关）
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + ASCENSION_PLACEHOLDER.healAmount);

  run.player.leino[dimension] += 1;
  // 首次 0→1：获赠体系基石卡与体系能力（FIRE_VEIN_CARDS §0）。路线开局
  // 灵脉等级也从 0 起步——起始牌组已含本维度基石卡，获赠表去重，只补缺失的卡与能力。
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
// 例外：**房内升阶**——beginTraining 在训练开始那一刻挂起的进阶
// （gameStage 切 'ascension' 但 currentRoom/roomData 原地保留）播完后**切回 'room'**：
// 训练的可选段（4 选 1 抓卡 + 尾款升级）与篝火还等着，楼层推进仍由 completeRoom 负责。
function completeAscension(run) {
  if (run.currentRoom) {
    run.gameStage = 'room';
    return run;
  }
  return advanceFloor(run);
}
