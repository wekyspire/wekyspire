// 环身舔舐火（L1 贴体层，burn 主题件，VFX 结构大更新 Phase 2 第四版，2026-09-26）：
// 簇式火舌方案废弃——散布的独立小火 quad 读作「角色下方那三坨火焰」（用户验收原话，
// 廉价感来源 = 火与身体是分离的贴片）。本版让火**长在身体上**：
//   · 共享本体几何 + 采样同一张立绘 alpha（stasisShell 同源手法）——
//     火焰噪声以剪影为掩膜：体内底旺上弱（贴肉燃烧）+ 剪影外沿一圈舔火
//     （多环 alpha 邻域采样出「外溢带」，火窜出轮廓、头顶上方也有火）；
//   · **挂 _standee 不挂 billboard 分组**（2026-09-26 系统性修正，用户验收：
//     「播放动画时底部火焰没有跟随」）——姿态通道（squash/widen/lean/呼吸）打在
//     _standee 上，采样本体剪影的件必须与本体同一变换空间；每帧拷贝 bodyMesh 位置；
//   · 前后两层（后层 z −0.30 被本体剪影遮挡、透明区透出 → 火绕到身后，环绕感）；
//   · level 除了总强度还抬火舌高度（rise 指数随 level 放平——低层只烧腿，高层没过头顶）；
//   · uCalm（火焰亲和）：滚动减速、摇曳收敛——可控的火（与 L0 同源）。
// HDR 纪律：芯部白黄峰值过世界 bloom 阈 1.45（火是发光体），暗部压回阈下。
// 总控一个标量 setLevel(0..1)；uTime 共用 L0 的钟（同源同帧）；dispose 由宿主层统一调。
// —— WebGPU 迁移 TSL 版（2026-09-27，原裸 GLSL 片元重写）：
//   · MeshBasicNodeMaterial + colorNode 全量接管输出（vec4 rgb=火色, a=alpha），
//     additive/transparent/depthWrite 语义照旧；无 map 时透明黑占位纹理 + uHasBody=0
//     → f 处处归零逐格 discard，与旧 GLSL 空采样器 × uHasBody 的退化路径等价；
//   · 立绘后到：TextureNode.value 换纹理即可（swap 不重建链，等价旧 tBody.value 赋值）；
//   · uCalm/uTime 直接引用 L0 的 uniform 节点实例（unitFxLayer.body 共享件——
//     同源同帧不再需要逐帧拷值）；旧版无 bloom offset 通道（火靠 HDR 色本体过阈），保持；
//   · If/Discard 待在 Fn 栈内；剪影邻域采样用 TextureNode.sample(uv.add(offset))
//     逐式对应旧 GLSL 的 tBody 偏移采样。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard, uniform, texture, uv,
  vec2, vec3, vec4, float, mix, max, pow, sin,
  smoothstep, oneMinus,
} from 'three/tsl';
import { ubfNoise } from './unitBodyFx.js';

// 1x1 透明黑占位纹理：map 未就位时 TextureNode 的合法采样源（WebGPU 不许绑空纹理），
// 采样结果 = (0,0,0,0)——uHasBody=0 时火势处处归零逐格 discard，占位期不渲染任何东西
const PLACEHOLDER = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
PLACEHOLDER.needsUpdate = true;

// 剪影 alpha 平滑版（羽化阈值化，与 stasisShell 同口径）——t 为共享 TextureNode，uvp 采样位
const bfSolid = Fn(([t, uvp]) => smoothstep(0.3, 0.65, t.sample(uvp).a));

// 火形噪声的基元 fbm（三频：0.55/0.30/0.15——与 L0 ubfFbm 的常数不同，逐式保留本件数值）；
// hash/value-noise 与 L0 同式，直接复用 unitBodyFx 导出的共享件
const bfFbm = Fn(([p]) =>
  ubfNoise(p).mul(0.55)
    .add(ubfNoise(p.mul(2.31).add(vec2(7.7, 3.1))).mul(0.30))
    .add(ubfNoise(p.mul(4.70).add(vec2(13.1, 9.2))).mul(0.15)));

/**
 * 火幕着色链（单 sheet 的 colorNode）。u = { uTexel, uLevel, uTime, uSeed, uCalm, uHasBody, uTheme }
 * （TSL uniform 节点集合；t 为共享本体纹理 TextureNode）。公式与 GLSL 版逐式一致。
 */
function buildFlameColorNode(t, u) {
  return Fn(() => {
    const vUv = uv();
    const inside = bfSolid(t, vUv);
    // 外溢带：两圈 8 向邻域取 max——本点透明但近邻实体 = 剪影外沿舔火区；
    // 第二圈更远更弱，火舌得以窜出轮廓（头顶上方也出火）
    const e1 = u.uTexel.mul(2.5);
    const e2 = u.uTexel.mul(5.0);
    const ring1 = float(0).toVar();
    const ring2 = float(0).toVar();
    ring1.assign(max(ring1, bfSolid(t, vUv.add(vec2(e1.x, 0.0)))));  ring1.assign(max(ring1, bfSolid(t, vUv.sub(vec2(e1.x, 0.0)))));
    ring1.assign(max(ring1, bfSolid(t, vUv.add(vec2(0.0, e1.y)))));  ring1.assign(max(ring1, bfSolid(t, vUv.sub(vec2(0.0, e1.y)))));
    ring1.assign(max(ring1, bfSolid(t, vUv.add(e1))));               ring1.assign(max(ring1, bfSolid(t, vUv.sub(e1))));
    ring1.assign(max(ring1, bfSolid(t, vUv.add(vec2(e1.x, e1.y.negate()))))); ring1.assign(max(ring1, bfSolid(t, vUv.add(vec2(e1.x.negate(), e1.y)))));
    ring2.assign(max(ring2, bfSolid(t, vUv.add(vec2(e2.x, 0.0)))));  ring2.assign(max(ring2, bfSolid(t, vUv.sub(vec2(e2.x, 0.0)))));
    ring2.assign(max(ring2, bfSolid(t, vUv.add(vec2(0.0, e2.y)))));  ring2.assign(max(ring2, bfSolid(t, vUv.sub(vec2(0.0, e2.y)))));
    ring2.assign(max(ring2, bfSolid(t, vUv.add(e2))));               ring2.assign(max(ring2, bfSolid(t, vUv.sub(e2))));
    ring2.assign(max(ring2, bfSolid(t, vUv.add(vec2(e2.x, e2.y.negate()))))); ring2.assign(max(ring2, bfSolid(t, vUv.add(vec2(e2.x.negate(), e2.y)))));
    const spill = oneMinus(inside).mul(max(ring1, ring2.mul(0.55)));
    // 火形噪声：向上卷（火向上窜）+ 域扭曲出舌形（tF = 滚动钟，勿与纹理节点 t 混名）
    const tF = u.uTime.mul(2.1).mul(oneMinus(u.uCalm.mul(0.3))).add(u.uSeed.mul(23.0));
    const p = vec2(vUv.x.mul(3.4).add(u.uSeed), vUv.y.mul(2.6).sub(tF));
    const warp = bfFbm(p.mul(1.6).add(vec2(0.0, tF.mul(-0.5))));
    const n = bfFbm(p.add(vec2(warp.mul(0.9).sub(0.45), 0.0)));
    // 火势：底旺顶弱，火舌高度随 level 抬升（低层只烧腿，高层没过头顶）
    const rise = pow(oneMinus(vUv.y), mix(2.6, 1.1, u.uLevel));
    const flick = sin(tF.mul(3.7).add(n.mul(12.0))).mul(0.15).mul(oneMinus(u.uCalm.mul(0.5))).add(0.85);
    const flame = rise.mul(float(0.20).add(n.mul(1.45))).mul(flick);
    // 合成：体内贴肉火（弱，托底）+ 外溢舔火（强，主体）
    const f = smoothstep(0.10, 0.68, flame.mul(inside.mul(0.55).add(spill.mul(1.35))))
      .mul(u.uLevel).mul(u.uHasBody).toVar();
    If(f.lessThan(0.004), () => { Discard(); });
    // 色 ramp：尖暗红 → 中橙 → 芯白黄（HDR 过阈真发光）；主题色掺两成半保持体系色
    const c = mix(vec3(1.7, 0.35, 0.06), vec3(2.7, 1.8, 0.8),
      smoothstep(0.35, 0.95, f.mul(oneMinus(vUv.y.mul(0.45))))).toVar();
    c.assign(mix(vec3(0.8, 0.13, 0.02), c, smoothstep(0.02, 0.45, f)));
    c.assign(mix(c, u.uTheme.mul(2.2), 0.25));
    return vec4(c, f);
  })();
}

/**
 * 在宿主单位的 _standee 上建环身舔舐火（前后两层；随姿态通道变形——采样本体剪影的件
 * 必须与本体同一变换空间，挂 billboard 分组会在位移动画时脱锚）。
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeBodyFlames(layer, { color = 0xff8a3a } = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  // 本体纹理节点（两 sheet 共享）：占位纹理起步，立绘就位 syncMap 换 .value 即可
  const t = texture(PLACEHOLDER);
  const group = new THREE.Group();
  group.name = 'bodyFlamesGroup';
  const sheets = [];
  for (const cfg of [{ z: 0.35, seed: 0.0, k: 1.0, ro: 1 }, { z: -0.30, seed: 3.7, k: 0.8, ro: 0 }]) {
    const u = {
      // map 就位即按真尺寸重设
      uTexel: uniform(new THREE.Vector2(1 / 256, 1 / 256)),
      uLevel: uniform(0),
      uTime: layer.body.uTime, // 共享 L0 的钟实例（同源同帧，UnitFxLayer 常驻推进）
      uSeed: uniform(cfg.seed),
      uCalm: layer.body.uCalm, // 共享实例：火焰亲和同帧生效（与 L0 同源）
      uHasBody: uniform(bodyMesh.material.map ? 1 : 0),
      uTheme: uniform(new THREE.Color(color)),
    };
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = buildFlameColorNode(t, u);
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    mat.transparent = true;
    mat.fog = false;
    // 几何与本体共享（随 setArt 自愈重绑）——全尺寸 1:1，uv 与立绘像素一一对应
    const mesh = new THREE.Mesh(bodyMesh.geometry, mat);
    mesh.name = 'bodyFlameSheet';
    mesh.renderOrder = cfg.ro;
    group.add(mesh);
    sheets.push({ mesh, mat, u, k: cfg.k, z: cfg.z });
  }
  unit._standee.add(group); // 挂 standee：随姿态通道前倾/压扁（与 stasisShell 同一条铁律）
  const syncMap = () => {
    const map = bodyMesh.material.map;
    if (map?.image) {
      t.value = map; // TextureNode 换纹理（等价旧 tBody.value 赋值，swap 不重建链）
      for (const s of sheets) {
        s.u.uHasBody.value = 1;
        s.u.uTexel.value.set(1 / map.image.width, 1 / map.image.height);
      }
    }
  };
  syncMap();
  let level = 0;
  const untick = unit.addTick(() => {
    group.visible = level > 0.02 && !unit._dead; // 尸体上不放火（orbs 同律）
    for (const s of sheets) {
      // setArt 自愈：本体几何被原位替换（旧几何销掉）——逐帧核对重绑共享引用
      if (s.mesh.geometry !== bodyMesh.geometry) s.mesh.geometry = bodyMesh.geometry;
      // 逐帧对齐本体局部位置（本体位移动画时火不脱锚；姿态缩放/旋转由 standee 父链继承）
      s.mesh.position.set(bodyMesh.position.x, bodyMesh.position.y, s.z);
      s.u.uLevel.value = level * s.k;
    }
    // 立绘后到（占位色块期建的火）——map 就位即启用剪影采样
    if (!sheets[0].u.uHasBody.value && bodyMesh.material.map) syncMap();
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    for (const s of sheets) s.mat.dispose(); // 几何是本体共享引用，不销
  };
  return {
    group,
    /** 总控标量 0..1：火势（enter 渐升 / stacks 强弱 / exit 渐熄全推它）。 */
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
