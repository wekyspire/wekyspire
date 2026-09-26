// 休息房陈列页（用户定 2026-09-11）：**休息阶段场景的视觉门**——与 roomGallery 同范式，
// 但多两件休息房专属的调试层：
//   1. **UI 安全区**：休息面板将覆盖画面下方（配方 anchors.uiSafe.bottomRatio，缺省 0.42），
//      用斜纹带标出——构图不该在这一带放精细件；
//   2. **交互锚点**：把配方的 anchors（老虎机/银行机/柜台）投影到屏幕并画圈标注，
//      用来核对「设施是否落在安全区之上、是否可读地分开、朝向是否朝相机」。
// 打开：npm run dev 后访问 /restGallery.html?recipe=casino&seed=demo
// 调参 knob：?seed= ｜ ?ui=0|0.55（安全区比例）｜ ?anchors=1|0 ｜ ?orbit=1（自由观察）
//   ｜ 布光 knob 同 roomGallery：?hemi=&moon=&fill=&ba=&bb=&glow=&glowd=&cf=&cfd=&fire=&fired=&lamp=&lampd=

import * as THREE from 'three';
import { composeRoom } from '../stage/scenes/rooms/composeRoom.js';
import { RECIPES } from '../stage/scenes/rooms/presets.js';
import { createVolumetricMoonlight } from '../stage/scenes/volumetricMoon.js';
import { applyToneMapping, DEFAULT_TONE_MODE } from '../stage/post/passes.js';
import { LIGHTING_PRESETS } from '../stage/scenes/rooms/lighting.js';
import { createSlotMachineRig } from '../stage/scenes/interactive/slotMachineRig.js';
import { createBankMachineRig } from '../stage/scenes/interactive/bankMachineRig.js';
import { createVendingMachineRig } from '../stage/scenes/interactive/vendingMachineRig.js';
import { FLOOR_Y } from '../stage/scenes/dungeon3D.js';
import { MachineMarkerObject } from '../stage/objects/MachineMarkerObject.js';

const params = new URLSearchParams(location.search);

// ---- 布光实时调参（与 roomGallery 同口径；多两条 lamp 通道 knob）----
function applyLightingTune(recipe) {
  const preset = LIGHTING_PRESETS[recipe?.lighting];
  if (!preset) return;
  const num = (k) => (params.has(k) ? Number(params.get(k)) : null);
  const apply = (v, fn) => { if (v !== null && Number.isFinite(v)) fn(v); };
  apply(num('hemi'), v => { preset.hemi[2] = v; });
  apply(num('moon'), v => { preset.moon = v; });
  apply(num('fill'), v => { preset.fill = v; });
  apply(num('ba'), v => { preset.bounce[0][0] = v; });
  apply(num('bb'), v => { preset.bounce[1][0] = v; });
  apply(num('glow'), v => { preset.battleGlow[1] = v; });
  apply(num('glowd'), v => { preset.battleGlow[2] = v; });
  apply(num('cf'), v => { preset.centerFill[1] = v; });
  apply(num('cfd'), v => { preset.centerFill[2] = v; });
  apply(num('fire'), v => { preset.fire.base = v; });
  apply(num('fired'), v => { preset.fire.dist = v; });
  apply(num('lamp'), v => { if (preset.lamp) preset.lamp.base = v; });
  apply(num('lampd'), v => { if (preset.lamp) preset.lamp.dist = v; });
  apply(num('fbase'), v => { if (preset.focus) preset.focus.base = v; });
  apply(num('fdim'), v => { if (preset.focus) preset.focus.dim = v; });
  apply(num('foff'), v => { if (preset.focus) preset.focus.offset = v; });
}

const canvas = document.createElement('canvas');
canvas.id = 'room-canvas';
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a12);

const camera = new THREE.PerspectiveCamera(24, 1, 1, 900);
const orbit = {
  az: 0.593, el: 0.349,
  dist: Number(params.get('dist')) || 185.8,
  target: new THREE.Vector3(0, -15, 0),
};

let room = null;
let composer = null;
let time = 0;
const rigs = new Map();      // name -> rig（老虎机/银行机的动画驱动）
const markerRings = [];      // name -> 地面光环（hover 提亮）
let focused = null;          // 当前聚焦的机器名
const camTween = { active: false, t: 0, dur: 0.85, from: null, to: null };
// 摇杆次数计数器（吞噬进度）：正式流程里来自 panelSnapshot.snap.slot.devour，调试门里本地模拟
// ——每次拉杆 +1（封顶 7），粉碎后归零。变的是**数据**，动画一律由 rig 自己的滚动积分做。
const DEVOUR_EVERY = 7;
let devourProgress = Number(params.get('devour')) || 0;
const devourReady = () => devourProgress >= DEVOUR_EVERY;
function syncDevour() {
  rigs.get('slot')?.setDevour?.({ progress: devourProgress, every: DEVOUR_EVERY, ready: devourReady() });
  const el = document.getElementById('bar-devour');
  if (el) {
    el.textContent = devourReady()
      ? '粉碎口已张开——点机身正面的投料口，或按此处的「粉碎」'
      : `摇杆次数 ${devourProgress}/${DEVOUR_EVERY}（粉碎口还需要 ${DEVOUR_EVERY - devourProgress} 次拉杆）`;
    el.style.color = devourReady() ? '#ffd75e' : '#8d97b5';
  }
  const btn = document.getElementById('bar-crush');
  if (btn) btn.disabled = !devourReady();
}

const info = document.getElementById('room-info');
const barEl = document.getElementById('machine-bar');
const barTitle = document.getElementById('machine-title');
const barBody = document.getElementById('machine-body');
const barBack = document.getElementById('machine-back');
const selector = document.getElementById('recipe-select');
const seedInput = document.getElementById('seed-input');
const safeEl = document.getElementById('ui-safe');
const anchorLayer = [];

// 配方下拉：默认列出全部配方（含战斗四型——休息房只是其中一族，便于对比手感）
for (const id of Object.keys(RECIPES)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = id + (id === 'casino' ? '（休息房）' : '');
  selector.appendChild(opt);
}
selector.value = params.get('recipe') || 'casino';
seedInput.value = params.get('seed') || 'demo';

// ---- 交互层（悬停高亮 / 点击聚焦 / 机器交互条）----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;

/** 屏幕坐标 → 命中的机器名（先打浮标，再打机器本体）。 */
function pickMachine(clientX, clientY) {
  if (!room) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  for (const m of markerRings) {
    if (m.marker && raycaster.intersectObject(m.marker, true).length) return m.name;
  }
  for (const m of markerRings) {
    if (m.entry && raycaster.intersectObject(m.entry.object, true).length) return m.name;
  }
  return null;
}

/** 屏幕坐标 → 聚焦机器正面的粉碎口热区（'crusher' | 'counter' | null）。
 *  只认**当前聚焦**的机器：远景点机身 = 聚焦，怼脸后点投料口才是"投料"，两者不混。 */
function pickCrusher(clientX, clientY) {
  if (focused !== 'slot') return null;
  const rig = rigs.get('slot');
  const targets = rig?.crusherTargets?.() ?? [];
  if (!targets.length) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(targets, false)) {
    const name = rig.pickNameOf?.(hit.object);
    if (name) return name;
  }
  return null;
}

function setHovered(name) {
  if (hovered === name) return;
  hovered = name;
  canvas.style.cursor = name ? 'pointer' : 'default';
  for (const m of markerRings) {
    m.hover = m.name === name;
    rigs.get(m.name)?.setHover(m.name === name);
  }
}

/** 聚焦某台机器：相机推到它屏幕前 + 弹出交互条（游戏内换成正式面板）。 */
function focusMachine(name) {
  const m = markerRings.find(x => x.name === name);
  if (!m) return;
  const rig = rigs.get(name);
  focused = name;
  savedOrbit = { az: orbit.az, el: orbit.el, dist: orbit.dist, target: orbit.target.clone() };
  // 取景口径（用户定 2026-09-11）：老虎机**贴到屏幕前**（接近怼脸），但**必须留住侧面拉杆**——
  // 于是按「屏幕自身尺寸 + 拉杆尖端外扩」算所需半宽/半高，再按相机 fov 反算距离。
  // 银行机没有拉杆这件"侧面极限件"，怼到屏幕上只会剩一块色板 → 改按机身上 2/3 段取景
  // （读作"站在这台机器前"，也留出下方交互 UI 的位置）。
  const parts = m.entry.parts ?? {};
  const reels = parts.reels ?? [];
  const sp = new THREE.Vector3();
  let halfW; let halfH; let screenH; let margin;
  if (parts.bay) {
    // 售货机（商店房）：框**货架区开口**——怼脸看货与价格；底边留出下方交互条的位置
    sp.copy(m.entry.object.localToWorld(new THREE.Vector3(parts.bay.x, parts.bay.y, parts.bay.z)));
    halfW = (parts.bay.w / 2) * m.entry.scale * 1.04;
    halfH = (parts.bay.h / 2) * m.entry.scale * 1.04;
    screenH = parts.bay.h * m.entry.scale;
    margin = 1.08;
  } else if (parts.leverPivot && reels.length) {
    const screenLike = reels[Math.floor(reels.length / 2)] ?? m.entry.object;
    screenLike.getWorldPosition(sp);
    const a = new THREE.Vector3(); const b = new THREE.Vector3();
    reels[0].getWorldPosition(a);
    reels[reels.length - 1].getWorldPosition(b);
    const cell = Math.abs(a.x - b.x) / (reels.length - 1);
    screenH = cell * 1.05;
    halfW = (Math.abs(a.x - b.x) + cell * 1.35) * 0.5;
    halfH = screenH * 0.5;
    const lb = new THREE.Box3().setFromObject(parts.leverPivot);
    halfW = Math.max(halfW, Math.abs(lb.max.x - sp.x), Math.abs(sp.x - lb.min.x));
    halfH = Math.max(halfH, Math.abs(lb.max.y - sp.y), Math.abs(sp.y - lb.min.y));
    margin = 1.32;                          // 贴脸余量：越小越近（拉杆刚不出框；1.3 左右是极限）
  } else {
    // 无拉杆件（银行机）：**整机入画**（读作"走到机器前"）——怼屏幕只剩一块色板，
    // 而机身上 2/3 段又太近（正面是一大片平壳）。下方 42% 会被交互面板盖住，正好。
    const bb = new THREE.Box3().setFromObject(m.entry.object);
    const size = bb.getSize(new THREE.Vector3());
    sp.set((bb.min.x + bb.max.x) / 2, bb.min.y + size.y * 0.52, (bb.min.z + bb.max.z) / 2);
    halfW = size.x * 0.5;
    halfH = size.y * 0.5;
    screenH = size.y * 0.3;
    margin = 1.12;
  }
  const vFov = (camera.fov * Math.PI) / 180;
  const distV = (halfH * margin) / Math.tan(vFov / 2);
  const distH = (halfW * margin) / (Math.tan(vFov / 2) * Math.max(0.5, camera.aspect));
  const dist = Math.max(distV, distH, 9);
  const fwd = new THREE.Vector3(Math.sin(m.entry.ry), 0, Math.cos(m.entry.ry));
  startCamTween(sp.clone().addScaledVector(fwd, dist), sp.clone());
  // 焦点布光（用户定 2026-09-11）：zoomin 时外围压暗、**正面补光**把机器中央屏幕区打亮。
  // 光心就落在屏幕中心（不许抬高——抬高会变顶光，正面屏幕反而照不亮，用户报障）。
  room.lighting?.setFocus(sp.clone(), { strength: 1 });
  rig?.setFocus(true);                    // 怼脸时抑制机体抖动（近景里同样位移看起来更剧烈）

  barTitle.textContent = name === 'slot' ? '🎰 老虎机' : '🏦 银行机';
  barBody.innerHTML = name === 'slot'
    ? '<button id="bar-pull">拉杆！（' + tier + '）</button><span id="bar-result"></span>'
      + '<div id="bar-devour" class="devour"></div>'
      + '<button id="bar-crush">粉碎一件物品（换金币）</button>'
    : '<button id="bar-deposit">存钱</button><button id="bar-withdraw">取钱</button>';
  if (name === 'slot') {
    document.getElementById('bar-pull').onclick = () => {
      const btn = document.getElementById('bar-pull');
      btn.disabled = true;
      const out = devOutcome();
      rig.pull(out);
      // 每拉一次杆，粉碎进度 +1（正式流程里由 core 的 slotDevour 累加，门里本地模拟同一口径）
      devourProgress = Math.min(DEVOUR_EVERY, devourProgress + 1);
      syncDevour();
      const res = document.getElementById('bar-result');
      if (res) res.textContent = '';
      const timer = setInterval(() => {
        if (!rig.isBusy()) {
          clearInterval(timer);
          btn.disabled = false;
          const zh = { none: '未中奖', minor: '小奖', major: '大奖' }[out.tier] ?? out.tier;
          if (res) res.textContent = `→ ${zh}`;
        }
      }, 120);
    };
    document.getElementById('bar-crush').onclick = () => runCrush();
    syncDevour();
  } else {
    document.getElementById('bar-deposit').onclick = () => rig.act('deposit');
    document.getElementById('bar-withdraw').onclick = () => rig.act('withdraw');
  }
  barEl.classList.add('open');
}

let savedOrbit = null;
/** 粉碎演出（调试门版）：正式流程里这条链是「对话问"粉碎什么？" → 全屏选卡/选遗物 →
 *  提交 core 结算 → 播机器演出 + 金币获得动画」；门里只保留**机器这一端**（rig.crush），
 *  用来单独调咬合/迸币手感。 */
function runCrush() {
  const rig = rigs.get('slot');
  if (!rig || !devourReady() || rig.isBusy()) return false;
  rig.crush();
  devourProgress = 0;          // 用掉即清零（core 同口径）；计数器随之滚回 0/7
  syncDevour();
  return true;
}
function unfocusMachine() {
  focused = null;
  barEl.classList.remove('open');
  room?.lighting?.setFocus(null);          // 退出追光：外围光缓动回常规布光
  for (const r of rigs.values()) r.setFocus?.(false);
  if (savedOrbit) { startCamTween(null, null, savedOrbit); savedOrbit = null; }
}

/** 开发用结果：?tier= 强制档位、?symbols=0,2,4 强制落面（默认随机）。 */
const tier = params.get('tier') ?? 'random';
function devOutcome() {
  const t = tier === 'random'
    ? (Math.random() < 0.18 ? 'major' : (Math.random() < 0.55 ? 'minor' : 'none'))
    : tier;
  const symParam = params.get('symbols');
  const symbols = symParam
    ? symParam.split(',').map(Number).filter(Number.isInteger)
    : null;
  return { tier: t, symbols };
}

// 相机补间：把「期望机位」反解成轨道参数（保持 orbit 模型不变）
function startCamTween(desired, target, override = null) {
  const from = { az: orbit.az, el: orbit.el, dist: orbit.dist, target: orbit.target.clone() };
  let to;
  if (override) {
    to = { az: override.az, el: override.el, dist: override.dist, target: override.target.clone() };
  } else {
    const dir = desired.clone().sub(target);
    to = {
      az: Math.atan2(dir.x, dir.z),
      el: Math.asin(Math.max(-0.99, Math.min(0.99, dir.y / dir.length()))),
      dist: Math.max(12, dir.length()),
      target: target.clone(),
    };
  }
  camTween.from = from;
  camTween.to = to;
  camTween.t = 0;
  camTween.active = true;
}

function stepCamTween(dt) {
  if (!camTween.active) return;
  camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
  const k = 1 - Math.pow(1 - camTween.t, 3);
  orbit.az = camTween.from.az + (camTween.to.az - camTween.from.az) * k;
  orbit.el = camTween.from.el + (camTween.to.el - camTween.from.el) * k;
  orbit.dist = camTween.from.dist + (camTween.to.dist - camTween.from.dist) * k;
  orbit.target.lerpVectors(camTween.from.target, camTween.to.target, k);
  if (camTween.t >= 1) camTween.active = false;
}

barBack.addEventListener('click', unfocusMachine);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focused) unfocusMachine(); });

function clearAnchors() {
  for (const el of anchorLayer) el.remove();
  anchorLayer.length = 0;
}

function rebuild() {
  const recipeId = selector.value;
  const seed = seedInput.value || 'demo';
  const recipe = RECIPES[recipeId];
  if (room) { scene.remove(room.group); room = null; }
  if (composer) { composer.dispose?.(); composer = null; }
  clearAnchors();

  applyLightingTune(recipe);
  room = composeRoom(recipeId, seed);           // 契约对象 { group, update, moonlight, recipe, grading, placements }
  scene.add(room.group);
  // 特殊色调（grading 契约）：曝光恒生效；tint 走 composer 合成
  // 色调映射：?tm=none|neutral|aces|reinhard 覆盖，?exp= 再乘一档曝光（A/B 用）
  const tmMode = params.get('tm') || DEFAULT_TONE_MODE;
  const tmExp = (room.grading?.exposure ?? 1) * (Number(params.get('exp')) || 1);
  // 雾：配方处方优先
  const fogDef = room.recipe?.fog;
  scene.fog = fogDef
    ? new THREE.Fog(fogDef.color, fogDef.near, fogDef.far)
    : new THREE.Fog(0x070a12, 165, 310);
  if (room.moonlight && typeof renderer.setRenderTarget === 'function' && !params.has('nocomposer')) {
    composer = createVolumetricMoonlight({ light: room.moonlight, tint: room.grading?.tint });
    composer.resize(window.innerWidth, window.innerHeight);
  }
  applyToneMapping(renderer, composer, tmMode, tmExp);
  // bloom 旋钮：?bloom=强度 &bthr=阈值 &bknee=软膝 &brad=半径（缺省不动 = 用烘焙值）
  const numKnob = (k) => (params.has(k) ? Number(params.get(k)) : undefined);
  composer?.setBloom({
    strength: numKnob('bloom'),
    threshold: numKnob('bthr'),
    knee: numKnob('bknee'),
    radius: numKnob('brad'),
  });

  // ---- 可动组件：建 rig + 悬浮标记 ----
  rigs.clear();
  markerRings.length = 0;
  for (const [name, entry] of room.interactives ?? new Map()) {
    const rig = entry.kind === 'slot'
      ? createSlotMachineRig({ object: entry.object, parts: entry.parts })
      : entry.kind === 'vending'
        ? createVendingMachineRig({ object: entry.object, parts: entry.parts })
        : createBankMachineRig({ object: entry.object, parts: entry.parts });
    rigs.set(name, rig);
    // 计数器初次同步（正式流程里在面板打开/数据变化时调用）
    if (name === 'slot') rig.setDevour?.({ progress: devourProgress, every: DEVOUR_EVERY, ready: devourReady() });
    // 售货机：陈列一份**样例货架**（真实数据来自 panelSnapshot.snap.shop；这里是视觉门）——
    // 故意混一件"买不起"的（价格标红）与一件遗物（走遗物立绘）
    if (entry.kind === 'vending') {
      rig.setStock?.([
        { index: 0, kind: 'relic', name: '塔的馈赠', price: 30, sold: false, affordable: true },
        { index: 1, kind: 'potion', name: '恢复药剂', price: 20, sold: false, affordable: true },
        { index: 2, kind: 'pack', name: '体修卡包', price: 28, sold: false, affordable: true },
        { index: 3, kind: 'relic', name: '光滑小圆盾', price: 55, sold: false, affordable: false },
      ]);
      rig.setDisplay?.('余额 30');
    }
    // 头顶浮标 = **一枚跳动的发光箭头**（与正式房间同一件对象；用户定 2026-09-12：
    // 去掉地面光环与光柱，只留箭头）——⚠ 底在房间地平（FLOOR_Y），箭尖指着机器顶
    const topY = new THREE.Box3().setFromObject(entry.object).max.y;
    const marker = new MachineMarkerObject({ size: Math.max(1, entry.scale * 0.52) });
    marker.position.set(entry.x, FLOOR_Y + Math.max(4, topY - FLOOR_Y + 1.3), entry.z);
    room.group.add(marker);
    markerRings.push({ name, marker, entry });
  }
  focused = null;
  barEl.classList.remove('open');

  const placements = room.placements || [];
  const fires = placements.filter(p => p.tags.some(t => t === 'lightSource' || t === 'fire'));
  const lamps = placements.filter(p => p.tags.includes('lamp'));
  let lights = 0;
  room.group.traverse(o => { if (o.isPointLight) lights += 1; });
  info.textContent = `${recipeId} · seed=${seed} ｜ 摆位 ${placements.length}`
    + `（落地 ${placements.filter(p => !p.onWall && !p.hosted && !p.floating).length}`
    + `/墙面 ${placements.filter(p => p.onWall).length}`
    + `/顶挂 ${placements.filter(p => p.floating).length}）`
    + `｜ 火位 ${fires.length} ｜ 灯锚 ${lamps.length} ｜ 点光 ${lights}`;

  // 安全区比例：配方声明优先，?ui= 覆盖（0 = 关闭）
  const uiParam = params.has('ui') ? Number(params.get('ui')) : null;
  const ratio = uiParam ?? recipe.anchors?.uiSafe?.bottomRatio ?? 0.42;
  safeEl.style.display = ratio > 0 ? 'block' : 'none';
  safeEl.style.height = `${Math.round(ratio * 100)}%`;

  // 锚点标记
  if (params.get('anchors') !== '0' && recipe.anchors) {
    for (const [key, a] of Object.entries(recipe.anchors)) {
      if (key === 'uiSafe' || a?.x == null) continue;
      const el = document.createElement('div');
      el.className = 'anchor-pin';
      el.innerHTML = `<b>${key}<br>(${a.x}, ${a.z})</b>`;
      document.body.appendChild(el);
      anchorLayer.push(el);
    }
  }
  syncAnchorPins();
}

/** 把锚点世界坐标投影到屏幕（每帧刷新，拖动相机时标记跟随）。 */
function syncAnchorPins() {
  if (!anchorLayer.length || !room) return;
  const recipe = RECIPES[selector.value];
  const names = Object.entries(recipe?.anchors ?? {}).filter(([k, a]) => k !== 'uiSafe' && a?.x != null);
  const world = new THREE.Vector3();
  names.forEach(([, a], i) => {
    const el = anchorLayer[i];
    if (!el) return;
    world.set(a.x, 12, a.z).project(camera);
    el.style.left = `${((world.x * 0.5) + 0.5) * window.innerWidth}px`;
    el.style.top = `${((-world.y * 0.5) + 0.5) * window.innerHeight}px`;
    el.style.display = world.z > 1 ? 'none' : 'block';
  });
}

// ---- 相机控制（与 roomGallery 同款：拖拽旋转 / 滚轮缩放；?orbit=1 时鼠标控制，否则静态机位）----
const freeOrbit = params.get('orbit') === '1';
let dragging = false;
let last = { x: 0, y: 0 };
let downAt = null;
canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  if (!freeOrbit) return;
  dragging = true; last = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  dragging = false;
  // 点击（无明显拖动）→ 命中机器就聚焦
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
    // 怼脸时优先打**机器正面的粉碎口热区**（远景点机身仍是"聚焦"，两者不混）
    const cz = pickCrusher(e.clientX, e.clientY);
    if (cz) {
      if (cz === 'crusher') {
        if (!runCrush()) {
          const el = document.getElementById('bar-devour');
          if (el) el.textContent = `粉碎口还闭着——还需要 ${DEVOUR_EVERY - devourProgress} 次拉杆`;
        }
      } else {
        const el = document.getElementById('bar-devour');
        if (el) el.textContent = `摇杆次数 ${devourProgress}/${DEVOUR_EVERY}（点左边的投料口粉碎）`;
      }
      downAt = null;
      return;
    }
    const hit = pickMachine(e.clientX, e.clientY);
    if (hit) focusMachine(hit);
    else if (focused && !e.target.closest('#machine-bar')) unfocusMachine();
  }
  downAt = null;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) {
    if (focused === 'slot') {
      const cz = pickCrusher(e.clientX, e.clientY);
      if (cz) { canvas.style.cursor = 'pointer'; return; }
    }
    if (!focused) setHovered(pickMachine(e.clientX, e.clientY));
    return;
  }
  orbit.az -= (e.clientX - last.x) * 0.005;
  orbit.el = Math.min(1.2, Math.max(-0.1, orbit.el - (e.clientY - last.y) * 0.004));
  last = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('wheel', (e) => {
  if (!freeOrbit) return;
  orbit.dist = Math.min(420, Math.max(60, orbit.dist + e.deltaY * 0.12));
}, { passive: true });
selector.addEventListener('change', rebuild);
document.getElementById('rebuild').addEventListener('click', rebuild);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.resize?.(w, h);
}
window.addEventListener('resize', resize);
resize();
rebuild();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  camera.position.set(
    orbit.target.x + orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az),
    orbit.target.y + orbit.dist * Math.sin(orbit.el),
    orbit.target.z + orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az),
  );
  camera.lookAt(orbit.target);
  room?.update(dt, null, camera.position);
  for (const rig of rigs.values()) rig.update(dt);
  // 浮标：跳动的发光箭头（hover / 聚焦的那台更亮更大）
  for (const m of markerRings) {
    m.marker?.setHighlight?.(m.hover || m.name === focused);
    m.marker?.update?.(dt);
  }
  stepCamTween(dt);
  syncAnchorPins();
  if (composer) composer.render(renderer, scene, camera);
  else renderer.render(scene, camera);
  window.__ready = true;
});

// 调试探针（隔离渲染诊断）
window.__scene = scene;
window.__camera = camera;
window.__THREE = THREE;
window.__roomRef = () => room;
window.__rebuild = rebuild;
window.__gallery = { scene, renderer, camera };
// 调试/迭代句柄：直接聚焦某台机器、直接驱动 rig（无需用鼠标点 canvas）
window.__focus = (name) => focusMachine(name);
window.__unfocus = unfocusMachine;
window.__rigs = rigs;
window.__pull = (outcome) => rigs.get('slot')?.pull(outcome ?? devOutcome());
// 粉碎入口：__devour(n) 直接设进度（0..7），__crush() 播一次粉碎演出（进度满才生效）
window.__devour = (n = DEVOUR_EVERY) => { devourProgress = Math.max(0, Math.min(DEVOUR_EVERY, n)); syncDevour(); };
window.__crush = () => runCrush();
// 直接落机位（迭代视觉时用来推近看局部，免去拖 canvas / 裁剪猜坐标）：
// __orbitTo(x, y, z, dist, az, el)——省略某参即保持原值；az/el 用弧度。
window.__orbitTo = (x, y, z, dist, az, el) => {
  if (x != null) orbit.target.set(x, y, z);
  if (Number.isFinite(dist)) orbit.dist = dist;
  if (Number.isFinite(az)) orbit.az = az;
  if (Number.isFinite(el)) orbit.el = el;
  camTween.active = false;
};
