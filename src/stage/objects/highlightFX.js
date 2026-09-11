// HighlightFX：资源徽章的高亮特效件（魏启水晶 / AP 金币共用）。
// 组成（全部装在一个 Group 内，调用方摆位/定 z）：
//   ├─ glow: 呼吸感光晕 plane（径向渐变贴图 + AdditiveBlending，透明度随包络×呼吸波）
//   └─ 粒子池: 升腾粒子（软圆点，颜色在指定色板间取；上升+微漂移，缩放淡入淡出）
// 状态衔接：update(dt, level) 的 level∈[0,1] 为目标强度，内部包络缓动趋近——
// 状态切换天然淡入淡出（离开高亮时余存粒子随包络收缩收尾，无硬切）。
// node 无 document 时不建任何 mesh（Group 空，update 无操作）——单测可安全构造。

import * as THREE from 'three';

const ENV_RATE = 6;      // 包络趋近速率（/s）：约 0.3s 淡入淡出
const BREATHE_FREQ = 3;  // glow 呼吸频率（rad/s）

export class HighlightFX {
  /**
   * @param {object} opts
   *   glowColor: 光晕色（number hex）
   *   glowSize:  光晕边长（世界单位，含衰减余量 ≈ 图标直径 ×1.8）
   *   particleColors: 粒子色板（交替取用；如魏启 [淡蓝, 洋红]、AP [金, 白]）
   *   particleSize / spread / rise: 粒子尺寸 / 发射带半宽 / 升腾高度
   */
  constructor({
    glowColor = 0xffffff, glowSize = 6,
    particleColors = ['#ffffff'], particleSize = 0.55,
    spread = 2, rise = 3.4, count = 12,
  } = {}) {
    this.group = new THREE.Group();
    this._spread = spread;
    this._rise = rise;
    this._level = 0;   // 当前包络（0..1）
    this._target = 0;  // 目标强度
    this._time = 0;

    if (typeof document === 'undefined') {
      this._glow = null;
      this._particles = [];
      return;
    }
    const glowTex = bakeRadialTexture();
    this._glow = new THREE.Mesh(
      new THREE.PlaneGeometry(glowSize, glowSize),
      new THREE.MeshBasicMaterial({
        map: glowTex, color: glowColor, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.group.add(this._glow);

    const dotTex = bakeRadialTexture();
    this._particles = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(particleSize, particleSize),
        new THREE.MeshBasicMaterial({
          map: dotTex, color: new THREE.Color(
            particleColors[i % particleColors.length]),
          transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      // 粒子错峰起始：进场即有均匀分布的升腾流，无需等首个发射周期填满
      const p = { mesh, life: -Math.random(), ttl: 0.9 + Math.random() * 0.5, vx: 0, vy: 0 };
      this._respawn(p, true);
      this._particles.push(p);
    }
  }

  /** 帧推进：level 为目标强度（1=高亮，0=熄灭），包络缓动 + 呼吸 glow + 粒子升腾。 */
  update(dt, level) {
    this._target = level;
    this._time += dt;
    const k = Math.min(1, dt * ENV_RATE);
    this._level += (this._target - this._level) * k;
    if (Math.abs(this._target - this._level) < 0.01) this._level = this._target;

    if (this._glow) {
      const breathe = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(this._time * BREATHE_FREQ));
      this._glow.material.opacity = this._level * 0.55 * breathe;
      this._glow.visible = this._level > 0.02;
    }
    if (!this._particles.length) return;
    const active = this._level > 0.05;
    for (const p of this._particles) {
      p.life += dt;
      if (p.life >= p.ttl) {
        if (active) this._respawn(p, false);
        else { p.mesh.visible = false; p.life = p.ttl; continue; }
      }
      if (p.life < 0) { p.mesh.visible = false; continue; } // 错峰延迟点火期不升腾
      const frac = p.life / p.ttl;                 // 0..1 生命周期
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, frac))); // 升起淡入→淡出
      const s = fade * (0.5 + 0.5 * this._level);  // 状态退出时随包络收缩
      p.mesh.scale.set(Math.max(0.001, s), Math.max(0.001, s), 1);
      p.mesh.visible = s > 0.02;
    }
  }

  _respawn(p, seed) {
    p.life = seed ? p.life * p.ttl : 0;           // 构造期错峰：负 life = 延迟点火
    p.ttl = 0.9 + Math.random() * 0.5;
    p.vx = (Math.random() - 0.5) * 0.5;
    p.vy = this._rise * (0.55 + Math.random() * 0.45);
    p.mesh.position.set((Math.random() - 0.5) * this._spread, 0, 0);
    if (!seed) p.mesh.visible = true;
  }

  dispose() {
    for (const p of this._particles ?? []) {
      p.mesh.geometry.dispose();
      p.mesh.material.map?.dispose?.();
      p.mesh.material.dispose();
    }
    this._particles = [];
    if (this._glow) {
      this._glow.geometry.dispose();
      this._glow.material.map?.dispose?.();
      this._glow.material.dispose();
    }
    this.group.parent?.remove(this.group);
  }
}

// 径向渐变贴图（glow 与粒子共用）：中心实、指数衰减到边
export function bakeRadialTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ScalePop：单峰放缩脉冲（资源数值变动弹跳）。数值变化时 trigger()，
// 宿主 update(dt) 内 step(mesh, dt) 推进——1 → 1+amp → 1 的 sin 单峰曲线，
// 中点峰值、两端速度为零，起放与回落都柔和；静息时零开销不动 mesh。
export class ScalePop {
  constructor({ duration = 0.35, amp = 0.28 } = {}) {
    this._duration = duration;
    this._amp = amp;
    this._t = Infinity;
  }

  trigger() { this._t = 0; }

  step(mesh, dt) {
    if (this._t >= this._duration) return;
    this._t = Math.min(this._duration, this._t + dt);
    const s = 1 + this._amp * Math.sin(Math.PI * (this._t / this._duration));
    mesh.scale.set(s, s, 1);
    if (this._t >= this._duration) mesh.scale.set(1, 1, 1);
  }
}
