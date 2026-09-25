// StagePickerKit：三个舞台（MapStage / RoomStage / BattleStage）共用的
// **全屏选卡 / 选遗物界面 + 获得物特写**套件。
//
// 背景（本文件要根除的病灶）：这三件套原先在三个舞台里各抄了一份 ~200 行，且已经开始分叉——
//   · 同一句提示在塔楼层与房间层写法不同（`滚轮翻页` vs `滚轮翻页（只列出当前可升级的卡）`）；
//   · 删卡的文案有「删除」与「移除」两套说法（玩家可见的不一致）；
//   · BattleStage 那份构造 CardScrollPickerObject 时**漏传 bakeFace/bakeText**
//     （症状 = 候选卡面/标题文字缺失），且只有它的「返回」不接 onCancel；
//   · 三处 `_ensureCardPicker/_pickerBakeText/_ensureRelicPicker` 同名不同实现。
// 抽 kit 后：界面骨架归 objects/（已有），**来源表/意图表/文案归这里**，舞台只保留
// 「薄转发 + 各自舞台特定的指针尾部逻辑」。
//
// 数据边界不变（THREE_UI_MIGRATION 铁律）：kit 不读 run 状态——候选一律来自宿主给的快照段
// （`openUpgradePicker(source, snap)`），确认只上行一个意图（`onIntent`），
// 开关界面本身是舞台本地交互态。
//
// 依赖注入（deps）：
//   · uiScene     THREE.Scene（UI pass；惰性创建的界面挂这里）
//   · getPicker   () => Picker|null（拾取器在 attachInput 里才注入，故每次要用时现取）
//   · bakeFace    卡面烘焙（与战场同源；**函数值**，原样透传，别当 getter 调）
//   · bus         事件总线（tooltip 出口）。可以是总线本身，也可以是 `() => bus`
//                 ——MapStage/RoomStage 的总线在 attachInput 里才拿到，必须传后者，
//                 否则惰性创建的界面永远收不到 tooltip。
//   · onIntent    (action) => void：确认/放弃时的上行出口（宿主自己转发给 runController）
//   · getSequencer () => AnimationSequencer|null（「择卡得卡」演出的指令化挂点，见
//                 cardGrantFlight.js；惰性取——runSequencer 由宿主后置注入）
//   · getAnchor   () => ({x,y,z}) 得卡演出的收编锚点（塔楼/房间 = 玩家状态栏）
//
// 用法：`const kit = createStagePickerKit({...})`，宿主保留对外方法作薄转发（见三舞台）。

import { CardScrollPickerObject } from './objects/CardScrollPickerObject.js';
import { RelicScrollPickerObject } from './objects/RelicScrollPickerObject.js';
import { ItemShowcaseObject } from './objects/ItemShowcaseObject.js';
import { CardObject } from './objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './objects/cardMetrics.js';
import { renderRichTextBlock } from './richtext/texture.js';
import { playCardGrantFlight } from './cardGrantFlight.js';
import { playCardUpgradeFlight } from './cardUpgradeFlight.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { withLabels } from './panels/shared.js';

// ---- 「升级 / 焚毁 / 删除」类选卡入口的统一来源表 ----
// 每项 = 从快照取候选段 + 确认后上行的意图 + 三行文案（标题/提示/确认键）。
// 本次合并取**并集**（塔楼层多出 gurpasRemove/bossRemove，房间层多出 slot），
// 文案漂移一律以玩家可见的一致性为准（删卡统一「删除」，不再有「移除」）。
const UPGRADE_SOURCES = {
  // upgrade: true = 晋升类入口：确认时先播「卡牌升级」变身演出（原卡金闪变新卡后飞入
  // 牌库），演完才上行意图（confirmHook 接管，见 openUpgradePicker）。焚毁/删除类不标。
  // （camp 源 2026-09-21 随 D4「营地不再能升级卡」移除——升级全部走训练房尾款。）
  training: {
    upgrade: true,
    cards: (s) => s?.training?.upgradeCards,
    intent: (uniqueID, targetId = null) => ({ action: 'trainingUpgrade', uniqueID, targetId }),
    title: '选择要升级的卡', confirmLabel: '确认升级',
    hint: '悬停查看升级后的卡面 ｜ 滚轮翻页（只列出当前可升级的卡）',
  },
  bankUpgrade: {
    upgrade: true,
    cards: (s) => s?.bank?.upgradeCards,
    intent: (uniqueID, targetId = null) => ({ action: 'bankUpgradeOffer', uniqueID, targetId }),
    title: '选择要升级的卡', confirmLabel: '确认升级',
    hint: '悬停查看升级后的卡面 ｜ 滚轮翻页（只列出当前可升级的卡）',
  },
  bankBurn: {
    cards: (s) => s?.bank?.burnCards,   // 焚毁候选（含 S 级豁免过滤）
    intent: (uniqueID) => ({ action: 'bankBurnOffer', uniqueID }),
    title: '选择要焚毁的卡', confirmLabel: '确认焚毁',
    hint: '恶魔词条·忘却：焚毁一张（S 级豁免）｜ 滚轮翻页',
  },
  slot: {
    upgrade: true,
    cards: (s) => s?.slot?.upgradeCards,
    intent: (uniqueID, targetId = null) => ({ action: 'slotPickUpgrade', uniqueID, targetId }),
    title: '选择要升级的卡', confirmLabel: '确认升级',
    hint: '悬停查看升级后的卡面 ｜ 滚轮翻页（只列出当前可升级的卡）',
  },
  gurpasRemove: {
    cards: (s) => s?.gurpas?.removeCards,   // 删卡服务：整副牌组（不限等阶）
    intent: (uniqueID) => ({ action: 'gurpasRemove', uniqueID }),
    title: '选择要删除的卡', confirmLabel: '确认删除',
    hint: '这张牌将从牌库中彻底消失 ｜ 滚轮翻页',
  },
  bossRemove: {
    cards: (s) => s?.cardRemoval?.removeCards,   // Boss 奖励删卡机会
    intent: (uniqueID) => ({ action: 'bossRemoveCard', uniqueID }),
    title: '选择要删除的卡', confirmLabel: '确认删除',
    hint: '这张牌将从牌库中彻底消失 ｜ 滚轮翻页',
  },
  ascensionRemove: {
    // 跳过进阶的删卡反哺（用户定 2026-09-13）：与 Boss 奖励同一计数器/同一结算，
    // 仅文案不同——title 用户钦定「删一张卡」；「返回」只收起界面（不删也行）。
    cards: (s) => s?.cardRemoval?.removeCards,
    intent: (uniqueID) => ({ action: 'bossRemoveCard', uniqueID }),
    title: '删一张卡', confirmLabel: '确认删除',
    hint: '体修精进的赠礼：这张牌将从牌库中彻底消失（也可以不删）｜ 滚轮翻页',
  },
};

// 选卡快照段 → 界面的候选条目形状（保持各入口原有的字段口径）
// tipDefIds/toViews 是升级分叉的全目标段（hover 多卡预览 + 分叉子面板候选）
const toCardEntry = (c) => ({
  uniqueID: c.uniqueID, defId: c.defId, view: c.view,
  enabled: c.enabled, tipDefId: c.tipDefId, tipDefIds: c.toDefIds,
});

export function createStagePickerKit({
  uiScene = null, getPicker = null, bakeFace = null, bus = null, onIntent = null,
  getSequencer = null, getAnchor = null,
} = {}) {
  // ---- 惰性实例 ----
  let cardPicker = null;   // 全屏选卡（升级/删除/焚毁/粉碎/卡包三选一共用）
  let relicPicker = null;  // 全屏选遗物（老虎机粉碎遗物入口）
  let showcase = null;     // 获得物特写（遗物/药水/奖励到手时播一次）
  let pickerRef = null;    // 最近一次 attachPicker 注入的拾取器（惰性创建时优先用它）
  let bakeCache;           // 本地文本烘焙缓存（undefined = 还没算过；null = node 无 document）
  // 当前界面的「确认 / 取消」出口（按入口切换：同一份界面服务多个入口）
  let confirmFn = null;
  let cancelFn = null;
  // 「择卡得卡」演出进行中（商店卡包）：routeClick/routeHover 据此吞掉一切指针
  // （演出期间选卡界面已关、意图尚未上行，放任点击会绕过确认流直接戳到下面的面板）
  let grantBusy = false;
  // 「卡牌升级」变身演出进行中（升级选卡确认 / 事件升级排水）：同上吞指针
  let upgradeBusy = false;

  const pickerNow = () => pickerRef ?? (typeof getPicker === 'function' ? getPicker() : null);
  const busNow = () => {
    const b = typeof bus === 'function' ? bus() : bus;   // bus 是对象，函数形式的只可能是 getter
    return b ?? null;
  };
  const scene = () => uiScene;

  /**
   * 选择界面（选卡/选遗物）用的文本烘焙：**honors fontPx / tint / maxWidth**。
   * ⚠ 不能拿舞台状态栏那套 `_bakeLabel`：那是牌桌时代给塔楼常驻控件用的壳，把 style/maxWidth
   * 写死，传进去的字号与颜色会被丢掉——症状是提示被按错宽度折成三行、稀有度色不生效。
   * node（无 document）退化为 null（TextBlockObject 自带占位烘焙）。
   */
  function bakeText() {
    if (bakeCache !== undefined) return bakeCache;
    bakeCache = (typeof document === 'undefined')
      ? null
      : (text, { fontPx = 16, tint = '#cdd6f4', maxWidth } = {}) => renderRichTextBlock(text, {
        maxWidth: maxWidth ?? 4000,
        scale: 3,
        style: { fontSize: fontPx, lineHeight: Math.round(fontPx * 1.3), color: tint },
      });
    return bakeCache;
  }

  /** 惰性建选卡界面（**bakeFace + bakeText + bus 三样齐全**——BattleStage 那份曾漏前两样）。 */
  function ensureCardPicker() {
    if (cardPicker) return cardPicker;
    cardPicker = new CardScrollPickerObject({
      bakeFace,
      bakeText: bakeText(),
      bus: busNow(),
      onCancel: () => { cancelFn?.(); },
      onConfirm: (ids) => { confirmFn?.(ids); },
    });
    scene()?.add(cardPicker);
    cardPicker.attachPicker(pickerNow());
    return cardPicker;
  }

  /** 惰性建选遗物界面（按钮走 ButtonObject 自带 bakeButtonFace，别喂文本烘焙）。 */
  function ensureRelicPicker() {
    if (relicPicker) return relicPicker;
    relicPicker = new RelicScrollPickerObject({
      bakeText: bakeText(),
      bus: busNow(),
      onCancel: () => { cancelFn?.(); },
      onConfirm: (ids) => { confirmFn?.(ids); },
    });
    scene()?.add(relicPicker);
    relicPicker.attachPicker(pickerNow());
    return relicPicker;
  }

  /**
   * 卡牌升级演出（通用入口，cardUpgradeFlight.js 的宿主侧包装）：原卡金闪变身新卡，
   * 然后飞入牌库锚点（getAnchor；锚点缺席 = 原地缩小淡出）。所有「局外晋升」的地方
   * 都调这里——升级选卡确认（openUpgradePicker 的 confirmHook）、事件升级（run 级
   * 声明排水）共用同一份表演。
   * @param {object} payload
   *   card: 现成的原卡 CardObject（选卡界面 takeEntry 摘下的那张；演完由演出接管销毁）。
   *         缺省时按 fromDefId/fromView 在亮相位新建一张
   *   fromDefId / fromView: 新建时的原卡面（card 缺席时二选一必给）
   *   toDefId / toView: 升级后的卡面（setCard 换面目标，二选一必给）
   *   at: 新建卡的亮相位（缺省屏幕中央 = uiScene 原点）
   *   onDone: 演出结束回调，**恰好一次**（受理失败也同步调——上行意图绝不被吞）
   * @returns 是否受理
   */
  function playCardUpgrade({ card = null, fromDefId = null, fromView = null, toDefId = null, toView = null, at = null, onDone = null } = {}) {
    let obj = card;
    // defId → 卡面投影（应用前口径；调用方给了现成 view 就不投影——快照 view 与界面同源）
    const viewOfDef = (id) => {
      try {
        const def = getSkillDefinition(id);
        return def ? withLabels(cardViewFromDef(def)) : null;
      } catch { return null; }   // 未注册等异常：退回字符串（bakeFace 占位），不拦确认流
    };
    if (!obj) {
      const fromData = fromView ?? viewOfDef(fromDefId) ?? fromDefId;
      if (!bakeFace || !fromData) { onDone?.(); return false; }
      obj = new CardObject({
        uniqueID: 'upgrade:flight',   // 演出卡不进拾取，id 只为日志区分
        cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace,
      });
      obj.setCard(fromData);
      obj.position.set(at?.x ?? 0, at?.y ?? 0, at?.z ?? 0);
      obj.scale.set(0.95, 0.95, 1);   // 亮相缩放（已在亮相位，gather 拍自动跳过）
    }
    scene()?.add(obj);   // takeEntry 摘出的卡已不在场景；新建的同样要挂
    const toCard = toView ?? viewOfDef(toDefId) ?? toDefId;
    upgradeBusy = true;
    return playCardUpgradeFlight({
      card: obj,
      toCard,
      target: typeof getAnchor === 'function' ? getAnchor() : null,
      center: at ?? null,
      sequencer: typeof getSequencer === 'function' ? getSequencer() : null,
      onDone: () => { upgradeBusy = false; onDone?.(); },
    });
  }

  return {
    bakeText,

    // ---- 惰性实例（未创建时 null；宿主/测试据此读界面内部态）----
    get cardPicker() { return cardPicker; },
    get relicPicker() { return relicPicker; },
    /** 特写是否在播（宿主据此吞掉面板输入 / 压暗常驻按钮）。 */
    get showcasing() { return !!showcase?.busy; },
    /** 卡牌升级变身演出是否在播（宿主据此压暗常驻按钮）。 */
    get upgrading() { return upgradeBusy; },
    /**
     * 卡图异步到图后重烘选卡界面（宿主在 cardArt.addOnLoad 里调；合批由宿主负责）。
     * 候选卡不在卡组、未经战斗预热，首拍多为无图占位——不补烘就永远空白
     * （用户 2026-09-25 报"三选一/训练场/选卡界面空白卡，手牌却有图"）。
     */
    rebakeCards() { cardPicker?.rebakeCards?.(); },
    /** 是否有套件级模态覆盖层在屏幕上（特写/升级演出在播或某个全屏界面开着）——宿主据此压暗常驻按钮。 */
    get uiBusy() { return grantBusy || upgradeBusy || !!showcase?.busy || !!cardPicker?.opened || !!relicPicker?.opened; },

    /** 卡牌升级演出（通用入口）：薄暴露内部 playCardUpgrade（见其注释）。 */
    playCardUpgrade(payload) { return playCardUpgrade(payload); },

    /**
     * 打开「选卡」界面；`source` 决定候选段、上行意图与文案（见 UPGRADE_SOURCES）。
     * 所有入口都只列**可用**候选（`enabled !== false`：升级入口的 enabled = 有晋升目标，
     * 把不可升级的卡也画成灰卡会让玩家在一堆灰卡里找目标——用户 2026-09-11 报）。
     * **晋升分叉**（用户定 2026-09-13）：确认的卡带多个晋升目标时不直接上行，换开
     * 「选择晋升方向」子面板（候选 = 各分叉目标卡面），确认才带 targetId 上行；
     * 子面板「返回」= 回上一级重选（不消费升级机会——意图未上行，core 未结算）。
     * @returns 是否真的打开了（无候选 / 未知 source → false，编排器据此跳过）
     */
    openUpgradePicker(source, snap = null) {
      const def = UPGRADE_SOURCES[source];
      if (!def) return false;
      const cards = (def.cards(snap) ?? []).filter(c => c.enabled !== false);
      if (!cards.length) return false;
      const picker = ensureCardPicker();
      const fire = (uniqueID, targetId = null) => {
        const intent = def.intent(uniqueID, targetId);
        if (intent) onIntent?.(intent);
      };
      // 晋升类入口的确认钩子：**先播「变身收编」演出再上行**（状态变更发生在演出之后，
      // 同 openShopPackPicker 的节拍哲学）。⚠ 必须设在 picker.open() 之后——open 会
      // 重置 confirmHook（设反了钩子被清，演出静默失效）。
      // 换面目标卡面优先取快照 toViews 里现成的投影（与界面 hover 预览同源，所见即所得；
      // 裸 defId 会被 bakeFace 当无字段数据烘成空卡）。
      const targetViewOf = (c, defId) => {
        const v = c?.toViews?.find(t => t.defId === defId)?.view ?? null;
        return v ? withLabels(v) : null;
      };
      const hookMain = () => {
        if (!def.upgrade) { picker.confirmHook = null; return; }
        picker.confirmHook = (keys) => {
          const c = cards.find(x => x.uniqueID === keys[0]) ?? null;
          const entry = c ? picker.takeEntry(keys[0]) : null;   // 摘下原卡（不随 close 释放）
          picker.close();
          playCardUpgrade({
            card: entry?.obj ?? null,
            fromDefId: c?.defId ?? null, fromView: c?.view ?? null,
            toDefId: c?.tipDefId ?? null, toView: targetViewOf(c, c?.tipDefId),
            onDone: () => fire(keys[0]),
          });
        };
      };
      const openMain = () => {
        confirmFn = (ids) => {
          const c = cards.find(x => x.uniqueID === ids[0]);
          if (c?.toDefIds?.length > 1) { openBranch(c); return; }
          fire(ids[0]);
        };
        cancelFn = null;   // 升级/焚毁/删除：返回 = 只收起界面（不做放弃）
        picker.open({
          title: def.title,
          hint: def.hint,
          cards: cards.map(toCardEntry),
          confirmLabel: def.confirmLabel,
        });
        hookMain();
      };
      const openBranch = (c) => {
        confirmFn = (ids) => fire(c.uniqueID, ids[0]);  // 子面板候选 key = 目标 defId
        cancelFn = () => openMain();                    // 返回 = 回上一级重选
        picker.open({
          title: '选择晋升方向',
          hint: '这张卡可以晋升为以下形态之一 ｜ 悬停查看卡面 ｜ 「返回」重新选卡',
          cards: (c.toViews ?? []).map(t => ({
            uniqueID: t.defId, defId: t.defId, view: t.view, enabled: true, tipDefId: t.defId,
          })),
          confirmLabel: '确认晋升',
        });
        if (def.upgrade) {
          // 分叉确认时面板上摆的是目标卡面而非原卡——演出卡按原卡面在屏幕中央新建
          picker.confirmHook = (keys) => {
            picker.close();
            playCardUpgrade({
              fromDefId: c.defId, fromView: c.view,
              toDefId: keys[0], toView: targetViewOf(c, keys[0]),
              onDone: () => fire(c.uniqueID, keys[0]),
            });
          };
        } else {
          picker.confirmHook = null;
        }
      };
      picker.attachPicker(pickerNow());
      openMain();
      return true;
    },

    /**
     * 卡包三选一（买到即开）：全屏 overlay，**可放弃**。
     * 确认 = 选中的卡入组——先播「择卡得卡」演出（脉冲→飞入收编锚点，sequencer 指令化），
     * 演出落袋后才上行意图（钱已花，选择权仍在玩家，用户定 2026-09-12）；返回 = 放弃这个卡包。
     */
    openShopPackPicker(snap = null) {
      const pend = snap?.shop?.pending;
      if (!pend?.cards?.length) return false;
      const picker = ensureCardPicker();
      confirmFn = (ids) => { onIntent?.({ action: 'takeShopCard', defId: ids[0] }); };
      cancelFn = () => { onIntent?.({ action: 'takeShopCard', defId: null }); };
      picker.attachPicker(pickerNow());
      picker.open({
        title: `${pend.packName ?? pend.packId} · 卡包`,
        hint: '择一张加入牌组 ｜ 不想要就点「返回」放弃这个卡包 ｜ 滚轮翻页',
        cards: pend.cards.map(c => ({
          uniqueID: c.defId, defId: c.defId, view: c.view, enabled: true, tipDefId: c.defId,
        })),
        confirmLabel: '加入牌组',
      });
      // 得卡演出钩子：接管确认后的关闭与上行时机（ScrollPickerObject 的 CONFIRM 分支）。
      // ⚠ 必须在 open() **之后**设——open 会重置 confirmHook（此前设在 open 前，钩子被
      // 清、演出静默失效：卡包确认后直接跳过飞行，是本批接入升级演出时发现的存量 bug）。
      picker.confirmHook = (keys) => {
        const entry = picker.takeEntry(keys[0]);   // 摘下被选中的那张（不随 close 释放）
        picker.close();
        grantBusy = true;
        const done = () => { grantBusy = false; confirmFn?.(keys); };
        if (!entry) { done(); return; }
        scene()?.add(entry.obj);   // picker 组在原点：局部坐标即世界坐标
        playCardGrantFlight({
          card: entry.obj,
          target: typeof getAnchor === 'function' ? getAnchor() : null,
          sequencer: typeof getSequencer === 'function' ? getSequencer() : null,
          onDone: done,
        });
      };
      return true;
    },

    /**
     * 遗物包三选一（售货机「稀有度遗物包」，2026-09-13 用户定）：全屏 overlay，**可放弃**。
     * 确认 = 选中的遗物入包（获得特写由拥有集差分自动兜）；返回 = 放弃（钱已花，不退）。
     * 候选走程序化藏品卡（RelicScrollPickerObject），与老虎机吞噬的遗物侧同一份 picker。
     */
    openShopRelicPackPicker(snap = null) {
      const pend = snap?.shop?.pending;
      if (pend?.kind !== 'relic' || !pend?.relics?.length) return false;
      const picker = ensureRelicPicker();
      confirmFn = (ids) => { onIntent?.({ action: 'takeShopRelic', relicId: ids[0] }); };
      cancelFn = () => { onIntent?.({ action: 'takeShopRelic', relicId: null }); };
      picker.attachPicker(pickerNow());
      picker.open({
        title: `${pend.rarity} 级遗物包`,
        hint: '挑一件收入囊中 ｜ 悬停查看效果 ｜ 不想要就点「返回」放弃（钱已花）｜ 滚轮翻页',
        relics: pend.relics,
        confirmLabel: '拿下这件',
      });
      return true;
    },

    /**
     * 老虎机中奖产出的**多选一**（2026-09-22 统一：获得演出 dismiss 后接全屏 overlay，
     * 不再走 dock 面板里的内嵌卡行/按钮墙）。卡类奖项与卡包同节拍：确认 = 择卡得卡
     * 演出 → `slotTake(choice)`；「返回」= 放弃这份产出（`slotDecline`，与卡包同口径——
     * 演出里的「跳过」也是放弃，两条出口殊途同归）。遗物类奖项走 RelicScrollPicker。
     * @returns 是否真的打开了（非多选奖项 / 无候选 → false）
     */
    openSlotPrizePicker(snap = null) {
      const pd = snap?.slot?.pending;
      if (!pd) return false;
      if (pd.relicChoices?.length) {
        const picker = ensureRelicPicker();
        confirmFn = (ids) => { onIntent?.({ action: 'slotTake', choice: ids[0] }); };
        cancelFn = () => { onIntent?.({ action: 'slotDecline' }); };
        picker.attachPicker(pickerNow());
        picker.open({
          title: pd.tier === 'major' ? '★ 大奖 · 挑一件遗物' : '小奖 · 挑一件遗物',
          hint: '悬停查看效果 ｜ 「返回」= 放弃这份产出',
          relics: pd.relicChoices,
          confirmLabel: '收下这件',
        });
        return true;
      }
      if (pd.choices?.length) {
        const picker = ensureCardPicker();
        confirmFn = (ids) => { onIntent?.({ action: 'slotTake', choice: ids[0] }); };
        cancelFn = () => { onIntent?.({ action: 'slotDecline' }); };
        picker.attachPicker(pickerNow());
        picker.open({
          title: pd.tier === 'major' ? '★ 大奖 · 择一张带走' : '小奖 · 择一张带走',
          hint: '不想要就点「返回」放弃 ｜ 滚轮翻页',
          cards: pd.choices.map(c => ({
            uniqueID: c.defId, defId: c.defId, view: c.view, enabled: true, tipDefId: c.defId,
          })),
          confirmLabel: '加入牌组',
        });
        // 得卡演出钩子（与卡包同款：open 之后设，接管关闭与上行时机）
        picker.confirmHook = (keys) => {
          const entry = picker.takeEntry(keys[0]);
          picker.close();
          grantBusy = true;
          const done = () => { grantBusy = false; confirmFn?.(keys); };
          if (!entry) { done(); return; }
          scene()?.add(entry.obj);
          playCardGrantFlight({
            card: entry.obj,
            target: typeof getAnchor === 'function' ? getAnchor() : null,
            sequencer: typeof getSequencer === 'function' ? getSequencer() : null,
            onDone: done,
          });
        };
        return true;
      }
      return false;
    },

    /**
     * 打开「粉碎物品」选择界面（老虎机吞噬入口；kind: 'card' | 'relic'）。
     * 候选数据由编排器给（kit 不读 run）：cards 走与升级入口同一份卡面烘焙，
     * relics 走程序化藏品卡（`objects/RelicScrollPickerObject.js`）。
     * @returns 是否真的打开了（无候选时 false，编排器据此跳过）
     */
    openDevourPicker({ kind, cards = [], relics = [], onPick = null } = {}) {
      if (kind === 'relic') {
        if (!relics.length) return false;
        const picker = ensureRelicPicker();
        confirmFn = (ids) => onPick?.(ids[0]);
        cancelFn = null;   // 粉碎没有"放弃"出口（返回 = 收起界面）
        picker.attachPicker(pickerNow());
        picker.open({
          title: '粉碎哪件遗物？',
          hint: '喂给老虎机换金币 ｜ 悬停查看效果 ｜ 滚轮翻页（S 级嚼不动）',
          relics,
          confirmLabel: '确认粉碎',
        });
        return true;
      }
      if (!cards.length) return false;
      const picker = ensureCardPicker();
      confirmFn = (ids) => onPick?.(ids[0]);
      cancelFn = null;
      picker.attachPicker(pickerNow());
      picker.open({
        title: '粉碎哪张卡？',
        hint: '喂给老虎机换金币 ｜ 悬停查看卡面 ｜ 滚轮翻页（诅咒卡另有奖赏）',
        cards,
        confirmLabel: '确认粉碎',
      });
      return true;
    },

    /**
     * 获得物特写（通用组件：有素材用素材，没有就拿程序化色块代替）。退出回调 `onDismiss`
     * 由 `show()` 的载荷携带（构造期那份是可选统一回调，缺省无动作）；**实例在退出后保持
     * 挂载复用**（惰性建一次，靠内部 in/hold/out 时序收尾），故构造无需参数。
     */
    showcaseItem(item) {
      if (!item) return false;
      if (!showcase) {
        showcase = new ItemShowcaseObject();
        scene()?.add(showcase);
        showcase.attachPicker(pickerNow());
      }
      return showcase.show(item);
    },

    /**
     * 逐帧驱动获得物特写（自带 in/hold/out 时序；未创建/空闲时无事发生）。
     * 舞台的帧循环调用它（套件的三个成员里只有特写需要帧驱动）。
     */
    update(dt) { showcase?.update(dt); },

    /** 滚轮：全屏界面开着才消费（返回是否真的动了；全屏界面是模态，滚轮只作用于它）。 */
    handleWheel(deltaY) {      if (cardPicker?.opened) return cardPicker.scrollBy(deltaY / 100);
      if (relicPicker?.opened) return relicPicker.scrollBy(deltaY / 100);
      return false;
    },

    /**
     * hover 路由前言：得卡演出在播 → 吞掉；特写在播 → 吞掉（不弹 tooltip）；
     * 某界面开着 → 转它的 onHover。
     * @returns 是否已被 kit 消费（true = 宿主不要再做自己的 hover 逻辑）
     */
    routeHover(hit, x, y) {
      if (grantBusy || upgradeBusy) return true;
      if (showcase?.busy) return true;
      if (cardPicker?.opened) { cardPicker.onHover(hit, x, y); return true; }
      if (relicPicker?.opened) { relicPicker.onHover(hit, x, y); return true; }
      return false;
    },

    /**
     * 点击路由前言：得卡/升级演出在播 → 吞掉；特写在播 → 点任意处退出；某界面开着 → 转它的 onClick。
     * @returns 是否已被 kit 消费（true = 宿主不要再做自己的点击逻辑）
     */
    routeClick(hit) {
      if (grantBusy || upgradeBusy) return true;
      if (showcase?.busy) { showcase.onClick(hit); return true; }
      if (cardPicker?.opened) { cardPicker.onClick(hit); return true; }
      if (relicPicker?.opened) { relicPicker.onClick(hit); return true; }
      return false;
    },

    /**
     * 按下转发（2026-09-21 滚动条拖拽）：点击语义在各舞台是「抬起」判定，而滚动条拖拽
     * 必须从按下那拍开始——宿主 handlePointerDown 里调这里，把按下（含指针坐标）交给
     * 开着的全屏界面（当前只有选卡界面的滚动条用；其余界面没有按下语义，返回 false）。
     */
    routePointerDown(hit, x, y) {
      if (grantBusy || upgradeBusy) return true;
      if (cardPicker?.opened) return cardPicker.onPointerDown?.(hit, x, y) ?? false;
      if (relicPicker?.opened) return relicPicker.onPointerDown?.(hit, x, y) ?? false;
      return false;
    },

    /**
     * 拾取器注入/重连：向**已创建**的惰性实例转播（未创建的等创建时自取）。
     * 传 null 表示摘除（detachInput）。panel 与机器拾取物不归 kit（各舞台自己管）。
     */
    attachPicker(picker = null) {
      pickerRef = picker ?? null;
      for (const inst of [cardPicker, relicPicker, showcase]) inst?.attachPicker?.(picker ?? null);
    },

    /** 两个选卡/选遗物界面的按钮动作合并查询（契约测试用；都没有则 null）。 */
    buttonActionsOf(pickId) {
      return cardPicker?._buttonActions?.get(pickId)
        ?? relicPicker?._buttonActions?.get(pickId)
        ?? null;
    },

    /** 释放已创建的实例（宿主 dispose 时调用；未创建的无事发生）。 */
    dispose() {
      for (const inst of [cardPicker, relicPicker, showcase]) {
        if (!inst) continue;
        scene()?.remove(inst);
        inst.dispose();
      }
      cardPicker = null;
      relicPicker = null;
      showcase = null;
      confirmFn = null;
      cancelFn = null;
      pickerRef = null;
      grantBusy = false;
      upgradeBusy = false;
    },
  };
}
