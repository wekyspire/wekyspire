// 道具陈列页（SCENE_TASKS T1.4 / WORKFLOW §7 门 2）：全部已登记道具网格陈列 + id 标签
// + palette 主题切换，浏览器过目即视觉验收。纯 dev 工具，不进构建产物、不写测试。
// 打开：npm run dev 后访问 /propGallery.html。

import * as THREE from 'three';
import { propRegistry } from '../stage/scenes/props/index.js';
import { P, PALETTES, setTheme, getTheme, shade } from '../stage/scenes/kit/palette.js';
import { box, plate } from '../stage/scenes/kit/primitives.js';
import { createRng } from '../stage/scenes/kit/scatter.js';
import { familyMaterial } from '../stage/scenes/kit/materials.js';

const CELL = 12;          // 陈列格边长（世界单位）
const WALL_CLASSES = new Set(['wallDecor', 'wallStructure', 'roomWall']);

const canvas = document.createElement('canvas');
canvas.id = 'gallery-canvas';
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090f);
scene.fog = new THREE.Fog(0x07090f, 120, 420);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1200);
const orbit = { yaw: -0.5, pitch: 0.62, dist: 60, target: new THREE.Vector3() };

// ---- 灯光：冷调基调（同战斗场景的语言：冷主光 + 保底环境光；验收页略提亮） ----
scene.add(new THREE.HemisphereLight(0x5a6a8e, 0x24242e, 2.0));
const key = new THREE.DirectionalLight(0x9db4ec, 3.2);
key.position.set(60, 90, 70);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -140; key.shadow.camera.right = 140;
key.shadow.camera.top = 140; key.shadow.camera.bottom = -140;
key.shadow.camera.far = 400;
scene.add(key);
const fill = new THREE.DirectionalLight(0x8496c4, 0.85);
fill.position.set(-70, 40, 30);
scene.add(fill);

// ---- 陈列构建 ----
let propRoot = null;

function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '600 44px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(4, 6, 12, 0.92)'; ctx.lineWidth = 9;
  ctx.strokeText(text, 256, 50);
  ctx.fillStyle = '#cfd8e3';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false }));
  sp.scale.set(9, 1.7, 1);
  return sp;
}

function disposeRoot(root) {
  root.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material?.map) o.material.map.dispose();
    if (o.material?.userData?.kitLegacyClone) o.material.dispose(); // 族单例禁 dispose，克隆才释放
  });
  scene.remove(root);
}

function buildGallery() {
  if (propRoot) disposeRoot(propRoot);
  propRoot = new THREE.Group();
  propRoot.name = 'propGallery';

  const defs = [...propRegistry.values()]
    .sort((a, b) => a.place.localeCompare(b.place) || a.id.localeCompare(b.id));
  const cols = Math.max(3, Math.ceil(Math.sqrt(defs.length * 1.7)));
  const matPlate = familyMaterial('stone', { color: shade(P.slab, -0.22) });
  const matWall = familyMaterial('stone', { color: shade(P.wall, -0.12) });

  defs.forEach((def, i) => {
    const cx = (i % cols) - (cols - 1) / 2;
    const cz = Math.floor(i / cols) - (Math.ceil(defs.length / cols) - 1) / 2;
    const cell = new THREE.Group();
    cell.position.set(cx * CELL, 0, cz * CELL);

    // 格底板（读比例的参照）+ 挂墙类补一片背墙
    const pad = plate({ color: shade(P.slab, -0.25), w: CELL - 1.2, d: CELL - 1.2, th: 0.3 });
    pad.material = matPlate;
    pad.receiveShadow = true;
    cell.add(pad);

    const built = def.build({ rng: createRng(`gallery:${def.id}`) });
    built.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // 居中到格子（挂墙类沿 z 贴背墙）
    const bb = new THREE.Box3().setFromObject(built);
    const offX = -(bb.min.x + bb.max.x) / 2;
    const offZ = WALL_CLASSES.has(def.place) ? -bb.min.z : -(bb.min.z + bb.max.z) / 2;
    built.position.set(offX, 0, offZ);
    cell.add(built);
    if (WALL_CLASSES.has(def.place)) {
      const wall = box({ color: shade(P.wall, -0.1), size: [CELL - 1.5, CELL - 1.5, 0.8] });
      wall.material = matWall;
      wall.position.set(0, (CELL - 1.5) / 2, -1.2);
      cell.add(wall);
    }

    const bb2 = new THREE.Box3().setFromObject(built);
    const label = labelSprite(def.id);
    label.position.set(0, Math.max(6, bb2.max.y + 2.2), 0);
    cell.add(label);
    propRoot.add(cell);
  });

  scene.add(propRoot);
  // 相机自动取距：按陈列盘对角线
  const size = new THREE.Box3().setFromObject(propRoot).getSize(new THREE.Vector3());
  orbit.dist = Math.max(46, Math.hypot(size.x, size.z) * 0.62);
  orbit.target.set(0, 2, 0);
  document.getElementById('gallery-count').textContent =
    `${defs.length} 件已登记 ｜ 分组排列：place 类别`;
}

function applyCamera() {
  const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
  camera.position.set(
    orbit.target.x + orbit.dist * cp * Math.sin(orbit.yaw),
    orbit.target.y + orbit.dist * sp,
    orbit.target.z + orbit.dist * cp * Math.cos(orbit.yaw),
  );
  camera.lookAt(orbit.target);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---- 交互：拖拽旋转 + 滚轮缩放（陈列验收用的最小轨道控制） ----
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - lastY) * 0.004, 0.12, 1.45);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.09), 14, 400);
}, { passive: false });

// ---- 主题切换 ----
const select = document.getElementById('theme-select');
for (const name of Object.keys(PALETTES)) {
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name;
  select.appendChild(opt);
}
select.value = getTheme();
select.addEventListener('change', () => { setTheme(select.value); buildGallery(); });

buildGallery();
resize();
renderer.setAnimationLoop(() => {
  applyCamera();
  renderer.render(scene, camera);
});
