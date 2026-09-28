// 云噪声烘焙纹理（2026-09-27，性能修复）：塔楼体积云 march 的全部程序噪声
// （Worley billow ×3 组格数/种子 + 值噪声）一次性 CPU 烘焙进 64³ RGBA8 3D 纹理——
// march 单步从 ~110 次 hash 求值降为 ~10 次三线性纹理采样。缘起：WebGPU 迁移后
// WGSL 程序噪声循环效率较 GLSL 降 2-3 倍，1080p 下 march 占帧耗 82%、4K 跌破 60fps
//（towerClouds.js 头注性能账；工业界同款手法 = HZD/Nubis 的 128³ 烘焙 Worley）。
// 观感与实时版统计等价（同公式的平铺 worley/值噪声；周期 = 格数 × 格长，warp 域
// 扭曲 + 双倍频 + 雾遮蔽下平铺重复不可读）。
//
// 通道布局（采样坐标 = 原噪声查询点 q ÷ (格长 × 通道格数)，三轴 Repeat）：
//   R  worley billow 4³ 格 —— 云主场双倍频、光 march 的 lite 密度场
//   G  worley billow 8³ 格 —— 细节侵蚀的 worley 通道
//   B  值噪声 8³ 点阵      —— 细节侵蚀的 perlin 通道、warp 场 wx/wz
//   A  worley billow 4³ 格（独立种子）—— warp 场阵风脉冲通道
//
// 调用：startCloudNoiseBake() 幂等启动（buildTowerClouds 已自启动，无需外部驱动）；
// 纹理异步落地后经 getCloudNoiseTextureAsync() 换绑（落地前采样黑占位 = 暂时无云）。
import * as THREE from 'three';

export const CLOUD_NOISE_SIZE = 64;
/** 各通道每轴格数（采样坐标换算的另一半在 towerClouds.js）。 */
export const CLOUD_NOISE_CELLS = Object.freeze({ R: 4, G: 8, B: 8, A: 4 });

// ---- 确定性格点 hash（32 位整数雪崩）——烘焙件只要求统计特性与 shader 版
// sine-hash 一致，不要求逐值相同 ----
function hash1(ix, iy, iz, seed) {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
    ^ Math.imul(iz, 1274126177) ^ Math.imul(seed, 662190137)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 平铺 worley billow：N³ 格，特征点 = 格原点 + hash 抖动；格索引取模回卷
//（→ 场以 N 格为周期平铺），距离搜索不 wrap（±1 邻域在周期场上足够）。
function makeWorley(N, seed) {
  const pts = new Float32Array(N * N * N * 3);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = (x + y * N + z * N * N) * 3;
    pts[o] = hash1(x, y, z, seed);
    pts[o + 1] = hash1(x, y, z, seed + 101);
    pts[o + 2] = hash1(x, y, z, seed + 202);
  }
  const idx = (x, y, z) => ((((x % N) + N) % N) + (((y % N) + N) % N) * N
    + (((z % N) + N) % N) * N * N) * 3;
  // 查询点 f 以「格」为单位（调用方已换算），返回 1-clamp(|F1|)（billow 反相）
  return (fx, fy, fz) => {
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let d = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const o = idx(ix + dx, iy + dy, iz + dz);
      const rx = ix + dx + pts[o] - fx;
      const ry = iy + dy + pts[o + 1] - fy;
      const rz = iz + dz + pts[o + 2] - fz;
      const dd = rx * rx + ry * ry + rz * rz;
      if (dd < d) d = dd;
    }
    return 1 - Math.min(Math.sqrt(d), 1);
  };
}

// 平铺值噪声：N³ 点阵 + quintic 三线性插值（与 shader 版 vnoise 同式）
function makeVnoise(N, seed) {
  const idx = (x, y, z) => hash1(((x % N) + N) % N, ((y % N) + N) % N, ((z % N) + N) % N, seed);
  return (fx, fy, fz) => {
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const rx = fx - ix, ry = fy - iy, rz = fz - iz;
    const ux = rx * rx * (3 - 2 * rx), uy = ry * ry * (3 - 2 * ry), uz = rz * rz * (3 - 2 * rz);
    const c000 = idx(ix, iy, iz), c100 = idx(ix + 1, iy, iz);
    const c010 = idx(ix, iy + 1, iz), c110 = idx(ix + 1, iy + 1, iz);
    const c001 = idx(ix, iy, iz + 1), c101 = idx(ix + 1, iy, iz + 1);
    const c011 = idx(ix, iy + 1, iz + 1), c111 = idx(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
  };
}

let _bakePromise = null;
let _texture = null;

/**
 * 幂等启动异步烘焙（分片让出主线程，启动期调用零卡顿）。
 * @returns {Promise<THREE.Data3DTexture>}
 */
export function startCloudNoiseBake() {
  if (_bakePromise) return _bakePromise;
  _bakePromise = (async () => {
    const S = CLOUD_NOISE_SIZE;
    const C = CLOUD_NOISE_CELLS;
    const data = new Uint8Array(S * S * S * 4);
    const worleyR = makeWorley(C.R, 17);
    const worleyG = makeWorley(C.G, 91);
    const worleyA = makeWorley(C.A, 53);
    const vnoiseB = makeVnoise(C.B, 37);
    for (let z = 0; z < S; z++) {
      for (let y = 0; y < S; y++) {
        let o = (y * S + z * S * S) * 4;
        for (let x = 0; x < S; x++) {
          const fx = x / S, fy = y / S, fz = z / S;
          data[o] = Math.round(worleyR(fx * C.R, fy * C.R, fz * C.R) * 255);
          data[o + 1] = Math.round(worleyG(fx * C.G, fy * C.G, fz * C.G) * 255);
          data[o + 2] = Math.round(vnoiseB(fx * C.B, fy * C.B, fz * C.B) * 255);
          data[o + 3] = Math.round(worleyA(fx * C.A, fy * C.A, fz * C.A) * 255);
          o += 4;
        }
      }
      if (z % 4 === 3) await new Promise((r) => setTimeout(r, 0)); // 分片让出主线程
    }
    const tex = new THREE.Data3DTexture(data, S, S, S);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    _texture = tex;
    return tex;
  })();
  return _bakePromise;
}

/** 已完成的纹理（未启动/未完成 → null）。 */
export function getCloudNoiseTexture() { return _texture; }

/** 完成即Resolve纹理的 Promise（未启动则顺带启动）。 */
export function getCloudNoiseTextureAsync() { return startCloudNoiseBake(); }
