// 燃烧发射图集（GPU 粒子系统的「GPU 侧生成粒子 metadata」环节，2026-09-27）：
// 每个活跃燃烧单位占图集一格（64×64，立绘 UV 空间），片元里用**本体着色同一份
// 燃烧场函数**（unitBodyFxBurnEmission——碳化场单一事实源）算发射强度，
// 并把该纹素对应的**世界坐标**一起写进 RT（RGBA32F：xyz=世界坐标，w=强度）——
// 出生位置/强度 metadata 由 GPU 算出并留在 GPU，CPU 只递 uniform 值（矩阵/燃烧强度），
// 永不读回粒子数据。
// ⚠ three 纪律：ShaderMaterial 的 uniformsList 在编译期定死 uniform 对象引用——
// 逐单位换挂 uniform **对象**会静默不生效，必须逐帧拷 .value（本件每列渲染前的做法）。
// 世界坐标经 bodyMesh.matrixWorld 算出：姿态通道（squash/lean/呼吸）天然跟随
// （悬挂点铁律的另一面——发射源与本体同一变换链）。
// 剪影门控：采样立绘 alpha（与 stasisShell 同阈值），透明区不发射（矩形板火星病灶）。
import * as THREE from 'three';
import { GLSL_BODY_FX } from '../unitBodyFx.js';
import { makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass } from '../../post/passes.js';

const TILE = 64; // 每格边长（纹素）

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tBody;
uniform float uHasBody;
uniform float uBurn;
uniform float uTime;
uniform float uCalm;
uniform mat4 uModel;      // bodyMesh.matrixWorld（含姿态链）
uniform vec2 uQuadSize;   // 立牌几何（宽, 高）
${GLSL_BODY_FX}
void main() {
  float sil = smoothstep(0.3, 0.65, texture2D(tBody, vUv).a) * uHasBody;
  float str = unitBodyFxBurnEmission(vUv, uBurn, uTime, uCalm) * sil;
  vec3 local = vec3((vUv.x - 0.5) * uQuadSize.x, (vUv.y - 0.5) * uQuadSize.y, 0.0);
  vec3 wp = (uModel * vec4(local, 1.0)).xyz;
  // 朝镜头抬一截：出生点贴在立绘平面上会被本体深度裁掉半截（圆点一半在板后），
  // 立牌是 billboard——局部 +z 即镜头方向，沿它抬 1.6 世界单位让火星飘在本体前方
  wp += normalize((uModel * vec4(0.0, 0.0, 1.0, 0.0)).xyz) * 1.6;
  gl_FragColor = vec4(wp, str);
}
`;

/**
 * 建燃烧发射图集。
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} maxUnits 同时活跃上限（一场战斗敌我单位数内）
 */
export function createBurnEmission(renderer, { maxUnits = 6 } = {}) {
  const rt = new THREE.WebGLRenderTarget(TILE * maxUnits, TILE, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, // float 不可线性过滤
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const uniforms = {
    tBody: { value: null },
    uHasBody: { value: 0 },
    uBurn: { value: 0 },   // 每列渲染前换成该单位 _fxLayer.body 的共享实例
    uTime: { value: 0 },
    uCalm: { value: 0 },
    uModel: { value: new THREE.Matrix4() },
    uQuadSize: { value: new THREE.Vector2(1, 1) },
  };
  const scene = makeFullScreenPass(FRAG, uniforms);
  const mat = scene.children[0].material;

  /**
   * 渲染本帧图集（仅活跃单位有燃烧时才被调）。
   * @param {Array<{unit: UnitObject}>} slots 活跃燃烧单位列表（下标 = 图集列）
   */
  function render(slots) {
    const prevViewport = new THREE.Vector4();
    renderer.getViewport(prevViewport);
    // ⚠ autoClear 纪律：renderFullScreenPass 每次 render 会清**整个 RT**（viewport 只管
    // 绘制不管清除）——逐列渲染不关 autoClear，后一列把前一列抹掉，只剩末列有数据
    // （多单位燃烧时前一列的火星发射静默死亡，agent 验收抓，2026-09-27）
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false); // 图集整清一次（列间不互清）
    for (let i = 0; i < slots.length && i < maxUnits; i++) {
      const unit = slots[i].unit;
      const body = unit._body;
      const rec = unit._fxLayer?.body;
      if (!body || !rec) continue;
      // 逐列拷 uniform **值**（不许换挂 uniform 对象——three 的 uniformsList 在编译期
      // 定死引用，换挂对象会静默不生效；同源口径靠值拷贝保持）
      mat.uniforms.uBurn.value = rec.uBurn.value;
      mat.uniforms.uTime.value = rec.uTime.value;
      mat.uniforms.uCalm.value = rec.uCalm.value;
      mat.uniforms.uModel.value.copy(body.matrixWorld); // 上一帧矩阵（1 帧滞后无感）
      const gp = body.geometry.parameters;
      mat.uniforms.uQuadSize.value.set(gp?.width ?? 16, gp?.height ?? 22);
      mat.uniforms.tBody.value = body.material.map ?? null;
      mat.uniforms.uHasBody.value = body.material.map ? 1 : 0;
      renderer.setViewport(i * TILE, 0, TILE, TILE); // 全屏 quad 精确映到本格
      renderFullScreenPass(renderer, scene);
    }
    renderer.setViewport(prevViewport);
    renderer.autoClear = prevAutoClear; // 还原（借用全局状态不留尾）
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(null);
  }

  function dispose() {
    rt.dispose();
    disposeFullScreenPass(scene);
  }

  return { texture: rt.texture, render, dispose, maxUnits, rt };
}
