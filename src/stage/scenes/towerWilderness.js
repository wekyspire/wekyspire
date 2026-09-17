// 塔楼层场景（2026-09-15 观感重做，替占位「纯色夜空 + 星点 + 色块塔」）：
// 一片大雪的荒原之中，一座孤独伫立的塔楼——billboard 纸片塔（层块归 MapStage 的
// setFloor/arriveFloor 舞台接口，本件只管环境）。
//
// 大气（TOWER.md 四阶段氛围的第一块基石，2026-09-16 起进入真大气渲染）：
//   · FogExp2 指数大气透视——雾色 = 低空色（**暗雾**，用户定 2026-09-16），远端雪原、
//     远处云堤、云下穹面三处融成同一条暗雾带（无缝的关键 = 三处同色同距离 ramp）；
//   · HemisphereLight 两半球环境光模拟——上方灰蓝（阴雪天空）、下方偏白（雪地反光），
//     外加一盏弱冷平行光给雪丘做体积（调参位）；
//   · 渐变天空穹（上灰蓝 → 下雪白，BackSide 球壳，不吃雾不写深度）+ **雪云体积层**
//     （towerClouds.js：Worley 噪音场 raymarch，1/4 分辨率 + 小域 blur，穹顶合成；
//     云下仰望/云内环视/云上俯瞰同一条路径，塔身穿云 = 二三阶段）。
// 雪花：GPU 常驻**实例化四边形**粒子——急迫斜风 + 湍流扭曲 + 沿飞行方向拉伸（速度感，
// 风源与云层同向）；CPU 每帧只推进 uTime，零属性回写；近场体积盒罩住视锥中段。
// node/headless 可安全构造（ShaderMaterial/RT/几何不依赖 document；RT pass 只在
// 浏览器渲染期的穹顶 onBeforeRender 里跑）。

import * as THREE from 'three';
import { CAMERA_AZIMUTH } from '../StageManager.js';
// shader 源码在同名 .glsl 文件（?raw 原生字符串导入，零插件；编辑器直接认后缀出高亮）。
// ⚠ dome.frag 里的归一化半径 900.0 与本文件 DOME_RADIUS 同值，改半径时两处一起动。
import domeVertSrc from './towerWilderness.dome.vert.glsl?raw';
import domeFragSrc from './towerWilderness.dome.frag.glsl?raw';
import snowVertSrc from './towerWilderness.snow.vert.glsl?raw';
import snowFragSrc from './towerWilderness.snow.frag.glsl?raw';
import { buildTowerClouds, CLOUD_PRESETS } from './towerClouds.js';

// ---- 调参位（浏览器验收后收紧）----
export const SKY_TOP = 0x7e93ad;       // 天顶：灰蓝（阴雪天空）
export const SKY_BOTTOM = 0x59626a;    // 低空/雾色：暗板岩灰（远地/远云/穹面三处同源
                                       // 融成一条暗雾带——用户定雾就要暗，不要亮辉光）
export const FOG_DENSITY = 0.015;      // 指数雾密度：~50 单位能见度（50 处融 ~47%，
                                       // 120 处 ~98%）——塔身约半透雾感、雪原远端全融天
export const GROUND_BASE_Y = -58;      // 雪原高度（固定：塔世界固定，相机随层爬升）
const DOME_RADIUS = 900;
// 雪花风暴配方斜风（二三章 storm 配方专用；一章平静雪不用它）。云层 advect 风是
// towerClouds.js 独立调定的观感值（用户 2026-09-16），两者不再同源——风暴云的风
// 待二三章美术 pass 时与 STORM_WIND 重新对齐。
export const STORM_WIND = { x: 7, z: 2.5 };

// 雪相/云观感的分章混合系数（TOWER.md 四阶段，2026-09-16 用户定）：
// 11 层 boss 前恰在云外（ch1 平静雪）、12 层入云、12-33 层完全在云内（ch2 风暴）、
// 34 层起太虚回静。混合跨 5 层（11→16 入、33→38 出）——雪速渐变摊到多次攀爬里，
// 不挤在一次爬升中造成"短暂明显加快"（用户报）。云板几何由 CLOUD_PRESETS.base/top
// 对齐塔层（18..174），与本地曲线配套。
export function towerStormLevel(floor) {
  const rise = smoothstep(11, 16, floor);
  const fall = 1 - smoothstep(33, 38, floor);
  return Math.min(1, Math.max(0, rise * fall));
}

// 塔世界位（塔环境与塔身的共享锚点：MapStage 塔组、专属机位缺省、雪原贴地都取它）。
// 定义在本件而非 MapStage：scenes 层不得反向 import stages——那条链会把 MapStage
// 的 Vite 专属依赖（import.meta.glob 等）拖进 node/headless，破坏本件的可安全构造。
export const TOWER_X = 58;             // 塔楼横向位置（右侧）
export const TOWER_Z = -10;
// 塔基轻吻雪面 0.5 单位（防贴地浮空的发丝缝）；层 f 模块中心 = 塔基 + (f-0.5)×层高，
// 即层 1 直接坐在塔基线上、只埋 0.5——此前埋 2+半层（79% 入土）是摆放公式差了半层。
export const TOWER_BASE_Y = GROUND_BASE_Y - 0.5;

/**
 * billboard 纸片塔的水平朝向角（绕 y，朝向塔楼层专属机位）。
 * 塔楼层相机走 towerCameraPose 专属机位（非 StageManager 基准机位）且固定，
 * 一次性算角即可，无需逐帧 billboard。from 缺省与 towerCameraPose 的缺省塔位一致。
 */
export function towerFacingY(from = { x: 58, z: -10 }) {
  const cam = towerCameraPose({ towerX: from.x, towerZ: from.z }).position;
  return Math.atan2(cam.x - from.x, cam.z - from.z);
}

/**
 * 塔楼层专属机位（用户定 2026-09-15：塔楼投影至少占屏 1/3）：
 * 沿世界相机基准方向（az/el 同角）拉近到塔前 `dist` 处，视线锚在塔中心向画面
 * 左侧偏 `lateral`——塔落在画面右侧（常驻面板在左，长期构图不挡塔）。
 * 世界相机是三舞台共享的，机位借用走「onEnter 设、onExit restoreBaseCamera」协议。
 * @returns { position: THREE.Vector3, lookAt: THREE.Vector3 }
 */
export const CAMERA_ELEVATION_TOWER = 9;  // 度：俯视角（眼高必须高于场内一切水平面，否则水平面露底=仰视矛盾）
export function towerCameraPose({
  towerX = TOWER_X, towerY = TOWER_BASE_Y, towerZ = TOWER_Z, dist = 30, lateral = 5, yOffset = -2
} = {}) {
  const az = THREE.MathUtils.degToRad(CAMERA_AZIMUTH);
  const el = THREE.MathUtils.degToRad(CAMERA_ELEVATION_TOWER);
  // 视线方向（相机 → 场景），与 StageManager 基准机位同角
  const dir = new THREE.Vector3(
    -Math.sin(az) * Math.cos(el),
    -Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  );
  // 画面右向（水平）：dir × up 的水平归一化
  const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const tower = new THREE.Vector3(towerX, towerY, towerZ);
  const lookAt = tower.clone().addScaledVector(right, -lateral);
  const position = lookAt.clone().addScaledVector(dir, -dist);
  position.y += yOffset; // 轻微下移，塔底露出更多雪原
  return { position, lookAt };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- 雪花（GPU 常驻实例化四边形；shader 源码在 towerWilderness.snow.*.glsl）----
// 雪云阶段（2026-09-16 用户定）：急迫斜向纷飞（uStorm 与云层风同源）+ 湍流扭曲 +
// 沿飞行方向拉伸（速度感）。Points 无法拉伸 → 实例化四边形（每粒一实例，4 顶点）。
function buildSnowfall({ count = 4800 } = {}) {
  // 近场体积盒贴视锥走廊：相机在 (≈37, 锚点y, 11) 向塔 (58, -10) 及远处雪原看——
  // 盒子罩住「相机→塔→塔后远处」这条走廊即可。全盒均匀撒点，盒体远大于视锥时粒子
  // 都撒到画外（旧盒 3.2M 单位³ 视锥只占 ~2%，720 粒同屏只剩十几粒——2026-09-16
  // 用户报大雪量不够）。盒随 setAnchorY 平移（相机爬升跟随）。
  const VOL_MIN = new THREE.Vector3(-43, -15, -40);
  const VOL_MAX = new THREE.Vector3(75, 40, 20);
  const span = VOL_MAX.clone().sub(VOL_MIN);
  const seeds = new Float32Array(count * 3); // 实例属性：三路独立随机流
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = Math.random() * 1000;
    seeds[i * 3 + 1] = Math.random() * 1000;
    seeds[i * 3 + 2] = Math.random() * 1000;
  }
  const quad = new THREE.PlaneGeometry(1, 1); // 单位四边形（x,y ∈ [-0.5,0.5]）
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: 0.12 },     // 雪片截面直径（世界单位；~旧 Points 像素径同观感）
    uStretch: { value: 0.4 },   // 拉伸增益（速度单位）
    uFall: { value: 14 },       // 下落速度基准（storm 配方；calm 配方在 shader 内 mix 到 2.5）
    uStorm: { value: new THREE.Vector2(STORM_WIND.x, STORM_WIND.z) },
    uStormAmt: { value: 0 },    // 配方混合（MapStage 按层驱动；0=一章平静雪）
    uVolMin: { value: VOL_MIN },
    uVolSpan: { value: span },
    uOpacity: { value: 0.8 },
    uFogDensity: { value: FOG_DENSITY },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: snowVertSrc,
    fragmentShader: snowFragSrc,
    transparent: true,
    depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'snowfall';
  object.frustumCulled = false; // 盒内回绕，包围球没意义
  object.renderOrder = 80;
  return { object, uniforms };
}

/**
 * 建塔楼层荒原环境。
 * @returns { group, fog, setAnchorY(y), update(dt), dispose() }
 *   fog 挂宿主 scene（scene.fog = fog）；setAnchorY 同步「随相机爬升」的环境件
 *   （雪盒 + 中心填充光）到当前层锚点高度。
 */
export function buildTowerWilderness({ towerX = TOWER_X, towerZ = TOWER_Z } = {}) {
  const group = new THREE.Group();
  group.name = 'towerWilderness';
  const disposables = []; // { dispose() }——几何/材质统一释放

  // 场景雾（FogExp2）：雪原大气。密度由 setStormLevel 按层驱动（四章太虚衰减）；
  // 色 = SKY_BOTTOM（暗雾）——Color 实例同时共享给穹顶（uBottom 本就同色）与云管线
  // 远云融雾（uFogColor）：三处永远同色，地平线整圈连成一条无缝暗雾带。
  const fog = new THREE.FogExp2(SKY_BOTTOM, FOG_DENSITY);

  // ---- 天空穹：渐变（地平线雾色 → 天顶灰蓝），不吃引擎雾不写深度、最先画 ----
  // shader 源码在 towerWilderness.dome.*.glsl（uTop/uBottom 由本文件头部常量注入）。
  // toneMapped:false——r185 雾在 tone map/sRGB 编码**之后**混入、雾色 uniform 直转
  // 输出色空间（全雾像素屏色 = 色号本值，不过 tone map）。穹顶要与被雾融的雪原
  // 无缝相接就必须同语义：编码但不受 tone map（与 three 对 background 色的处理
  // 一致）；否则 tone map 把穹顶压暗一截 → 地平线接缝（2026-09-16）。
  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(SKY_TOP) },
      uBottom: { value: new THREE.Color(SKY_BOTTOM) },
    },
    vertexShader: domeVertSrc,
    fragmentShader: domeFragSrc,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.set(0, 20, 40); // 罩住相机（距中心 ~157）与整片雪原
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  disposables.push(domeGeo, domeMat);

  // ---- 雪云体积层（towerClouds.js）：mesh pass → 云 march（读场景深度）→ 合成。
  // 接入 = StageManager 的 composeScene 钩子（本件产出 clouds，MapStage 委托
  // composeFrame；gallery 主循环直接调同一条管线）。
  const clouds = buildTowerClouds({
    sunDir: new THREE.Vector3(-60, 90, -40), // 与 rim 平行光同向（月光透云）
  });
  clouds.uniforms.uSkyTop.value.setHex(SKY_TOP);
  clouds.uniforms.uSkyBottom.value.setHex(SKY_BOTTOM);
  clouds.uniforms.uFogColor.value = fog.color;   // 共享 Color 实例：远云融雾 = 地平线辉光

  // ---- 光照：雪夜，两半球环境光（上灰蓝天空 / 下偏白雪地反光）+ 弱冷平行光做雪丘体积 ----
  const hemi = new THREE.HemisphereLight(0x8fa3bd, 0xd8dde2, 0.1);
  group.add(hemi);
  const rim = new THREE.DirectionalLight(0xbfd0e0, 0.2);
  rim.position.set(-60, 90, -40); // 塔后上方逆光侧（只给雪原造型，贴图塔不受光）
  group.add(rim);

  // 中心静态光（central）：一层/塔基专属——固定不打光到高层，塔底的「门厅灯」。
  // 位置与强度是用户调参位，别在 setAnchorY 里动它。
  const central = new THREE.PointLight(0xe6f0f8, 2, 300, 0.5);
  central.name = 'centralLight';
  central.position.set(TOWER_X-9, TOWER_BASE_Y+5, TOWER_Z+7);
  group.add(central);

  // 层跟随光（track）：随相机锚点爬升的独立光源——塔是世界固定的，decay 2 的点光
  // 钉死塔基在高层衰减殆尽，当前层的塔身/雪面要它来补（setAnchorY 抬到锚点上方 5，
  // 与 central 同偏移同色温，跨层光照观感一致）。
  const track = new THREE.PointLight(0xe6f0f8, 50, 300, 2);
  track.name = 'floorTrackLight';
  track.position.set(TOWER_X-2, TOWER_BASE_Y+3, TOWER_Z+3);
  group.add(track);

  // ---- 雪原：起伏地面（三组错频正弦缓丘 + 塔基周围压平），受半球光与指数雾 ----
  // 幅员 3600 见方（用户定 2026-09-16）：远缘 ~1800 在任何雾密度下都被完全抹成雾色
  // （平方指数雾最小 ρ=0.004 时 (ρd)²≈52），任何机位的视线都终结在「已是雾色的
  // 地面」而不是雪原边缘/穹面下半球——地平线地面接缝的根治。近场细节由正弦波长
  // （100~300）对 14 单位网格的采样保证（每波长 7+ 采样），无须渐进细分。
  const fieldGeo = new THREE.PlaneGeometry(3600, 3600, 256, 256);
  fieldGeo.rotateX(-Math.PI / 2);
  {
    const pos = fieldGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let h = Math.sin(x * 0.021 + z * 0.013) * 2.2
        + Math.sin(x * 0.043 - z * 0.031 + 1.7) * 1.4
        + Math.sin(z * 0.061 + x * 0.052 + 4.1) * 0.8;
      h *= smoothstep(8, 30, Math.hypot(x - towerX, z - towerZ)); // 塔基周围压平
      pos.setY(i, h);
    }
    fieldGeo.computeVertexNormals();
  }
  const fieldMat = new THREE.MeshStandardMaterial({ color: 0xe6ecf2, roughness: 0.92, metalness: 0 });
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.name = 'snowfield';
  field.position.y = GROUND_BASE_Y;
  group.add(field);
  disposables.push(fieldGeo, fieldMat);

  // ---- 雪花 ----
  const snow = buildSnowfall();
  group.add(snow.object);
  disposables.push(snow.object.geometry, snow.object.material);

  return {
    group,
    fog,
    clouds,   // 雪云系统（gallery 调参入口：params/syncParams/update/dispose）
    /** 环境件随层锚点爬升：雪盒平移（回绕在局部空间，整体平移即跟随相机）+
     *  层跟随光抬到锚点上方 2。塔与雪原本体、云板、一层静态光 central 固定不动。 */
    setAnchorY(y) {
      snow.object.position.y = y;
      track.position.y = y + 2;
    },
    /** 雪相配方混合（0=一章平静雪 1=雪云急迫；towerStormLevel 按层求值）。
     *  同一个系数驱动**云层分章预设插值**（CLOUD_PRESETS ch1↔ch2）——爬升跨章时
     *  雪、云观感一起连续渐变，不在揭幕瞬间跳变。
     *  @param floor 可选：当前（或插值中）层号——驱动四章太虚的雾衰减（离开三章
     *  后场景雾密度才变小，一二三章恒定；用户定 2026-09-16）。 */
    setStormLevel(v, floor = null) {
      const t = Math.min(1, Math.max(0, v));
      snow.uniforms.uStormAmt.value = t;
      const a = CLOUD_PRESETS.ch1;
      const b = CLOUD_PRESETS.ch2;
      for (const k in a) clouds.params[k] = a[k] + (b[k] - a[k]) * t;
      let density = FOG_DENSITY;
      if (floor != null) {
        const clear = smoothstep(33, 38, floor);   // 四章太虚：雾密度 0.015 → 0.004
        density = FOG_DENSITY + (0.004 - FOG_DENSITY) * clear;
        fog.density = density;
      }
      // 远云融雾与地面雾同一密度标尺（march 侧同为平方指数）——四章雾变薄时远云
      // 同步少融，暗雾带不悬空；一二三章 density=FOG_DENSITY，系数 1 无扰动。
      clouds.params.haze *= density / FOG_DENSITY;
      clouds.syncParams();
    },
    get stormLevel() { return snow.uniforms.uStormAmt.value; },
    update(dt) {
      snow.uniforms.uTime.value += dt;
      clouds.update(dt);   // 云层 advect 时钟（风中滚动）
    },
    dispose() {
      clouds.dispose();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.removeFromParent();
    },
  };
}
