// 状态渲染：把会话状态（run + 战斗）渲染成文本界面（headless CLI 与直播观战共用同一份）。
// 按阶段分流到 render* 小函数；render() 只负责玩家/遗物表头与尾档收尾。
import { swapCostOf } from '../../src/core/state/battleState.js';
import { handBreakdown } from '../../src/core/skills/helpers.js';
import { getSkillDefinition } from '../../src/core/skills/registry.js';
import { getAbilityDefinition } from '../../src/core/abilities/registry.js';
import { getEnemyDefinition } from '../../src/core/enemies/registry.js';
import { getRelicDefinition } from '../../src/core/relics/registry.js';
import { gatedPromotionTargets } from '../../src/core/run/promotion.js';
import { PACKS, maxRewardTier } from '../../src/core/run/rewards.js';
import { ASCENSION_PLACEHOLDER } from '../../src/core/run/ascension.js';
import { campOptions, campLocked } from '../../src/core/run/rooms/camp.js';
import { upgradableCards } from '../../src/core/run/rooms/training.js';
import { slotView, SLOT } from '../../src/core/run/rooms/slotMachine.js';
import { bankView, pendingDebuffViews } from '../../src/core/run/rooms/bank.js';
import { gurpasView } from '../../src/core/run/rooms/gurpas.js';
import { eventView } from '../../src/core/run/rooms/event.js';
import { listNamedTerms } from '../../src/core/skills/namedTerms.js';
import { allEffects } from '../../src/core/effects/registry.js';

import { defOf, plain, costText, kwText, effectsText, intentText, cardLine, slotResultText } from './format.mjs';
import { stageCn, battleLogText } from './engine.mjs';

export function render(S) {
  const run = S.run;
  const p = run.player;
  const L = [];
  const head = `【魏启尖塔 · headless】第 ${run.floor}/${run.totalFloors} 层 · ${stageCn(run.gameStage)}`
    + (run.result ? `（${run.result === 'victory' ? '登顶成功' : '战败'}）` : '');
  L.push(`═══ ${head} ═══`);
  const apNote = p.actionPoints > p.maxActionPoints
    ? `（+${p.actionPoints - p.maxActionPoints} 来自本回合临时加成，非上限）` : '';
  L.push(`玩家: HP ${p.hp}/${p.maxHp} 护盾${p.shield} 魏启 ${p.mana}/${p.maxMana} AP ${p.actionPoints}/${p.maxActionPoints}${apNote} 金币 ${p.money} | 灵脉 火${p.leino.fire} 体修${p.bodyLevel ?? 0} | 训练 ${p.trainingCount} 进阶 ${p.ascensionCount}/${ASCENSION_PLACEHOLDER.maxAscensions}`);
  if (p.effects?.length) L.push(`玩家效果: ${effectsText(p)}`);
  if (p.abilities.length) {
    L.push(`能力: ${p.abilities.map(id => {
      const d = getAbilityDefinition(id);
      return d ? `${d.name}「${d.description}」` : id;
    }).join('；')}`);
  }
  // 遗物：背包全量 + 槽位占用（槽位是**权重和**口径 Σcost ≤ relicSlots；非槽位式恒生效、不需装备）
  if (p.relics?.length) {
    const cost = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
    const used = (p.equippedRelics ?? []).reduce((n, id) => n + cost(id), 0);
    L.push(`遗物槽位 ${used}/${p.relicSlots}：`
      + p.relics.map((id) => {
        const d = getRelicDefinition(id);
        const tags = [d?.rarity ?? 'C', d?.nonSlot ? '非槽位式' : `${cost(id)}槽${cost(id) === 0 ? '·需装备' : ''}`];
        if ((p.equippedRelics ?? []).includes(id)) tags.push('已装备');
        return `${d?.name ?? id}(${tags.join('·')})`;
      }).join(' / '));
    L.push('  → relic equip|unequip <遗物id>（仅 prep；非槽位式不用装备）｜ relics 查看全部遗物效果说明');
  }
  // 删卡机会：全阶段可见（Boss 奖励 / 跳过进阶反哺共用同一计数器；此前 headless 没有入口）
  if (run.pendingCardRemoval > 0) {
    L.push(`⧉ 删卡机会 ×${run.pendingCardRemoval}（remove <构筑#> [卡名]，不用则保留）`);
  }

  const stage = run.gameStage;
  if (stage === 'battle' && S.battle) renderBattle(S, L);
  else if (stage === 'reward' && run.rewards) renderReward(S, L);
  else if (stage === 'room') renderRoom(S, L);
  else if (stage === 'ascension') renderAscension(S, L);
  else if (stage === 'prep') renderPrep(S, L);
  else if (stage === 'end') renderEnd(S, L);

  if ((stage === 'reward' || stage === 'end') && S.presenter?.calls?.length) {
    const log = battleLogText(S);
    if (log.length) {
      L.push('上场战斗尾档（死因/击杀回放）:');
      for (const l of log) L.push(`  · ${l}`);
    }
  }
  if (S.lastOutcome) L.push(`⟐ ${S.lastOutcome}`);
  return L.join('\n');
}

function renderBattle(S, L) {
  const p = S.run.player;
  const bs = S.battle.battleState;
  L.push(`〔回合 ${bs.turn.count}〕敌人:`);
  bs.enemies.forEach((e, i) => {
    if (e.isDead()) { L.push(`  [${i + 1}] ${e.name} ✝`); return; }
    L.push(`  [${i + 1}] ${e.name} HP ${e.hp}/${e.maxHp}${e.shield ? ` 护盾${e.shield}` : ''}${effectsText(e) ? ` 效果:${effectsText(e)}` : ''} 意图: ${intentText(e)}`);
  });
  for (const al of bs.allies) {
    if (al.isDead()) continue;
    L.push(`瑞米: HP ${al.hp}/${al.maxHp} 意图: ${intentText(al)}`);
  }
  // 批次 13 容量分解（用户要求 headless 注明状态）：普通/咏唱容量/溢出三段；
  // 迷你卡计 0 张不占位但实体在列表里——单独注记张数，免得「占用5/5 却列出 7 张」被当 bug
  const _bd = handBreakdown(bs);
  const _cap = p.chantCapacity ?? 1;
  const _used = _bd.normal + Math.max(0, _bd.chantW - _cap);
  const _mini = bs.zones.hand.filter((c) => defOf(c).keywords?.includes('mini')).length;
  L.push(`牌库 ${bs.zones.deck.length}（lib 查抽牌顺序——抽牌严格按顺序，可预知） | 焚毁 ${bs.zones.burnt.length} | `
    + `手牌 占用${_used}/${p.maxHandSize}（普通${_bd.normal} + 咏唱溢出${Math.max(0, _bd.chantW - _cap)}）`
    + `${_mini ? `｜迷你${_mini}张（列得出不占位）` : ''} | `
    + `咏唱容量 ${Math.min(_bd.chantW, _cap)}/${_cap}`);
  L.push(`手牌:`);
  // 咏唱图例（0927 实录：咏唱被当成一次性结算，第二下把引擎解除了——点亮/解除语义常驻提示）
  if (bs.zones.hand.some((c) => defOf(c).cardMode === 'chant')) {
    L.push('  ※ 咏唱：打出=点亮（每回合P5自动触发，占咏唱容量+手牌权重）；已点亮的再打出=解除离场');
  }
  bs.zones.hand.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, S.battle.ctx)));
  L.push(`本回合累计: 打${bs.history.turn.played} 弃${bs.history.turn.discarded} 抽${bs.history.turn.drawn}`);
  const pi = bs.pendingInput?.request;
  if (pi) {
    const lo = pi.min ?? pi.count ?? 1;
    const hi = pi.max ?? pi.count ?? 1;
    const need = lo === hi ? `选 ${lo} 张` : `选 ${lo}~${hi} 张`;
    L.push(`▶ 待输入: ${pi.reason ?? pi.prompt ?? pi.kind}${pi.kind === 'confirm' ? '' : `（${need}）`}`);
    if (pi.candidates?.length) {
      const byId = new Map();
      for (const z of ['hand', 'deck', 'burnt', 'pending']) for (const c of bs.zones[z]) byId.set(c.uniqueID, c);
      L.push(`  候选（来源 ${pi.source ?? '?'}，共 ${pi.candidates.length} 张）:`);
      // 候选可能是区内 runtime（uniqueID）或纯 defId（发现池等尚未入区的卡）——defId
      // 也解析成中文名+卡面（0927 实录：候选只显 fireControlDisturb 裸 id，应答还得敲 id）
      pi.candidates.forEach((id, i) => {
        const rt = byId.get(id);
        if (rt) { L.push(`    [${i + 1}] ${defOf(rt).name}`); return; }
        const def = getSkillDefinition(id) ?? getRelicDefinition(id);
        L.push(def ? `    [${i + 1}] ${def.name} ${def.tier ? `${def.tier}阶 ` : ''}「${plain(def.describe?.() ?? def.description ?? '')}」`
          : `    [${i + 1}] ${id}`);
      });
    }
  }
  if (pi) {
    L.push(`  → 应答：in <候选#> [卡名] …（多选就重复写，如 in 1 拳 3 盾）`);
  }
  L.push(`→ play <手牌#> <卡名> [敌#] / dump（付费${swapCostOf(bs)}AP弃全部手牌） / end`
    + ` / why <手牌#> / lib 看牌库`);
  const log = battleLogText(S);
  if (log.length) {
    L.push(`最近结算:`);
    for (const l of log) L.push(`  · ${l}`);
  }
}

function renderReward(S, L) {
  const run = S.run;
  const rw = run.rewards;
  L.push(`金币 +${rw.money}`);
  if (!rw.packId) {
    L.push(`可选卡包:`);
    rw.packs.forEach((id, i) => L.push(`  [${i + 1}] ${PACKS[id]?.name ?? id}（等级上限 ${maxRewardTier(run, id)}）`));
    L.push(`→ pack <#>`);
  } else {
    L.push(`已开 ${PACKS[rw.packId]?.name ?? rw.packId}，候选:`);
    rw.skillChoices.forEach((id, i) => {
      const def = getSkillDefinition(id);
      const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
      L.push(`  [${i + 1}] ${nameTag} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」`);
    });
    L.push(`→ take <#> <卡名> / skip`);
  }
}

function renderRoom(S, L) {
  const run = S.run;
  const room = run.currentRoom;
  // 合并房（campTraining）两部分独立计时：完成态看 run.roomData 的旗标，不看
  // S.roomDone——它是单旗标，任一部分动作都会置位，按它早退会把另一部分的动作入口
  // 一起藏掉。2026-09-18 训练改版：训练的"完成"= 开局（trained）且可选段收束
  // （optionalDone 或从未掷候选也不欠尾款）。
  const trainingSettled = !!run.roomData?.trained
    && !run.roomData?.drawChoices && !run.roomData?.pendingUpgrade;
  const roomDone = room === 'campTraining'
    ? (!!run.roomData?.campUsed && trainingSettled)
    : room === 'training'
      ? trainingSettled
      : S.roomDone;
  L.push(roomDone
    ? '状态：本房间动作已完成 → next 离开（售货机不受限，仍可 act shop buy）'
    : '状态：房间动作未完成（可选动作见下）');
  // 售货机与房间**并存**（不占房间名额）：任何房间都可能同层有货架
  if (run.shop) renderRoomShop(S, L);
  if (roomDone) {
    // 状态行已在段首统一给出（report-r1-A 缺陷#8：避免有的房间给提示、有的不给）
    return;
  }
  if (room === 'camp' || room === 'training' || room === 'campTraining') renderRoomCampTraining(S, L, room);
  else if (room === 'slot') renderRoomSlot(S, L);
  else if (room === 'gurpas') renderRoomGurpas(S, L);
  else if (room === 'event') renderRoomEvent(S, L);
}

function renderRoomShop(S, L) {
  const run = S.run;
  const p = run.player;
  const disc = run.shop.discount < 1 ? `（${Math.round(run.shop.discount * 10)} 折）` : '';
  L.push(`自动售货机${disc}｜持有 ${p.money} 金币：`);
  if (run.shop.broken) L.push('  瑞米：“上次逃得太狼狈了……忘记补货了……”');
  // 买不起的货直接标注差额——headless 没有 GUI 的红字价格，文本口径是唯一的可负担性信息
  // （R8-A：P0 因为"试着点了最贵的看会不会触发什么"，被动买了货，丧失了主动选择权）
  run.shop.items.forEach((it, i) => L.push(`  [${i + 1}] ${it.label} — ${it.price} 金`
    + (it.sub ? `｜${plain(it.sub)}` : '') + (it.sold ? '（已售出）' : '')
    + (!it.sold && p.money < it.price ? `（还差 ${it.price - p.money} 金）` : '')));
  if (run.shopPending) {
    if (run.shopPending.kind === 'relic') {
      // 遗物包三选一（2026-09-13 用户定）：稀有度 + 名 + 效果，claim -1 放弃
      L.push(`  遗物包待选（${run.shopPending.rarity} 级，三选一，可放弃）:`);
      run.shopPending.choices.forEach((id, i) => {
        const def = getRelicDefinition(id);
        L.push(`    [${i + 1}] 【${def?.name ?? id}】（${def?.rarity ?? 'C'} 级，`
          + `${def?.nonSlot ? '非槽位式' : `占 ${def?.cost ?? 0} 槽`}）${def?.description ?? ''}`);
      });
      L.push('  → act shop claim <#> 选择 / act shop claim -1 放弃');
    } else {
      L.push('  卡包待选:');
      run.shopPending.choices.forEach((id, i) => {
        const def = getSkillDefinition(id);
        L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
      });
      L.push('  → act shop claim <#|defId> [卡名]');
    }
  } else {
    L.push('  → act shop buy <#> 购买（离开房间不清货架，买光不补）');
  }
}

// 营地部分与训练部分各自一段；合并房（campTraining）两段都渲染
// 2026-09-18 训练改版：训练必做且先于篝火；可选段 = 四选一抓卡（抓了欠一次升级）
function renderRoomCampTraining(S, L, room) {
  const run = S.run;
  const renderCamp = () => {
    if (campLocked(run)) {
      L.push('营地：锁定（先把训练收尾——act train 开局 / act up 清尾款）');
      return;
    }
    const optCn = { recoverRemi: '找回瑞米(remi)', rest: '休整(rest)' };
    L.push(`营地。可用: ${campOptions(run).map(o => optCn[o] ?? o).join(' / ')}`
      + `（act rest | act remi——2026-09-21 D4：营地不再能升级卡）`);
  };
  const renderTraining = () => {
    const deckIdx = (rt) => `[${run.player.deck.indexOf(rt) + 1}]`;
    if (!run.roomData?.trained) {
      L.push(`训练场（必做·先训练后篝火；累计训练 ${run.player.trainingCount} 次）`);
      L.push('→ act train 开始训练（修行次数达标会当场引动进阶事件：dim → ability）');
      return;
    }
    L.push(`训练场（已开局，累计训练 ${run.player.trainingCount} 次）`);
    if (run.roomData?.drawChoices) {
      L.push('抓牌候选（可选·抓了欠一次升级）:');
      run.roomData.drawChoices.forEach((id, i) => {
        const def = getSkillDefinition(id);
        const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
        L.push(`  [${i + 1}] ${nameTag} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」`);
      });
      L.push('→ act take <#> <卡名> / act skipdraw 放弃本次抓牌');
    } else if (run.roomData?.pendingUpgrade) {
      const p = run.roomData.pendingUpgrade;
      if (typeof p !== 'object' || !p.mode) {
        // 尾款第一拍：选模式（升 2 张 C→B / 升 1 张 B→A）
        const cs = upgradableCards(run).filter(rt => defOf(rt).tier === 'C');
        const bs = upgradableCards(run).filter(rt => defOf(rt).tier === 'B');
        L.push('尾款升级——先选模式:');
        if (cs.length >= 2) L.push(`  act upmode c → 升 2 张 C→B（可升: ${cs.map(rt => `${deckIdx(rt)}${defOf(rt).name}`).join(' ')}）`);
        if (bs.length >= 1) L.push(`  act upmode b → 升 1 张 B→A（可升: ${bs.map(rt => `${deckIdx(rt)}${defOf(rt).name}`).join(' ')}）`);
      } else {
        const tier = p.mode === 'twoC' ? 'C' : 'B';
        const pool = upgradableCards(run).filter(rt => defOf(rt).tier === tier);
        L.push(`尾款升级（${p.mode === 'twoC' ? '2 张 C→B' : '1 张 B→A'}，还需 ${p.remaining} 张）——可升级卡: ${pool.map(rt => `${deckIdx(rt)}${defOf(rt).name}`).join(' ')}`);
        L.push('→ act up <构筑#> <卡名>（先 preview up <#> 看升阶对比；编号即 deck 视图行号）');
      }
    } else if (!run.roomData?.optionalDone) {
      L.push('→ act draw（看四选一候选）/ 不抓就直接处理营地或 next 离开');
    } else {
      L.push('训练部分：已完成（每房一次）');
    }
  };
  if (room !== 'training') {
    if (run.roomData?.campUsed) L.push('营地部分：已用过（每房一次）');
    else renderCamp();
  }
  if (room !== 'camp') renderTraining();
  if (room === 'campTraining') {
    L.push(run.roomData?.pendingUpgrade
      ? '（抓卡尾款未清：先 act upmode c|b 选模式，再 act up <构筑#> <卡名>）'
      : !run.roomData?.trained
        ? '（训练必做：act train 开局后才能用营地/离开）'
        : '（营地与训练各自可做一次，收尾后 next 离开）');
  }
}

function renderRoomSlot(S, L) {
  const run = S.run;
  const p = run.player;
  const v = slotView(run);
  // 「单价」与「免费」并列展示被三路试玩先后误读成"免费也在扣钱"——免费次数在手时
  // 直接说"本次免费"，付费才报单价（免费抽不涨价）。
  L.push(`老虎机：${v.freeRolls ? `本次拉杆**免费**（剩 ${v.freeRolls} 次）` : `本次单价 ${v.cost} 金币`}（付费每抽 +${SLOT.costStep}）｜持有 ${p.money}`
    + `｜小奖 ${Math.round(v.minorChance * 100)}% 大奖 ${Math.round(v.majorChance * 100)}%（未中累加）`);
  L.push(`吞噬进度 ${v.devourProgress}/${v.devourEvery}${v.devourReady ? '（可吞噬）：act devour relic <遗物id> / act devour card <构筑#>' : ''}`);
  // 银行机（与老虎机成对出现）
  {
    const bk = bankView(run);
    L.push(`🏦 银行机：存款 ${bk.deposit} 金 ｜ 连击 ${bk.combo} ｜ 每层利率 每 ${bk.ratePer} 金产 ${bk.rateYield} 金`
      + (bk.deposit > 0 ? `（再攒一层 +${bk.nextInterest}）` : ''));
    const pend = pendingDebuffViews(run);
    if (pend.length) L.push(`  身负恶魔词条：${pend.map(d => `${d.name}(剩${d.battlesLeft}场)`).join('、')}`);
    if (bk.pendingRoll) {
      L.push(`  恶魔 roll（${bk.pendingRoll.tier} 档，已入账 ${bk.pendingRoll.gold} 金）——必须选一个：`);
      for (const o of bk.pendingRoll.options) L.push(`    ${o.name}[${o.id}]：${o.desc}`);
      L.push('  → act bank pick <词条id>');
    } else {
      const acts = [];
      if (bk.money > 0) acts.push('act bank deposit [金额]');
      if (bk.deposit > 0) acts.push('act bank withdraw');
      if (bk.canOverdraft) acts.push('act bank overdraft <yellow|red|black>');
      else if (bk.lockout > 0) L.push(`  （通过黑色级后，银行机再过 ${bk.lockout} 次见面才允许超额取款）`);
      if (acts.length) L.push(`  → ${acts.join(' | ')}`);
    }
    for (const offer of bk.offers) {
      L.push(offer === 'upgrade'
        ? '  → act bank upgrade <构筑#> <卡名>（词条附赠：立即免费升级一张）'
        : '  → act bank burn <构筑#> <卡名>（词条附赠：自选焚毁一张）');
    }
  }
  if (run.slotPending) {
    L.push(`待处理产出：${slotResultText(run.slotPending)}`);
    const pd = run.slotPending;
    if (pd.choices?.length) {
      L.push('  候选卡:');
      pd.choices.forEach((c, i) => {
        const def = getSkillDefinition(c.id);
        L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${c.name}「${plain(def?.describe?.() ?? '')}」`);
      });
      L.push('  → act claim <#>（编号或卡名）');
    } else if (pd.relicChoices?.length) {
      L.push('  候选遗物:');
      pd.relicChoices.forEach((r, i) => {
        L.push(`    [${i + 1}] ${r.name}：${plain(getRelicDefinition(r.id)?.description ?? '')}`);
      });
      L.push('  → act claim <#>（编号或遗物名）');
    }
    else if (pd.upgrade?.kind === 'free' || run.slotUpgradePending) L.push('  → act upgrade <构筑#> <卡名>（指定要升级的卡）');
    else L.push('  → act claim 领取 / act drop 放弃');
  } else {
    L.push('→ act spin 拉杆（产出可放弃）/ next 离开');
  }
}

function renderRoomGurpas(S, L) {
  const run = S.run;
  const g = gurpasView(run);
  L.push(`古尔帕斯之店（持有 ${g.money} 金币）——她只收 A/S 级遗物，货架买光不补：`);
  g.items.forEach((it, i) => L.push(`  [${i + 1}] ${it.label} — ${it.price} 金`
    + (it.sub ? `｜${plain(it.sub)}` : '') + (it.sold ? '（已售出）' : '')
    + (it.kind === 'remove' ? `（本次已用 ${it.used ?? 0}/2）` : '')));
  if (g.pendingPack) {
    L.push('  卡包待选:');
    g.pendingPack.choices.forEach((id, i) => {
      const def = getSkillDefinition(id);
      L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
    });
    L.push('  → act gurpas claim <#|defId> [卡名]');
  } else {
    L.push('  → act gurpas buy <#>｜act gurpas remove <构筑#> <卡名>（删卡服务）');
  }
  if (g.sellable.length) {
    L.push('  收购（A/S）：' + g.sellable.map(x => `${x.name}(${x.rarity},+${x.price}金)`).join(' / '));
    L.push('  → act gurpas sell <遗物id>');
  } else {
    L.push('  （身上没有她收的 A/S 级遗物）');
  }
}

function renderRoomEvent(S, L) {
  const v = eventView(S.run);
  L.push(`事件房「${v.name}」→ act choose <#> 选定选项 ｜ act play = 直接选 [1] ｜ act skip 不触发离开`);
  v.choices.forEach((c, i) => L.push(`  [${i + 1}] ${c.label}${c.hint ? '——' + c.hint : ''} (id:${c.id})`));
}

function renderAscension(S, L) {
  const run = S.run;
  L.push(`→ dim 火 | dim 木 | dim 空 | dim 跳过`);
  L.push(`  提示：跳过本灵脉进阶 = 选择进阶体修等级（体修等级+1，之后能抽到更高阶的体修卡牌）+生命上限+3+删卡机会1次（不回血、不提魏启）；点火系 = +1魏启上限并回满、回${ASCENSION_PLACEHOLDER.healAmount}血`);
  if (run.ascensionOffer) {
    L.push(`能力候选:`);
    run.ascensionOffer.forEach((id, i) => {
      const def = getAbilityDefinition(id);
      const tag = def?.grade === 'master' ? '大师' : '精英';
      L.push(`  [${i + 1}] 【${tag}】${def?.name ?? id}「${def?.description ?? ''}」`);
    });
    L.push(`→ ability <#|skip>`);
  }
}

function renderPrep(S, L) {
  const run = S.run;
  const p = run.player;
  L.push(`本层遭遇: ${run.encounter.map(e => {
    const def = getEnemyDefinition(e.defId);
    const elite = def?.difficulty?.elite ? '精英·' : '';
    return `${elite}${def?.name ?? e.defId}(${e.maxHp}血${e.difficulty != null ? `·难${e.difficulty}` : ''})`;
  }).join(' + ')}`);
  {
    // 未装备遗物显式提醒（买/抽到忘装 = 整场不生效，第 2 轮试玩点名的最大摩擦点）
    const costOf = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
    const unequipped = (p.relics ?? []).filter(
      id => !(p.equippedRelics ?? []).includes(id) && !getRelicDefinition(id)?.nonSlot);
    const free = p.relicSlots - (p.equippedRelics ?? []).reduce((n, id) => n + costOf(id), 0);
    if (unequipped.length) {
      const fits = unequipped.filter(id => costOf(id) <= free);
      const shown = unequipped.slice(0, 6).map(id => `${getRelicDefinition(id)?.name ?? id}(${costOf(id)}槽)`);
      const tail = unequipped.length > shown.length ? ` 等 ${unequipped.length} 件` : '';
      L.push(`⚠ 有 ${unequipped.length} 件遗物未装备（空槽 ${free} 点）：${shown.join(' / ')}${tail}`);
      L.push(fits.length
        ? `  → 可装：${fits.slice(0, 4).map(id => `relic equip ${id}`).join(' / ')}（不装本场不生效）`
        : `  → 空槽不足（未装备的都要 ${Math.min(...unequipped.map(costOf))} 点以上）：先 relic unequip <遗物id> 腾槽`);
    }
  }
  L.push(`→ fight 开战 / deck 看牌组`);
}

function renderEnd(S, L) {
  const run = S.run;
  L.push(`本局结束：${run.result === 'victory' ? '登顶成功' : '战败'}。感谢游玩！`);
  const tail = S.lastBattleTail;
  if (tail) {
    L.push(`终局快照 · 死时手牌: ${tail.hand.length ? tail.hand.join(' / ') : '（空）'}`);
    L.push(`终局快照 · 敌人: ${tail.enemies.map((e) => `${e.name} ${e.dead ? '已死' : `${e.hp}/${e.maxHp}血`}`).join(' | ') || '（无）'}`);
  }
}

export function renderDeck(S) {
  // 战斗中看战斗牌区（牌库顶在前，可见冷却/激活）；平时看构筑（升级用编号）
  if (S.battle && S.run.gameStage === 'battle') {
    const z = S.battle.battleState.zones;
    const L = [`战斗牌区：手牌 ${z.hand.length} | 牌库 ${z.deck.length}（顶在前）| 焚毁 ${z.burnt.length} | 结算区 ${z.pending.length}`];
    L.push('牌库:');
    z.deck.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, null)));
    if (z.burnt.length) {
      L.push('焚毁区:');
      z.burnt.forEach((c, i) => L.push(`  [${i + 1}] ${defOf(c).name}`));
    }
    return L.join('\n');
  }
  const L = [`构筑牌组（${S.run.player.deck.length} 张，升级用编号）:`];
  S.run.player.deck.forEach((rt, i) => {
    const def = defOf(rt);
    const targets = gatedPromotionTargets(S.run, def);
    const next = targets[0];
    const promo = next
      ? ` →${getSkillDefinition(next).name}`
      : (Array.isArray(def.promotesTo) ? def.promotesTo[0] : def.promotesTo)
        ? ' →（等阶未解锁）' : '';
    L.push(`  [${i + 1}] ${def.name} ${def.tier}阶${promo}`);
  });
  return L.join('\n');
}

// 牌库查阅（战斗中）：抽牌顺序视图——抽牌是顺序抽的，可预知未来抽到什么。
// 注：本场无弃牌堆，弃牌/换牌直接回牌库底（可在下表尾部看到）。
export function renderLib(S) {
  if (!S.battle || S.run.gameStage !== 'battle') {
    return '【牌库】lib 只在战斗内有意义（战斗中才能预知下一张抽到什么）。'
      + '当前非战斗阶段——你看到的是静态构筑，抽牌顺序要等开战才有；用 deck 查构筑。';
  }
  const z = S.battle.battleState.zones;
  const L = ['【牌库】抽牌严格按下列顺序（[1] 就是下一张抽到的）——可预知未来抽卡；弃牌/换牌回牌库底：'];
  if (!z.deck.length) {
    L.push('  （牌库已空——本场无弃牌堆；抽牌等效果会因无牌可抽而落空，注意卡牌循环）');
  } else {
    z.deck.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, null)));
  }
  return L.join('\n');
}

// 遗物一览（只读）：拥有的全部遗物 + 效果文本 + 槽位占用（report-r1-A 缺陷#7）
export function renderRelics(S) {
  const run = S.run;
  const p = run.player;
  const cost = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
  const owned = p.relics ?? [];
  const L = ['【遗物】槽位是**权重和**口径：已装备遗物的槽位值之和 ≤ 槽位上限；非槽位式（0 槽）恒生效、不用装备。'];
  if (!owned.length) return L.concat('  （还没有遗物）').join('\n');
  const used = (p.equippedRelics ?? []).reduce((n, id) => n + cost(id), 0);
  L.push(`槽位 ${used}/${p.relicSlots}（战斗中生效 = 已装备 + 全部非槽位式）`);
  for (const id of owned) {
    const d = getRelicDefinition(id);
    const tags = [d?.rarity ?? 'C', d?.nonSlot ? '非槽位式·恒生效' : `${cost(id)}槽`];
    if ((p.equippedRelics ?? []).includes(id)) tags.push('已装备');
    else if (!d?.nonSlot) tags.push('未装备·不生效');
    L.push(`  ${d?.name ?? id}（${tags.join('·')}）：${plain(d?.description ?? '')}`);
  }
  if (run.gameStage === 'prep') {
    L.push('  → relic equip <遗物id> / relic unequip <遗物id>（进战斗前定好；编号见上）');
  }
  return L.join('\n');
}

export function renderTerms() {
  // agent 口径（幼稚园模式）：程序化细则——触发时机/判定口径/不生效情形写全，防 LLM 误读规则
  const L = ['【词条表】（卡面关键词的完整释义，程序化细则口径）'];
  for (const { name, text } of listNamedTerms({ agent: true })) L.push(`  ${name} — ${text}`);
  L.push('【效果表】（状态栏图标释义）');
  for (const def of allEffects()) {
    L.push(`  ${def.name}（${def.type === 'buff' ? '增益' : '减益'}） — ${def.description}`);
  }
  return L.join('\n');
}

// 战斗长日志（log [N]，默认 40，上限 200）：「最近结算」只给尾部 10 条，复杂回合的
// 中间过程（0927 实录：咏唱解除的证据行被截掉，只能靠读源码复盘）需要更长窗口核对。
export function renderLog(S, tail = 40) {
  const n = Math.max(1, Math.min(200, Number.isFinite(tail) ? tail : 40));
  const log = battleLogText(S, n);
  return [`【战斗日志】最近 ${log.length} 条（log <N> 调 1~200；非战斗阶段为上场战斗尾档）：`]
    .concat(log.map((l) => `  · ${l}`)).join('\n');
}

// 规则速查（rules）：回合结构/基础语义/主语约定。LLM 试玩常因机制口径不清吃大亏
// （0927 实录：咏唱当一次性结算、焰刃「正在燃烧」读成目标燃烧、以为留手会弃掉）。
// 事实源：instructions/turn.js（七阶段）、battleRoot.js（PreBattle/护盾清零/魏启半开）、battle.md。
export function renderRules() {
  const L = ['【规则速查】（词条细则看 terms；本表只讲结构与时序）'];
  L.push('□ 玩家回合七阶段：P1 回合开始（AP回满·魏启+1·回合开始效果结算→然后护盾清零）'
    + ' → P2 冷却推进（手牌与牌库里的计时卡各推进1拍） → P3 抽牌（抽至手牌容量，咏唱按权重占位；'
    + '首回合不抽——起手牌由开战发放） → P4 你操作 → P5 咏唱触发（全部已点亮咏唱在此结算）'
    + ' → P7 盟友行动 → P8 回合结束结算 → P9 超载尾弃（超容量手牌从尾部弃回牌库底，激活咏唱豁免）');
  L.push('□ 敌方回合：先快照行动者 → 回合开始效果（敌方燃烧跳伤、复苏复活都在此）→ 依次行动 → 刷新意图。'
    + '跳伤在行动**之前**（被烧死的敌人本回合不攻击）；复活归来的单位本回合不行动（快照已定）。');
  L.push('□ 持续伤害按**所属方**回合开始结算，跳完-1层：敌方燃烧在敌方阶段开头跳、你的自燃在你回合开头跳。'
    + '你的护盾在你的回合开始清零（先结算跳伤后清——残盾吃得到跳伤；开局盾首回合豁免）；'
    + '敌方护盾每个敌方回合开始清零。');
  L.push('□ 战斗开始：护盾/效果清零、AP回满、魏启=上限一半（下取整，回合开始再+1）；牌组克隆洗牌后发起新手牌。'
    + '牌库顶=下一张抽到的；打出/弃掉的**非消耗**卡回牌库底（无弃牌堆、无重洗）；'
    + '消耗卡本场移除、下场战斗回归；战斗中新获得的卡（发现产物/敌人塞的牌）本场临时，战后不沉淀。');
  L.push('□ 手牌：未打出的牌**保留到下回合**（P3只补空位——留手=放弃等额新牌）。');
  L.push('□ 咏唱卡：打出=付费**点亮**（每回合P5自动触发，占咏唱容量+手牌权重）；再次打出=**解除**离场（无触发）。'
    + '点亮是持续状态，不是一次性结算。');
  L.push('□ 卡面主语约定：裸写「效果X N」（燃烧4/护盾6/攻击+7）= **自己**获得或自身状态；「目标/敌人」= 卡牌目标。'
    + '「正在燃烧」类条件判的是你自己。');
  L.push('□ 伤害管线：基础值+面板 → PRE修饰 → 减**防御**（固定值）→ 护盾吸收 → 生命。'
    + '蓄势只被**生命伤害**扣层（盾挡/防挡不算）；荆棘按受击次数反伤；闪避使下一次受击落空。');
  L.push('□ 常用排查：why <手牌#|卡名>（为什么打不出）| lib（预知抽牌顺序）| log <N>（长战斗日志）'
    + '| terms（词条/效果表）| rules（本表）');
  return L.join('\n');
}
