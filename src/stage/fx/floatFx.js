// CPU 粒子门面（飘字/贴图专用）。使用边界（2026-10-07 用户定，AGENTS「CPU/GPU
// 分工铁律」同步）：**默认一律走 GPU 粒子池**（fx/gpu/particlePool.js）；本门面只许
// 承接**同时**满足两条件的粒子：①（per-粒子独立纹理/文本，或行为特别复杂）
// 且 ② 总量十几个以内——都成立才走 CPU。
//   · 文本/贴图粒子（spawnText/spawnSprite：伤害数字、治疗读数、符咒碎片、贴图
//     光环）：烘焙纹理 Sprite 池，物理 = 初速度 + gravity + drag，透明度随寿命衰减
//     （fadeIn 三角），scalePop 出生弹跳，按 space 分流 world/ui 两套（UI 前景层
//     恒定屏幕尺寸、不被场景遮挡）——本门面的正当职责。
// 历史迁移：一次性点粒子爆发（spawn）→ gpu/burstFx.js；持续点发射器
// （spawnEmitter）→ gpu/ambientMotes.js（2026-10-07 全量迁移，本文件的点粒子
// 池/发射器机械已删）。

import * as THREE from 'three';
import { renderRichTextBlock } from '../richtext/texture.js';

const SPRITE_DEFAULTS = Object.freeze({
  vx: 0,
  vy: 0,
  gravity: 0,       // g：加速度（世界单位/秒²）；y 向上，下坠为负
  drag: 0,          // 阻力系数（/秒）：v *= max(1 - drag, 0)^dt
  ttl: 0.9,
  fadeIn: false,    // true = 透明度先升后降（三角），false = 只降
  scalePop: 0,      // 出生弹跳：初始放大倍数增量，约 0.25s 内衰减回 1
  z: 70,
  space: 'world',   // 'world' = 3D 场景池（吃雾/深度）；'ui' = uiScene 前景池（读数文本）
  disposeTexture: false, // 文本纹理一次性使用，死亡即销毁
});

export function createFloatFx({ maxSprites = 64, pixelsPerWorld = 10 } = {}) {
  const ppw = pixelsPerWorld;

  // ---- Sprite 池（world / ui 两套，空间分流）----
  const buildSpriteGroup = (n) => {
    const group = new THREE.Group();
    group.renderOrder = 71;   // 贴图/文本粒子层
    group.userData.free = [];
    for (let i = 0; i < n; i++) {
      // fog:false——精灵是演出读数，不吃场景雾的压暗
      const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      group.add(sprite);
      group.userData.free.push(sprite);
    }
    return group;
  };
  const sprites = buildSpriteGroup(maxSprites);        // 世界池：3D 场景内
  let spriteFree = sprites.userData.free;
  const spritesUI = buildSpriteGroup(maxSprites);      // UI 池：挂 uiScene（读数文本）
  let spriteUIFree = spritesUI.userData.free;
  const spritePool = [];           // 活精灵 { sprite, space, vx, vy, gravity, drag, life, ttl, fadeIn, scalePop, w, h, disposeTexture }

  /**
   * 发射一个贴图粒子（textured particle）。
   * @param {object} options
   *   texture: THREE.Texture；width/height: 世界单位尺寸；
   *   space: 'world'（3D 场景池）| 'ui'（uiScene 前景池）；
   *   其余物理/表现参数见 SPRITE_DEFAULTS
   */
  function spawnSprite(x, y, { texture, width, height, ...rest }) {
    const o = { ...SPRITE_DEFAULTS, ...rest };
    const freeList = o.space === 'ui' ? spriteUIFree : spriteFree;
    const sprite = freeList.pop();
    if (!sprite) { o.disposeTexture && texture?.dispose?.(); return null; } // 池满静默丢弃
    sprite.material.map = texture;
    sprite.material.opacity = o.fadeIn ? 0 : 1;
    sprite.material.needsUpdate = true;
    sprite.visible = true;
    const rec = {
      sprite, space: o.space, x, y,
      vx: o.vx, vy: o.vy,
      gravity: o.gravity, drag: o.drag,
      life: 0, ttl: o.ttl,
      fadeIn: o.fadeIn, scalePop: o.scalePop,
      w: width, h: height,
      disposeTexture: o.disposeTexture, z: o.z,
    };
    writeSpriteTransform(rec);
    spritePool.push(rec);
    return rec;
  }

  /**
   * 发射一个文本粒子（伤害/治疗数字等）：文本烘焙为一次性纹理。
   * @param {object} options  fontSize/color/fontWeight（烘焙样式，px）+ 物理参数
   */
  function spawnText(x, y, text, options = {}) {
    const { fontSize = 32, color = '#ffffff', fontWeight = 'bold', ...physics } = options;
    const { texture, width, height } = bakeText(text, { fontSize, color, fontWeight });
    const rec = spawnSprite(x, y, {
      texture,
      width: width / ppw,
      height: height / ppw,
      disposeTexture: true,
      ...physics,
    });
    if (rec) rec.text = text; // 测试/调试可断言
    return rec;
  }

  function update(dt) {
    for (let k = spritePool.length - 1; k >= 0; k--) {
      const p = spritePool[k];
      p.life += dt;
      if (p.life >= p.ttl) {
        p.sprite.visible = false;
        if (p.disposeTexture) p.sprite.material.map?.dispose?.();
        p.sprite.material.map = null;
        (p.space === 'ui' ? spriteUIFree : spriteFree).push(p.sprite);
        spritePool.splice(k, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag > 0) {
        const f = Math.pow(Math.max(1 - p.drag, 0.0001), dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.ttl;
      p.sprite.material.opacity = p.fadeIn ? Math.min(t, 1 - t) * 2 : 1 - t;
      writeSpriteTransform(p);
    }
  }

  function writeSpriteTransform(p) {
    p.sprite.position.set(p.x, p.y, p.z);
    const s = p.scalePop > 0 ? 1 + p.scalePop * Math.max(0, 1 - p.life / 0.25) : 1;
    p.sprite.scale.set(p.w * s, p.h * s, 1);
  }

  return {
    spawnSprite, spawnText, update,
    sprites, spritesUI,
    get activeSpriteCount() { return spritePool.length; },
  };
}

// 文本烘焙：RichTextEngine；非浏览器（无 canvas）退化为 1x1 占位
function bakeText(text, { fontSize, color, fontWeight }) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture, width: 1, height: 1 };
  }
  return renderRichTextBlock(text, {
    style: { fontSize, color, fontWeight, lineHeight: Math.ceil(fontSize * 1.3) }, // 行高随字号，防大字号裁剪
    scale: 2,
  });
}
