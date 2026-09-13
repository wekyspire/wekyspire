// 状态渲染：把会话状态（run + 战斗）渲染成文本界面（headless CLI 与直播观战共用同一份）。
// 按阶段分流到 render* 小函数；render() 只负责玩家/遗物表头与尾档收尾。
import { swapCostOf } from '../../src/core/state/battleState.js';
import { effectiveHandCount } from '../../src/core/skills/helpers.js';
import { getSkillDefinition } from '../../src/core/skills/registry.js';
import { getAbilityDefinition } from '../../src/core/abilities/registry.js';
import { getEnemyDefinition } from '../../src/core/enemies/registry.js';
import { getRelicDefinition } from '../../src/core/relics/registry.js';
import { gatedPromotionTargets } from '../../src/core/run/promotion.js';
import { PACKS, maxRewardTier } from '../../src/core/run/rewards.js';
import { ASCENSION_PLACEHOLDER, FIRST_ASCENSION_GRANT } from '../../src/core/run/ascension.js';
import { campOptions } from '../../src/core/run/rooms/camp.js';
import { trainingMode, upgradableCards } from '../../src/core/run/rooms/training.js';
import { slotView, SLOT } from '../../src/core/run/rooms/slotMachine.js';
import { bankView, pendingDebuffViews } from '../../src/core/run/rooms/bank.js';
import { gurpasView } from '../../src/core/run/rooms/gurpas.js';
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
  if (p.abilities.length) L.push(`能力: ${p.abilities.join(' ')}`);
  // 遗物：背包全量 + 槽位占用（槽位是**权重和**口径 Σcost ≤ relicSlots；非槽位式恒生效、不需装备）
  if (p.relics?.length) {
    const cost = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
    const used = (p.equippedRelics ?? []).reduce((n, id) => n + cost(id), 0);
    L.push(`遗物槽位 ${used}/${p.relicSlots}：`
      + p.relics.map((id) => {
        const d = getRelicDefinition(id);
        const tags = [d?.rarity ?? 'C', d?.nonSlot ? '非槽位式' : `${cost(id)}槽`];
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
  L.push(`牌库 ${bs.zones.deck.length}（lib 查抽牌顺序——顺序抽，可预知） | 焚毁 ${bs.zones.burnt.length} | 手牌 ${effectiveHandCount(bs)}/${p.maxHandSize}（加权）`);
  L.push(`手牌:`);
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
      L.push(`  候选（来源 ${pi.source ?? '?'}，共 ${pi.candidates.length} 张）: `
        + pi.candidates.map((id, i) => `[${i + 1}] ${byId.has(id) ? defOf(byId.get(id)).name : id}`).join(' '));
    }
  }
  L.push(`→ play <手牌#> <卡名> [敌#] / dump <手牌#> <卡名> [更多# 卡名…]（付费${swapCostOf(bs)}AP弃任意张） / end`
    + ` / in <候选#> [卡名] …（多选就重复写，如 in 1 拳 3 盾） / why <手牌#> / lib 看牌库`);
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
  // 合并房（campTraining）两部分独立计时：完成态看 run.roomData 的双旗标，不看
  // S.roomDone——它是单旗标，任一部分动作都会置位，按它早退会把另一部分的动作入口
  // 连同强绑抓牌候选一起藏掉（"先休整后训练 → 候选不可见、显示已完成"的病灶）
  const roomDone = room === 'campTraining'
    ? (!!run.roomData?.campUsed && !!run.roomData?.trained)
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
  else if (room === 'event') renderRoomEvent(L);
}

function renderRoomShop(S, L) {
  const run = S.run;
  const p = run.player;
  const disc = run.shop.discount < 1 ? `（${Math.round(run.shop.discount * 10)} 折）` : '';
  L.push(`自动售货机${disc}｜持有 ${p.money} 金币：`);
  if (run.shop.broken) L.push('  瑞米：“上次逃得太狼狈了……忘记补货了……”');
  // 买不起的货直接标注差额——headless 没有 GUI 的红字价格，文本口径是唯一的可负担性信息
  // （R8-A：P0 因为"试着点了最贵的看会不会触发什么"，被动买了货，丧失了主动选择权）
  run.shop.items.forEach((it, i) => L.push(`  [${i}] ${it.label} — ${it.price} 金`
    + (it.sub ? `｜${plain(it.sub)}` : '') + (it.sold ? '（已售出）' : '')
    + (!it.sold && p.money < it.price ? `（还差 ${it.price - p.money} 金）` : '')));
  if (run.shopPending) {
    if (run.shopPending.kind === 'relic') {
      // 遗物包三选一（2026-09-13 用户定）：稀有度 + 名 + 效果，claim -1 放弃
      L.push(`  遗物包待选（${run.shopPending.rarity} 级，三选一，可放弃）:`);
      run.shopPending.choices.forEach((id, i) => {
        const def = getRelicDefinition(id);
        L.push(`    [${i}] 【${def?.name ?? id}】（${def?.rarity ?? 'C'} 级，`
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
function renderRoomCampTraining(S, L, room) {
  const run = S.run;
  const renderCamp = () => {
    const optCn = { recoverRemi: '找回瑞米(remi)', rest: '休整(rest)', upgrade: '升级(upgrade)' };
    L.push(`营地。可用: ${campOptions(run).map(o => optCn[o] ?? o).join(' / ')}`
      + `（act rest | act remi | act upgrade <构筑#> <卡名>——先 preview up <#> 看升阶对比）`);
  };
  const renderTraining = () => {
    L.push(`训练场（累计训练 ${run.player.trainingCount} 次）。模式: ${trainingMode(run) === 'upgrade' ? '先升后抓' : '退化抓牌'}`);
    if (run.roomData?.drawChoices) {
      L.push(`抓牌候选:`);
      run.roomData.drawChoices.forEach((id, i) => {
        const def = getSkillDefinition(id);
        const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
        L.push(`  [${i + 1}] ${nameTag} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」${run.roomData.forced ? '' : '（可跳过）'}`);
      });
      L.push(`→ act take <#> <卡名>${run.roomData.forced ? '（升级强绑，不可跳过）' : ' / act skipdraw'}`);
    } else if (trainingMode(run) === 'upgrade') {
      const deckIdx = (rt) => `[${run.player.deck.indexOf(rt) + 1}]`;
      L.push(`可升级卡: ${upgradableCards(run).map(rt => `${deckIdx(rt)}${defOf(rt).name}`).join(' ')}`);
      L.push(`→ act up <构筑#> <卡名>（先 preview up <#> 看升阶对比；编号即 deck 视图行号）/ act skip`);
    } else {
      L.push(`→ act draw（看候选）/ act skip`);
    }
  };
  if (room !== 'training') {
    if (run.roomData?.campUsed) L.push('营地部分：已用过（每房一次）');
    else renderCamp();
  }
  if (room !== 'camp') {
    if (run.roomData?.trained) L.push('训练部分：已完成（每房一次）');
    else renderTraining();
  }
  if (room === 'campTraining') {
    L.push(run.roomData?.forced
      ? '（升级强绑抓牌未领：必须 act take <#>）'
      : '（营地与训练各自可做一次，随时 next 离开）');
  }
}

function renderRoomSlot(S, L) {
  const run = S.run;
  const p = run.player;
  const v = slotView(run);
  L.push(`老虎机：本次单价 ${v.cost} 金币（每抽 +${SLOT.costStep}）｜持有 ${p.money}`
    + (v.freeRolls ? `｜免费 ${v.freeRolls} 次` : '')
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
  g.items.forEach((it, i) => L.push(`  [${i}] ${it.label} — ${it.price} 金`
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

function renderRoomEvent(L) {
  L.push(`事件房 → act play 触发事件`);
}

function renderAscension(S, L) {
  const run = S.run;
  L.push(`→ dim 火 | dim 跳过`);
  L.push(`  提示：跳过本灵脉进阶 = 选择进阶体修等级（体修等级+1，之后能抽到更高阶的体修卡牌）且生命上限+3，另回${ASCENSION_PLACEHOLDER.healAmount}血、魏启上限+1`);
  if (run.cardOffering) {
    const off = run.cardOffering;
    const grant = FIRST_ASCENSION_GRANT[off.dimension];
    if (grant && run.player.leino[off.dimension] === 1) {
      const ab = grant.ability ? getAbilityDefinition(grant.ability) : null;
      L.push(`本次获赠（已入牌组）：${grant.cards.map(id => getSkillDefinition(id)?.name ?? id).join('、')}`
        + (ab ? ` ｜ 体系能力「${ab.name}」：${plain(ab.description)}` : ''));
    }
    L.push(`种子九选三（选3张入组，刷新剩 ${off.rerollsLeft}）:`);
    off.cards.forEach((id, i) => {
      const def = getSkillDefinition(id);
      L.push(`  [${i + 1}] ${def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·` : ''}${def.name} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」`);
    });
    L.push(`→ seed <#> <卡名>,<#> <卡名>,<#> <卡名> / reroll`);
  }
  if (run.ascensionOffer) {
    L.push(`能力候选:`);
    run.ascensionOffer.forEach((id, i) => {
      const def = getAbilityDefinition(id);
      L.push(`  [${i + 1}] ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
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
  const L = ['【词条表】（卡面关键词的完整释义，等同游戏内悬浮说明）'];
  for (const { name, text } of listNamedTerms()) L.push(`  ${name} — ${text}`);
  L.push('【效果表】（状态栏图标释义）');
  for (const def of allEffects()) {
    L.push(`  ${def.name}（${def.type === 'buff' ? '增益' : '减益'}） — ${def.description}`);
  }
  return L.join('\n');
}
