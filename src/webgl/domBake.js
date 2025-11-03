import * as PIXI from 'pixi.js';
import html2canvas from 'html2canvas';
import {snapdom} from "@zumer/snapdom";

function ensureStagingRoot() {
  let root = document.getElementById('__pixi_bake_stage');
  if (!root) {
    root = document.createElement('div');
    root.id = '__pixi_bake_stage';
    Object.assign(root.style, {
      position: 'fixed',
      left: '-100000px',
      top: '-100000px',
      width: '0px',
      height: '0px',
      overflow: 'hidden',
      pointerEvents: 'none',
      opacity: '1'
    });
    document.body.appendChild(root);
  }
  return root;
}

/**
 * 将一个 DOM 元素烘焙为 Pixi Texture（通过离屏克隆，规避父元素 opacity/transform 干扰）
 * 返回 { texture, scaleUsed, destroy() }
 */
export async function bakeElementToTexture(el, {
  scale = window.devicePixelRatio,
  transparent = true,
  useCORS = true,
} = {}) {
  if (!el) throw new Error('bakeElementToTexture: el is required');
  const rect = el.getBoundingClientRect();
  let w = Math.max(1, Math.round(el.offsetWidth || rect.width));
  let h = Math.max(1, Math.round(el.offsetHeight || rect.height));

  const stage = ensureStagingRoot();
  const clone = el.cloneNode(true);
  // 固定克隆尺寸，避免在离屏容器中塌缩
  clone.style.width = w + 'px';
  clone.style.height = h + 'px';
  clone.style.opacity = '1';
  clone.style.position = 'relative';
  stage.appendChild(clone);

  let canvas = null;
  if(false) {
    canvas = await html2canvas(clone, {
      backgroundColor: transparent ? null : '#000000',
      scale,
      useCORS,
      logging: false,
      width: w,
      height: h,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      removeContainer: true,
    });
  } else {
    canvas = await snapdom.toCanvas(clone, {
      scale: 1,// / scale,
      width: w,
      height: h,
      backgroundColor: transparent ? null : '#000000'
    });
  }

  // 清理克隆
  try { stage.removeChild(clone); } catch(_) {}

  const texture = PIXI.Texture.from(canvas);
  // if (texture && texture.baseTexture) {
  //   texture.
  // }

  return {
    texture,
    scaleUsed: scale,
    destroy() {
      try { texture.destroy(true); } catch(_) {}
    }
  };
}
