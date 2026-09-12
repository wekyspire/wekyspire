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
// 导出：进阶幕间（runController.playAscensionScene）的对话选项也用这份文案，两处不漂移。
export const DIM_META = {
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
      kind: 'text', text: `[${tag}] ${r.name}${suffix}`, tint: r.equipped ? '#cfe0f5' : undefined,
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
  shop: { name: '商店房', glyph: '🧃', hint: '售货机——点击货架上的商品直接购买' },
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
/**
 * 「升级一张卡」入口（训练场/营地共用）：按一下进入**全屏选卡界面**
 * （本动作由舞台本地消化——界面里的卡来自快照的 upgradeCards；确认时才把选中的卡上报 core）。
 */
const upgradeButton = (source) => ({
  kind: 'button', id: `${source}:upgrade`, width: 300, size: 'main',
  label: '升级一张卡', action: { action: 'openUpgradePicker', source, local: true },
});
/** 营地动作瓦片（休整/找回瑞米 + 免费升级入口）：占位面板与场景式面板共用（模块作用域）。 */
const pushCampGroup = (w, c = { options: [] }) => {
  const tiles = [];
  if (c.options.includes('recoverRemi')) {
    tiles.push({ id: 'recoverRemi', name: '🐾 找回瑞米', desc: '瑞米回到身边', action: { action: 'campChoose', option: 'recoverRemi' } });
  }
  if (c.options.includes('rest')) {
    // ⚠ 瓦片副标题是**单行不换行**（bakeButtonFace 的 sublabel，画在瓦片画布上）：
    // 超出瓦片宽度会被**画布裁掉**（症状：两头的字没了只剩中间）。故 desc 压到 ~6 个汉字，
    // 完整口径放到下面的说明行（sub 行会换行/缩放，放得下）
    tiles.push({ id: 'rest', name: '🔥 休整', desc: '回血 35%', action: { action: 'campChoose', option: 'rest' } });
  }
  if (tiles.length) w.push({ kind: 'tiles', idPrefix: 'camp', tileHeight: 96, gapY: 14, items: tiles });
  if (c.options.includes('rest')) {
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '休整 = 回复 35% 最大生命，并把魏启全部回满' });
  }
  if (c.options.includes('upgrade')) {
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '或免费升级一张卡：' });
    w.push(upgradeButton('camp'));
  }
};

/** 奖励房（模态）：训练场 / 营地 / 老虎机 / 事件房。 */
export function buildRoomPanel(snap) {
  const w = [];
  roomHeader(w, snap);

  if (snap.room === 'training') {
    const t = snap.training ?? {};
    // 候选抉择中（升级后的强制尾款 / 退化模式已开局）：**都不给跳过**（用户定 2026-09-12：
    // 训练本身可以不做的——直接离开房间即可，面板里再放"跳过"是重复出口）
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
      return w;
    }
    if (t.mode === 'upgrade') {
      w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '免费升级一张卡（完成后须再择一张加入牌组）：' });
      w.push(upgradeButton('training'));
      w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（不想训练就直接离开房间）' });
      return w;
    }
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '暂无可升级的卡牌，本次改为抓一张。' });
    w.push({ kind: 'button', id: 'train:roll', width: 240, label: '抓牌', action: { action: 'trainingDrawRoll' } });
    return w;
  }

  // 营地组（单房 'camp' 与合并房 'campTraining' 共用同一份）
  if (snap.room === 'camp') {
    pushCampGroup(w, snap.camp);
    return w;
  }

  // 合并房（营地 · 训练场）：两个部分各一次；训练抉择中优先占屏，营地组在下方仍然可用
  // 合并房（营地 · 训练场）：两个部分各一次；训练抉择中优先占屏，营地组在下方仍然可用
  if (snap.room === 'campTraining') {
    trainingWidgets(w, snap);
    campWidgets(w, snap);
    // 离房（强绑抓牌未领时不允许——completeRoom 也会拦，这里不给按钮以免误导）
    if (!(snap.training ?? {}).forced) {
      w.push({ kind: 'button', id: 'room:leave', label: '离开', width: 240, size: 'sub', action: { action: 'leaveRoom' } });
    }
    return w;
  }

  if (snap.room === 'slot') {
    roomHeader(w, snap);
    slotWidgets(w, snap);
    bankWidgets(w, snap);
    w.push({ kind: 'button', id: 'slot:leave', label: '离开', width: 220, size: 'sub', action: { action: 'leaveSlot' } });
    return w;
  }

  if (snap.room === 'gurpas') {
    const g = snap.gurpas ?? { items: [], sellable: [] };
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: `持有 ${g.money} 金币 ｜ 她只收 A/S 级遗物` });
    // 买到即开的卡包：优先占屏（三选一）
    if (g.pendingPackCards?.length) {
      w.push({ kind: 'sub', align: 'center', tint: '#cfe0f5', text: `卡包 ${g.pendingPack.packId === 'gurpasA' ? '（全 A 级）' : '（全 B 级）'}：择一张加入牌组` });
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
    // 随机事件已改成**幕间播片**（cutscene 的 CG + 对话 + 选项，用户定 2026-09-12）：
    // 事件房没有场景舞台、也不再走面板交互——进房即自动播（runController.playEventScene）。
    // 这里只留一句话与一个**安全阀**入口（万一没自动播起来，玩家还能手动触发，不会被卡住）。
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: ROOM_META.event.hint });
    w.push({
      kind: 'button', id: 'event:play', width: 260, size: 'sub',
      label: '看看发生了什么', action: { action: 'triggerEvent' },
    });
    return w;
  }

  if (snap.room === 'shop') {
    // 商店房：**一整间货房**（用户定 2026-09-12）。场景版（RoomStage）点售货机开货架面板；
    // 这里是无场景的占位路径（headless/降级）——同一份货架内容，末尾给"离开房间"。
    return buildShopPanel(snap, { standalone: true });
  }

  w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（此房间暂无面板）' });
  return w;
}

/**
 * 房间表头：标题 + 售货机入口（售货机与房间并存、不占房间名额，入口是**本地**动作）。
 * 场景式休息房把机器面板拆开单开（点哪台开哪台），所以表头要能被两个面板各自复用。
 */
function roomHeader(w, snap, title = null) {
  const meta = ROOM_META[snap.room] ?? { name: snap.room, glyph: '？', hint: '' };
  w.push({ kind: 'title', text: title ?? `${meta.glyph} ${meta.name}`, align: 'center' });
  if (snap.shop) {
    w.push({
      kind: 'button', id: 'room:shop', width: 300, size: 'sub',
      label: `售货机（持有 ${snap.money} 金币）`,
      action: { action: 'openShop', local: true },
    });
  }
}

/** 老虎机本体的 widget（无表头、无离开——场景式房间点机器单开，占位房间由 buildRoomPanel 组装）。 */
function slotWidgets(w, snap, { sceneChoice = false } = {}) {
    // 恶魔 roll 进行中：机器已切恶魔形态、拉杆锁定（core 同款守卫）——面板只讲这一件事
    if (snap.bank?.pendingRoll) { demonRollWidgets(w, snap.bank.pendingRoll, sceneChoice); return; }
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
      w.push({ kind: 'text', align: 'center', tint: pd.tier === 'major' ? '#e8eefb' : '#c3cee0',
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
      // 需要"选一个"的产出不给领取键（点候选即领取）；**其余产出也不给"领取"键**——
      // 中奖即自动唤起获得演出（用户定 2026-09-12：领取必须是获得演出，不是操纵条里一个
      // 干巴巴的按钮）。这里只留「放弃」兜底（演出被跳过/已关闭时仍能处理掉这份产出）。
      w.push({
        kind: 'button', id: 'slot:decline', width: 220, size: 'sub',
        label: (pd.choices?.length ?? 0) > 0 || (pd.relicChoices?.length ?? 0) > 0 ? '全部放弃' : '放弃',
        action: { action: 'slotDecline' },
      });
      return w;
    }

    if (s.needsCardPick) {
      w.push({ kind: 'gap' });
      w.push({ kind: 'text', align: 'center', tint: '#e8eefb', text: '免费指定升级：请选择一张卡' });
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
      w.push({ kind: 'text', align: 'center', tint: '#e8eefb', text: slotPrizeText(s.lastSpin) });
    }
    w.push({
      kind: 'button', id: 'slot:spin', width: 260, size: 'main',
      label: s.spinning ? '转动中…' : `拉杆！（${s.cost} 金）`,
      enabled: !!s.canSpin && !s.spinning,
      action: { action: 'spin' },
    });

    // 吞噬：累积满 7 次 roll 才可粉碎一件遗物/卡换金币。
    // **入口是一个按钮**（不再把候选平铺成按钮墙）：点它 → dialogue 层问「粉碎什么？」
    // → 全屏选卡/选遗物界面。编排在 runController（Stage 只上报"入口被点了"）。
    const dv = s.devour ?? {};
    w.push({ kind: 'gap' });
    w.push({
      kind: 'sub', align: 'center', tint: dv.ready ? '#a8c6a0' : '#77809a',
      text: dv.ready
        ? '老虎机张开了嘴——可以粉碎一件遗物或一张卡换金币：'
        : `吞噬进度 ${dv.progress ?? 0}/${dv.every ?? 7}（每拉一次杆累积 1）`,
    });
    if (dv.ready) {
      w.push({
        kind: 'button', id: 'slot:crush', width: 340, size: 'sub',
        label: '粉碎物品…', action: { action: 'requestDevour' },
      });
    }
    // 离房安慰奖（拉了 ≥2 次杆一次没中）**完全不进 UI**（用户定 2026-09-13）：它既不是进度
    // 也不是可领取项——玩家点「继续前进」离房时，机器自己凑上来吐可乐/鸡腿让你二选一
    // （场景演出见 RoomStage._playGift），领完自动续上离房切幕。面板里既不提示也不给按钮，
    // 免得把"离房"这件事拆成"先在面板里领东西、再点一次继续"两步。
}

/**
 * 恶魔 roll 进行中（机器已切恶魔形态）：**词条在场景里选**（老虎机上那三张卡片），
 * 面板只给状态与三条效果文本（对着卡片读）。
 * @param sceneChoice true = 场景里选（不给按钮，只有可读行）；false = 无场景的占位路径（给按钮）
 */
function demonRollWidgets(w, pr, sceneChoice) {
  w.push({ kind: 'gap' });
  w.push({ kind: 'title', text: '😈 恶魔 roll', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#cfe0f5',
    text: `超额取款已入账 ${pr.gold} 金——`
      + (sceneChoice ? '在轮盘上选一个词条承受（悬停看效果）' : '选一个词条承受：'),
  });
  // 场景路径**不再列词条**（用户定 2026-09-13）：那三个词条就是转盘停下来的三面，悬停转轮
  // 出 tooltip，操纵条里再抄一遍纯属重复。无场景的占位路径（gallery/headless 降级）没有转盘
  // 可点，才需要这里的按钮兜底，否则那条路会卡死。
  if (sceneChoice) return true;
  for (const o of pr.options) {
    w.push({
      kind: 'button', id: `bank:pick:${o.id}`, width: 440, size: 'sub',
      label: `${o.name}：${o.desc}`,
      action: { action: 'bankPick', id: o.id },
    });
  }
  return true;
}

/** 银行机的 widget（同上）。 */
function bankWidgets(w, snap, { sceneChoice = false } = {}) {
  const bk = snap.bank;
  if (!bk) return;
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
      demonRollWidgets(w, bk.pendingRoll, sceneChoice);
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

/** **老虎机面板**（场景式休息房：点机身 → 开这一份）。 */
export function buildSlotPanel(snap, opts = {}) {
  const w = [];
  roomHeader(w, snap, '🎰 老虎机');
  slotWidgets(w, snap, opts);
  return w;
}

/** **银行机面板**（场景式休息房：点银行机 → 开这一份）。 */
export function buildBankPanel(snap, opts = {}) {
  const w = [];
  roomHeader(w, snap, '🏦 银行机');
  bankWidgets(w, snap, opts);
  return w;
}

/**
 * 训练部分（营地·训练场合并房的训练半场）：免费升级 → 强绑择一张加入牌组 / 退化抓牌 / 跳过。
 * 占位房间与**场景式房间**（RoomStage 点训练桩开的那份）共用同一份。
 */
function trainingWidgets(w, snap) {
  const t = snap.training ?? {};
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
  } else if (!t.done && t.mode === 'upgrade') {
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：免费升级一张卡（完成后须再择一张加入牌组）：' });
    w.push(upgradeButton('training'));
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（不想训练就直接点「继续前进」离开）' });
  } else if (!t.done) {
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '训练：暂无可升级的卡牌，改为抓一张。' });
    w.push({ kind: 'button', id: 'train:roll', width: 240, label: '抓牌', action: { action: 'trainingDrawRoll' } });
    w.push({ kind: 'sub', align: 'center', tint: '#77809a', text: '（不想训练就直接点「继续前进」离开）' });
  } else {
    w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '训练部分：本房已完成' });
  }
}

/** 营地部分（休整 / 找回瑞米 / 免费升级一张）：占位房间与场景式房间共用。 */
function campWidgets(w, snap) {
  const c = snap.camp ?? { options: [] };
    w.push({ kind: 'sub', align: 'center', tint: c.used ? '#6f7a92' : '#9aa3b8', text: '营地部分（本房一次）：' });
    if (c.used) w.push({ kind: 'sub', align: 'center', tint: '#6f7a92', text: '本房营地动作已用过' });
    else pushCampGroup(w, c);
}

/** **营地部分面板**（单房 'camp' 占位路径：只有营地组）。 */
export function buildCampPanel(snap) {
  const w = [];
  roomHeader(w, snap, '🔥 营地');
  campWidgets(w, snap);
  return w;
}

/**
 * **场景式房间：点篝火开的面板**（用户定 2026-09-12）——只有营地部分。
 * 与训练桩的面板（buildTrainingPartPanel）**必须区分开**：两件交互物各管半边，
 * 点哪件处理哪半边（早期两件都开合并面板 = 交互物形同虚设，用户报"点了没区别"）。
 */
export function buildCampPartPanel(snap) {
  const w = [];
  campWidgets(w, snap);
  return w;
}

/** **场景式房间：点训练桩开的面板**——只有训练部分。 */
export function buildTrainingPartPanel(snap) {
  const w = [];
  trainingWidgets(w, snap);
  return w;
}

/** **训练部分面板**（单房 'training' 占位路径：只有训练组）。 */
export function buildTrainingPanel(snap) {
  const w = [];
  roomHeader(w, snap, '⚔ 训练场');
  trainingWidgets(w, snap);
  return w;
}

/**
 * **营地 · 训练场合并房面板**（用户定 2026-09-12）。
 *
 * 场景式房间里**点篝火（或训练桩）开这一份**：营地选项与训练选项一起给——两个部分同处一室，
 * 玩家点任何一个交互物都该看到全部可做的事，不用来回点两件东西。
 * 例外：训练的三选一还挂着时（升级后的强绑尾款）**只显示训练部分**——那是必须做完的抉择，
 * 把营地组也铺上去会把下沿停靠面板顶到屏幕上缘、盖住房间。
 */
export function buildCampTrainingPanel(snap) {
  const w = [];
  const t = snap.training ?? {};
  roomHeader(w, snap, '🔥 营地 · ⚔ 训练场');
  if (t.choices?.length && t.forced) { trainingWidgets(w, snap); return w; }
  campWidgets(w, snap);
  w.push({ kind: 'gap' });
  w.push({ kind: 'sub', align: 'center', tint: t.done ? '#6f7a92' : '#9aa3b8', text: '⚔ 训练部分（本房一次）：' });
  trainingWidgets(w, snap);
  return w;
}

/**
 * 售货机操纵面板（场景式商店房里点售货机 → 下沿停靠）。
 * @param snap 房间快照
 * @param opts.standalone 无场景的占位路径（房间面板就是这一份）：末尾给"离开房间"而不是"离开售货机"
 * @param opts.buttons    带购买按钮（缺省 = standalone）。场景版不带：3D 货架就在眼前，
 *                        再排一列按钮只会把面板顶高、把货架挤到操纵条下面
 */
export function buildShopPanel(snap, { standalone = false, buttons = standalone } = {}) {
  const shop = snap.shop ?? { items: [], pending: null };
  const w = [];

  // 卡包三选一（买到即开，金币已扣）：**走全屏选卡 overlay**（用户定 2026-09-12：
  // "不要塞在操纵条里"），操纵条只留一个兜底入口（overlay 已自动打开，这里是安全阀）。
  // 三选一**可放弃**：overlay 的「返回」= 放弃这个卡包（钱已花，选择权在你）。
  if (shop.pending) {
    w.push({ kind: 'title', text: `卡包 · ${shop.pending.packId}`, align: 'center' });
    w.push({ kind: 'sub', align: 'center', tint: '#9aa3b8', text: '包内三选一——择一张加入牌组（不想要就放弃）' });
    w.push({
      kind: 'button', id: 'shop:openPack', width: 300, size: 'main',
      label: '打开卡包选择', action: { action: 'openShopPack', local: true },
    });
    return w;
  }

  w.push({ kind: 'title', text: '售货机', align: 'center' });
  w.push({
    kind: 'sub', align: 'center', tint: '#9aa3b8',
    text: `持有 ${snap.money} 金币`
      + (shop.discount < 1 ? ` ｜ 瑞米给了折扣（${Math.round(shop.discount * 10)} 折）` : ''),
  });
  // 购买有两条路：**直接点货架上的商品**（场景里的 billboard，买不起价格标红）或这里的按钮。
  // 场景版（dock 停靠面板）**不再放按钮**：货架就在眼前的 3D 里，重复一排按钮只会把面板顶高、
  // 把货架挤到操纵条下面去；占位版（standalone）没有 3D 货架，才需要按钮。
  w.push({
    kind: 'sub', align: 'center', tint: '#77809a',
    text: buttons ? '选择要买的商品：' : '点击货架上的商品直接购买（买不起的价格标红）｜点面板外可拉远',
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
    if (!it.sold && buttons) {
      w.push({
        kind: 'button', id: `shop:buy:${it.index}`, width: 240, size: 'sub',
        label: it.affordable ? `购买（${it.price} 金）` : '金币不足',
        enabled: it.affordable,
        action: { action: 'buyShopItem', index: it.index },
      });
    }
  }
  w.push({ kind: 'gap' });
  if (standalone) {
    w.push({ kind: 'button', id: 'shop:leaveRoom', width: 220, size: 'sub', label: '离开', action: { action: 'leaveRoom' } });
  }
  // 场景版（dock 操纵条）：**不给「离开售货机/返回房间」按钮**——点面板外的房间空白处
  // 即拉远回全景（与所有机器面板同一套退出口，用户定 2026-09-12）
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

/**
 * 快照 kind → widget builder + PanelObject 形态（**所有舞台共用一份**：
 * 塔楼层 MapStage、战斗层 BattleStage（战后奖励）、房间层 RoomStage 的 dock 面板各取所需）。
 * 未登记 kind = 该阶段没有 Three 面板（目前 stage='end' 由 Vue 的 EndPanel 接管）。
 */
export const PANEL_BUILDERS = Object.freeze({
  prep: { build: buildPrepPanel, form: 'anchored' },
  reward: { build: buildRewardPanel, form: 'modal' },
  ascension: { build: buildAscensionPanel, form: 'modal' },
  room: { build: buildRoomPanel, form: 'modal' },
  // 售货机在塔楼层的占位视图（场景式商店房走 RoomStage 的 dock 面板）：这里没有 3D 货架，
  // 所以要带购买按钮（`buttons: true`），否则降级路径上买不了东西
  shop: { build: (snap) => buildShopPanel(snap, { buttons: true }), form: 'modal' },
});
