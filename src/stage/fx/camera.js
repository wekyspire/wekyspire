// 相机导演（fx 架构脊柱之三，2026-09-22 定稿）：
// 三件事——命名机位库、flyTo 运镜、override 栈。
//   pose 库：registerPose('bossIntro', { position, lookAt })，内容一律住 fx/scripts/
//   （Boss 专属机位跟 Boss 剧本同文件；通用机位住 scripts/cameras/）——本类只持栈与原语。
//   flyTo：补间 position + 注视点（lookAt 目标作为内部状态连续补间，避免四元数硬切）。
//   override 栈：常规战斗逻辑栈底，Boss 战 push 自己的控制器，cutscene push 全手动，
//   pop 即还原——嵌套覆写（cutscene 打断 Boss 演出）自动正确。控制器 =
//   { poses?, onEnter?(director), onExit?(director), onTick?(dt, director) }，本类不解释内容。
// 铁律沿用 StageManager：借用相机的舞台退出时必须清空栈 + restoreBaseCamera()。
import * as THREE from 'three';
import gsap from 'gsap';

export class CameraDirector {
  /** @param {StageManager} stageManager */
  constructor(stageManager) {
    this._sm = stageManager;
    this._poses = new Map();
    this._stack = [];            // [{ id, controller }]，栈顶 = 生效者
    this._flight = null;         // 在途 flyTo 补间（后到先赢）
    // 注视点内部状态：从基准机位反推（position + 视向 × 到原点距离≈基准注视点）
    const cam = this._sm.camera;
    this._lookAt = cam.position.clone()
      .add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(cam.position.length()));
  }

  // ---- 机位库 ----

  /** pose = { position: {x,y,z}, lookAt?: {x,y,z} }（lookAt 缺省 = 保持当前注视点）。 */
  registerPose(name, pose) {
    if (this._poses.has(name)) console.warn(`[fx/camera] 机位重名覆盖：${name}`);
    this._poses.set(name, pose);
    return pose;
  }

  getPose(name) { return this._poses.get(name) ?? null; }

  /** 当前注视点（只读拷贝）。 */
  get lookAt() { return this._lookAt.clone(); }

  // ---- 运镜 ----

  /**
   * 飞到机位（后到先赢：掐断在途飞行）。返回完成 Promise。
   * 剧本里用法：await ctx 包装或裸 await director.flyTo('bossIntro', { durationMs: 800 })。
   */
  flyTo(poseOrName, { durationMs = 600, ease = 'power2.inOut' } = {}) {
    const pose = typeof poseOrName === 'string' ? this._poses.get(poseOrName) : poseOrName;
    if (!pose) {
      console.warn(`[fx/camera] 未知机位：${poseOrName}`);
      return Promise.resolve(false);
    }
    this._killFlight();
    const cam = this._sm.camera;
    const look = pose.lookAt
      ? { x: pose.lookAt.x, y: pose.lookAt.y, z: pose.lookAt.z }
      : { x: this._lookAt.x, y: this._lookAt.y, z: this._lookAt.z };
    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => { this._flight = null; resolve(true); },
      });
      tl.to(cam.position, { x: pose.position.x, y: pose.position.y, z: pose.position.z, duration: durationMs / 1000, ease }, 0);
      tl.to(this._lookAt, { ...look, duration: durationMs / 1000, ease,
        onUpdate: () => cam.lookAt(this._lookAt) }, 0);
      this._flight = tl;
    });
  }

  /** 回基准机位（补间版 restoreBaseCamera——舞台退场的收尾运镜）。 */
  flyHome(opts = {}) {
    const base = this._sm.cameraBase;
    if (!base) return Promise.resolve(false);
    // 基准注视点 = 基准位置沿基准视向反推
    const pos = base.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(base.quaternion);
    const look = pos.clone().add(dir.multiplyScalar(pos.length()));
    return this.flyTo({ position: pos, lookAt: look }, opts);
  }

  // ---- override 栈 ----

  /** 压入相机控制器（其 poses 就地登记，onEnter 立即生效）。同 id 重 push = 替换。
   *  栈顶唯一生效纪律：压栈时旧栈顶退激活（onExit），弹栈时新栈顶重新激活（onEnter）。 */
  pushOverride(id, controller = {}) {
    this.popOverride(id); // 幂等
    this.current?.controller.onExit?.(this); // 旧栈顶退激活（对称于 pop 的重新激活）
    this._stack.push({ id, controller });
    for (const [name, pose] of Object.entries(controller.poses ?? {})) this.registerPose(name, pose);
    controller.onEnter?.(this);
    return controller;
  }

  /** 弹出指定控制器（不必栈顶）；栈空 = 回基准机位（瞬时，交给舞台契约）。
   *  仅当被弹的是栈顶时才重新激活新栈顶（弹中层不惊动现行控制器）。 */
  popOverride(id) {
    const i = this._stack.findIndex(e => e.id === id);
    if (i < 0) return false;
    const wasTop = i === this._stack.length - 1;
    const [entry] = this._stack.splice(i, 1);
    entry.controller.onExit?.(this);
    if (this._stack.length === 0) this._sm.restoreBaseCamera();
    else if (wasTop) this._stack[this._stack.length - 1].controller.onEnter?.(this); // 露出下层：重新生效
    return true;
  }

  get current() { return this._stack.length ? this._stack[this._stack.length - 1] : null; }

  /** 每帧转发给栈顶控制器（StageManager.onTick 接一次即可）。 */
  tick(dtSeconds) {
    this.current?.controller.onTick?.(dtSeconds, this);
  }

  /** 舞台退出收尾：清空栈 + 掐断在途飞行 + 还原基准机位。 */
  dispose() {
    this._killFlight();
    while (this._stack.length) this.popOverride(this._stack[this._stack.length - 1].id);
    this._sm.restoreBaseCamera();
  }

  _killFlight() {
    if (!this._flight) return;
    try { this._flight.kill(); } catch (_) {}
    this._flight = null;
  }
}

export function createCameraDirector(stageManager) { return new CameraDirector(stageManager); }
