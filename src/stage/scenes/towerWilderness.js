// 塔楼层场景（2026-09-15 观感重做，替占位「纯色夜空 + 星点 + 色块塔」）：
// 一片大雪的荒原之中，一座孤独伫立的塔楼——billboard 纸片塔（层块归 MapStage 的
// setFloor/arriveFloor 舞台接口，本件只管环境）。
//
// 大气（用户定的简单替代方案，真大气散射以后实现）：
//   · FogExp2 指数大气透视——雾色 = 天空地平线色，远处雪原融进天空；
//   · HemisphereLight 两半球环境光模拟——上方灰蓝（阴雪天空）、下方偏白（雪地反光），
//     外加一盏弱冷平行光给雪丘做体积（调参位）；
//   · 渐变天空穹（上灰蓝 → 下雪白，BackSide 球壳，不吃雾不写深度）。
// 雪花：GPU 常驻粒子（moonDust 同范式简化版）——顶点着色器里下落 + 风摆 + 盒内回绕，
// CPU 每帧只推进 uTime，零属性回写；近场体积盒罩住视锥中段，不需要雾。
// node/headless 可安全构造（ShaderMaterial/几何不依赖 document；无贴图需求）。

import * as THREE from 'three';
import {
  WORLD_HEIGHT, CAMERA_FOV, CAMERA_ZOOM, CAMERA_AZIMUTH, CAMERA_ELEVATION, CAMERA_LOOK_AT,
} from '../StageManager.js';

// ---- 调参位（浏览器验收后收紧）----
export const SKY_TOP = 0x7e93ad;       // 天顶：灰蓝（阴雪天空）
export const SKY_BOTTOM = 0xd9e2ea;    // 地平线：雪白（雾色同源，地平线无缝）
export const FOG_DENSITY = 0.0031;     // 指数雾密度：塔身 ~25% 融雾，远端雪原 ~85% 融天
export const GROUND_BASE_Y = -58;      // 雪原基准高度（画面下缘附近；低楼层时动态上抬贴塔基）
const DOME_RADIUS = 900;

/** 世界相机位置（由 StageManager 常量重算——塔楼层相机固定在基准机位）。 */
function cameraPosition() {
  const az = THREE.MathUtils.degToRad(CAMERA_AZIMUTH);
  const el = THREE.MathUtils.degToRad(CAMERA_ELEVATION);
  const dist = ((WORLD_HEIGHT / 2) / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))) * CAMERA_ZOOM;
  return new THREE.Vector3(
    CAMERA_LOOK_AT.x - Math.sin(az) * Math.cos(el) * dist,
    CAMERA_LOOK_AT.y + Math.sin(el) * dist,
    CAMERA_LOOK_AT.z + Math.cos(az) * Math.cos(el) * dist,
  );
}

/**
 * billboard 纸片塔的水平朝向角（绕 y，朝向世界相机）。
 * 塔楼层相机固定（基准机位），一次性算角即可，无需逐帧 billboard。
 */
export function towerFacingY(from = { x: 0, z: 0 }) {
  const cam = cameraPosition();
  return Math.atan2(cam.x - from.x, cam.z - from.z);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- 雪花（GPU 常驻粒子）----
const SNOW_VERT = /* glsl */`
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;    // 点径基准（世界单位）
  uniform float uScale;   // 尺寸衰减基准 = 画布高/2（1080p 假设 540）
  uniform vec3 uVolMin;
  uniform vec3 uVolSpan;
  void main() {
    // 下落（逐粒速度差 6~14 世界单位/秒）+ 盒内回绕
    float fall = 6.0 + 8.0 * fract(aSeed * 17.31);
    vec3 base = position;
    base.y = uVolMin.y + mod(position.y - uVolMin.y - uTime * fall, uVolSpan.y);
    // 风摆：错频正弦水平漂移（x 主摆 + z 副摆）
    float sway = 1.2 + 1.6 * fract(aSeed * 7.7);
    base.x += sin(uTime * (0.5 + fract(aSeed * 3.1)) + aSeed) * sway;
    base.z += cos(uTime * (0.4 + fract(aSeed * 5.3)) + aSeed * 2.0) * sway * 0.6;
    vec4 wp = modelMatrix * vec4(base, 1.0);
    vec4 mv = viewMatrix * wp;
    gl_PointSize = uSize * (0.6 + 0.9 * fract(aSeed * 11.3)) * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const SNOW_FRAG = /* glsl */`
  precision highp float;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * uOpacity;
    gl_FragColor = vec4(0.95, 0.97, 1.0, a);
  }
`;

function buildSnowfall({ count = 720 } = {}) {
  // 近场体积盒：罩住塔楼层视锥中段（相机 (≈98, 48, 145) 看向 (0, -15, 0)）
  const VOL_MIN = new THREE.Vector3(-80, -50, -40);
  const VOL_MAX = new THREE.Vector3(110, 50, 130);
  const span = VOL_MAX.clone().sub(VOL_MIN);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = VOL_MIN.x + Math.random() * span.x;
    positions[i * 3 + 1] = VOL_MIN.y + Math.random() * span.y;
    positions[i * 3 + 2] = VOL_MIN.z + Math.random() * span.z;
    seeds[i] = Math.random() * 1000;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: 0.85 },
    uScale: { value: 540 },
    uVolMin: { value: VOL_MIN },
    uVolSpan: { value: span },
    uOpacity: { value: 0.8 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'snowfall';
  points.frustumCulled = false; // 盒内回绕，包围球没意义
  points.renderOrder = 80;
  return { points, uniforms };
}

/**
 * 建塔楼层荒原环境。
 * @returns { group, fog, setSnowfieldY(y), update(dt), dispose() }
 *   fog 挂宿主 scene（scene.fog = fog）；setSnowfieldY 随楼层微调雪原高度
 *   （低楼层贴塔基，中高楼层固定在基准高度）。
 */
export function buildTowerWilderness({ towerX = 58, towerZ = -10 } = {}) {
  const group = new THREE.Group();
  group.name = 'towerWilderness';
  const disposables = []; // { dispose() }——几何/材质统一释放

  // ---- 天空穹：渐变（地平线雪白 → 天顶灰蓝），不吃雾不写深度、最先画 ----
  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(SKY_TOP) },
      uBottom: { value: new THREE.Color(SKY_BOTTOM) },
    },
    vertexShader: /* glsl */`
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      varying vec3 vLocal;
      void main() {
        float h = clamp(vLocal.y / ${DOME_RADIUS.toFixed(1)} * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uBottom, uTop, pow(h, 0.85));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.set(0, 20, 40); // 罩住相机（距中心 ~157）与整片雪原
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  disposables.push(domeGeo, domeMat);

  // ---- 光照：两半球环境光（上灰蓝天空 / 下偏白雪地反光）+ 弱冷平行光做雪丘体积 ----
  const hemi = new THREE.HemisphereLight(0x8fa3bd, 0xd8dde2, 1.05);
  group.add(hemi);
  const rim = new THREE.DirectionalLight(0xbfd0e0, 0.4);
  rim.position.set(-60, 90, -40); // 塔后上方逆光侧（只给雪原造型，贴图塔不受光）
  group.add(rim);

  // ---- 雪原：起伏地面（三组错频正弦缓丘 + 塔基周围压平），受半球光与指数雾 ----
  const fieldGeo = new THREE.PlaneGeometry(900, 700, 96, 72);
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
  group.add(snow.points);
  disposables.push(snow.points.geometry, snow.points.material);

  return {
    group,
    fog: new THREE.FogExp2(SKY_BOTTOM, FOG_DENSITY),
    /** 低楼层时把雪原上抬贴住塔基（塔基世界 y 随当前层漂移，中高楼层固定在基准高度）。 */
    setSnowfieldY(y) {
      field.position.y = Math.min(GROUND_BASE_Y, y);
    },
    update(dt) { snow.uniforms.uTime.value += dt; },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.removeFromParent();
    },
  };
}
