// 调试模式编排（Shell 域模块）：**面板与外部脚本的唯一入口**。
//
// 分工（与 runShowcase / runMachines / runCutsceneFlows 同构）：
//   · core/debug/ops.js —— 改 core 状态（纯函数，带 core 守卫）
//   · 本文件 —— 改完之后**前端怎么刷新**：状态栏 / 面板 / 换台 / 相机 / 进房演出 / 重开
//   · DebugOverlay.vue —— 只画 UI，读写都经这里
//
// ctx 的引用**全部晚绑定**（箭头闭包捕获词法绑定，运行期才取值）：notify / swapAnyToMap
// 之类的 const 在本模块之后才初始化，构造期不调用它们，初始化顺序安全。
//
// 边界（有意为之）：
//   · 战斗中的牌组/遗物/跳层会破坏战场一致性 —— 这里直接拒绝并给出人话（面板据此置灰）
//   · 改过状态的局立刻升级为「调试局」（run.debugMode = true）→ 落盘切到 debug 槽，
//     真实存档永不被污染（安全网：从开始界面误入普通局也能被兜住）

import { reactive } from 'vue';
import * as ops from '../core/debug/ops.js';
import * as bops from '../core/debug/battleOps.js';

export function createRunDebug(ctx) {
  const { run, notify, syncMapStatus } = ctx;
  // 回执历史（面板底部显示）：调试工具自己的日志——每个动作都留一句人话，
  // 「点了没反应」在这类工具里最费时间，所以失败原因也照登不误。
  const messages = reactive([]);
  let msgSeq = 0;
  let toastFn = null;
  const say = (text) => {
    if (!text) return;
    messages.unshift({ id: ++msgSeq, text });
    if (messages.length > 40) messages.pop();
    toastFn?.(text);
  };
  // 「本局改过东西」= 调试局：槽位随之切换（saves.modeOf 读它）
  let dirtied = false;
  function markDirty() {
    if (dirtied) return;
    dirtied = true;
    if (!run.debugMode) {
      run.debugMode = true;
      say('本局已标记为调试局：存档写入 debug 槽，真实存档不受影响');
    }
  }

  const inBattle = () => run.gameStage === 'battle';
  const busy = () => !!ctx.getBattleStage();   // 战斗舞台存活（含战后奖励面板期间）

  /** 统一包装：guard → core op → 刷新 → 人话回执（异常转成人话，不炸面板）。 */
  function act(label, guard, fn, after = null) {
    if (guard) { say(`${label}：${guard}`); return false; }
    try {
      const msg = fn();
      markDirty();
      after?.();
      syncMapStatus?.();
      notify?.();
      // 战斗内改动（上限类字段等）补一次战斗投影同步：run 级 notify 触不到 bridge 的
      // 标脏链，投影只在战斗指令事件时重拉——否则珠子/将弃预告停更到下一条指令
      //（2026-09-22 qa 实测修复）。
      const bridge = ctx.getBattleBridge?.();
      if (bridge) { bridge.markDirty?.(); bridge.syncIfIdle?.(); }
      say(msg ?? label);
      return true;
    } catch (err) {
      say(`${label} 失败：${err?.message ?? err}`);
      return false;
    }
  }

  // 战斗内禁止的操作：牌组/遗物/跳层（战场按旧牌组装配；promoteCard 还会原地改
  // 正在战斗里的同一批 runtime 对象 → 前后端分叉）。先秒杀/硬重置退出战斗再改。
  const battleGuard = (what) => (inBattle() ? `战斗中不能${what}（先秒杀敌人或硬重置退出战斗）` : null);

  // ---- 状态 ----
  const setField = (field, value) => act(`改 ${field}`, null, () => ops.setPlayerField(run, field, value));
  const setLeino = (dim, level) => act(`改灵脉 ${dim}`, null, () => ops.setLeinoLevel(run, dim, level));
  const setInvulnerable = (on) => act('无敌开关', null, () => ops.setInvulnerable(run, on));
  const clearDebuffs = () => act('清负面', null, () => ops.clearDebuffs(run));
  const addEffect = (effectId, stacks) => act('加效果', null, () => ops.addEffectToPlayer(run, effectId, stacks));

  // ---- 牌组 ----
  const addCard = (defId) => act('加卡', battleGuard('改牌组'), () => ops.grantCard(run, defId));
  const removeCard = (uniqueID) => act('删卡', battleGuard('改牌组'), () => ops.removeCard(run, uniqueID));
  const promoteCard = (uniqueID, targetId = null) => act('升级卡', battleGuard('改牌组'), () => ops.promoteCardAt(run, uniqueID, targetId));
  const resetDeck = () => act('重置牌组', battleGuard('改牌组'), () => ops.resetDeck(run));

  // ---- 遗物 ----
  const addRelic = (relicId) => act('加遗物', battleGuard('改遗物'), () => ops.grantRelicById(run, relicId));
  const addRandomRelic = (rarity = null) => act('随机遗物', battleGuard('改遗物'), () => ops.grantRandomRelic(run, rarity));
  const removeRelic = (relicId) => act('移除遗物', battleGuard('改遗物'), () => ops.removeRelicById(run, relicId));
  const equip = (relicId) => act('装备遗物', battleGuard('改遗物'), () => ops.equipRelicById(run, relicId));
  const unequip = (relicId) => act('卸下遗物', battleGuard('改遗物'), () => ops.unequipRelicById(run, relicId));

  // ---- 楼层 / 房间 ----
  const setFloor = (floor) => act('跳层', null, () => {
    const msg = ops.setFloor(run, floor);
    // 舞台归一：战斗/房间舞台全拆，塔楼摆到新层（同一份「落到 prep」语义）
    ctx.swapAnyToMap?.();
    ctx.mapStage?.setFloor?.(run.floor, run.totalFloors);
    return msg;
  });
  const nextFloor = () => setFloor(run.floor + 1);
  const reloadFloor = () => setFloor(run.floor);   // 同层重掷遭遇（换一批敌人）
  const enterRoom = (roomId) => act('进房', null, () => {
    const msg = ops.enterRoom(run, roomId);
    ctx.swapAnyToMap?.();
    ctx.mapStage?.setFloor?.(run.floor, run.totalFloors);
    return msg;
  }, () => ctx.enterRoomPresentation?.());

  // ---- 奖励 / 进阶 / 幕间 ----
  const startReward = (opts = {}) => act('开奖励', battleGuard('开奖励'), () => {
    const msg = ops.startReward(run, opts);
    ctx.swapAnyToMap?.();
    return msg;
  });
  const grantRandomRelicRarity = (r) => addRandomRelic(r);

  /** 触发进阶事件（走正式幕间：真实结算 + 真进阶结果；currentRoom 为空时会推进楼层）。 */
  const triggerAscension = () => act('触发进阶', null, () => ops.startAscensionEvent(run),
    () => { void ctx.playAscensionScene?.(); });

  /**
   * 跳过当前幕间：反复 advance/choose(首个选项) 直到 idle。
   * 闸门（人机对话页）没开时 advance 会被拒——所以是"轮询推进"而不是一次性调用。
   */
  async function skipCutscene() {
    const c = ctx.cutscene;
    if (!c?.state || c.state.mode === 'idle') { say('当前没有幕间在播'); return false; }
    for (let i = 0; i < 120; i++) {
      const st = c.state;
      if (!st || st.mode === 'idle') break;
      const page = st.step?.type === 'dialogue' ? st.step.pages?.[st.pageIndex] : null;
      if (page?.choices?.length) c.choose(page.choices[0].id);
      else c.advance();
      // 让队列/闸门往前走一步（advance 是同步回执，推进靠 sequencer 的下一帧）
      await new Promise(r => setTimeout(r, 50));
    }
    const done = ctx.cutscene?.state?.mode === 'idle';
    say(done ? '已跳过幕间' : '幕间跳过超时（仍在中途）');
    return done;
  }

  // ---- 战斗内（指令化：秒杀走正式伤害/死亡/胜利链）----
  const battle = () => {
    const b = ctx.getBattleBridge?.()?.battle ?? null;
    if (!b) throw new Error('当前没有进行中的战斗');
    return b;
  };
  const battleAct = (label, fn) => act(label, inBattle() ? null : '当前不在战斗中', fn);
  const killAllEnemies = () => battleAct('秒杀敌人', () => bops.killAllEnemies(battle()));
  const killEnemy = (key) => battleAct('秒杀单个', () => bops.killEnemy(battle(), key));
  const healFull = () => battleAct('回满血', () => bops.healPlayerFull(battle()));
  const gainManaInBattle = (n) => battleAct('加魏启', () => bops.gainMana(battle(), n));
  const gainApInBattle = (n) => battleAct('加行动力', () => bops.gainActionPoints(battle(), n));
  const gainShieldInBattle = (n) => battleAct('加护盾', () => bops.gainShield(battle(), n));
  const addCardToHand = (defId) => battleAct('加到手牌', () => bops.addCardToHand(battle(), defId));
  const drawCards = (n) => battleAct('抽牌', () => bops.drawCards(battle(), n));
  const addBattleEffect = (targetKey, effectId, stacks) =>
    battleAct('加效果', () => bops.addEffect(battle(), targetKey, effectId, stacks));
  const cleanseBattle = () => battleAct('净化全场', () => bops.cleanseAll(battle()));
  const enemyViews = () => {
    try { return bops.enemyViews(battle()); } catch { return []; }
  };
  /**
   * 硬重置：丢弃本场战斗，回到本层战前准备（不计奖励、不判胜负）。
   * 用在"战斗卡死/演示已废"的场合——它是**逃生舱**，不是正常胜利路径（正常胜利用秒杀）。
   */
  function hardResetBattle() {
    if (!ctx.getBattleStage?.()) { say('当前没有战斗舞台可重置'); return false; }
    ctx.swapAnyToMap?.();
    run.gameStage = 'prep';
    run.encounter = run.encounter ?? null;
    markDirty();
    syncMapStatus?.();
    notify?.();
    say('已丢弃本场战斗，回到本层战前准备');
    return true;
  }

  return {
    // 面板用：是否调试会话（决定显示"本局为调试局"）
    get session() { return !!run.debugMode; },
    get dirtied() { return dirtied; },
    messages,                        // 回执历史（reactive，面板直接渲染）
    setToast: (fn) => { toastFn = fn; },   // 可选：同时喂全局 toast（面板注入）
    note: (text) => say(text),        // 面板自己的提示出口（如 JSON 解析失败）
    markDirty,                       // 手动路径用（走 act 的已自动标）
    inBattle, busy,
    packIds: () => ops.packIds(run),

    setField, setLeino, setInvulnerable, clearDebuffs, addEffect,
    addCard, removeCard, promoteCard, resetDeck,
    addRelic, addRandomRelic, removeRelic, equip, unequip,
    setFloor, nextFloor, reloadFloor, enterRoom,
    startReward, grantRandomRelicRarity,
    triggerAscension, skipCutscene,
    // 战斗页
    killAllEnemies, killEnemy, healFull, gainManaInBattle, gainApInBattle, gainShieldInBattle,
    addCardToHand, drawCards, addBattleEffect, cleanseBattle, enemyViews, hardResetBattle,
  };
}
