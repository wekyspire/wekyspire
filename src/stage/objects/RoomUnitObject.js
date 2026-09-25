// RoomUnitObject：休息房场景里的**单位立牌**（骑士 / 瑞米 / 未来店主等 NPC）。
//
// 与战斗 UnitObject 的分工：那是带血条/意图/效果行的战斗件；这是纯场景演员——
// 只有 billboard 本体，无任何状态 UI（用户 2026-09-25 定：房间单位不显示生命值）。
//
// 动效全走「billboard 线性变换」（用户 2026-09-25 定：真做动画太麻烦）：
//   · 移动 = 一连串抛物线小跳（hop），起跳压缩/落地压扁的 squash & stretch；
//   · 朝向 = 面板镜像翻转（scale.x 取负）；
//   · 形态 = 换立牌贴图（pose 表：idle/sit/curious/…素材缺位自动回落 idle）。
// 面向相机：与机器浮标同款逐帧水平转正。
//
// 指令化（后端驱动，直播友好）：本对象只认描述符化的 op（moveTo/pose/face/wander），
// 由 RoomStage 的 roomUnits 导演（stages/roomUnits.js）翻译下发——描述符全部为
// 可序列化纯数据，未来 wire 回放可直接重放同一条指令流。

import * as THREE from 'three';

const DEFAULT_HEIGHT = 10; // 立牌世界高度（骑士 12，瑞米 6——由导演按单位给）
const HOP_HEIGHT = 1.6;    // 单跳抛物线峰高（世界单位）
const HOP_DIST = 4.2;      // 单跳水平距离（超过则拆多跳）

export class RoomUnitObject extends THREE.Group {
  /**
   * @param {object} options
   *   name: 单位名（'knight' | 'remi' | …，指令寻址用）
   *   unitArt: UnitArtCache（缺省 null = 永远占位色块，node 单测用）
   *   art: { idle: 'unit_player_front.png', sit: 'remi_pose_sit.webp', … }
   *        pose 名 → 素材文件名（经缓存 getFile 解析；idle 必给）
   *   standeeHeight: 立牌世界高度
   */
  constructor({ name, unitArt = null, art = {}, standeeHeight = DEFAULT_HEIGHT } = {}) {
    super();
    this.name = `room-unit:${name}`;
    this.unitName = name;
    this._unitArt = unitArt;
    this._art = art;
    this._standeeHeight = standeeHeight;
    this._pose = 'idle';
    this._facing = 1;            // +1 右 / -1 左（镜像系数）
    this._artAttached = false;
    this._hop = null;            // 在途跳：{from, to, t, dur, resolve}
    this._hopQueue = [];         // 后续跳段
    this._bobT = Math.random() * 10; // 待机呼吸相位（去同步）

    this._billboard = new THREE.Group();
    this._billboard.name = 'billboard';
    this.add(this._billboard);
    this._body = new THREE.Mesh(
      new THREE.PlaneGeometry(standeeHeight, standeeHeight),
      new THREE.MeshBasicMaterial({ color: 0x2a2f3a, transparent: true }),
    );
    this._body.position.y = standeeHeight / 2;
    this._billboard.add(this._body);
    this._applyPoseArt();
  }

  /** 贴图晚到补挂：宿主（导演）在 unitArt.addOnLoad 里调一次即可。 */
  refreshArt() {
    this._artAttached = false;
    this._applyPoseArt();
  }

  _applyPoseArt() {
    const file = this._art[this._pose] ?? this._art.idle;
    const img = file ? this._unitArt?.getFile?.(file) : null;
    if (!img) return;                       // 未就绪/无素材：保占位，等 refreshArt
    const aspect = img.naturalWidth / img.naturalHeight;
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    const old = this._body.material.map;
    this._body.material.map = tex;
    this._body.material.color.set(0xffffff);
    this._body.material.needsUpdate = true;
    old?.dispose?.();
    this._body.geometry.dispose();
    this._body.geometry = new THREE.PlaneGeometry(this._standeeHeight * aspect, this._standeeHeight);
    this._body.position.y = this._standeeHeight / 2;
    this._artAttached = true;
  }

  get pose() { return this._pose; }
  get moving() { return !!this._hop || this._hopQueue.length > 0; }

  /** 形态切换（素材缺位静默回落 idle——描述符安全）。返回是否真的换了。 */
  setPose(pose) {
    if (!pose || pose === this._pose) return false;
    this._pose = (pose in this._art) ? pose : 'idle';
    this._applyPoseArt();
    return true;
  }

  /** 朝向：+1 面右 / -1 面左（镜像翻面）。 */
  face(dir) {
    const d = dir >= 0 ? 1 : -1;
    if (d === this._facing) return;
    this._facing = d;
    this._billboard.scale.x = d;   // 负值镜像（贴图水平翻转）
  }

  /**
   * 跳跳移动：把 (x,z) 直线拆成若干抛物线小跳排队播放。
   * 返回 Promise（全部跳完 resolve；被新指令打断也 resolve——描述符幂等不悬挂）。
   */
  moveTo(x, z, { hopHeight = HOP_HEIGHT } = {}) {
    for (const h of [this._hop, ...this._hopQueue]) h?.resolve?.();
    this._hopQueue.length = 0;
    this._hop = null;
    const from = { x: this.position.x, z: this.position.z };
    const dx = x - from.x, dz = z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return Promise.resolve();
    this.face(dx !== 0 ? dx : this._facing);
    const hops = Math.max(1, Math.ceil(dist / HOP_DIST));
    const segs = [];
    for (let i = 1; i <= hops; i++) {
      segs.push({
        from: { x: from.x + dx * ((i - 1) / hops), z: from.z + dz * ((i - 1) / hops) },
        to: { x: from.x + dx * (i / hops), z: from.z + dz * (i / hops) },
      });
    }
    const distPer = dist / hops;
    return new Promise((resolve) => {
      this._hopQueue = segs.map(s => ({ ...s, h: hopHeight, dur: Math.max(0.34, distPer * 0.12), resolve: null }));
      // 链尾 resolve：全部跳完才算到
      this._hopQueue[this._hopQueue.length - 1].resolve = resolve;
      this._nextHop();
    });
  }

  _nextHop() {
    this._hop = this._hopQueue.shift() ?? null;
    if (!this._hop) return;
    this._hop.t = 0;
  }

  /** 帧驱动：跳的抛物线 + squash&stretch + 待机呼吸 + 面向相机（水平转正）。 */
  tick(dt, camera) {
    if (this._hop) {
      const h = this._hop;
      h.t = Math.min(1, h.t + dt / h.dur);
      const k = h.t;
      this.position.x = h.from.x + (h.to.x - h.from.x) * k;
      this.position.z = h.from.z + (h.to.z - h.from.z) * k;
      const arc = Math.sin(k * Math.PI);          // 抛物线
      this._billboard.position.y = arc * h.h;
      // 压缩拉伸：起跳/落地压扁（y 压 x 拉伸），空中拉长
      const squash = Math.sin(k * Math.PI * 2);   // -1..1..-1
      this._billboard.scale.y = 1 + squash * 0.16;
      this._billboard.scale.x = (this._facing) * (1 - squash * 0.12);
      if (k >= 1) {
        this._billboard.position.y = 0;
        this._billboard.scale.y = 1;
        this._billboard.scale.x = this._facing;
        const done = this._hop;
        this._nextHop();
        done.resolve?.();
      }
    } else {
      // 待机呼吸：轻微上下 + 缩放（跳跳世界观的"活物感"）
      this._bobT += dt;
      const b = Math.sin(this._bobT * 2.1);
      this._billboard.position.y = Math.max(0, b) * 0.14;
      this._billboard.scale.y = 1 + b * 0.02;
      this._billboard.scale.x = this._facing * (1 - b * 0.02);
    }
    // 面向相机（只水平转正，不俯仰）
    if (camera) {
      const dx = camera.position.x - this.position.x;
      const dz = camera.position.z - this.position.z;
      this.rotation.y = Math.atan2(dx, dz);
    }
  }

  dispose() {
    this._body.material.map?.dispose?.();
    this._body.material.dispose();
    this._body.geometry.dispose();
    for (const h of [this._hop, ...this._hopQueue]) h?.resolve?.();
    this._hop = null;
    this._hopQueue.length = 0;
  }
}
