// CPU 粒子门面（飘字/贴图专用）。使用边界（2026-10-07 用户定，AGENTS「CPU/GPU
// 分工铁律」同步）：**默认一律走 GPU 粒子池**（fx/gpu/particlePool.js）；本门面只许
// 承接**同时**满足两条件的粒子：①（per-粒子独立纹理/文本，或行为特别复杂）
// 且 ② 总量十几个以内——都成立才走 CPU。
//   · 文本/贴图粒子（spawnText/spawnSprite：伤害数字、治疗读数、符咒碎片、贴图
//     光环）：烘焙纹理 Sprite 池，物理 = 初速度 + gravity + drag，透明度随寿命衰减
//     （fadeIn 三角），scalePop 出生弹跳，按 space 分流 world/ui 两套（UI 前景层
//     恒定屏幕尺寸、不被场景遮挡）——本门面的正当职责。
//   · 点粒子发射器（spawnEmitter）：**WebGPU 下渲染件坏死**（PointsMaterial +
//     onBeforeCompile GLSL 补丁在 WebGPU 管线失效，粒子不可见——2026-10-07 白炽
//     零特效案定案）。禁止新增消费者；存量（咏唱场景 drift/ring、Boss 剧本氛围
//     尾巴、recipes.js 的无 GPU 降级回退）待迁 GPU 池后本段删除。
// 一次性点粒子爆发（spawn）已迁 GPU 池 burst（gpu/burstFx.js 门面），不在本文件。

import * as THREE from 'three';
import { renderRichTextBlock } from '../richtext/texture.js';

const POINT_DEFAULTS = Object.freeze({
  color: 0xff5533,
  speed: 20,        // 初速（世界单位/秒），逐粒子 0.5~1.3 随机
  ttl: 0.55,        // 寿命（秒），逐粒子 0.7~1.3 随机
  gravity: -30,
  size: 1.2,        // 点大小（世界单位）
  z: 70,
  angle0: 0, angle1: Math.PI * 2, // 发射方向窗（弧度；缺省全向）
  vbx: 0, vby: 0,   // 速度偏置（叠在方向采样之后：整体漂移/升腾走它）
});

const EMITTER_DEFAULTS = Object.freeze({
  rate: 12,   // 每秒发射粒子数
  radius: 0,  // 发射位 xy 随机抖动半径（世界单位）
  outward: false, // true = 发射方向取「偏离圆心」的径向（配 radius 读作一圈圈荡开的热浪）
  zJitter: 0,     // z 逐粒子 ±抖动（纵深散布；0 = 全在同一深度切片）
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

export function createFloatFx({ max = 512, maxSprites = 64, pixelsPerWorld = 10 } = {}) {
  const ppw = pixelsPerWorld;

  // ---- 点粒子池（emitter 专用）----
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({
    size: 1, // 全局乘子留 1，实际尺寸全在 aSize 属性里
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    map: softPointTexture(), // 圆斑：无 map 时 gl_PointCoord 是实心方块（Boss 体量下火星糊成方块）
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  material.customProgramCacheKey = () => 'weky-floatfx-points-v1';
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 70;

  const pool = [];               // 活点粒子 { i, x, y, vx, vy, life, ttl, gravity, r, g, b }
  const free = Array.from({ length: max }, (_, i) => max - 1 - i);
  const emitters = [];           // 持续发射器 { x, y, acc, rate, radius, stopped, o, color }

  // ---- Sprite 池（world / ui 两套，空间分流）----
  const buildSpriteGroup = (n) => {
    const group = new THREE.Group();
    group.renderOrder = 71;   // 文本/贴图粒子在点粒子之上
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

  function spawnOne(x, y, o, color) {
    const i = free.pop();
    if (i == null) return; // 池满静默丢弃
    const angle = o.angle0 + Math.random() * (o.angle1 - o.angle0);
    const speed = o.speed * (0.5 + Math.random() * 0.8);
    // 逐粒子亮度抖动（0.75~1.3）：单色加色爆发太均质，抖出明暗层次更醒目
    const jitter = 0.75 + Math.random() * 0.55;
    sizes[i] = o.size * (0.8 + Math.random() * 0.5); // 点径同步抖动
    pool.push({
      i, x, y,
      vx: Math.cos(angle) * speed + o.vbx,
      vy: Math.sin(angle) * speed + o.vby,
      life: 0,
      ttl: o.ttl * (0.7 + Math.random() * 0.6),
      gravity: o.gravity,
      r: Math.min(1, color.r * jitter), g: Math.min(1, color.g * jitter), b: Math.min(1, color.b * jitter),
      z: o.z,
    });
  }

  /**
   * 持续点粒子发射器：每帧按 rate 累积发射，stop() 即停（已发出的粒子自然存活到 ttl）。
   * options 在点粒子参数口径上追加 rate/radius/outward/zJitter（见 EMITTER_DEFAULTS）。
   * handle 上的 `rate` 是公开可变数值字段且逐帧生效——舞台侧可用 gsap 直接补间
   * handle.rate 做进入渐升（0→满）。
   * @returns {{ rate: number, stopped: boolean, stop(): void, setPosition(x,y): void }}
   */
  function spawnEmitter(x, y, options = {}) {
    const o = { ...POINT_DEFAULTS, ...EMITTER_DEFAULTS, ...options };
    // handle 即发射器记录本体：rate/x/y/acc 直接挂在上面，外部改 rate 下帧即生效
    const handle = {
      x, y,
      rate: o.rate,              // 每秒发射数（公开可变，逐帧读）
      acc: 0,                    // 发射累积器：满 1 发 1 粒
      radius: o.radius,
      outward: o.outward,
      zJitter: o.zJitter,
      stopped: false,
      _p: { o, color: new THREE.Color(o.color) }, // 逐粒子参数（私有槽，count 不参与——每次恒发 1）
      stop() { handle.stopped = true; }, // 幂等：update 泵到即从 emitters splice 移除
      setPosition(nx, ny) { handle.x = nx; handle.y = ny; },
    };
    emitters.push(handle);
    return handle;
  }

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
    if (emitters.length > 0) {
      let dirty = false;
      for (let k = emitters.length - 1; k >= 0; k--) {
        const e = emitters[k];
        if (e.stopped) { emitters.splice(k, 1); continue; }
        e.acc += e.rate * dt;
        while (e.acc >= 1) {
          e.acc -= 1;
          // 发射位 = emitter 当前位置 + radius 内随机抖动（均匀圆盘近似：r*sqrt(u)）
          const a = Math.random() * Math.PI * 2;
          const r = e.radius * Math.sqrt(Math.random());
          // outward：发射方向改取「圆心→发射点」的径向（方向窗被压成这一条线），
          // 配 vby 上升偏置读作一圈圈向外荡开、向上蒸腾的热浪；zJitter 撒纵深
          const o = (e.outward || e.zJitter)
            ? { ...e._p.o,
                ...(e.outward ? { angle0: a, angle1: a } : null),
                z: e._p.o.z + (e.zJitter ? (Math.random() * 2 - 1) * e.zJitter : 0) }
            : e._p.o;
          spawnOne(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, o, e._p.color);
          dirty = true;
        }
      }
      if (dirty) geometry.attributes.aSize.needsUpdate = true;
    }
    if (pool.length > 0) {
      for (let k = pool.length - 1; k >= 0; k--) {
        const p = pool[k];
        p.life += dt;
        if (p.life >= p.ttl) {
          colors[p.i * 3] = 0;
          colors[p.i * 3 + 1] = 0;
          colors[p.i * 3 + 2] = 0;
          free.push(p.i);
          pool.splice(k, 1);
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const fade = 1 - p.life / p.ttl;
        positions[p.i * 3] = p.x;
        positions[p.i * 3 + 1] = p.y;
        positions[p.i * 3 + 2] = p.z;
        colors[p.i * 3] = p.r * fade;
        colors[p.i * 3 + 1] = p.g * fade;
        colors[p.i * 3 + 2] = p.b * fade;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    }
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
    spawnEmitter, spawnSprite, spawnText, update,
    points, sprites, spritesUI,
    get activeCount() { return pool.length; },
    get activeSpriteCount() { return spritePool.length; },
  };
}

// 点粒子形状：白热中心 → 边缘归零的柔斑（additive 下黑=不发光）。
// node（无 document）返回 null → 材质退回实心方点，纯逻辑测试不受影响。
let _softPoint = null;
function softPointTexture() {
  if (_softPoint) return _softPoint;
  if (typeof document === 'undefined') return null;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.82)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  _softPoint = new THREE.CanvasTexture(c);
  _softPoint.colorSpace = THREE.SRGBColorSpace;
  return _softPoint;
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
