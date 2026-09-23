// 相机导演（fx 架构脊柱之三，2026-09-22 定稿；09-23 改单点合成）：
// 四件事——命名机位库、flyTo 运镜、override 栈、**叠加偏移通道**。
//   pose 库：registerPose('bossIntro', { position, lookAt })，内容一律住 fx/scripts/
//   （Boss 专属机位跟 Boss 剧本同文件；通用机位住 scripts/cameras/）——本类只持栈与原语。
//   flyTo：补间**权威取景**（_pose.position / _lookAt / fov），不直接写相机。
//   override 栈：常规战斗逻辑栈底，Boss 战 push 自己的控制器，cutscene push 全手动，
//   pop 即还原——嵌套覆写（cutscene 打断 Boss 演出）自动正确。控制器 =
//   { poses?, onEnter?(director), onExit?(director), onTick?(dt, director) }，本类不解释内容。
//   偏移通道：setOffset(id, x, y, z) 登记一路「只叠不改基位」的瞬时位移（受击震荡、
//   推镜余震、命中顶撞…），多路各自独立、互不覆盖。
// ★ 单一落笔源纪律：**世界相机的位姿只有 commit() 一处写**。运镜写 pose、瞬时位移写
//   通道，渲染前一次性合成 ⇒ 任意多路写入者天然可叠加。旧模型让大家各自
//   cam.position = 绝对值，两路一撞就翻车：受击震荡在推镜途中启动会把画面钉在起跳位、
//   收尾再把相机硬拷回过期基位（= pyro 转段起点那一下肉眼可感的跳跃，09-23 定位）。
// 未接管时（无飞行 / 无覆写 / 无偏移）导演完全透明，不碰相机——塔楼与休息房
//   那些直接搬相机的舞台照旧自便；它们要是想被叠加，把位移写成一路 offset 即可。
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
    const cam = this._sm.camera;
    // 注视点内部状态：从基准机位反推（position + 视向 × 到原点距离≈基准注视点）
    this._lookAt = cam.position.clone()
      .add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(cam.position.length()));
    // 权威取景：commit() 按「pose + Σ 偏移」落笔，外部写入者移动相机时收回同步
    this._pose = { position: cam.position.clone(), fov: cam.fov };
    this._offsets = new Map();   // id -> Vector3 叠加偏移通道
    this._sum = new THREE.Vector3();   // 本帧合成后的偏移（commit 写相机用）
    this._applied = new THREE.Vector3(); // 上一帧写到相机上的偏移（跟随相机按增量还原）
    this._scratch = new THREE.Vector3(); // commit/_syncFrom 的临时量（免每帧分配）
    this._lookDirty = false;     // 权威注视点被外部改过：下一帧必须重新 lookAt
    this._engaged = false;       // 上一帧是否在接管相机
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

  /**
   * 取景量尺（垂直视场角 + 宽高比）——剧本按**真实视野**反解机位用。
   * 为什么暴露这个：战斗相机是 24° 长焦，视野高度 ≈ 0.42×距离，凭经验写死
   * 「退到 34u」这类坐标必然翻车（pyro 特写实拍成半张脸，09-23 教训）。
   * 要框住高度 H 的主体、占画框 f 比例 → 距离 = H / (f × 2·tan(fov/2))。
   */
  get framing() {
    const cam = this._sm.camera;
    return { fov: cam.fov ?? 50, aspect: cam.aspect ?? 16 / 9 };
  }

  /**
   * 基准战斗取景（position / lookAt / fov）——剧本要「在默认机位的基础上改」时用它，
   * 别自己抄一份球坐标常数（fov/俯角一改，抄的数就全废，09-23 已踩过两次）。
   * lookAt 用与 flyHome 同一口径：沿基准视向推进「到原点的距离」。
   */
  get basePose() {
    const base = this._sm.cameraBase;
    if (!base) return null;
    const pos = base.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(base.quaternion);
    const look = pos.clone().add(dir.multiplyScalar(pos.length()));
    return { position: { x: pos.x, y: pos.y, z: pos.z }, lookAt: { x: look.x, y: look.y, z: look.z },
      fov: base.fov ?? this._sm.camera.fov };
  }

  // ---- 运镜 ----

  /**
   * 飞到机位（后到先赢：掐断在途飞行）。返回完成 Promise——**必达**：
   * 正常到位 resolve(true)；被后来的 flyTo 抢飞 / dispose 掐断 resolve(false)
   * （契约同 runScript：await 它的剧本协程永不停在半空）。
   * 补间对象是权威取景（pose/_lookAt），不是相机本体——震荡之类的叠加层
   * 因此可以在运镜全程继续生效（旧版会被运镜覆盖掉，或者反过来把运镜钉住）。
   */
  flyTo(poseOrName, { durationMs = 600, ease = 'power2.inOut' } = {}) {
    const pose = typeof poseOrName === 'string' ? this._poses.get(poseOrName) : poseOrName;
    if (!pose) {
      console.warn(`[fx/camera] 未知机位：${poseOrName}`);
      return Promise.resolve(false);
    }
    this._killFlight();
    this._lookDirty = true; // 起手必须先按新注视点定向一次（pose 不带 lookAt 时也保持指向）
    const look = pose.lookAt
      ? { x: pose.lookAt.x, y: pose.lookAt.y, z: pose.lookAt.z }
      : { x: this._lookAt.x, y: this._lookAt.y, z: this._lookAt.z };
    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          if (this._flight?.tl === tl) this._flight = null;
          // 收尾这一帧起 `_flight` 不再强制定向：置脏，让最后一帧落在精确注视点上
          this._lookDirty = true;
          resolve(true);
        },
      });
      tl.to(this._pose.position, { x: pose.position.x, y: pose.position.y, z: pose.position.z,
        duration: durationMs / 1000, ease }, 0);
      tl.to(this._lookAt, { ...look, duration: durationMs / 1000, ease }, 0);
      // pose 带 fov 就连视场角一起飞（长焦/广角切换是构图的一部分）；缺省不动 fov
      if (pose.fov != null) {
        tl.to(this._pose, { fov: pose.fov, duration: durationMs / 1000, ease }, 0);
      }
      this._flight = { tl, resolve };
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

  // ---- 叠加偏移通道 ----

  /**
   * 登记/更新一路叠加偏移（渲染期相机位 = 权威取景 + Σ 各通道）。
   * 通道之间只求和、不争所有权：震荡照旧震，推镜照旧飞。
   * z 一般留 0（沿视向推拉会被透视放大成缩放感，横/纵向才是"震"）。
   */
  setOffset(id, x = 0, y = 0, z = 0) {
    let v = this._offsets.get(id);
    if (!v) { v = new THREE.Vector3(); this._offsets.set(id, v); }
    return v.set(x, y, z);
  }

  /** 撤掉一路偏移（震荡收尾/剧本 dispose 必调，残留会把相机永久推歪）。 */
  clearOffset(id) { return this._offsets.delete(id); }

  /** 本帧合成偏移（commit 求和后缓存；只读语义，别改）。 */
  get offsetSum() { return this._sum; }

  /** 直接改权威注视点（override 控制器要做「镜头自己晃一下视线」时用）。
   *  只在导演接管期间有意义：无人运镜/无偏移时下一帧就被相机现状收回。 */
  setLookAt(x, y, z) {
    this._lookAt.set(x, y, z);
    this._lookDirty = true;
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
    if (this._stack.length === 0) {
      this._sm.restoreBaseCamera();
      // 直写相机之后必须收回权威取景：否则还在生效的偏移通道（震荡未收尾）会拿
      // 上一份 pose 把刚还原的基准机位顶掉一帧
      this._syncFrom(this._sm.camera);
    } else if (wasTop) this._stack[this._stack.length - 1].controller.onEnter?.(this); // 露出下层：重新生效
    return true;
  }

  get current() { return this._stack.length ? this._stack[this._stack.length - 1] : null; }

  /** 每帧转发给栈顶控制器（StageManager.onTick 接一次即可）。 */
  tick(dtSeconds) {
    this.current?.controller.onTick?.(dtSeconds, this);
  }

  /**
   * 渲染前落笔（StageManager 在两遍渲染之前调）：世界相机 = 权威取景 + Σ 叠加偏移。
   * 这是全工程唯一写世界相机位姿的地方——各路写入者（运镜、震荡、常驻微运动）
   * 都只改自己的那份数据，所以天然可叠加、也不会互相钉住/拷回过期值。
   * 没在接管（无飞行、无覆写、无偏移）时完全透明：把相机现状收回权威取景后直接返回，
   * 塔楼/休息房那些自己搬相机的舞台不受干扰。
   */
  commit() {
    const cam = this._sm.camera;
    const sum = this._sum.set(0, 0, 0);
    for (const v of this._offsets.values()) sum.add(v);
    const engaged = !!this._flight || !!this.current || sum.lengthSq() > 0;
    if (!engaged && !this._engaged) { this._syncFrom(cam); return; }
    // UI 正交相机 = 跟随者：导演不管它的取景，只把偏移**增量**转嫁过去
    // （双 pass 同步位移才是真·全屏震；退场/收尾时 sum=0，增量正好把它抹平）
    const ui = this._sm.uiCamera;
    if (ui) ui.position.add(this._scratch.copy(sum).sub(this._applied));
    this._applied.copy(sum);
    cam.position.copy(this._pose.position).add(sum);
    if (this._lookDirty || this._flight) cam.lookAt(this._lookAt);
    this._lookDirty = false;
    if (cam.fov !== this._pose.fov) {
      cam.fov = this._pose.fov;
      cam.updateProjectionMatrix();
    }
    this._engaged = engaged;
  }

  /** 撤掉全部叠加偏移并把跟随相机抹平（舞台退场：偏移不许漏给下一舞台）。 */
  releaseOffsets() {
    const ui = this._sm.uiCamera;
    if (ui && this._applied.lengthSq() > 0) ui.position.sub(this._applied);
    this._offsets.clear();
    this._sum.set(0, 0, 0);
    this._applied.set(0, 0, 0);
    this._engaged = false;
  }

  // 无人运镜时把相机现状收回权威取景（外部写入者 = 基位的主人）
  _syncFrom(cam) {
    this._pose.position.copy(cam.position);
    this._pose.fov = cam.fov;
    const dir = this._scratch.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this._lookAt.copy(cam.position).add(dir.multiplyScalar(cam.position.length()));
  }

  /** 舞台退出收尾：清空栈 + 掐断在途飞行 + 清空机位库 + 还原基准机位（换场即忘）。 */
  dispose() {
    this._killFlight();
    while (this._stack.length) this.popOverride(this._stack[this._stack.length - 1].id);
    this._poses.clear(); // 机位随舞台走：Boss push 的命名机位不漏进下一场
    this._sm.restoreBaseCamera();
    this.releaseOffsets(); // 基准机位已直写，这里只负责抹掉残留偏移
  }

  // 掐断在途飞行：promise 也一并 resolve(false)——await 方不许挂死
  _killFlight() {
    const f = this._flight;
    if (!f) return;
    this._flight = null;
    try { f.tl.kill(); } catch (_) {}
    f.resolve(false);
  }
}

/**
 * 「长焦平视」派生机位（对抗镜头的通用原语）：注视点与方位**都不动**，只把视场角
 * 压小、俯角压平，并按新 fov 反解距离以保住原来的取景范围。
 * 为什么走这条路而不是把镜头怼到主体脸上：对抗感来自**透视压缩**——远机位 + 窄视场
 * 会把前后两排拉到同一层平面上（长焦的老手艺），而推近特写只是把队友挤出画框、
 * 把回合制对撞拍成了大头照（pyro P2 实拍定论 2026-09-23）。
 * @param {{position:{x,y,z}, lookAt:{x,y,z}, fov:number}} base 基准取景（CameraDirector#basePose）
 * @param {number} fovScale 视场角缩放（<1 = 更长焦）
 * @param {number} elScale 俯角缩放（<1 = 更平视）
 * @param {number} cover 取景范围缩放（1 = 与基准同宽同高，>1 收进更多内容）
 * @returns {{position, lookAt, fov}} 可直接喂 flyTo / registerPose
 */
export function duelPose(base, { fovScale = 0.8, elScale = 0.55, cover = 1 } = {}) {
  const l = base.lookAt;
  const dx = base.position.x - l.x;
  const dy = base.position.y - l.y;
  const dz = base.position.z - l.z;
  const dist0 = Math.hypot(dx, dy, dz);
  const el0 = Math.asin(dy / dist0);
  const az0 = Math.atan2(-dx, dz); // 与 StageManager 落位式同构（x=-sin az·cos el·d，z=cos az·cos el·d）
  const halfTan = (deg) => Math.tan(THREE.MathUtils.degToRad(deg / 2));
  const fov = base.fov * fovScale;
  const dist = dist0 * (halfTan(base.fov) / halfTan(fov)) * cover; // 视野高 = 2tan(fov/2)·d，取同高反解
  const el = el0 * elScale;
  return {
    fov,
    position: {
      x: l.x - Math.sin(az0) * Math.cos(el) * dist,
      y: l.y + Math.sin(el) * dist,
      z: l.z + Math.cos(az0) * Math.cos(el) * dist,
    },
    lookAt: { x: l.x, y: l.y, z: l.z },
  };
}

/** 一个机位（{position,lookAt,fov}）在注视平面上的可见高度——剧本按它给尺度（余烬散布、
 *  微运动幅度），而不是写死世界坐标。 */
export function viewHeightOf(pose) {
  const d = Math.hypot(pose.position.x - pose.lookAt.x, pose.position.y - pose.lookAt.y,
    pose.position.z - pose.lookAt.z);
  return 2 * Math.tan(THREE.MathUtils.degToRad((pose.fov ?? 24) / 2)) * d;
}

export function createCameraDirector(stageManager) { return new CameraDirector(stageManager); }
