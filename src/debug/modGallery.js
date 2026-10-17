// 卡牌 modifier 审核页（modGallery.html）：把注册表里的卡牌 modifier 挂到一组
// 代表性卡样上隔离审核。真链路三件套：
//   卡面 = bakeCardFace + sharedCardArtCache（页脚词条/热区与战斗同源，挂/摘即时重烘）
//   视图 = effectiveDefOf/keywordsOf/costOf + projectSkill（modifier patch 全折算）
//   特效 = CardObject/CardFxLayer（锁定烙印等逐 modifier 视觉）+ uiComposer bloom 链
// hover 卡面热区弹 tooltip（shell/tooltip.js 同源内容——mod 词条即玩家观察通道）。
// 交互：左面板选 modifier（注册表逐项）→「全部挂上/全部摘除」或直接点卡切换该卡。
// 纯 dev 工具，不进构建、不写测试。打开：npm run dev 后访问 /modGallery.html。

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { CardObject } from '../stage/objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from '../stage/objects/cardMetrics.js';
import { makeCardFaceBaker } from '../stage/richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../stage/art/cardArtCache.js';
import { sharedUnitArtCache } from '../stage/art/unitArt.js';
import { createUiComposer } from '../stage/post/uiComposer.js';
import { applyToneMapping, DEFAULT_TONE_MODE } from '../stage/post/passes.js';
import { UI_CAMERA_LOOK_AT_Y, UI_CAMERA_Z, WORLD_HEIGHT } from '../stage/StageManager.js';
import { tooltipModel } from '../shell/tooltip.js';
// core：注册表 + modifier 有效视图原语（battle 无关口径，headless/本页共用）
import '../core/content/index.js';
import { getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import {
  allCardModifiers, effectiveDefOf, modsOf, hasCardModifier, hasModifierFlag,
  attachModifierInstance, detachModifierInstance,
} from '../core/skills/cardModifiers.js';
import { projectSkill, KEYWORD_LABELS } from '../bridge/projection.js';

// ---- 样本卡（覆盖页脚词条形态：白板 / 子体系 / 多词条 / X 费 / 咏唱 / S 阶冷却）----
const SAMPLES = ['punchC', 'slashC', 'badOmenC', 'reliefValveB', 'endlessComboA', 'fierceFistS'];

// ---- 渲染底座（uiComposer 卡牌链 = BattleStage 手牌同款；无世界场景，纯 UI 审核面）----
const canvas = document.createElement('canvas');
canvas.id = 'mod-canvas';
canvas.style.cssText = 'display:block;position:absolute;inset:0';
document.body.appendChild(canvas);

const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(window.devicePixelRatio);
applyToneMapping(renderer, DEFAULT_TONE_MODE, 1);

const uiScene = new THREE.Scene();
const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
uiCamera.position.set(0, UI_CAMERA_LOOK_AT_Y, UI_CAMERA_Z);
uiCamera.lookAt(0, UI_CAMERA_LOOK_AT_Y, 0);
const fitFrustum = (aspect) => {
  const halfH = WORLD_HEIGHT / 2;
  uiCamera.left = -halfH * aspect; uiCamera.right = halfH * aspect;
  uiCamera.top = halfH; uiCamera.bottom = -halfH;
  uiCamera.updateProjectionMatrix();
};
const uiComposer = createUiComposer();

// ---- 样本 runtime（modifier 挂在 fake rt 上——keywordsOf/costOf/projectSkill 全走真原语）----
const rts = new Map();   // defId → rt
const views = new Map(); // defId → CardObject
const bakeFace = makeCardFaceBaker({ cardArt: sharedCardArtCache, unitArt: sharedUnitArtCache });

let uid = 0;
for (const defId of SAMPLES) {
  const def = getSkillDefinition(defId);
  if (!def) { console.warn(`[modGallery] 样本 ${defId} 未注册，跳过`); continue; }
  const max = def.charges?.max ?? Infinity;
  rts.set(defId, {
    uniqueID: `mod-${uid++}`, defId, power: 0, isActivated: false,
    remainingUses: max, currentCooldown: 0, modifiers: [],
  });
}

// 视图折算：def ⊕ modifier patch（词条/费用/冷却）+ mods 徽章——与战斗投影同口径
const viewOf = (rt) => {
  const view = cardViewFromDef(effectiveDefOf(rt), {});
  return {
    ...view,
    keywords: view.keywords.map((k) => KEYWORD_LABELS[k] ?? k), // 页脚词条要中文标签
    ...projectSkill(rt), // power/mods 徽章（页脚热区数据源）
  };
};

// 两行三卡（正交可视高 100、中心 y=-10；卡 26×35.1）
const ROWS = [[12], [-34]]; // 行 y
function layout() {
  const ids = [...rts.keys()];
  const n = Math.ceil(ids.length / ROWS.length) || 1;
  ids.forEach((defId, i) => {
    const rt = rts.get(defId);
    let view = views.get(defId);
    if (!view) {
      view = new CardObject({ uniqueID: rt.uniqueID, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace });
      views.set(defId, view);
      uiScene.add(view);
    }
    const row = Math.floor(i / n);
    const col = i % n;
    view.position.set((col - (n - 1) / 2) * (CARD_WIDTH + 10), ROWS[row] ?? 0, 0);
  });
}

// 挂/摘后重推单卡：卡面重烘（词条/徽章/热区）+ 逐 modifier 特效
// （locked → 烙印标记；unplayable 旗标 → 禁用压暗档）
function refresh(defId) {
  const rt = rts.get(defId);
  const view = views.get(defId);
  if (!rt || !view) return;
  view.setCard(viewOf(rt));
  view.setLockMark(hasCardModifier(rt, 'locked'));
  view.setVisualState(hasModifierFlag(rt, 'unplayable') ? 'disabled' : 'normal');
}
const refreshAll = () => { for (const id of rts.keys()) refresh(id); renderPanel(); };

// ---- DOM 面板（左上：modifier 选择 + 全挂/全摘 + 样本挂载清单）----
let activeModId = allCardModifiers()[0]?.id ?? null;
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;top:10px;left:12px;pointer-events:auto;'
  + 'font:13px/1.7 monospace;color:#cfd8e3;text-shadow:0 1px 3px rgba(0,0,0,.9);'
  + 'background:rgba(8,11,18,.82);border:1px solid #2a3346;padding:10px 12px;max-width:340px';
document.body.appendChild(panel);

function renderPanel() {
  const mods = allCardModifiers();
  let html = `<div style="font:600 15px/1.4 monospace;color:#e8eef8;margin-bottom:4px">卡牌 modifier 审核 · modGallery</div>`;
  html += `<div style="color:#8a93b2;margin-bottom:6px">点卡切换挂载｜hover 卡面词条看 tooltip</div>`;
  html += `<div style="margin:4px 0 2px;color:#8a93b2">modifier（注册表 ${mods.length} 项）</div>`;
  for (const m of mods) {
    const on = m.id === activeModId;
    html += `<div class="mg-mod" data-id="${m.id}" style="cursor:pointer;padding:3px 6px;`
      + `border:1px solid ${on ? '#e8a23c' : '#2a3346'};${on ? 'background:#20242e;' : ''}margin-bottom:3px">`
      + `<b style="color:#e8eef8">${m.icon ?? ''}${m.name}</b>`
      + `<span style="color:#8a93b2"> · ${m.id}</span>`
      + `<div style="color:#a8b2c8;font-size:12px">${m.describe?.() ?? ''}</div></div>`;
  }
  html += `<div style="margin:6px 0">`
    + `<button id="mg-all" style="font:12px monospace;color:#e8eef8;background:#20242e;border:1px solid #3a4258;padding:3px 10px;cursor:pointer">全部挂上</button> `
    + `<button id="mg-none" style="font:12px monospace;color:#e8eef8;background:#20242e;border:1px solid #3a4258;padding:3px 10px;cursor:pointer">全部摘除</button></div>`;
  html += `<div style="margin:4px 0 2px;color:#8a93b2">样本挂载</div>`;
  for (const defId of rts.keys()) {
    const def = getSkillDefinition(defId);
    const names = modsOf(rts.get(defId)).map((m) => m.modId).join(',') || '—';
    html += `<div><span style="color:#cfd8e3">${def?.name ?? defId}</span>`
      + `<span style="color:#8a93b2"> · ${names}</span></div>`;
  }
  panel.innerHTML = html;
  for (const el of panel.querySelectorAll('.mg-mod')) {
    el.addEventListener('click', () => { activeModId = el.dataset.id; renderPanel(); });
  }
  panel.querySelector('#mg-all')?.addEventListener('click', () => {
    if (!activeModId) return;
    for (const rt of rts.values()) attachModifierInstance(rt, { modId: activeModId, source: 'gallery' });
    refreshAll();
  });
  panel.querySelector('#mg-none')?.addEventListener('click', () => {
    for (const rt of rts.values()) rt.modifiers = [];
    refreshAll();
  });
}

// ---- 指针：hover 热区 tooltip + 点卡切换挂载 ----
const raycaster = new THREE.Raycaster();
const pick = (px, py) => {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    (px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), uiCamera);
  const hits = raycaster.intersectObjects([...views.values()], true);
  for (const hit of hits) {
    let node = hit.object;
    while (node && !([...views.values()].includes(node))) node = node.parent;
    if (!node || !hit.uv) continue;
    const defId = [...views.entries()].find(([, v]) => v === node)?.[0];
    return { defId, region: node.hitTestUV({ u: hit.uv.x, v: hit.uv.y }) ?? null };
  }
  return null;
};

const tip = document.createElement('div');
tip.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:10;'
  + 'max-width:260px;background:rgba(10,14,24,.94);border:2px solid #3a4258;'
  + 'padding:8px 10px;font:13px/1.6 monospace;color:#dfe6f2';
document.body.appendChild(tip);

canvas.addEventListener('pointermove', (e) => {
  const hit = pick(e.clientX, e.clientY);
  if (hit?.region) {
    const model = tooltipModel(hit.region.type, hit.region.payload);
    tip.innerHTML = `<b style="color:#fff">${model.title ?? ''}</b><div>${model.body ?? ''}</div>`;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 280)}px`;
    tip.style.top = `${Math.min(e.clientY + 14, innerHeight - 120)}px`;
  } else {
    tip.style.display = 'none';
  }
});
canvas.addEventListener('pointerdown', (e) => {
  const hit = pick(e.clientX, e.clientY);
  if (!hit || !activeModId) return;
  const rt = rts.get(hit.defId);
  if (hasCardModifier(rt, activeModId)) detachModifierInstance(rt, activeModId);
  else attachModifierInstance(rt, { modId: activeModId, source: 'gallery' });
  refresh(hit.defId);
});

// ---- 主循环：卡特效层逐帧（烙印呼吸/enter 拍）+ uiComposer 卡牌链 ----
const clock = new THREE.Clock();
let frames = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const v of views.values()) v.updateFx(dt);
  renderer.setClearColor(0x07090f, 1);
  renderer.clear();
  uiComposer.render(renderer, uiScene, uiCamera);
  frames++;
  window.__ready = frames > 2;
});

const resize = () => {
  const w = innerWidth, h = innerHeight;
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  renderer.setSize(w, h);
  fitFrustum(w / h);
  uiComposer.resize(w, h, window.devicePixelRatio);
};
addEventListener('resize', resize);
resize();

layout();
refreshAll();
sharedCardArtCache?.addOnLoad?.(() => refreshAll()); // 卡图异步到图 → 重烘全卡面
sharedUnitArtCache?.addOnLoad?.(() => refreshAll());

// 探针口：帧就绪闸（__ready）+ 页柄（toggle/refresh/样本表）
window.__modGallery = {
  views, rts, get activeModId() { return activeModId; },
  set(id, on) {
    const rt = rts.get(id);
    if (!rt || !activeModId) return;
    if (on) attachModifierInstance(rt, { modId: activeModId, source: 'gallery' });
    else detachModifierInstance(rt, activeModId);
    refresh(id);
  },
  refreshAll,
};
