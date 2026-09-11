// 各休息阶段面板的构建器：「快照 → widget 列表」纯映射。
// 一个面板一个 builder；PanelObject 只认 widget 描述，不认识任何面板语义。
// action 字段即上报给宿主：`local: true` 的由舞台自己消化（面板本地交互态，如勾选），
// 其余转给 runController.dispatchPanelIntent（见 THREE_UI_MIGRATION §2.1）。

import { KEYWORD_LABELS } from '../../bridge/projection.js';
import { getSkillDefinition } from '../../core/skills/registry.js';
import { getRelicDefinition } from '../../core/relics/registry.js';

// 卡面视图的关键词 id → 页脚中文标签（标签表在 bridge，core 不得反向依赖，故在此映射）
const withLabels = (view) => (view
  ? { ...view, keywords: (view.keywords ?? []).map(k => KEYWORD_LABELS[k] ?? k) }
  : view);

// 灵脉维度的表现配置（配色/字槽）：core 只给 id 与等级，画成什么样属表现层。
// 素材到位后把 glyph 换成美术图即可（与旧面板 .dim-icon「美术到位替换」同一处）。
const DIM_META = {
  fire: { label: '火灵脉', glyph: '炎', color: '#e85a5a' },
  wood: { label: '木灵脉', glyph: '木', color: '#4aa56e' },
  air: { label: '空灵脉', glyph: '风', color: '#5aa2e8' },
  body: { label: '体修', glyph: '武', color: '#b8894a' },
};

/** 战前准备（塔楼层）：层数 / 敌人预告 / 遗物装卸 / 进入战斗。 */
export function buildPrepPanel(snap) {
  const w = [];
  w.push({ kind: 'title', text: snap.title ?? '战前准备' });
  // 未用掉的删卡机会（Boss 奖励）也可以在塔楼层用掉
  if (snap.cardRemoval) {
    w.push({
      kind: 'button', id: 'prep:removeCard', width: 360, size: 'sub',
      label: `使用删卡机会（剩 ${snap.cardRemoval.count} 次）`,
      action: { action: 'openUpgradePicker', source: 'bossRemove', local: true },
    });
  }
  w.push({ kind: 'text', text: `层数 ${snap.floor} / ${snap.totalFloors}` });
  w.push({
    kind: 'text',
    text: snap.atBossFloor ? `本层即 Boss！` : `距 Boss 层 ${snap.toBoss} 层`,
    tint: snap.atBossFloor ? '#ff7875' : undefined,
  });

  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', text: '下层敌人预告', tint: '#8a93b2' });
  if (!snap.encounter?.length) w.push({ kind: 'text', text: '（无）', tint: '#77809a' });
  for (const e of snap.encounter ?? []) {
    w.push({ kind: 'text', text: e.name, tint: '#f08080' });
  }

  w.push({ kind: 'gap' });
  w.push({
    kind: 'sub',
    // 槽位是权重和口径（Σcost ≤ 上限）：显示占用量而非件数
    text: `遗物（槽位 ${snap.relicSlots.used}/${snap.relicSlots.total}）`,
    tint: '#8a93b2',
  });
  if (!snap.relics?.length) w.push({ kind: 'text', text: '（无）', tint: '#77809a' });
  const slotRelics = (snap.relics ?? []).filter(r => !r.nonSlot);
  const nonSlotRelics = (snap.relics ?? []).filter(r => r.nonSlot);
  for (const r of slotRelics) {
    const tag = r.rarity ? `${r.rarity}·${r.cost}槽` : `${r.cost}槽`;
    const suffix = r.equipped ? '（已装备）' : '';
    w.push({
      kind: 'text', text: `[${tag}] ${r.name}${suffix}`, tint: r.equipped ? '#ffd75e' : undefined,
      token: { type: 'relic', payload: { relicId: r.id } }, // hover 出效果预览
    });
    if (r.equipped) {
      w.push({ kind: 'button', id: `relic:unequip:${r.id}`, label: '卸下', action: { action: 'unequip', relicId: r.id } });
      if (r.canUse) {
        const uses = r.usesLeft != null ? `（余 ${r.usesLeft}）` : '';
        w.push({ kind: 'button', id: `relic:use:${r.id}`, label: `使用${uses}`, action: { action: 'useRelic', relicId: r.id } });
      }
    } else {
      w.push({
        kind: 'button', id: `relic:equip:${r.id}`,
        label: r.canEquip ? '装备' : '装备（槽位不足）',
        enabled: r.canEquip, // 可用性由 core 判定，Stage 只画
        action: { action: 'equip', relicId: r.id },
      });
    }
  }
  if (nonSlotRelics.length) {
    w.push({ kind: 'gap' });
    w.push({ kind: 'sub', text: '非槽位式（恒生效，不占槽）', tint: '#8a93b2' });
    for (const r of nonSlotRelics) {
      w.push({
        kind: 'text', text: `[${r.rarity ?? 'C'}] ${r.name}`, tint: '#a8c6a0',
        token: { type: 'relic', payload: { relicId: r.id } },
      });
    }
  }

  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'prep:start', label: '进入战斗', size: 'main',
    enabled: snap.canStartBattle !== false, action: { action: 'startBattle' },
  });
  return w;
}

/**
 * 战后奖励（模态）：金币入账 + 卡包选择 + 包内三选一（或跳过）。
 * 卡包未选时给瓦片；已开包（含单包自动开）给卡面三选一。
 */
export function buildRewardPanel(snap) {
  const removal = snap.cardRemoval;
  const w = [];
  w.push({ kind: 'title', text: snap.title ?? '战后奖励', align: 'center' });
  w.push({ kind: 'text', text: `金币 +${snap.money}`, tint: '#ffd75e', align: 'center' });
  w.push({ kind: 'gap' });

  // Boss 通关奖励：删卡机会（§2.1）——与古尔帕斯的删卡服务同一套选卡界面
  if (removal) {
    w.push({
      kind: 'button', id: 'reward:removeCard', width: 360, size: 'sub',
      label: `使用删卡机会（剩 ${removal.count} 次）`,
      action: { action: 'openUpgradePicker', source: 'bossRemove', local: true },
    });
    w.push({ kind: 'gap' });
  }

  if (!snap.packId) {
    w.push({ kind: 'sub', text: '选择一个卡包（按该体系灵脉等级出卡）：', tint: '#9aa3b8', align: 'center' });
    w.push({
      kind: 'tiles', idPrefix: 'pack', tileHeight: 96,
      items: (snap.packs ?? []).map(p => ({
        id: p.id, name: p.name, desc: p.desc,
        action: { action: 'chooseRewardPack', packId: p.id },
      })),
    });
    return w;
  }

  w.push({
    kind: 'sub',
    text: `${snap.packName ?? ''} · 择一张技能卡加入牌组`,
    tint: '#9aa3b8', align: 'center',
  });
  w.push({
    kind: 'cards', idPrefix: 'reward',
    items: (snap.skillChoices ?? []).map(c => ({
      defId: c.defId, view: withLabels(c.view),
      action: { action: 'claimReward', defId: c.defId },
    })),
  });
  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'reward:skip', label: '跳过奖励', width: 220,
    action: { action: 'claimReward', defId: null },
  });
  return w;
}

/**
 * 进阶事件（模态）：常规 = 四维度突破；种子包 = 九选三 + 刷新。
 * 勾选缓冲由舞台以 `{ selected }` 注入（纯 UI 交互态，确认时才作为 intent 载荷上报）；
 * 勾选动作标 `local: true`，由舞台自己消化并就地重绘，不惊动 core。
 */
export function buildAscensionPanel(snap, { selected = new Set() } = {}) {
  const w = [];
  const off = snap.offering;

  if (!off) {
    w.push({ kind: 'title', text: snap.title ?? '进阶事件', align: 'center' });
    w.push({ kind: 'sub', text: '灵力涌动——择一条主维度突破：', tint: '#9aa3b8', align: 'center' });
    w.push({
      kind: 'tiles', idPrefix: 'dim', tileHeight: 104, gapY: 14,
      items: (snap.dims ?? []).map((d) => {
        const meta = DIM_META[d.id] ?? { label: d.id, glyph: '?', color: '#8a93b2' };
        return {
          id: d.id, name: `${meta.glyph} ${meta.label}`, desc: `等级 ${d.level}`,
          action: { action: 'chooseAscensionDimension', dimension: d.id },
        };
      }),
    });
    w.push({ kind: 'gap' });
    w.push({
      kind: 'button', id: 'asc:skip', label: '跳过（改记 1 点体修等级）', width: 300,
      action: { action: 'skipAscension' },
    });
    w.push({ kind: 'gap' });
    w.push({
      kind: 'sub', align: 'center', tint: '#77809a',
      text: `总进阶 ${snap.ascensionCount}/${snap.maxAscensions}`
        + ` ｜ 突破后恢复 ${snap.healAmount} 点生命、魏启上限 +${snap.manaGain}`,
    });
    return w;
  }

  const dimMeta = DIM_META[off.dimension] ?? { label: off.dimension };
  w.push({ kind: 'title', text: `种子包 · ${dimMeta.label}`, align: 'center' });
  if (snap.grant) {
    w.push({
      kind: 'sub', align: 'center', tint: '#9aa3b8',
      text: `初次点亮——已获赠 ${snap.grant.cardNames.join('、')} 直入牌组`
        + `，并获得体系能力「${snap.grant.abilityName}」`,
    });
  }
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `再从九张基石卡中任选 ${off.picks} 张加入牌组（已选 ${selected.size}/${off.picks}）`,
  });
  w.push({
    kind: 'cards', idPrefix: 'seed', cols: 5, scale: 0.62, gapY: 12,
    items: (off.cards ?? []).map(c => ({
      defId: c.defId, view: withLabels(c.view), active: selected.has(c.defId),
      action: { action: 'toggleSeed', defId: c.defId, local: true },
    })),
  });
  w.push({
    kind: 'button', id: 'seed:confirm', width: 260, size: 'main',
    label: `确认（${selected.size}/${off.picks}）`,
    enabled: selected.size === off.picks,
    action: { action: 'chooseSeedCards', defIds: [...selected] },
  });
  w.push({
    kind: 'button', id: 'seed:reroll', width: 260, size: 'sub',
    label: `刷新九张（剩余 ${off.rerollsLeft} 次）`,
    enabled: off.rerollsLeft > 0,
    action: { action: 'rerollSeedOffering' },
  });
  return w;
}

// 房间标题/图标/提示：表现文案（core 只给 currentRoom 这个 id）
const ROOM_META = {
  training: { name: '训练场', glyph: '🏋️', hint: '磨砺技艺——每层训练记录在案，达标即可进阶' },
  camp: { name: '营地', glyph: '⛺', hint: '暂作休整，选择一件好事发生' },
  campTraining: { name: '营地 · 训练场', glyph: '⛺', hint: '休整与磨砺同处一室——两边各可做一次' },
  gurpas: { name: '古尔帕斯之店', glyph: '🏪', hint: '旧魏启大陆的物件——她只收 A/S 级遗物' },
  slot: { name: '老虎机', glyph: '🎰', hint: '命运转轮，愿者上钩' },
  event: { name: '事件房', glyph: '❓', hint: '一间弥漫着迷雾的房间……' },
};

// 老虎机奖项文案（结果载荷 → 可读文本；奖励房通用）
const prizeText = (p) => ({
  nothing: '什么也没发生……',
  money: `金币 +${p.money}`,
  fruit: '获得 remi 升级果 ×1',
  training: '训练次数 +1',
  card: `获得卡牌：${p.defId}`,
  relic: `获得遗物：${p.relicId}`,
}[p.type] ?? '……');
const eventText = (r) => ({
  moneyBag: `捡到钱袋：金币 +${r.money}`,
  spring: `治愈泉：回复 ${r.heal} 点生命`,
}[r.eventId] ?? '迷雾散去，什么也没留下。');

/**
 * 「升级一张卡」入口（训练场/营地共用）：按一下进入**全屏选卡界面**
 * （本动作由舞台本地消化——界面里的卡来自快照的 upgradeCards；确认时才把选中的卡上报 core）。
 */
const upgradeButton = (source) => ({
  kind: 'button', id: `${source}:upgrade`, width: 300, size: 'main',
  label: '升级一张卡', action: { action: 'openUpgradePicker', source, local: true },
});

/** 奖励房（模态）：训练场 / 营地 / 老虎机 / 事件房。 */
export function buildRoomPanel(snap) {
  const meta = ROOM_META[snap.room] ?? { name: snap.room, glyph: '？', hint: '' };
  const w = [];
  w.push({ kind: 'title', text: `${meta.glyph} ${meta.name}`, align: 'center' });
  // 售货机与房间并存（不占房间名额）：本层有货架就给一个入口（打开是**本地**动作，不消耗房间行动）
  if (snap.shop) {
    w.push({
      kind: 'button', id: 'room:shop', width: 300, size: 'sub',
      label: `自动售货机（持有 ${snap.money} 金币）`,
      action: { action: 'openShop', local: true },
    });
  }

  if (snap.room === 'training') {
    const t = snap.training ?? {};
    // 候选抉择中（升级后的强制尾款 / 退化模式已开局）：差别只在有无跳过
    if (t.choices?.length) {
      w.push({
        kind: 'sub', align: 'center', tint: '#9aa3b8',
        text: t.forced ? '升级完成！必须择一张加入牌组：' : '择一张加入牌组：',
      });
      w.push({
        kind: 'cards', idPrefix: 'train', cols: 3, scale: 0.8,
        items: t.choicesCards.map(c => ({
          defId: c.defId, view: withLabels(c.view),
          action: { action: 'trainingDraw', defId: c.defId },
        })),
      });
      if (!t.forced) {
        w.push({ kind: 'button', id: 'train:skip', label: '跳过', width: 220, size: 'sub', action: { action: 'trainingDraw', defId: null } });
      }
      return w;
    }
    if (t.mode === 'upgrade') {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '免费升级一张卡（完成后须再择一张加入牌组）：' });
      w.push(upgradeButton('training'));
      w.push({ kind: 'button', id: 'train:skip', label: '跳过', width: 220, size: 'sub', action: { action: 'trainingSkip' } });
      return w;
    }
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '暂无可升级的卡牌，本次改为抓一张（可跳过）。' });
    w.push({ kind: 'button', id: 'train:roll', width: 240, label: '抓牌', action: { action: 'trainingDrawRoll' } });
    w.push({ kind: 'button', id: 'train:skip', label: '跳过', width: 220, size: 'sub', action: { action: 'trainingSkip' } });
    return w;
  }

  // 营地组（单房 'camp' 与合并房 'campTraining' 共用同一份）
  const pushCampGroup = (c = { options: [] }) => {
    const tiles = [];
    if (c.options.includes('recoverRemi')) {
      tiles.push({ id: 'recoverRemi', name: '🐾 找回瑞米', desc: '那位老朋友回到了身边', action: { action: 'campChoose', option: 'recoverRemi' } });
    }
    if (c.options.includes('rest')) {
      tiles.push({ id: 'rest', name: '🔥 休整', desc: '回复 35% 最大生命，魏启全部回满', action: { action: 'campChoose', option: 'rest' } });
    }
    if (tiles.length) w.push({ kind: 'tiles', idPrefix: 'camp', tileHeight: 96, gapY: 14, items: tiles });
    if (c.options.includes('upgrade')) {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '或免费升级一张卡：' });
      w.push(upgradeButton('camp'));
    }
  };

  if (snap.room === 'camp') {
    pushCampGroup(snap.camp);
    return w;
  }

  // 合并房（营地 · 训练场）：两个部分各一次；训练抉择中优先占屏，营地组在下方仍然可用
  if (snap.room === 'campTraining') {
    const t = snap.training ?? {};
    const c = snap.camp ?? { options: [] };
    if (t.choices?.length) {
      w.push({
        kind: 'sub', align: 'center', tint: '#9aa3b8',
        text: t.forced ? '升级完成！必须择一张加入牌组：' : '择一张加入牌组：',
      });
      w.push({
        kind: 'cards', idPrefix: 'train', cols: 3, scale: 0.8,
        items: t.choicesCards.map(x => ({
          defId: x.defId, view: withLabels(x.view),
          action: { action: 'trainingDraw', defId: x.defId },
        })),
      });
      if (!t.forced) {
        w.push({ kind: 'button', id: 'train:skip', label: '跳过', width: 220, size: 'sub', action: { action: 'trainingDraw', defId: null } });
      }
    } else if (!t.done && t.mode === 'upgrade') {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：免费升级一张卡（完成后须再择一张加入牌组）：' });
      w.push(upgradeButton('training'));
      w.push({ kind: 'button', id: 'train:skip', label: '跳过训练', width: 220, size: 'sub', action: { action: 'trainingSkip' } });
    } else if (!t.done) {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：暂无可升级的卡牌，改为抓一张（可跳过）。' });
      w.push({ kind: 'button', id: 'train:roll', width: 240, label: '抓牌', action: { action: 'trainingDrawRoll' } });
      w.push({ kind: 'button', id: 'train:skip', label: '跳过训练', width: 220, size: 'sub', action: { action: 'trainingSkip' } });
    } else {
      w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '训练部分：本房已完成' });
    }
    w.push({ kind: 'sub', align: 'center', tint: c.used ? '#6f7a92' : '#9aa3b8', text: '营地部分（本房一次）：' });
    if (c.used) w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '本房营地动作已用过' });
    else pushCampGroup(c);
    // 离房（强绑抓牌未领时不允许——completeRoom 也会拦，这里不给按钮以免误导）
    if (!t.forced) {
      w.push({ kind: 'button', id: 'room:leave', label: '离开', width: 240, size: 'sub', action: { action: 'leaveRoom' } });
    }
    return w;
  }

  if (snap.room === 'slot') {
    const s = snap.slot ?? {};
    const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
    w.push({
      kind: 'sub', align: 'center', tint: '#9aa3b8',
      text: `单抽 ${s.cost} 金 ｜ 持有 ${s.money}`
        + (s.freeRolls ? ` ｜ 免费 ${s.freeRolls} 次` : '')
        + ` ｜ 已抽 ${s.rolls ?? 0}`,
    });
    w.push({
      kind: 'sub', align: 'center', tint: '#77809a',
      text: `小奖 ${pct(s.minorChance)}（未中累加）｜ 大奖 ${pct(s.majorChance)}（未中累加）`,
    });

    // 产出：不能连抽，先处理这一件（文档：产出总是可以放弃不要的）
    const pd = s.pending;
    if (pd) {
      w.push({ kind: 'gap' });
      w.push({ kind: 'text', align: 'center', tint: pd.tier === 'major' ? '#ffd75e' : '#cdd6f4',
        text: (pd.tier === 'major' ? '★ 大奖：' : '') + slotPrizeText(pd) });
      if (pd.relicChoices?.length) {
        for (const r of pd.relicChoices) {
          w.push({
            kind: 'button', id: `slot:relic:${r.id}`, width: 320, size: 'sub',
            label: `${r.name}（${getRelicRarity(r.id)}）`,
            action: { action: 'slotTake', choice: r.id },
          });
        }
      } else if (pd.choices?.length) {
        // 卡多选一（3 或 6 张）：一整行卡面，点哪张领哪张
        w.push({
          kind: 'cards', idPrefix: 'slotPrize', cols: Math.min(6, pd.choices.length),
          scale: pd.choices.length > 3 ? 0.52 : 0.72,
          items: pd.choices.map(c => ({
            defId: c.defId, view: withLabels(c.view),
            action: { action: 'slotTake', choice: c.defId },
          })),
        });
      } else if (pd.upgrade?.kind === 'free') {
        w.push({
          kind: 'button', id: 'slot:pickUpgrade', width: 300, size: 'sub',
          label: '选择要免费升级的卡',
          action: { action: 'openUpgradePicker', source: 'slot', local: true },
        });
      }
      // 需要"选一个"的产出不给领取键（点候选即领取）；其余给 领取/放弃
      const needsPick = (pd.choices?.length ?? 0) > 0 || (pd.relicChoices?.length ?? 0) > 0;
      if (!needsPick) {
        w.push({
          kind: 'button', id: 'slot:take', width: 220, size: 'sub', label: '领取',
          action: { action: 'slotTake' },
        });
      }
      w.push({
        kind: 'button', id: 'slot:decline', width: 220, size: 'sub',
        label: needsPick ? '全部放弃' : '放弃',
        action: { action: 'slotDecline' },
      });
      return w;
    }

    if (s.needsCardPick) {
      w.push({ kind: 'gap' });
      w.push({ kind: 'text', align: 'center', tint: '#ffd75e', text: '免费指定升级：请选择一张卡' });
      w.push({
        kind: 'button', id: 'slot:pickUpgrade', width: 300, size: 'sub',
        label: '选择要免费升级的卡',
        action: { action: 'openUpgradePicker', source: 'slot', local: true },
      });
      return w;
    }

    if (s.spinning) {
      w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '🎰 …' });
    } else if (s.lastSpin) {
      w.push({ kind: 'text', align: 'center', tint: '#ffd75e', text: slotPrizeText(s.lastSpin) });
    }
    w.push({
      kind: 'button', id: 'slot:spin', width: 260, size: 'main',
      label: s.spinning ? '转动中…' : `拉杆！（${s.cost} 金）`,
      enabled: !!s.canSpin && !s.spinning,
      action: { action: 'spin' },
    });

    // 吞噬：累积满 7 次 roll 才可粉碎一件遗物/卡换金币
    const dv = s.devour ?? {};
    w.push({ kind: 'gap' });
    w.push({
      kind: 'sub', align: 'center', tint: dv.ready ? '#a8c6a0' : '#77809a',
      text: dv.ready
        ? '老虎机张开了嘴——可粉碎一件遗物或一张卡换取金币：'
        : `吞噬进度 ${dv.progress ?? 0}/${dv.every ?? 7}`,
    });
    if (s.devourables) {
      for (const r of s.devourables.relics) {
        w.push({
          kind: 'button', id: `slot:devour:relic:${r.id}`, width: 320, size: 'sub',
          label: `粉碎遗物：${r.name}（${r.rarity}）`,
          action: { action: 'slotDevourRelic', relicId: r.id },
        });
      }
      for (const c of s.devourables.cards) {
        w.push({
          kind: 'button', id: `slot:devour:card:${c.uniqueID}`, width: 320, size: 'sub',
          label: `粉碎卡牌：${c.name}（${c.tier}）`,
          action: { action: 'slotDevourCard', uniqueID: c.uniqueID },
        });
      }
    }
    // —— 银行机（与老虎机成对出现；SLOT_MACHINE.md §银行机）——
    const bk = snap.bank;
    if (bk) {
      w.push({ kind: 'gap' });
      w.push({ kind: 'sub', align: 'center', tint: '#9ccfff', text: '🏦 银行机' });
      w.push({
        kind: 'sub', align: 'center', tint: '#9aa3b8',
        text: `存款 ${bk.deposit} 金 ｜ 连击 ${bk.combo} ｜ 每层利率 每 ${bk.ratePer} 金产 ${bk.rateYield} 金`,
      });
      if (bk.deposit > 0) {
        w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: `再攒一层可多拿 +${bk.nextInterest} 金` });
      }
      if (bk.pendingDebuffs?.length) {
        w.push({
          kind: 'sub', align: 'center', tint: '#ff8a80',
          text: '身负恶魔词条：' + bk.pendingDebuffs.map(d => `${d.name}(剩${d.battlesLeft}场)`).join('、'),
        });
      }
      if (bk.pendingRoll) {
        w.push({
          kind: 'text', align: 'center', tint: '#ff8a80',
          text: `恶魔 roll（已入账 ${bk.pendingRoll.gold} 金）：必须选一个词条承受`,
        });
        for (const o of bk.pendingRoll.options) {
          w.push({
            kind: 'button', id: `bank:pick:${o.id}`, width: 440, size: 'sub',
            label: `${o.name}：${o.desc}`,
            action: { action: 'bankPick', id: o.id },
          });
        }
      } else {
        if (bk.money > 0) {
          w.push({
            kind: 'button', id: 'bank:deposit', width: 300, size: 'sub',
            label: `存入全部（${bk.money} 金）`,
            action: { action: 'bankDeposit' },
          });
        }
        if (bk.deposit > 0) {
          w.push({
            kind: 'button', id: 'bank:withdraw', width: 340, size: 'sub',
            label: `取款（${bk.deposit} 金，会打断连击）`,
            action: { action: 'bankWithdraw' },
          });
        }
        if (bk.canOverdraft) {
          w.push({ kind: 'sub', align: 'center', tint: '#ff8a80', text: '超额取款（立刻拿钱，代价是恶魔词条）：' });
          for (const t of bk.tiers) {
            w.push({
              kind: 'button', id: `bank:overdraft:${t.id}`, width: 240, size: 'sub',
              label: `${t.name} +${t.gold} 金`,
              action: { action: 'bankOverdraft', tier: t.id },
            });
          }
        } else if (bk.lockout > 0) {
          w.push({
            kind: 'sub', align: 'center', tint: '#77809a',
            text: `银行机暂时不让你超额取款（再过 ${bk.lockout} 次见面）`,
          });
        }
      }
      for (const offer of bk.offers ?? []) {
        w.push(offer === 'upgrade'
          ? {
            kind: 'button', id: 'bank:offerUpgrade', width: 320, size: 'sub',
            label: '立即免费升级一张卡',
            action: { action: 'openUpgradePicker', source: 'bankUpgrade', local: true },
          }
          : {
            kind: 'button', id: 'bank:offerBurn', width: 320, size: 'sub',
            label: '自选焚毁一张卡',
            action: { action: 'openUpgradePicker', source: 'bankBurn', local: true },
          });
      }
    }
    w.push({ kind: 'button', id: 'slot:leave', label: '离开', width: 220, size: 'sub', action: { action: 'leaveSlot' } });
    return w;
  }

  if (snap.room === 'gurpas') {
    const g = snap.gurpas ?? { items: [], sellable: [] };
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: `持有 ${g.money} 金币 ｜ 她只收 A/S 级遗物` });
    // 买到即开的卡包：优先占屏（三选一）
    if (g.pendingPackCards?.length) {
      w.push({ kind: 'sub', align: 'center', tint: '#ffd75e', text: `卡包 ${g.pendingPack.packId === 'gurpasA' ? '（全 A 级）' : '（全 B 级）'}：择一张加入牌组` });
      w.push({
        kind: 'cards', idPrefix: 'gurpasPack', cols: 3, scale: 0.8,
        items: g.pendingPackCards.map(c => ({
          defId: c.defId, view: withLabels(c.view),
          action: { action: 'gurpasTake', defId: c.defId },
        })),
      });
      return w;
    }
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '货架：' });
    g.items.forEach((it, i) => {
      const sold = it.sold ? '（已售出）' : '';
      const used = it.kind === 'remove' ? `（已用 ${it.used ?? 0}/${2}）` : '';
      w.push({
        kind: 'button', id: `gurpas:buy:${i}`, width: 460, size: 'sub',
        label: `${it.label} — ${it.price} 金${sold}${used}`,
        enabled: !it.sold && (it.kind !== 'remove' || (it.used ?? 0) < 2) && g.money >= it.price,
        action: { action: 'gurpasBuy', index: i },
      });
      if (it.sub) w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: `　${it.sub}` });
    });
    w.push({ kind: 'gap' });
    if (g.sellable?.length) {
      w.push({ kind: 'sub', align: 'center', tint: '#a8c6a0', text: '收购（A/S 级）：' });
      for (const s of g.sellable) {
        w.push({
          kind: 'button', id: `gurpas:sell:${s.relicId}`, width: 400, size: 'sub',
          label: `卖出 ${s.name}（${s.rarity}）→ +${s.price} 金`,
          action: { action: 'gurpasSell', relicId: s.relicId },
        });
      }
    } else {
      w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（你身上没有她收的 A/S 级遗物）' });
    }
    w.push({ kind: 'button', id: 'room:leave', label: '离开', width: 240, size: 'sub', action: { action: 'leaveRoom' } });
    return w;
  }

  if (snap.room === 'event') {
    const e = snap.event ?? {};
    if (!e.result) {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: ROOM_META.event.hint });
      w.push({ kind: 'button', id: 'event:explore', width: 240, label: '探索', action: { action: 'triggerEvent' } });
    } else {
      w.push({ kind: 'text', align: 'center', tint: '#ffd75e', text: eventText(e.result) });
      w.push({ kind: 'button', id: 'event:leave', label: '离开', width: 220, size: 'sub', action: { action: 'leaveEvent' } });
    }
    return w;
  }

  w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（此房间暂无面板）' });
  return w;
}

/** 售货机（模态）：货架列表 + 购买；卡包开出三选一时切换为选卡视图。 */
export function buildShopPanel(snap) {
  const shop = snap.shop ?? { items: [], pending: null };
  const w = [];

  // 卡包三选一（买到即开，金币已扣）：必须选一张才收尾
  if (shop.pending) {
    w.push({ kind: 'title', text: `卡包 · ${shop.pending.packId}`, align: 'center' });
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '包内三选一——择一张加入牌组：' });
    w.push({
      kind: 'cards', idPrefix: 'shopPack', cols: 3, scale: 0.8,
      items: shop.pending.cards.map(c => ({
        defId: c.defId, view: withLabels(c.view),
        action: { action: 'takeShopCard', defId: c.defId },
      })),
    });
    return w;
  }

  w.push({ kind: 'title', text: '自动售货机', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `持有 ${snap.money} 金币`
      + (shop.discount < 1 ? ` ｜ 瑞米给了折扣（${Math.round(shop.discount * 10)} 折）` : ''),
  });
  if (shop.broken) {
    w.push({
      kind: 'sub', align: 'center', tint: '#c9a86a',
      text: '瑞米：“上次逃得太狼狈了，嘿嘿……忘记补货了……”',
    });
  }
  for (const it of shop.items) {
    const tag = it.kind === 'relic' ? '[遗物]' : it.kind === 'pack' ? '[卡包]' : it.kind === 'apple' ? '[苹果]' : '[补给]';
    w.push({
      kind: 'text', align: 'center',
      tint: it.sold ? '#5d6584' : (it.affordable ? undefined : '#8a6a6a'),
      text: `${tag} ${it.label} ｜ ${it.price} 金` + (it.sold ? '（已售出）' : ''),
      // 遗物货 hover 出效果预览（买之前能看清是什么）
      ...(it.relicId ? { token: { type: 'relic', payload: { relicId: it.relicId } } } : {}),
    });
    if (!it.sold) {
      w.push({
        kind: 'button', id: `shop:buy:${it.index}`, width: 240, size: 'sub',
        label: it.affordable ? `购买（${it.price} 金）` : '金币不足',
        enabled: it.affordable,
        action: { action: 'buyShopItem', index: it.index },
      });
    }
  }
  w.push({ kind: 'gap' });
  w.push({
    kind: 'button', id: 'shop:leave', width: 220, size: 'sub', label: '离开售货机',
    action: { action: 'closeShop', local: true },
  });
  return w;
}

/** 老虎机产出的可读文本（表现层翻译；引擎只给载荷）。 */
export function slotPrizeText(p) {
  if (!p) return '';
  if (p.kind === 'nothing') return '什么也没发生……';
  if (p.money != null) return `金币 +${p.money}`;
  if (p.healPct != null) return `恢复 ${Math.round(p.healPct * 100)}% 生命`;
  if (p.fullRestore) return '全状态恢复（生命与魏启回满，负面效果清除）';
  if (p.special === 'apple') return '瑞米最爱的苹果（喂给瑞米）';
  if (p.special === 'goldApple') return '金苹果（喂给瑞米）';
  if (p.special === 'fruit') return '特殊物品：瑞米升级果';
  if (p.special === 'training') return '特殊物品：训练次数 +1';
  if (p.upgradeCopyId) return `获得「升级后的复制品」：${defName(p.upgradeCopyId)}`;
  if (p.upgrade?.kind === 'random') return `随机升级 ${p.upgrade.count} 张可升级卡`;
  if (p.upgrade?.kind === 'free') return '免费指定升级一张卡';
  if (p.relicChoices?.length) return '三选一 A 级遗物——择一件：';
  if (p.relicId) return `获得遗物：${relicName(p.relicId)}`;
  if (p.choices?.length) return `择一张卡加入牌组（共 ${p.choices.length} 张）：`;
  return p.kind ?? '';
}

const defName = (id) => getSkillDefinition(id)?.name ?? id;
const relicName = (id) => getRelicDefinition(id)?.name ?? id;
const getRelicRarity = (id) => getRelicDefinition(id)?.rarity ?? 'C';

/** 升级目标名（选卡界面/升级行用）。 */
function getSkillDefinitionSafe(id) { return getSkillDefinition(id); }
