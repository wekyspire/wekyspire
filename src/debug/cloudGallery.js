// 雪云陈列页（2026-09-16 用户定：塔楼层大气渲染的浏览器视觉门）：
// 完整 towerWilderness 环境（天空穹 + 雪云体积层 + 雪原 + 急迫斜雪）+ 自由相机，
// 云下仰望 / 云内环视外望 / 云上俯瞰三预设（TOWER.md 四阶段相对关系）+ 调参 knob。
// 纯 dev 工具，不进构建、不写测试。打开：npm run dev 后访问 /cloudGallery.html。

import * as THREE from 'three';
import { buildTowerWilderness } from '../stage/scenes/towerWilderness.js';

const params = new URLSearchParams(location.search);

const canvas = document.createElement('canvas');
canvas.id = 'cloud-canvas';
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
window.__scene = scene; // 调试探针：隔离渲染诊断

// 完整荒原环境（穹顶内嵌云层 RT pass，onBeforeRender 自动接本页相机/渲染器）
const wild = buildTowerWilderness();
scene.add(wild.group);
scene.fog = wild.fog;
window.__clouds = wild.clouds; // 控制台探针：clouds.params / syncParams()
window.__wild = wild;          // 控制台探针：环境件（雾/雪盒/穹顶/灯）
window.__renderer = renderer;  // 控制台探针：像素回读复渲染用

const camera = new THREE.PerspectiveCamera(Number(params.get('fov')) || 40, 1, 0.1, 4000);
window.__camera = camera; // 控制台探针：像素回读复渲染用

// ---- 自由轨道相机（roomGallery 同范式 + 高度自由：云层是"高度"的艺术）----
const orbit = { az: -0.59, el: 0.12, dist: 120, target: new THREE.Vector3(0, -20, 0) };
function applyCamera() {
  const { az, el, dist, target } = orbit;
  camera.position.set(
    target.x + Math.sin(az) * Math.cos(el) * dist,
    target.y + Math.sin(el) * dist,
    target.z + Math.cos(az) * Math.cos(el) * dist,
  );
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}
const PRESETS = {
  under:  { az: -0.59, el: -0.35, dist: 70,  target: [0, 4, 0] },   // 云下仰望（一阶段观感）
  inside: { az: -0.4,  el: -0.05, dist: 40,  target: [0, 95, 0] },  // 云内环视（二三章，板 18..174）
  above:  { az: -0.59, el: 0.55,  dist: 250, target: [0, 60, 0] },  // 云上俯瞰（四阶段）
  tower:  { az: -0.59, el: -0.16, dist: 60,  target: [58, -30, -10] }, // 塔楼机位（取景参照）
};
function preset(name) {
  const p = PRESETS[name];
  if (!p) return;
  orbit.az = p.az; orbit.el = p.el; orbit.dist = p.dist;
  orbit.target.set(...p.target);
  applyCamera();
}
document.getElementById('preset-under').onclick = () => preset('under');
document.getElementById('preset-inside').onclick = () => preset('inside');
document.getElementById('preset-above').onclick = () => preset('above');
document.getElementById('preset-tower').onclick = () => preset('tower');

// ---- 拖拽/滚轮 ----
let dragging = false;
let px = 0, py = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.az -= (e.clientX - px) * 0.005;
  orbit.el = Math.min(1.45, Math.max(-1.45, orbit.el + (e.clientY - py) * 0.005));
  px = e.clientX; py = e.clientY;
  applyCamera();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey) orbit.target.y += e.deltaY * 0.05; // 升降：探云板上下
  else orbit.dist = Math.min(600, Math.max(6, orbit.dist * (1 + e.deltaY * 0.001)));
  applyCamera();
}, { passive: false });

// ---- 调参 knob（直接落 clouds.params + syncParams / 雪花 uniforms）----
const KNOBS = [
  ['coverage', '覆盖度', 0, 1, 0.01],
  ['density', '消光密度', 0.1, 3, 0.05],
  ['scale', 'worley单元尺度', 20, 140, 1],
  ['stepSize', '步长', 2, 20, 0.5],
  ['steps', '步数上限', 8, 64, 1],
  ['haze', '云雾等效密度', 0, 0.012, 0.0002],
  ['underShade', '云下压暗', 0.3, 1, 0.02],
  ['sun', '银边强度', 0, 2, 0.05],
  ['windX', '风x', -20, 20, 0.5],
  ['windZ', '风z', -20, 20, 0.5],
  ['detailAmt', '细节侵蚀', 0, 1, 0.05],
  ['detailFreq', '侵蚀频率', 0.02, 0.4, 0.01],
  ['warpAmt', '域扭曲幅度', 0, 40, 1],
  ['warpFreq', '扭曲频率', 0.005, 0.12, 0.001],
  ['gustBoost', '云内阵风', 1, 5, 0.1],
  ['innerStep', '云内步长倍率', 0.2, 1, 0.05],
  ['lanternIntensity', '测试灯强度', 0, 150, 5],
  ['lanternDist', '测试灯距离', 5, 80, 1],
  ['nearFadeStart', '近机减淡起点', 0, 30, 1],
  ['nearFadeEnd', '近机减淡终点', 10, 120, 5],
  ['nearFadeAmt', '近场残余密度', 0, 1, 0.05],
  ['timeScale', '时间倍率', 0, 6, 0.1],
];
const knobs = document.getElementById('cloud-knobs');
const state = { timeScale: 1 };
for (const [key, label, min, max, step] of KNOBS) {
  const row = document.createElement('label');
  const val = document.createElement('span');
  val.className = 'val';
  row.append(`${label} `);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step;
  input.value = wild.clouds.params[key] ?? state[key] ?? 0;
  val.textContent = ` ${input.value}`;
  input.oninput = () => {
    const v = Number(input.value);
    val.textContent = ` ${v}`;
    if (key === 'timeScale') state.timeScale = v;
    else { wild.clouds.params[key] = v; wild.clouds.syncParams(); }
  };
  row.append(input, val);
  knobs.append(row);
}
// 雪花调参（速度感三件套）
const SNOW_KNOBS = [
  ['uStormAmt', '雪相配方(0平静/1风暴)', 0, 1, 0.05],
  ['uFall', '雪下落基准(storm)', 2, 40, 1],
  ['uStretch', '雪拉伸增益', 0, 2, 0.05],
  ['uStormX', '雪斜风x', -20, 20, 0.5],
];
const snowU = (() => {
  // 从场景取雪花 uniforms（名字约定 'snowfall'）
  const mesh = wild.group.getObjectByName('snowfall');
  return mesh ? mesh.material.uniforms : null;
})();
for (const [key, label, min, max, step] of SNOW_KNOBS) {
  if (!snowU) break;
  const row = document.createElement('label');
  const val = document.createElement('span');
  val.className = 'val';
  row.append(`${label} `);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step;
  const uKey = key === 'uStormX' ? 'uStorm' : key;
  input.value = key === 'uStormX' ? snowU.uStorm.value.x : snowU[uKey].value;
  val.textContent = ` ${input.value}`;
  input.oninput = () => {
    const v = Number(input.value);
    val.textContent = ` ${v}`;
    if (key === 'uStormX') snowU.uStorm.value.x = v;
    else snowU[uKey].value = v;
  };
  row.append(input, val);
  knobs.append(row);
}

// ---- 主循环 ----
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
const info = document.getElementById('cloud-info');
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  wild.setAnchorY(camera.position.y); // 雪盒跟相机高度（游戏内由 MapStage 按层驱动）
  wild.update(dt * state.timeScale); // 云 advect + 雪 uTime（时间倍率=风的快慢）
  wild.clouds.composeFrame({ renderer, scene, camera }); // mesh→云 march→合成（与游戏同管线）
  // renderer.render(scene, camera); // 旧直渲路径（无云管线的对照位，排查时切回）
  fpsAcc += dt; fpsN += 1; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    info.textContent = `fps ${Math.round(fpsN / fpsAcc)} ｜ RT ${(renderer.getDrawingBufferSize(new THREE.Vector2()).x / 4) | 0}×${(renderer.getDrawingBufferSize(new THREE.Vector2()).y / 4) | 0}`;
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }
  requestAnimationFrame(tick);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
preset('under'); // 初始：云下仰望（一阶段观感）
requestAnimationFrame(tick);
