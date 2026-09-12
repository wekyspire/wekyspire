// MachineMarkerObject：休息房里"这台能点"的浮标（用户定 2026-09-11，2026-09-12 大幅简化）。
//
// 形态沿革：早先是「地面光环 + 菱形 + 光柱」三件套，用户要求**大幅简化**——
// **去掉地面光圈与光柱，只留机器上方一枚跳动的发光箭头**（箭尖朝下指着机器）。
// 材质走 MeshBasicMaterial + 颜色乘到 >1：吃 HDR 亮部通道，读作"自己在发光"；
// 跳动是 |sin| 起落 + 落地轻微压扁，hover/聚焦时整体放大提亮。
//
// 纯 Stage 层：自带材质与时序，宿主只喂 dt 与 highlight（0/1），自己不读任何游戏状态。

import * as THREE from 'three';

const GOLD = 0xffe08a;
const H = 2.6;          // 箭头总高（size=1 时）：箭尖在 y=0，箭杆顶在 y=H
const PERIOD = 1.1;     // 一次跳动周期（秒）

export class MachineMarkerObject extends THREE.Group {
  /**
   * @param {object} options
   *   size: 整体缩放（世界单位；机器体量越大给越大）
   *   tint: 发光色（缺省金）
   */
  constructor({ size = 1.2, tint = GOLD } = {}) {
    super();
    this._base = new THREE.Color(tint).multiplyScalar(1.6);   // >1 = HDR 亮部（发光感）
    this._mat = new THREE.MeshBasicMaterial({ color: this._base.clone() });
    this._t = Math.random() * PERIOD;
    this._k = 0;        // 高亮缓动（hover/聚焦）
    this._want = 0;

    const s = size;
    // 箭杆（方柱，配体素风）
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 1.35 * s, 0.62 * s), this._mat);
    shaft.position.y = (1.25 + 0.675) * s;
    // 箭尖：四棱锥朝下；转 45° 让一个面正对镜头（剪影读作箭头而不是菱形）
    const head = new THREE.Mesh(new THREE.ConeGeometry(1.05 * s, 1.5 * s, 4), this._mat);
    head.rotation.z = Math.PI;
    head.rotation.y = Math.PI / 4;
    head.position.y = 0.75 * s;
    this.add(shaft, head);
    this._shaft = shaft;
    this._head = head;
    // 命中盒（透明）：远景也好点——箭头本体细，单独放大可点范围
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(2.6 * s, H * s, 2.6 * s),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.position.y = H * s / 2;
    this.add(hit);
    this._hit = hit;
    this.scale.setScalar(1);
  }

  /** hover / 聚焦高亮（0 = 常态，1 = 提亮放大）。 */
  setHighlight(on) { this._want = on ? 1 : 0; }

  /** 帧驱动：跳动（|sin| 起落 + 落地压扁）+ 呼吸发光 + 高亮缓动。 */
  update(dt) {
    this._t += dt;
    this._k += (this._want - this._k) * Math.min(1, dt * 7);
    const phase = (this._t % PERIOD) / PERIOD;
    const lift = Math.abs(Math.sin(Math.PI * phase));        // 0（落地）→ 1（最高）
    const squash = 1 - 0.1 * (1 - lift);                     // 起跳/落地时压一下
    const g = 1 + 0.18 * this._k;
    this.scale.set(g * (1 + 0.06 * (1 - lift)), g * squash, g * (1 + 0.06 * (1 - lift)));
    // 发光呼吸 + 高亮提亮（乘在基准色上，保色相）
    const pulse = (1 + 0.13 * Math.sin(this._t * 4.4)) * (1 + 0.4 * this._k);
    this._mat.color.copy(this._base).multiplyScalar(pulse);
  }

  dispose() {
    for (const m of [this._shaft, this._head, this._hit]) m.geometry.dispose();
    this._mat.dispose();
    this._hit.material.dispose();
  }
}

export { H as MARKER_HEIGHT, PERIOD as MARKER_PERIOD };
