// 战斗特效预览台（fxGallery.html 主逻辑）：一章敌人演出的点播工作台——
// 真战场环境（同 composeRoom 场景 + 战斗机位 + 月光 composer + GPU 粒子池）
// 里隔离播放：起手族模板 / 形体件 / 逐敌逐拍真实分发 / 命中三式+主题 /
// 生死拍（unitBeats 真代码 mixin）/ aura 主题。附带主题战生成器（saveForge 链路
// 跳真实战斗）。纯 dev 工具，不进构建、不写测试。
// 打开：npm run dev 后访问 /fxGallery.html

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { composeRoom } from '../stage/scenes/rooms/composeRoom.js';
import { createVolumetricMoonlight } from '../stage/scenes/volumetricMoon.js';
import { applyToneMapping, DEFAULT_TONE_MODE } from '../stage/post/passes.js';
import { getScene, slotTransform } from '../stage/scenes/index.js';
import { UnitObject } from '../stage/objects/UnitObject.js';
import { StageAnimator, gsapTween } from '../stage/animator/StageAnimator.js';
import { ScreenShake } from '../stage/objects/screenImpactFX.js';
import { Cast } from '../stage/fx/cast.js';
import { runScript } from '../stage/fx/script.js';
import { createParticlePool } from '../stage/fx/gpu/particlePool.js';
import { createBurstFacade } from '../stage/fx/gpu/burstFx.js';
import { sharedUnitArtCache } from '../stage/art/unitArt.js';
import { resolveUnitAuras } from '../stage/fx/recipes.js';
import { AuraHost } from '../stage/fx/aura.js';
import { getScript } from '../stage/fx/scripts/index.js';
import { runEnemyHitBeat, resolveEnemyHitFx } from '../stage/fx/spells/enemyHitFx.js';
import { enemySpawnGarnishOf, enemyDeathBeatOf } from '../stage/fx/enemyLifeFx.js';
import { unitBeats } from '../stage/stages/battleBeats/units.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y, UI_CAMERA_Z } from '../stage/StageManager.js';
// core 侧（敌人注册表 + 逻辑偶——逐拍枚举读 getIntention）
import '../core/content/index.js';
import { allEnemies, getEnemyDefinition } from '../core/enemies/registry.js';

// ============ 渲染底座（roomGallery 同骨架） ============
const canvas = document.createElement('canvas');
canvas.id = 'fx-canvas';
document.body.appendChild(canvas);

const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a14);
const uiScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(24, 1, 1, 900);
const orbit = { az: 0.593, el: 0.349, dist: 185.8, target: new THREE.Vector3(0, -15, 0) };
const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
uiCamera.position.set(0, UI_CAMERA_LOOK_AT_Y, UI_CAMERA_Z);
uiCamera.lookAt(0, UI_CAMERA_LOOK_AT_Y, 0);

// 战场场景（章1 战斗房型 + 月光 composer——与 BattleStage 同渲染链）
const SCENE_ID = 'fortress';
const sceneDef = getScene(SCENE_ID, 'fxgallery');
const room = composeRoom(SCENE_ID, 'fxgallery');
scene.add(room.group);
let moonComposer = null;
if (room.moonlight && typeof renderer.setRenderTarget === 'function') {
  moonComposer = createVolumetricMoonlight({ light: room.moonlight });
}
applyToneMapping(renderer, DEFAULT_TONE_MODE, room.grading?.exposure ?? 1);

// 迷你相机导演：只实现 ScreenShake 要的偏移通道（setOffset/clearOffset），
// 主循环里「轨道基位 + Σoffset」一次落笔（世界相机单一落笔源的画廊版）
const director = (() => {
  const offsets = new Map();
  const sum = new THREE.Vector3();
  return {
    setOffset(id, x = 0, y = 0, z = 0) {
      let v = offsets.get(id);
      if (!v) { v = new THREE.Vector3(); offsets.set(id, v); }
      return v.set(x, y, z);
    },
    clearOffset(id) { return offsets.delete(id); },
    sumInto(out) {
      sum.set(0, 0, 0);
      for (const v of offsets.values()) sum.add(v);
      return out.copy(sum);
    },
  };
})();

// ============ 舞台服务（BattleStage 同款能力面，缩到单场验收所需） ============
const particles2World = createParticlePool(renderer, { space: 'world', name: 'fxGalleryPool' });
if (particles2World) scene.add(particles2World.points);
const particles = createBurstFacade(particles2World, () => camera);
scene.add(particles.sprites);
uiScene.add(particles.spritesUI);
const shake = new ScreenShake({ director });
const cast = new Cast();
const animator = new StageAnimator({ tween: gsapTween });
const runFx = (fn) => runScript(fn, { animator });

// unitBeats 的舞台桩：生死拍直接跑真实方法（零拷贝复用 BattleStage 代码）
const stageStub = {
  animator, particles, cast, scene, uiScene,
  _units: new Map(),
  _cleaveSplit: new Set(),
  _enemyHitRecent: new Map(),
  _snapshot: null,
  _fxRunScript: runFx,
  _spellDeps: () => ({ scene, uiScene, particles, cast, shake, notify: null, worldPool: particles2World }),
  ...unitBeats,
};

// ============ 单位（玩家 + 三敌槽；逻辑偶枚举真实意图拍） ============
const bakeLabel = null; // UnitObject 缺省烘焙（验收不需要精确读数文本）
const mkUnit = (uniqueID, side, standeeHeight = 22) => {
  const u = new UnitObject({ uniqueID, side, standeeHeight, bakeLabel });
  return u;
};
const playerView = mkUnit('p', 'player', 24);
const logicPlayer = null;
scene.add(playerView);
cast.register('role:player', playerView);

const ENEMY_SLOTS = 3;
const enemyViews = [];
const logicEnemies = [];
let focusIdx = 0; // 当前点播目标敌下标

const CH1 = allEnemies()
  .filter(d => d.getIntention && d.difficulty && (d.difficulty.floorMax ?? 0) <= 16)
  .sort((a, b) => (a.difficulty.base ?? 0) - (b.difficulty.base ?? 0));
const BOSSES = allEnemies().filter(d => d.orbs || /纵火|卡达斯|MEFM|穿山甲王|腐败之源/.test(d.name ?? ''));

function placeUnits() {
  const tr0 = slotTransform(sceneDef, 'player', 0, 1);
  playerView.position.set(tr0.x, tr0.y, tr0.z);
  playerView._baseScale = tr0.scale;
  playerView.scale.set(tr0.scale, tr0.scale, 1);
  applyArt(playerView, null, 'player');
  for (let i = 0; i < ENEMY_SLOTS; i++) {
    const tr = slotTransform(sceneDef, 'enemy', i, ENEMY_SLOTS);
    const v = enemyViews[i];
    v.position.set(tr.x, tr.y, tr.z);
    v._baseScale = tr.scale;
    v.scale.set(tr.scale, tr.scale, 1);
  }
}
function applyArt(view, defId, side) {
  const img = sharedUnitArtCache.get(defId, side, null);
  if (img && !view.hasArt) view.setArt(img);
}
function setEnemySlot(i, defId) {
  const def = getEnemyDefinition(defId);
  if (!def) return;
  const v = enemyViews[i];
  v._defId = defId;
  v.visible = true;
  v._dead = false;
  v.restoreBody();
  v.resetPose();
  v.billboard.rotation.x = 0;
  applyArt(v, defId, 'enemy');
  stageStub._units.set(v.uniqueID, v);
  cast.register(`unit:${v.uniqueID}`, v);
  logicEnemies[i] = def.createUnit();
  logicEnemies[i].actionIndex = 0;
}
function resetUnits() {
  playerView.visible = true;
  playerView._dead = false;
  playerView.restoreBody();
  playerView.resetPose();
  playerView.billboard.rotation.x = 0;
  for (let i = 0; i < ENEMY_SLOTS; i++) {
    const v = enemyViews[i];
    if (!v._defId) continue;
    const keep = v._defId;
    setEnemySlot(i, keep);
    v.setPose({ squash: 1, widen: 1, lean: 0 });
  }
  setStatus('单位已重置');
}

for (let i = 0; i < ENEMY_SLOTS; i++) {
  const v = mkUnit(`e${i}`, 'enemy', 22);
  enemyViews.push(v);
  scene.add(v);
}
setEnemySlot(0, 'slime');
setEnemySlot(1, 'mossBallA');
setEnemySlot(2, 'staticPuff');
placeUnits();
sharedUnitArtCache.addOnLoad?.(() => {
  applyArt(playerView, null, 'player');
  for (const v of enemyViews) applyArt(v, v._defId, 'enemy');
});

const focusView = () => enemyViews[focusIdx];
const focusLogic = () => logicEnemies[focusIdx];

// ============ 播放基建 ============
const statusEl = document.getElementById('fx-status');
function setStatus(text) { statusEl.textContent = text; }
const toastEl = document.getElementById('fx-toast');
let toastT = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { toastEl.style.opacity = 0; }, 1800);
}

const enemyActScript = getScript('enemyAct');
/** runScript 包一层（每拍独立协程，互不打断——验收场景要可连播对比）。 */
function runWith(fn) {
  return runFx(async (ctx) => { await fn(ctx); });
}

// 播放目录（分组渲染）。每项 = { label, run(ctx) }；run 里用 focusView() 拿目标敌。
const PREVIEWS = [];
const group = (title, items) => PREVIEWS.push({ title, items });

// ---- 起手族（families）----
const fam = await import('../stage/fx/scripts/enemies/families.js');
const A = (view) => ({ ctx: null, deps: { scene, uiScene, particles, cast, shake }, unit: view, player: playerView, kinds: [] });
// families 的拍函数收 {ctx, deps, unit, player}——ctx 要 runScript 的真 ctx，经 runWith 注入
function famPlay(maker, view = focusView()) {
  return runWith(async (ctx) => { await maker()({ ...A(view), ctx }); });
}
group('起手族 · strikeWindup（五体态）', [
  { label: 'blob 胶质压团（绿）', run: () => famPlay(() => fam.strikeWindup('blob', { color: 0x86c86a })) },
  { label: 'crouch 兽类伏低（土）', run: () => famPlay(() => fam.strikeWindup('crouch', { color: 0x9a7a52 })) },
  { label: 'crouch 重击档', run: () => famPlay(() => fam.strikeWindup('crouch', { color: 0x9a7a52, heavy: true })) },
  { label: 'rear 虫类扬头（琥珀）', run: () => famPlay(() => fam.strikeWindup('rear', { color: 0xb09060 })) },
  { label: 'hover 飞行扑翼（黄）', run: () => famPlay(() => fam.strikeWindup('hover', { color: 0xd8c088 })) },
  { label: 'lash 藤蔓预弹（绿）', run: () => famPlay(() => fam.strikeWindup('lash', { color: 0x8aba60 })) },
]);
group('起手族 · 施法/防御/发呆', [
  { label: 'spitGlob 毒液吐弹（绿）', run: () => famPlay(() => fam.spitGlob({ color: [0.35, 0.75, 0.30], hot: [0.7, 1.05, 0.55], size: 1.2 })) },
  { label: 'spitGlob 咒弹（紫）', run: () => famPlay(() => fam.spitGlob({ color: [0.62, 0.38, 0.95], hot: [0.95, 0.80, 1.30] })) },
  { label: 'chargeUp 聚能（金）', run: () => famPlay(() => fam.chargeUpFx({ color: 0xffe0a0 })) },
  { label: 'chargeUp 暴怒（红）', run: () => famPlay(() => fam.chargeUpFx({ color: 0xe0705a, orb: [1.0, 0.45, 0.3], hot: [1.4, 0.55, 0.4] })) },
  { label: 'hunker 蜷缩防御（深）', run: () => famPlay(() => fam.hunkerFx({ depth: 1.2, dustColor: 0xb8a98c })) },
  { label: 'dazeSway 发呆摇晃', run: () => famPlay(() => fam.dazeSway({})) },
  { label: 'wailFx 冰嚎（蓝环）', run: () => famPlay(() => fam.wailFx({ color: [0.62, 0.78, 0.98], rings: 4, upMotes: 10 })) },
  { label: 'wailFx 怨灵啸（紫环）', run: () => famPlay(() => fam.wailFx({ color: [0.62, 0.48, 0.90], rings: 3 })) },
  { label: 'trembleWarn 引线震颤', run: () => famPlay(() => fam.trembleWarn({})) },
]);

// ---- 形体件（fxPieces 单件）----
const fxp = await import('../stage/fx/scripts/enemies/fxPieces.js');
const chest = (v) => ({ x: v.position.x, y: v.position.y + 3.4 * (v._baseScale ?? 1), z: v.position.z });
const feet = (v) => ({ x: v.position.x, y: v.position.y + 0.6 * (v._baseScale ?? 1), z: v.position.z });
const head = (v) => ({ x: v.position.x, y: v.position.y + 4.9 * (v._baseScale ?? 1), z: v.position.z });
group('形体件（fxPieces 单件）', [
  { label: 'zapArc 电弧（毛球→玩家）', run: () => runWith(async (ctx) => {
    const a = fxp.zapArc(ctx, stageStub._spellDeps(), { from: chest(focusView()), to: chest(playerView) });
    for (let i = 0; i < 5; i++) { a.jolt(); await ctx.wait(110); }
    await a.promise;
  }) },
  { label: 'wailRing 声波环（蓝）', run: () => runWith((ctx) => fxp.wailRing(ctx, stageStub._spellDeps(), { at: head(focusView()), color: [0.62, 0.78, 0.98] })) },
  { label: 'wailRing 声波环（紫）', run: () => runWith((ctx) => fxp.wailRing(ctx, stageStub._spellDeps(), { at: head(focusView()), color: [0.62, 0.48, 0.90] })) },
  { label: 'fuseRing 引线收束圈', run: () => runWith((ctx) => fxp.fuseRing(ctx, stageStub._spellDeps(), { at: feet(focusView()), ms: 900 })) },
  { label: 'mossWave 蔓延雾锋（向玩家）', run: () => runWith((ctx) => fxp.mossWave(ctx, stageStub._spellDeps(), { at: feet(focusView()), dir: -1 })) },
  { label: 'chargeOrb 蓄能光球（金）', run: () => runWith((ctx) => fxp.chargeOrb(ctx, stageStub._spellDeps(), { at: chest(focusView()) })) },
  { label: 'chargeOrb 喉压光球（绿）', run: () => runWith((ctx) => fxp.chargeOrb(ctx, stageStub._spellDeps(), { at: chest(focusView()), color: [0.72, 0.95, 0.45], hot: [1.15, 1.35, 0.75] })) },
  { label: 'edgeSurge 剪影边光（金）', run: () => { fxp.playEdgeSurge(focusView(), 0xd8a860); toast('边光播放（约 0.6s 自清）'); } },
  { label: 'dustLanding 双层落地尘', run: () => runWith((ctx) => fxp.dustLanding(ctx, stageStub._spellDeps(), { at: feet(focusView()), count: 18, lampIntensity: 420 })) },
]);

// ---- 逐敌逐拍（真分发：enemyAct 注册表 + 真实意图枚举）----
const enemySelect = document.getElementById('fx-enemy');
function refreshEnemySelect() {
  const prev = enemySelect.value;
  enemySelect.innerHTML = '';
  for (const d of [...CH1, ...BOSSES]) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name ?? d.id}（${d.id}）`;
    enemySelect.appendChild(opt);
  }
  if (prev) enemySelect.value = prev;
}
refreshEnemySelect();
enemySelect.addEventListener('change', () => setEnemySlot(focusIdx, enemySelect.value));

/** 逐拍枚举：logic 偶走 actionIndex 0..7 读 getIntention 的 kinds（去重）。 */
function beatsOf(defId) {
  const def = getEnemyDefinition(defId);
  if (!def?.getIntention) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < 10; i++) {
    const lu = def.createUnit();
    lu.actionIndex = i;
    lu.intention = {};
    lu.getStat = () => 0;
    lu.getEffectStacks = () => 0;
    const it = def.getIntention(lu, null) ?? {};
    const kinds = it.kinds ?? ['unknown'];
    const key = kinds.join('+') + '|' + (it.note ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ i, kinds, note: it.note ?? '' });
  }
  return out;
}
// 「逐敌逐拍」目录 = 当前下拉敌人的真实拍列表（切敌人时重建）
const beatsGroupEl = { items: [] };
group('逐敌逐拍（当前目标敌 · 真分发）', beatsGroupEl.items);
function rebuildBeats() {
  beatsGroupEl.items.length = 0;
  const id = enemySelect.value;
  for (const b of beatsOf(id)) {
    beatsGroupEl.items.push({
      label: `拍${b.i} ${b.kinds.join('+')}${b.note ? ' · ' + b.note : ''}`,
      run: () => {
        // 快照意图（resolveEnemyHitFx 与分发都读它）：手动置 _snapshot
        stageStub._snapshot = {
          enemies: [{ uniqueID: focusView().uniqueID, intention: { kinds: b.kinds, hits: 1, damage: 8 } }],
          player: { uniqueID: 'p' },
        };
        return runWith(async (ctx) => {
          await enemyActScript({
            ctx,
            args: { unit: focusView().uniqueID, kinds: b.kinds, hits: 1 },
            cast, particles, shake,
            unitById: (x) => (x === focusView().uniqueID ? focusView() : null),
            scene, uiScene,
          });
        });
      },
    });
  }
  renderGroups();
}

// ---- 命中三式 + 主题 ----
group('命中三式（受击者 = 玩家）', [
  { label: 'normal 普攻撞击', run: () => runWith(async (ctx) => {
    stageStub._snapshot = { enemies: [{ uniqueID: focusView().uniqueID, intention: { kinds: ['attack'], hits: 1, damage: 7 } }] };
    const fx = resolveEnemyHitFx(stageStub, { source: { side: 'enemy', defId: focusView()._defId, uniqueID: focusView().uniqueID }, type: 'major' }, 7, { damage: 7, hits: 1 });
    await runEnemyHitBeat(ctx, stageStub._spellDeps(), { fx, unit: playerView, dealt: 7, swing: 7, fromX: focusView().position.x });
  }) },
  { label: 'rapid 连击小快', run: () => runWith(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      const fx = resolveEnemyHitFx(stageStub, { source: { side: 'enemy', defId: focusView()._defId, uniqueID: focusView().uniqueID }, type: 'major' }, 3, { damage: 3, hits: 4 });
      await runEnemyHitBeat(ctx, stageStub._spellDeps(), { fx, unit: playerView, dealt: 3, swing: 3, fromX: focusView().position.x });
    }
  }) },
  { label: 'heavy 重击大冲击', run: () => runWith(async (ctx) => {
    const fx = resolveEnemyHitFx(stageStub, { source: { side: 'enemy', defId: focusView()._defId, uniqueID: focusView().uniqueID }, type: 'major' }, 18, { damage: 18, hits: 1 });
    await runEnemyHitBeat(ctx, stageStub._spellDeps(), { fx, unit: playerView, dealt: 18, swing: 18, fromX: focusView().position.x });
  }) },
  { label: '主题行：当前敌（pal/garnish）', run: () => runWith(async (ctx) => {
    const fx = resolveEnemyHitFx(stageStub, { source: { side: 'enemy', defId: focusView()._defId, uniqueID: focusView().uniqueID }, type: 'major' }, 12, { damage: 12, hits: 1 });
    await runEnemyHitBeat(ctx, stageStub._spellDeps(), { fx, unit: playerView, dealt: 12, swing: 12, fromX: focusView().position.x });
    toast(`主题：${focusView()._defId}${fx?.pal ? '（已并入配色）' : '（通配）'}`);
  }) },
]);

// ---- 生死拍（unitBeats 真代码 + 覆写）----
group('生死拍（目标敌 = 当前选中）', [
  { label: '通用死亡（倒牌+焚毁）', run: () => new Promise((res) => stageStub._unitDeathBeat(focusView(), {}, () => { resetUnits(); res(); })) },
  { label: '重击死亡（击退+挣扎）', run: () => new Promise((res) => stageStub._unitDeathBeat(focusView(), { heavy: true }, () => { resetUnits(); res(); })) },
  { label: '假死留尸（复苏倒计时）', run: () => new Promise((res) => stageStub._unitDeathBeat(focusView(), { unit: { _reviveCountdown: 1 } }, res)) },
  { label: '复苏起立 + garnish', run: () => new Promise((res) => {
    focusView().billboard.rotation.x = -1.43; // 倒地姿态起播
    stageStub._unitSpawnBeat(focusView(), () => { enemySpawnGarnishOf(focusView()._defId)?.(stageStub, focusView()); res(); });
  }) },
  { label: '覆写：爆囊自爆（切爆囊后播）', run: () => new Promise((res) => {
    const v = focusView();
    if (!enemyDeathBeatOf(v._defId)) { toast('当前敌无死亡覆写（回落通用）'); }
    const r = enemyDeathBeatOf(v._defId)?.(stageStub, v, { tags: ['blast'] }, () => { setTimeout(resetUnits, 600); res(); });
    if (r === false) { stageStub._unitDeathBeat(v, {}, () => { resetUnits(); res(); }); }
  }) },
  { label: '覆写：史莱姆融化（切史莱姆后播）', run: () => new Promise((res) => {
    const v = focusView();
    const r = enemyDeathBeatOf(v._defId)?.(stageStub, v, {}, () => { setTimeout(resetUnits, 600); res(); });
    if (r === false) { stageStub._unitDeathBeat(v, {}, () => { resetUnits(); res(); }); }
  }) },
]);

// ---- aura 主题 ----
const auraHosts = [];
function setAura(effects) {
  const host = new AuraHost({ object3D: focusView() });
  host.set(resolveUnitAuras(effects, { particles, unit: focusView(), gpu: null }));
  auraHosts.push(host);
}
group('aura 主题（目标敌身上）', [
  { label: '燃烧 burn 3', run: () => setAura([{ effectId: 'burn', stacks: 3 }]) },
  { label: '燃烧 burn 30（烧透）', run: () => setAura([{ effectId: 'burn', stacks: 30 }]) },
  { label: '中毒 poison 5', run: () => setAura([{ effectId: 'poison', stacks: 5 }]) },
  { label: '眩晕 stun', run: () => setAura([{ effectId: 'stun', stacks: 1 }]) },
  { label: '引线 blastFuse 3（充足）', run: () => setAura([{ effectId: 'blastFuse', stacks: 3 }]) },
  { label: '引线 blastFuse 1（将爆）', run: () => setAura([{ effectId: 'blastFuse', stacks: 1 }]) },
  { label: '清空 aura', run: () => { for (const h of auraHosts.splice(0)) h.set(new Map()); } },
]);

// ============ 目录 UI 渲染 ============
const groupsEl = document.getElementById('fx-groups');
function renderGroups() {
  groupsEl.innerHTML = '';
  for (const g of PREVIEWS) {
    const h = document.createElement('h2');
    h.textContent = g.title;
    groupsEl.appendChild(h);
    for (const item of g.items) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.addEventListener('click', async () => {
        try {
          setStatus(`播放：${item.label}`);
          await item.run();
          setStatus(`完：${item.label}`);
        } catch (e) {
          console.error('[fxGallery] 播放异常', e);
          toast('播放异常（见控制台）');
        }
      });
      groupsEl.appendChild(b);
    }
  }
}
document.getElementById('fx-reset').addEventListener('click', resetUnits);
rebuildBeats();
renderGroups();

// ============ 主题战生成器（POST /forge-save → 跳真实战斗） ============
const forgePicksEl = document.getElementById('fx-forge-picks');
const FORGE_LIST = [...CH1, ...BOSSES];
for (const d of FORGE_LIST) {
  const lab = document.createElement('label');
  lab.style.display = 'inline-block';
  lab.style.marginRight = '4px';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = d.id;
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(d.name ?? d.id));
  forgePicksEl.appendChild(lab);
}
document.getElementById('fx-forge-go').addEventListener('click', async () => {
  const ids = [...forgePicksEl.querySelectorAll('input:checked')].map(i => i.value);
  if (!ids.length) { toast('先勾选至少一个敌人'); return; }
  const floor = Number(document.getElementById('fx-forge-floor').value) || 3;
  const hp = Number(document.getElementById('fx-forge-hp').value) || 65;
  try {
    const res = await fetch('/forge-save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enemies: ids, floor, hp }),
    });
    const data = await res.json();
    if (!data.save) throw new Error(data.error ?? '生成失败');
    toast(`存档 ${data.save} 已生成，跳转战斗…`);
    setTimeout(() => { location.href = `/?debug=1&save=${data.save}`; }, 500);
  } catch (e) {
    toast('生成失败：' + e.message);
  }
});

// ============ 交互（拖拽/滚轮，roomGallery 同款） ============
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

// ============ 主循环 ============
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const halfH = WORLD_HEIGHT / 2;
  const halfW = halfH * camera.aspect;
  uiCamera.left = -halfW; uiCamera.right = halfW;
  uiCamera.top = halfH; uiCamera.bottom = -halfH;
  uiCamera.updateProjectionMatrix();
  moonComposer?.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const _shakeVec = new THREE.Vector3();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  room?.update(dt, null, camera.position);
  // 相机 = 轨道基位 + Σ震屏偏移（迷你导演合成）
  const ce = Math.cos(orbit.el), se = Math.sin(orbit.el);
  camera.position.set(
    orbit.target.x + orbit.dist * ce * Math.sin(orbit.az),
    orbit.target.y + orbit.dist * se,
    orbit.target.z + orbit.dist * ce * Math.cos(orbit.az),
  );
  director.sumInto(_shakeVec);
  camera.position.add(_shakeVec);
  camera.lookAt(orbit.target);
  playerView.update(dt);
  for (const v of enemyViews) v.update(dt);
  particles.update(dt);
  particles2World?.update?.(dt);
  if (moonComposer) moonComposer.render(renderer, scene, camera);
  else renderer.render(scene, camera);
  // UI 前景 pass（飘字/覆盖面）：清深度后正交渲染
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(uiScene, uiCamera);
  renderer.autoClear = true;
  window.__ready = true;
});

window.__fxGallery = { scene, uiScene, renderer, camera, enemyViews, playerView, stageStub };
