// 休息阶段面板的浏览器视觉门（uiGallery.html）。
// 与 propGallery / roomGallery 同范式：独立页面 + 查询参数调参，用于在浏览器里
// 验收面板视觉与交互，不必真的玩到那一层。
//
// knobs：
//   ?panel=prep        面板种类（当前只有 prep；后续随迁移增加）
//   ?seed=123          样本 run 的种子
//   ?relics=dragonScale,blackMountainRock,springFlask   预置遗物（逗号分隔）
//   ?equip=dragonScale     预置装备
//   ?floor=7           楼层（影响距 Boss 提示）
//
// 交互真的通：点击面板按钮 → 走 MapStage 的意图出口 → 落到 core 的 prep 函数 →
// 重推快照。页面左上角显示最后一次意图，可据此确认路由链路。

import '../core/content/index.js';
import { StageManager } from '../stage/StageManager.js';
import { MapStage } from '../stage/stages/MapStage.js';
import { createRun, enterBattle, finishBattle, completeRewards } from '../core/run/runFlow.js';
import { prepSnapshot, rewardSnapshot, ascensionSnapshot, roomSnapshot } from '../core/run/panelSnapshot.js';
import { grantRelic, equipRelic, unequipRelic, prepUseRelic } from '../core/run/prep.js';
import { chooseRewardPack, chooseSkillReward } from '../core/run/rewards.js';
import { chooseAscension, chooseSeedCards, rerollSeedOffering } from '../core/run/ascension.js';
import { trainUpgrade, trainDrawChoices, trainDraw, skipTraining } from '../core/run/rooms/training.js';
import { campRest, campRecoverRemi, campUpgrade } from '../core/run/rooms/camp.js';
import {
  spinSlot, takeSlotPrize, declineSlotPrize, slotUpgrade, devourSlot,
} from '../core/run/rooms/slotMachine.js';
import { playEvent } from '../core/run/rooms/event.js';
import { ensureShopStock, buyShopItem, takeShopCard } from '../core/run/rooms/shop.js';
import { completeRoom } from '../core/run/runFlow.js';
import { attachTooltipForwarding } from '../shell/tooltipForward.js';
import { tooltipState } from '../shell/tooltipHub.js';
import mitt from 'mitt';

const q = new URLSearchParams(location.search);
const opt = (k, d) => q.get(k) ?? d;
const PANEL = opt('panel', 'prep');
const SEED = Number(opt('seed', '123'));

const canvas = document.createElement('canvas');
canvas.id = 'gallery-canvas';
canvas.style.cssText = 'display:block;position:absolute;inset:0';
document.body.appendChild(canvas);

const overlay = document.createElement('div');
overlay.id = 'gallery-overlay';
overlay.style.cssText = 'position:fixed;top:10px;right:12px;pointer-events:none;'
  + 'font:13px/1.7 monospace;color:#cfd8e3;text-shadow:0 1px 3px rgba(0,0,0,.9);text-align:right';
overlay.innerHTML = '<h1 style="margin:0 0 2px;font:600 15px/1.4 monospace;color:#e8eef8">'
  + '休息阶段面板 · uiGallery</h1><div id="ug-info"></div><div id="ug-intent"></div>'
  + '<div style="color:#8a93b2">面板内按钮/卡面可点；面板外为地图舞台（塔楼）</div>';
document.body.appendChild(overlay);
const info = overlay.querySelector('#ug-info');
const intentLine = overlay.querySelector('#ug-intent');

// ---- 样本 run（按面板种类造对应阶段）----
let run = null;
let roomUi = null; // 房间层舞台侧瞬态（老虎机演出态 / 事件结果）
function buildRun() {
  const r = createRun({ seed: SEED });
  if (PANEL === 'room') {
    // 房间层：?room=training|camp|slot|event（默认 slot，含演出与揭示）
    r.gameStage = 'room';
    r.currentRoom = opt('room', 'slot');
    // ?floor=4 等商店层可看到售货机入口；?shop=1 直接打开售货机
    r.floor = Number(opt('floor', '1'));
    r.storyMode = opt('story', '0') === '1';
    r.player.money = Number(opt('money', '20'));
    ensureShopStock(r);
    roomUi = { slot: { anim: null, lastSpin: null }, eventResult: null };
    if (r.currentRoom === 'slot') r.player.money = Number(opt('money', '20'));
  } else if (PANEL === 'ascension') {
    // 进阶事件：进 ascension 阶段；?offering=1 直接走到种子包（火灵脉首次 0→1）
    r.gameStage = 'ascension';
    if (opt('offering', '0') === '1') chooseAscension(r, 'fire');
  } else if (PANEL === 'reward') {
    // 战后奖励：赢一场即进 reward（初始只解锁体修包 → 核心自动开包，直接进三选一）
    enterBattle(r);
    finishBattle(r, 'victory');
  } else {
    r.floor = Number(opt('floor', '1'));
    for (const id of opt('relics', 'dragonScale,blackMountainRock,springFlask').split(',').filter(Boolean)) {
      grantRelic(r, id);
      if (opt('equip', '').split(',').includes(id)) equipRelic(r, id);
    }
  }
  return r;
}
run = buildRun();

// ---- 舞台 ----
const stageManager = new StageManager();
stageManager.attach(canvas);
const mapStage = new MapStage({});
mapStage.setFloor(run.floor, run.totalFloors);
stageManager.setStage(mapStage);
stageManager.start();

const bus = mitt();
attachTooltipForwarding(bus);

const push = () => {
  if (PANEL === 'room') mapStage.setPanel(roomSnapshot(run, roomUi));
  else if (PANEL === 'ascension') mapStage.setPanel(ascensionSnapshot(run));
  else if (PANEL === 'reward') mapStage.setPanel(rewardSnapshot(run));
  else mapStage.setPanel(prepSnapshot(run));
  // 顶端资源行/状态栏也给上（面板与之同屏，便于检查遮挡关系）
  mapStage.setStatus({
    ap: run.player.maxActionPoints, apMax: run.player.maxActionPoints,
    mana: run.player.mana, manaMax: run.player.maxMana,
    money: run.player.money, hp: run.player.hp, maxHp: run.player.maxHp,
    relics: run.player.equippedRelics.map(id => ({ id, name: id, icon: null, usesLeft: null })),
    remi: { present: true, hp: 15 },
  });
  info.textContent = `面板 ${PANEL} ｜ 阶段 ${run.gameStage} ｜ 层 ${run.floor}/${run.totalFloors} ｜ 种子 ${run.seed}`;
};

mapStage.setPanelIntentHandler((intent) => {
  intentLine.textContent = `意图：${JSON.stringify(intent)}`;
  const a = intent?.action;
  try {
    if (a === 'equip') equipRelic(run, intent.relicId);
    else if (a === 'unequip') unequipRelic(run, intent.relicId);
    else if (a === 'useRelic') prepUseRelic(run, intent.relicId);
    else if (a === 'startBattle') intentLine.textContent += '  （陈列页不进入战斗）';
    else if (a === 'chooseRewardPack') chooseRewardPack(run, intent.packId);
    else if (PANEL === 'room') {
      // 房间层：真走 core，并让「老虎机演出 → 回执 → 揭示」在陈列页也跑通
      if (a === 'trainingUpgrade') trainUpgrade(run, intent.uniqueID);
      else if (a === 'trainingDrawRoll') trainDrawChoices(run);
      else if (a === 'trainingDraw') { trainingDraw(run, intent.defId ?? null); completeRoom(run); }
      else if (a === 'trainingSkip') { skipTraining(run); completeRoom(run); }
      else if (a === 'campChoose') {
        if (intent.option === 'rest') campRest(run);
        else if (intent.option === 'recoverRemi') campRecoverRemi(run);
        else if (intent.option === 'upgrade') campUpgrade(run, intent.uniqueID);
        completeRoom(run);
      }
      else if (a === 'spin') {
        const prize = spinSlot(run);
        roomUi.slot = { anim: { id: `a${Date.now()}`, prize }, lastSpin: null };
      } else if (a === 'slotAnimDone') {
        roomUi.slot = { anim: null, lastSpin: roomUi.slot.anim?.prize ?? null };
      } else if (a === 'slotTake') takeSlotPrize(run, intent.choice ?? null);
      else if (a === 'slotDecline') declineSlotPrize(run);
      else if (a === 'slotPickUpgrade') slotUpgrade(run, intent.uniqueID);
      else if (a === 'slotDevourRelic') devourSlot(run, { kind: 'relic', relicId: intent.relicId });
      else if (a === 'slotDevourCard') devourSlot(run, { kind: 'card', uniqueID: intent.uniqueID });
      else if (a === 'leaveSlot') completeRoom(run);
      else if (a === 'triggerEvent') roomUi.eventResult = playEvent(run);
      else if (a === 'buyShopItem') buyShopItem(run, intent.index);
      else if (a === 'takeShopCard') takeShopCard(run, intent.defId);
      else if (a === 'leaveEvent') completeRoom(run);
      if (run.gameStage !== 'room') run = buildRun(); // 离房 → 重建样本
    }
    else if (a === 'chooseAscensionDimension') chooseAscension(run, intent.dimension);
    else if (a === 'chooseSeedCards') chooseSeedCards(run, intent.defIds);
    else if (a === 'rerollSeedOffering') rerollSeedOffering(run);
    else if (a === 'claimReward') {
      chooseSkillReward(run, intent.defId ?? null);
      completeRewards(run);
      // 领取即离房：重建一份 reward 样本，面板留在屏幕上继续可点
      if (PANEL === 'reward' && run.gameStage !== 'reward') run = buildRun();
    } else if (PANEL === 'ascension' && a === 'chooseSeedCards') {
      if (run.gameStage !== 'ascension') run = buildRun(); // 选完即离房 → 重建样本
    }
  } catch (e) {
    intentLine.textContent += `  ✗ ${e.message}`;
  }
  push();
});
mapStage.attachInput({ stageManager, bus });
push();
// ?picker=1 直接打开全屏选卡界面（营地/训练场的「升级一张卡」），省得玩到那一层
if (opt('picker', '0') === '1' && (run.currentRoom === 'camp' || run.currentRoom === 'training')) {
  mapStage._onPanelAction({ action: 'openUpgradePicker', source: run.currentRoom, local: true });
}
// ?shop=1 直接打开售货机（需 ?floor= 命中商店层，如 floor=4）
if (opt('shop', '0') === '1' && run.shop) {
  mapStage._onPanelAction({ action: 'openShop', local: true });
}

// ---- 指针接线（与 App.vue 同一套调用） ----
const local = (e) => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
canvas.addEventListener('pointermove', (e) => { mapStage.handlePointerMove(...local(e)); });
canvas.addEventListener('pointerdown', (e) => { mapStage.handlePointerDown(...local(e)); });
canvas.addEventListener('pointerup', (e) => { mapStage.handlePointerUp(...local(e)); });

// tooltip 是 DOM 浮层（本页不引入 TooltipOverlay 组件，只把状态机结果画成一行，便于确认链路）
const tt = document.createElement('div');
tt.style.cssText = 'position:fixed;left:12px;bottom:12px;pointer-events:none;'
  + 'font:12px/1.6 monospace;color:#9aa3b8;text-shadow:0 1px 3px rgba(0,0,0,.9)';
document.body.appendChild(tt);
setInterval(() => {
  tt.textContent = tooltipState.visible
    ? `tooltip: ${tooltipState.model?.title ?? ''} @${Math.round(tooltipState.x)},${Math.round(tooltipState.y)}`
    : 'tooltip: —';
}, 150);

const resize = () => {
  const w = innerWidth; const h = Math.round(w * 9 / 16);
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  stageManager.resize(w, h);
};
addEventListener('resize', resize);
resize();
