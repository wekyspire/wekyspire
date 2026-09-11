// 房型陈列页（SCENE_TASKS P3 出口标准的视觉门）：三配方 × 任意种子房间陈列，
// 相机默认取战斗机位（fov24 / azimuth +34° / elevation 20° / lookAt(0,-15,0)），
// 肉眼验收三型差异 + keepout + 密度。纯 dev 工具，不进构建、不写测试。
// 打开：npm run dev 后访问 /roomGallery.html?recipe=ch1&seed=demo。

import * as THREE from 'three';
import { composeRoom } from '../stage/scenes/rooms/composeRoom.js';
import { RECIPES } from '../stage/scenes/rooms/presets.js';
import { DUNGEON } from '../stage/scenes/dungeon.js';
import { createVolumetricMoonlight } from '../stage/scenes/volumetricMoon.js';
import { LIGHTING_PRESETS } from '../stage/scenes/rooms/lighting.js';

const params = new URLSearchParams(location.search);

// ---- 布光实时调参（A/B 诊断/与用户共调）：?hemi= &moon= &fill= &ba= &bb= &glow= &glowd=
// &cf= &cfd= &fire= &fired= ——直接覆盖当前配方布光预设的对应字段，焙入 presets 前先在这找数。
function applyLightingTune() {
  const preset = LIGHTING_PRESETS[RECIPES[document.getElementById('recipe-select').value]?.lighting];
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
}

const canvas = document.createElement('canvas');
canvas.id = 'room-canvas';
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
window.__scene = scene; // 调试探针：隔离渲染诊断
scene.background = new THREE.Color(0x060a14);
scene.fog = new THREE.Fog(0x060a14, 165, 310); // 战斗雾口径

// 战斗机位（StageManager 世界相机参数 + CAMERA_ZOOM 0.79；与战斗内所见一致）。
// dist 可用 ?dist= 覆盖（观评估）。
const camera = new THREE.PerspectiveCamera(24, 1, 1, 900);
const orbit = {
  az: 0.593, el: 0.349,
  dist: Number(new URLSearchParams(location.search).get('dist')) || 185.8,
  target: new THREE.Vector3(0, -15, 0),
};

let room = null;
let composer = null; // 体积月光 composer（BattleStage 同口径：有投影月光即接管世界 pass）

function disposeRoom() {
  if (!room) return;
  composer?.dispose();
  composer = null;
  room.group.traverse(o => {
    o.geometry?.dispose?.();
    // kit 族单例禁 dispose；场景自有材质（skydome/moonDust shader 等）随场景释放
    if (o.material && !o.material.userData?.kitFamily) o.material.dispose?.();
  });
  scene.remove(room.group);
  room = null;
}

function build(recipeId, seed) {
  disposeRoom();
  applyLightingTune();
  if (recipeId === 'dungeon') {
    room = DUNGEON.build3D(); // 对照组：手工大厅（同管线渲染，隔离变量）
    document.getElementById('room-info').textContent = 'dungeon · 手工大厅对照';
  } else {
    room = composeRoom(recipeId, seed);
    const fires = room.placements.filter(p => p.tags.some(t => t === 'lightSource' || t === 'fire'));
    document.getElementById('room-info').textContent =
    `${recipeId} · seed=${seed} ｜ 摆位 ${room.placements.length}（落地 ${
      room.placements.filter(p => !p.onWall && !p.hosted && !p.floating).length
    }/墙面 ${room.placements.filter(p => p.onWall).length}/顶挂 ${
      room.placements.filter(p => p.floating).length
    }）｜ 火源 ${fires.length} ｜ 点光 ${countLights(room.group)}`;
  }
  scene.add(room.group);
  // 特殊色调（grading 契约）：曝光倍率恒生效；tint 走 composer 合成（nocomposer 调试路径无色调）
  const grading = room.grading;
  renderer.toneMappingExposure = grading?.exposure ?? 1;
  // 雾：配方处方优先（BattleStage 缺省 165/310，火把章需远推），否则战斗缺省
  const fogDef = room.recipe?.fog;
  scene.fog = fogDef
    ? new THREE.Fog(fogDef.color, fogDef.near, fogDef.far)
    : new THREE.Fog(0x060a14, 165, 310);
  if (room.moonlight && typeof renderer.setRenderTarget === 'function'
      && !new URLSearchParams(location.search).has('nocomposer')) {
    composer = createVolumetricMoonlight({ light: room.moonlight, tint: grading?.tint });
    composer.resize(window.innerWidth, window.innerHeight);
  }
  window.__ready = false;
}

function countLights(group) {
  let n = 0;
  group.traverse(o => { if (o.isPointLight) n++; });
  return n;
}

function applyCamera() {
  const ce = Math.cos(orbit.el), se = Math.sin(orbit.el);
  camera.position.set(
    orbit.target.x + orbit.dist * ce * Math.sin(orbit.az),
    orbit.target.y + orbit.dist * se,
    orbit.target.z + orbit.dist * ce * Math.cos(orbit.az),
  );
  camera.lookAt(orbit.target);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  composer?.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// ---- 交互：拖拽旋转 + 滚轮缩放 ----
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  orbit.az -= (e.clientX - lastX) * 0.004;
  orbit.el = THREE.MathUtils.clamp(orbit.el + (e.clientY - lastY) * 0.003, 0.1, 1.4);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.08), 60, 520);
}, { passive: false });

// ---- 配方/种子选择 ----
const recipeSelect = document.getElementById('recipe-select');
for (const name of [...Object.keys(RECIPES), 'dungeon']) {
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name;
  recipeSelect.appendChild(opt);
}
const seedInput = document.getElementById('seed-input');
recipeSelect.value = params.get('recipe') || 'fortress';
seedInput.value = params.get('seed') || 'demo';
recipeSelect.addEventListener('change', () => build(recipeSelect.value, seedInput.value || 'demo'));
document.getElementById('rebuild').addEventListener('click', () => build(recipeSelect.value, seedInput.value || 'demo'));

build(recipeSelect.value, seedInput.value || 'demo');
resize();
window.__gallery = { scene, renderer, camera }; // 调试句柄（Playwright 诊断用）

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  room?.update(dt, null, camera.position);
  applyCamera();
  if (composer) composer.render(renderer, scene, camera);
  else renderer.render(scene, camera);
  window.__ready = true;
});

// 调试探针：隔离渲染诊断（声明全部完成之后）
window.__camera = camera;
window.__THREE = THREE;
window.__roomRef = () => room; // 调试探针：摆位表
