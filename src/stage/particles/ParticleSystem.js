// ParticleSystem（§4.8）：两类粒子池，由 StageManager.onTick 驱动（BattleStage 接线）。
//   ① Points 池：单 THREE.Points + 对象池的轻量点粒子（火花/碎屑爆发）。
//      加色混合下黑色=不可见，死粒子颜色归零并归还池位。真 3D——z 必须传场景内
//      实际深度（缺省 z=70 是旧 2D 特效层约定，斜相机下会投影错位）。
//   ② Sprite 池：textured / text 粒子（伤害数字、图标、符咒碎片等）。
//      每个精灵独立材质（各自纹理与透明度），物理与点粒子一致：
//      初速度 + gravity（g，世界单位/秒²，y 向上故下坠为负）+ drag 阻力，
//      透明度随寿命衰减（fadeIn 时为三角曲线），scalePop 出生弹跳。
//      文本经注入的 bakeText 烘焙成纹理（RichTextEngine），随粒子死亡销毁。
//      按 space 分流两套池：'world'（3D 场景内，吃雾/深度）与 'ui'（uiScene
//      前景层，伤害/治疗读数专用——恒定屏幕尺寸、不被场景遮挡；发射前由
//      BattleStage 做世界→UI 投影桥接，本类不感知相机）。

import * as THREE from 'three';
import { renderRichTextBlock } from '../richtext/texture.js';

const DEFAULTS = Object.freeze({
  count: 14,
  color: 0xff5533,
  speed: 20,        // 初速（世界单位/秒），逐粒子 0.5~1.3 随机
  ttl: 0.55,        // 寿命（秒），逐粒子 0.7~1.3 随机
  gravity: -30,
  size: 1.2,        // PointsMaterial 点大小（世界单位）
  z: 70,            // 粒子层高度（特效层）
});

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

export class ParticleSystem {
  /**
   * @param {object} options
   *   max: 点粒子池上限；maxSprites: 精灵粒子池上限
   *   bakeText: (text, { fontSize, color, fontWeight }) => { texture, width, height }
   *     文本烘焙（缺省浏览器 RichTextEngine；单测注入 fake）
   *   pixelsPerWorld: 烘焙像素 → 世界单位换算（默认 10，全局约定）
   */
  constructor({ max = 512, maxSprites = 64, pointSize = DEFAULTS.size, bakeText = null, pixelsPerWorld = 10 } = {}) {
    this._max = max;
    this._ppw = pixelsPerWorld;
    this._bakeText = bakeText || defaultBakeText;

    // ---- ① Points 池 ----
    // 逐粒子尺寸：PointsMaterial.size 是材质级全局值，spawn 的 size 选项要生效
    // 必须走顶点属性（aSize）——onBeforeCompile 把 gl_PointSize 改为 size * aSize
    this._pointSize = pointSize; // spawn 未显式传 size 时的缺省
    this._positions = new Float32Array(max * 3);
    this._colors = new Float32Array(max * 3);
    this._sizes = new Float32Array(max);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this._sizes, 1));
    const material = new THREE.PointsMaterial({
      size: 1, // 全局乘子留 1，实际尺寸全在 aSize 属性里
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    material.customProgramCacheKey = () => 'weky-particles-points-v1';
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 70;

    this._pool = [];               // 活点粒子 { i, x, y, vx, vy, life, ttl, gravity, r, g, b }
    this._free = Array.from({ length: max }, (_, i) => max - 1 - i);

    // ---- ② Sprite 池（world / ui 两套，空间分流）----
    this.sprites = this._buildSpriteGroup(maxSprites);      // 世界池：3D 场景内
    this._spriteFree = this.sprites.userData.free;
    this.spritesUI = this._buildSpriteGroup(maxSprites);    // UI 池：挂 uiScene（读数文本）
    this._spriteUIFree = this.spritesUI.userData.free;
    this._spritePool = [];           // 活精灵 { sprite, space, vx, vy, gravity, drag, life, ttl, fadeIn, scalePop, w, h, disposeTexture }
  }

  _buildSpriteGroup(n) {
    const group = new THREE.Group();
    group.renderOrder = 71;   // 文本/贴图粒子在点粒子之上
    group.userData.free = [];
    for (let i = 0; i < n; i++) {
      // fog:false——精灵是演出读数，不吃场景雾的压暗
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      group.add(sprite);
      group.userData.free.push(sprite);
    }
    return group;
  }

  get activeCount() { return this._pool.length; }
  get activeSpriteCount() { return this._spritePool.length; }

  /** 在 (x, y) 处爆发一团点粒子。options 见 DEFAULTS（size 逐次覆盖缺省点径）。 */
  spawn(x, y, options = {}) {
    const o = { ...DEFAULTS, size: this._pointSize, ...options };
    const color = new THREE.Color(o.color);
    for (let n = 0; n < o.count; n++) {
      const i = this._free.pop();
      if (i == null) return; // 池满静默丢弃
      const angle = Math.random() * Math.PI * 2;
      const speed = o.speed * (0.5 + Math.random() * 0.8);
      // 逐粒子亮度抖动（0.75~1.3）：单色加色爆发太均质，抖出明暗层次更醒目
      const jitter = 0.75 + Math.random() * 0.55;
      this._sizes[i] = o.size * (0.8 + Math.random() * 0.5); // 点径同步抖动
      this._pool.push({
        i, x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: o.ttl * (0.7 + Math.random() * 0.6),
        gravity: o.gravity,
        r: Math.min(1, color.r * jitter), g: Math.min(1, color.g * jitter), b: Math.min(1, color.b * jitter),
        z: o.z,
      });
    }
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  /**
   * 发射一个贴图粒子（textured particle）。
   * @param {object} options
   *   texture: THREE.Texture；width/height: 世界单位尺寸；
   *   space: 'world'（3D 场景池）| 'ui'（uiScene 前景池）；
   *   其余物理/表现参数见 SPRITE_DEFAULTS
   */
  spawnSprite(x, y, { texture, width, height, ...rest }) {
    const o = { ...SPRITE_DEFAULTS, ...rest };
    const free = o.space === 'ui' ? this._spriteUIFree : this._spriteFree;
    const sprite = free.pop();
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
    this._writeSpriteTransform(rec);
    this._spritePool.push(rec);
    return rec;
  }

  /**
   * 发射一个文本粒子（伤害/治疗数字等）：文本烘焙为一次性纹理。
   * @param {object} options  fontSize/color/fontWeight（烘焙样式，px）+ 物理参数
   */
  spawnText(x, y, text, options = {}) {
    const { fontSize = 32, color = '#ffffff', fontWeight = 'bold', ...physics } = options;
    const { texture, width, height } = this._bakeText(text, { fontSize, color, fontWeight });
    const rec = this.spawnSprite(x, y, {
      texture,
      width: width / this._ppw,
      height: height / this._ppw,
      disposeTexture: true,
      ...physics,
    });
    if (rec) rec.text = text; // 测试/调试可断言
    return rec;
  }

  update(dt) {
    this._updatePoints(dt);
    this._updateSprites(dt);
  }

  _updatePoints(dt) {
    if (this._pool.length === 0) return;
    const pos = this._positions;
    const col = this._colors;
    for (let k = this._pool.length - 1; k >= 0; k--) {
      const p = this._pool[k];
      p.life += dt;
      if (p.life >= p.ttl) {
        col[p.i * 3] = 0;
        col[p.i * 3 + 1] = 0;
        col[p.i * 3 + 2] = 0;
        this._free.push(p.i);
        this._pool.splice(k, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = 1 - p.life / p.ttl;
      pos[p.i * 3] = p.x;
      pos[p.i * 3 + 1] = p.y;
      pos[p.i * 3 + 2] = p.z;
      col[p.i * 3] = p.r * fade;
      col[p.i * 3 + 1] = p.g * fade;
      col[p.i * 3 + 2] = p.b * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  _updateSprites(dt) {
    for (let k = this._spritePool.length - 1; k >= 0; k--) {
      const p = this._spritePool[k];
      p.life += dt;
      if (p.life >= p.ttl) {
        p.sprite.visible = false;
        if (p.disposeTexture) p.sprite.material.map?.dispose?.();
        p.sprite.material.map = null;
        (p.space === 'ui' ? this._spriteUIFree : this._spriteFree).push(p.sprite);
        this._spritePool.splice(k, 1);
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
      this._writeSpriteTransform(p);
    }
  }

  _writeSpriteTransform(p) {
    p.sprite.position.set(p.x, p.y, p.z);
    const s = p.scalePop > 0 ? 1 + p.scalePop * Math.max(0, 1 - p.life / 0.25) : 1;
    p.sprite.scale.set(p.w * s, p.h * s, 1);
  }
}

// 浏览器默认文本烘焙：RichTextEngine；非浏览器（无 canvas）退化为 1x1 占位
function defaultBakeText(text, { fontSize, color, fontWeight }) {
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
