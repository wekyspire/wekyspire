// StageManager（§4.1）：单全屏 canvas 的 three.js 舞台总管。
// 世界坐标约定：z=0 平面上屏幕高度 ≈ 100 世界单位，y 向上，x 向右。
// 布局一律用世界坐标计算；resize 只改相机视锥，不动任何场景对象。
// 相机选小 FOV PerspectiveCamera + 斜方向俯视（用户定）：
//   眼高高于场景内全部水平面（地板/柱帽），透视方向全场一致——不出现"地板俯视、
//   柱顶仰视"的矛盾（眼高若夹在场景中部，眼上物露底面、眼下物露顶面，读起来像两个视角）。
//   azimuth 让相机从右侧斜看向场景（纵深/体积感更强）；
//   lookAt 压低给底部手牌栏留构图空间；z=0 平面与正交近似一致（布局/映射不变）。
// 显示假设：游玩分辨率固定 16:9（1920x1080，z=0 世界宽 ≈177.8），不做其它比例适配。

import * as THREE from 'three';

export const WORLD_HEIGHT = 100;
export const CAMERA_FOV = 24;        // 小视场角（度）：≈正交的稳定比例 + 可感纵深
export const CAMERA_AZIMUTH = -34;   // 度：斜方向——相机在敌人（+x）一侧斜看向场景（用户定，右侧视角）
export const CAMERA_ELEVATION = 20;  // 度：俯视角（眼高必须高于场内一切水平面，否则水平面露底=仰视矛盾）
export const CAMERA_LOOK_AT = Object.freeze({ x: 0, y: -15, z: 0 }); // 视轴锚在牌桌上方，底部留给手牌构图
// 世界相机取景缩放（用户定 2026-09：0.79 ≈ 距离 235→185）。房间 PCG 道具全面 2x+ 放大后，
// 原距离下战场空旷感强；拉近让房间/道具铺满画面。只作用于世界相机距离——worldHeight/
// UI 正交视锥/布局坐标系全部不动（UI 取景、布局、拾取反投影不受影响），代价是 z=0 平面
// 可视高 ≈79（画面外圈内容出画，由房型配方按新机位校核）。
export const CAMERA_ZOOM = 0.79;
// UI 相机（牌桌覆盖层专用）：独立 OrthographicCamera 正视角（用户定）。
// 透视 UI 相机让卡牌/UI 吃透视畸变——z 层不同投影缩放/偏移不同（咏唱槽 z=4 vs
// 手牌 z=20+ 位置错乱、卡牌飞行 z 变化时忽大忽小）；正交下布局坐标↔屏幕线性映射，
// 拾取/拖拽反投影也线性，一类问题全消。
export const UI_CAMERA_LOOK_AT_Y = -15; // 取景中心 y（底部留手牌构图，与旧透视 UI 相机同框架）
export const UI_CAMERA_Z = 500;         // 正交相机位置只决定可见 z 区间，不改投影

// 世界内 z 分层（renderOrder 约定，数值即约定本身，勿散写魔法数）
export const Z_LAYERS = Object.freeze({
  BACKGROUND: 0,
  TABLE: 10,
  HAND_CARD: 20,     // 手牌在 LayoutEngine 里另有 10+i 的局部 z（挂到 HAND_CARD 层组内）
  UNIT: 30,
  PARTICLE: 40,
  EFFECT: 50,
});

export class StageManager {
  /**
   * @param {object} options
   *   worldHeight: number = 100
   *   createRenderer: ({canvas}) => renderer-like   缺省 new THREE.WebGLRenderer（浏览器）；
   *     单测注入假 renderer（{ render(){}, setSize(){}, dispose(){} }）
   */
  constructor(options = {}) {
    this._worldHeight = options.worldHeight || WORLD_HEIGHT;
    this._createRenderer = options.createRenderer || (({ canvas }) => new THREE.WebGLRenderer({ canvas, antialias: true }));
    this._renderer = null;
    this._camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
    // 相机距离：让 z=0 平面的可视高恰好 = worldHeight（与旧正交约定无缝衔接），
    // 再乘 CAMERA_ZOOM 取景缩放（拉近出画的部分由场景内容本身兜底：夜空/雾/墙顶铁律）
    this._cameraDistance = ((this._worldHeight / 2)
      / Math.tan(THREE.MathUtils.degToRad(this._camera.fov / 2))) * CAMERA_ZOOM;
    // 斜方向俯视：lookAt + 球坐标偏移（azimuth 绕 y、elevation 俯角）。
    // 眼高高于场内一切水平面（透视方向一致性的根），视轴锚在牌桌上方
    const az = THREE.MathUtils.degToRad(CAMERA_AZIMUTH);
    const el = THREE.MathUtils.degToRad(CAMERA_ELEVATION);
    this._camera.position.set(
      CAMERA_LOOK_AT.x - Math.sin(az) * Math.cos(el) * this._cameraDistance,
      CAMERA_LOOK_AT.y + Math.sin(el) * this._cameraDistance,
      CAMERA_LOOK_AT.z + Math.cos(az) * Math.cos(el) * this._cameraDistance,
    );
    this._camera.lookAt(CAMERA_LOOK_AT.x, CAMERA_LOOK_AT.y, CAMERA_LOOK_AT.z);
    // UI 专用相机（uiScene pass）：正交正视——卡牌/按钮/图标/资源点的布局坐标
    // 与屏幕线性映射，不吃任何透视畸变（z 只决定前后层，不改投影大小/位置）。
    // 与渲染同理，UI 对象的拾取/拖拽映射也必须走这台相机（Picker 按 space 路由）。
    this._uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this._uiCamera.position.set(0, UI_CAMERA_LOOK_AT_Y, UI_CAMERA_Z);
    this._uiCamera.lookAt(0, UI_CAMERA_LOOK_AT_Y, 0);
    this._fitUiFrustum(16 / 9); // resize 前的合法缺省（16:9 假定）
    this._raycaster = new THREE.Raycaster();
    this._stage = null;         // 当前场景包装：{ name, scene, onEnter?, onExit? }
    this._running = false;
    this._rafId = null;
    this._viewWidth = 0;
    this._viewHeight = 0;
    this._clock = null;         // start 时创建（node 无 performance 场景注入）
    this._tickHandlers = new Set(); // 每帧回调（粒子系统等）：fn(dtSeconds)
  }

  /** 注册每帧回调，返回注销函数。 */
  onTick(fn) {
    this._tickHandlers.add(fn);
    return () => this._tickHandlers.delete(fn);
  }

  get camera() { return this._camera; }
  get uiCamera() { return this._uiCamera; }
  get stage() { return this._stage; }
  get worldHeight() { return this._worldHeight; }
  /** z=0 平面的世界宽（16:9 ≈ 177.8）。 */
  get worldWidth() { return this._viewHeight > 0 ? this._worldHeight * (this._viewWidth / this._viewHeight) : 0; }
  get viewSize() { return { width: this._viewWidth, height: this._viewHeight }; }

  attach(canvas) {
    this._renderer = this._createRenderer({ canvas });
    this._renderer?.setPixelRatio?.(this._devicePixelRatio());
    // 阴影贴图（月光穿窗投影用；假 renderer 无 shadowMap，单测跳过）
    if (this._renderer.shadowMap) {
      this._renderer.shadowMap.enabled = true;
      this._renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft 在新版 three 已弃用（自动回退 PCF）
    }
    return this;
  }

  // HiDPI：渲染缓冲按设备像素比放大（cap 2 防 4K+ 高倍屏填充率浪费）。
  // 缺了这步，DPR>1 的屏上 canvas 以 CSS 像素渲染再被浏览器拉伸——整屏发糊
  // （烘焙分辨率再高也救不回来）。node 单测无 window → 1。
  _devicePixelRatio() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.min(dpr, 2);
  }

  // UI 正交视锥：z=0 平面可视高恰好 = worldHeight（与世界相机同约定）。
  // 取景中心偏移只由相机位置（0, UI_CAMERA_LOOK_AT_Y）承担——视锥在视图空间
  // 必须对称，再把 top/bottom 也偏移等于把取景中心算两遍
  _fitUiFrustum(aspect) {
    const halfH = this._worldHeight / 2;
    const halfW = halfH * aspect;
    const cam = this._uiCamera;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
  }

  resize(width, height) {
    this._viewWidth = width;
    this._viewHeight = height;
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
    this._fitUiFrustum(width / height);
    // setSize 前重申像素比：窗口跨屏拖动时 DPR 可能变化
    this._renderer?.setPixelRatio?.(this._devicePixelRatio());
    this._renderer?.setSize?.(width, height);
    this._stage?.composeResize?.(width, height); // 后处理链 RT 跟随（如体积光 composer）
  }

  /** 屏幕像素 → 指定 z 平面上的世界坐标（射线与 z=planeZ 平面求交，任意相机通用）。
   *  cam 缺省世界相机；牌桌 UI 空间传 this.uiCamera。 */
  screenToWorld(px, py, planeZ = 0, cam = this._camera) {
    cam.updateMatrixWorld(); // 相机不在场景图内，matrixWorld 需手动刷新
    const ndc = new THREE.Vector2(
      (px / this._viewWidth) * 2 - 1,
      -((py / this._viewHeight) * 2 - 1),
    );
    this._raycaster.setFromCamera(ndc, cam);
    const ray = this._raycaster.ray;
    const t = (planeZ - ray.origin.z) / ray.direction.z;
    const p = ray.at(t, new THREE.Vector3());
    return { x: p.x, y: p.y };
  }

  /** 世界坐标 → 屏幕像素（测试/调试逆映射）。cam 缺省世界相机；UI 空间传 uiCamera。 */
  worldToScreen(wx, wy, wz = 0, cam = this._camera) {
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(wx, wy, wz).project(cam);
    return {
      x: ((v.x + 1) / 2) * this._viewWidth,
      y: ((1 - v.y) / 2) * this._viewHeight,
    };
  }

  /**
   * 场景切换。stage: { name, scene: THREE.Scene, uiScene?: THREE.Scene,
   *   onEnter?(manager), onExit?(manager) }
   * uiScene 存在时走双 pass：先渲染 scene（3D 世界），清深度后再渲染 uiScene（前景 UI）。
   */
  setStage(stage) {
    if (this._stage === stage) return;
    this._stage?.onExit?.(this);
    this._stage = stage;
    this._stage?.onEnter?.(this);
  }

  start() {
    if (this._running || !this._renderer) return;
    this._running = true;
    this._clock = new THREE.Clock();
    const tick = () => {
      if (!this._running) return;
      const dt = Math.min(this._clock.getDelta(), 0.1); // 掉帧保护：单帧最多推进 100ms
      for (const fn of this._tickHandlers) fn(dt);
      if (this._stage) {
        // 世界 pass：stage 可带 composeScene 钩子接管渲染（如体积光 composer 的
        // RT+后处理链），缺省直接渲染
        if (this._stage.composeScene) {
          this._stage.composeScene({ renderer: this._renderer, scene: this._stage.scene, camera: this._camera });
        } else {
          this._renderer.render(this._stage.scene, this._camera);
        }
        // UI 独立 pass（stage.uiScene，如卡牌/按钮/图标）：清深度后二次渲染——
        // 牌桌 UI 的世界坐标在地板平面之下（y<-30），同 pass 会被地板 z-test 裁掉；
        // UI 本质是前景覆盖层，与 3D 世界不做深度交互
        const ui = this._stage.uiScene;
        if (ui) {
          const r = this._renderer;
          const prevAutoClear = r.autoClear;
          r.autoClear = false;
          r.clearDepth?.(); // 假 renderer（单测）无此方法，跳过即可
          r.render(ui, this._uiCamera); // UI 用专用正交相机：卡牌/按钮永远正对观者、无透视畸变
          r.autoClear = prevAutoClear;
        }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  dispose() {
    this.stop();
    this._renderer?.dispose?.();
    this._renderer = null;
  }
}
