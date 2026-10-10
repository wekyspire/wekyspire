// 开屏全量 shader 预热（2026-10-09）：WebGPU 管线首用编译 0.3~1.5s/个——此前各处
// 就近预热（战斗开场 bodyFx/施术面片按卡组、舞台首帧带出后处理链），**房间首进**
// 与**休息房机器 zoom-in** 仍是裸奔（实报卡顿/动画错位）。结构性方案（用户定）：
// 开屏加载阶段把全部管线预热掉——本模块在 StageManager 启动后、开始界面（DOM 全屏
// 盖布）背后架一座**幕后暖场**：
//   ① 逐间预建 PCG 房（fortress 战斗房 + casino/camp/shop 三间休息房——机器 rig 的
//      材质/纹理/灯全随 composeRoom 建出）+ 体积月光 composer 真渲数帧（march/tonemap/
//      阴影管线走通），暖完即拆（管线缓存按程序哈希常驻，RT/几何随拆释放）；
//   ② uiScene 放一张真卡（C0 卡面特效全链）+ 一块 canvas 纹理样片（legacy basic 管线），
//      uiComposer 后处理链（RT/bloom/预乘盖回）随渲染循环自然走通；
//   ③ 施术面片全变体：技能注册表全 defId 走 warmSpellFx 既有机制（变体按程序去重）。
// 分段容错：一段失败不拦下一段与游戏启动；`?warmup=0` 可关（排障口径）。
// 暖场由 newGame 的 setStage 自然接管（onExit 全拆），菜单阶段常驻渲染成本 = 空场景一帧。

import * as THREE from 'three';
import { composeRoom } from './scenes/rooms/composeRoom.js';
import { createVolumetricMoonlight } from './scenes/volumetricMoon.js';
import { warmSpellFx } from './fx/spells/index.js';
import { allSkills, getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { makeCardFaceBaker } from './richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from './art/cardArtCache.js';
import { CardObject } from './objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './objects/cardMetrics.js';

/** 预建的房型（覆盖：章1 战斗房 + 三间休息房——机器 rig 是 zoom-in 卡顿主诉） */
const WARM_RECIPES = ['fortress', 'casino', 'camp', 'shop'];

const nextFrames = (n) => new Promise((resolve) => {
  let i = 0;
  const t = () => { if (++i >= n) resolve(); else requestAnimationFrame(t); };
  requestAnimationFrame(t);
});

/**
 * 开屏预热主入口（fire-and-forget；App.vue 在 stageManager.start() 后调用）。
 * @param {StageManager} stageManager
 * @param {object} opts whenContent: () => Promise（内容注册表就绪门——施术变体/卡面样片依赖）
 * @returns {Promise<string>} 收尾摘要（诊断用）
 */
export async function runBootWarmup(stageManager, { whenContent = null } = {}) {
  if (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('warmup') === '0') return 'off';
  const renderer = stageManager?._renderer;
  if (!renderer || (!renderer.compileAsync && !renderer.compile)) return 'no-renderer';
  const log = (...a) => console.info('[warmup]', ...a);
  let contentOk = true;
  try { await whenContent?.(); } catch { contentOk = false; }

  const scene = new THREE.Scene();
  const uiScene = new THREE.Scene();
  let composer = null;
  let room = null;

  const teardownRoom = () => {
    // 先摘渲染钩子再拆件：composeScene 闭包捕获的是 composer 变量——先置 null 会
    // 让下一帧 rAF 在 null.render 上抛错打断渲染主循环（tick 无兜底，实测病灶）
    warmStage.composeScene = null;
    if (room) { scene.remove(room.group); }
    composer?.dispose();
    composer = null;
    room?.propPhys?.dispose?.();
    room?.combust?.dispose?.();
    room = null;
    scene.fog = null;
  };
  const mountRoom = (recipeId) => {
    teardownRoom();
    room = composeRoom(recipeId, 'boot-warm');
    scene.add(room.group);
    const fogDef = room.recipe?.fog;
    scene.fog = fogDef
      ? new THREE.Fog(fogDef.color, fogDef.near, fogDef.far)
      : new THREE.Fog(0x060a14, 165, 310);
    if (room.moonlight && typeof renderer.setRenderTarget === 'function') {
      composer = createVolumetricMoonlight({
        light: room.moonlight, march: stageManager?.getRenderQuality?.(),
      });
      composer.resize(stageManager.viewSize.width || 2, stageManager.viewSize.height || 2);
    }
  };

  const warmStage = {
    name: 'boot-warmup',
    scene,
    uiScene,
    composeScene: null,
    onExit: () => teardownRoom(),
  };
  const isLive = () => stageManager._stage === warmStage;

  try {
    // 只在尚无舞台时上暖场：?save= 直入的 newGame 可能先到——不得覆盖已设的游戏舞台
    if (stageManager._stage != null) return 'late';
    stageManager.setStage(warmStage);
    // ① 逐间暖房：真渲数帧（composer/阴影/march 走真 pass）+ compileAsync 双保险
    for (const recipeId of WARM_RECIPES) {
      try {
        mountRoom(recipeId);
        const comp = composer;   // 捕获当值（别捕获变量——拆件后闭包不得再触达旧件）
        warmStage.composeScene = comp
          ? ({ renderer: r, scene: s, camera: c }) => comp.render(r, s, c)
          : null;
        await nextFrames(3);
        try { await renderer.compileAsync(scene, stageManager.camera); } catch { /* 续 */ }
        if (!isLive()) break;   // 玩家已开局（?save= 直入等）：暖场被接管，余房不演
        await nextFrames(2);
      } catch (err) {
        console.warn(`[warmup] 房间 ${recipeId} 预热异常（跳过）：`, err);
      }
    }
    teardownRoom();
    // 最后一间留着常驻渲染太重：回到空场景 + 一盏灯（菜单期间成本趋零）
    scene.add(new THREE.HemisphereLight(0x8fb0d8, 0x1a1e28, 1.0));

    if (contentOk) {
      // ② uiScene 真卡样片（C0 卡面特效 + 富文本烘焙）+ canvas 纹理样片（legacy basic）
      try {
        const baker = makeCardFaceBaker({ cardArt: sharedCardArtCache });
        const card = new CardObject({
          uniqueID: 'warm:card', cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: baker,
        });
        const def = allSkills()[0] ?? null;
        if (def) card.setCard(cardViewFromDef(getSkillDefinition(def.id) ?? def, {}));
        card.position.set(0, 0, 40);
        uiScene.add(card);
        const cnv = document.createElement('canvas');
        cnv.width = cnv.height = 8;
        const c2 = cnv.getContext('2d');
        c2.fillStyle = '#88aacc'; c2.fillRect(0, 0, 8, 8);
        const quad = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cnv), transparent: true }),
        );
        quad.position.set(-30, 0, 40);
        uiScene.add(quad);
        await nextFrames(2);
        try { await renderer.compileAsync(uiScene, stageManager.uiCamera); } catch { /* 续 */ }
      } catch (err) {
        console.warn('[warmup] uiScene 样片预热异常（跳过）：', err);
      }

      // ③ 施术面片全变体（全 defId；变体按程序去重，量级 ~几十个 quad）
      try {
        warmSpellFx(allSkills().map(d => d.id), {
          renderer, camera: stageManager.camera, worldPool: null,
        });
      } catch (err) {
        console.warn('[warmup] 施术变体预热异常（跳过）：', err);
      }
    }
    log('完成', { contentOk, live: isLive() });
    return contentOk ? 'done' : 'partial(no-content)';
  } catch (err) {
    console.warn('[warmup] 预热链异常（不影响启动）：', err);
    try { teardownRoom(); } catch { /* 已拆 */ }
    return 'error';
  }
}
