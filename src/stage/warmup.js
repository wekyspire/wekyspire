// 开屏轻量预热（2026-10-12 改造）：只做菜单期（开始界面盖布背后）安全且便宜的两段——
//   ② uiScene 样卡（C0 卡面特效全链 + canvas 纹理 legacy 管线；uiComposer 后处理链
//      随渲染循环自然走通），暖完即从 uiScene 摘除（菜单期不再逐帧渲染它）；
//   ③ 施术面片全变体：技能注册表全 defId 走 warmSpellFx 既有机制（变体按程序去重）。
// 原「逐间预建 PCG 房 + 体积月光 composer 真渲数帧再拆」的①段已删（2026-10-12）：
// 拆房只摘不 dispose 泄漏 GPU 资源、暖场房 seed 与真房不同覆盖不精确、后台标签页下
// rAF 停摆会把余段拖进游戏期——房间管线预热迁至自然挂载点（RoomStage 构造 = 幕间
// 黑幕中点：compileAsync + initTexture，见 RoomStage.js）。
// 全程 isLive 门控：玩家一开局（setStage 被游戏舞台接管），未做的段立即放弃，暖场
// 不与游戏期竞争。`?warmup=0` 可关（排障口径）。
// 暖场由 newGame 的 setStage 自然接管；菜单阶段常驻渲染成本 = 空场景一帧。

import * as THREE from 'three';
import { warmSpellFx } from './fx/spells/index.js';
import { allSkills, getSkillDefinition } from '../core/skills/registry.js';
import { cardViewFromDef } from '../core/skills/cardView.js';
import { makeCardFaceBaker } from './richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from './art/cardArtCache.js';
import { CardObject } from './objects/CardObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './objects/cardMetrics.js';

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
  if (!renderer || !renderer.compileAsync) return 'no-renderer';
  const log = (...a) => console.info('[warmup]', ...a);
  let contentOk = true;
  try { await whenContent?.(); } catch { contentOk = false; }

  const scene = new THREE.Scene();
  const uiScene = new THREE.Scene();
  const warmStage = { name: 'boot-warmup', scene, uiScene };
  const isLive = () => stageManager._stage === warmStage;

  try {
    // 只在尚无舞台时上暖场：?save= 直入的 newGame 可能先到——不得覆盖已设的游戏舞台
    if (stageManager._stage != null) return 'late';
    stageManager.setStage(warmStage);

    if (contentOk) {
      // ② uiScene 真卡样片（C0 卡面特效 + 富文本烘焙）+ canvas 纹理样片（legacy basic）
      try {
        if (isLive()) {
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
          if (isLive()) {
            try { await renderer.compileAsync(uiScene, stageManager.uiCamera); } catch { /* 续 */ }
          }
          // 暖完即摘（菜单期不再逐帧渲染样卡；管线缓存已建立，摘除零损失）
          uiScene.remove(card);
          uiScene.remove(quad);
          card.dispose();
          quad.geometry.dispose();
          quad.material.map?.dispose?.();
          quad.material.dispose();
        }
      } catch (err) {
        console.warn('[warmup] uiScene 样片预热异常（跳过）：', err);
      }

      // ③ 施术面片全变体（全 defId；变体按程序去重，量级 ~几十个 quad）
      if (isLive()) {
        try {
          warmSpellFx(allSkills().map(d => d.id), {
            renderer, camera: stageManager.camera, worldPool: null,
          });
        } catch (err) {
          console.warn('[warmup] 施术变体预热异常（跳过）：', err);
        }
      }
    }
    log('完成', { contentOk, live: isLive() });
    return contentOk ? 'done' : 'partial(no-content)';
  } catch (err) {
    console.warn('[warmup] 预热链异常（不影响启动）：', err);
    return 'error';
  }
}
