// 烧毁/烧黑 modifier——WebGPU 迁移 TSL 版（原 onBeforeCompile 字符串补丁重写）：
// 「shader 一旦写好可应用在任何 PCG mesh 上」——挂进任意材质
// （主顾 = 族单例 M.wood / M.cloth：木件与布旗全族生效，合批散件与未合批活件一视同仁）。
// 范式与 unitBodyFx.js 同源（W3 立，细则见该文件头注）。两枚 uniform 节点
// （剧本经 ctx.tweenRaw 直推 `.value` 标量字段，口径不变）：
//   uChar 0→1  烧黑：albedo 混向炭黑（双频 hash 噪波斑驳，不是匀色漆）
//   uBurn 0→1  烧毁：按 ~0.6u 格块 hash 逐格 discard 侵蚀 + 侵蚀前沿一条窄余烬边；
//              前沿阈值叠加第二层 hash 扰动（侵蚀边界犬牙交错）；余烬边吃 uTime 闪烁
//   uTime      秒计时（常驻剧本线性推）：只服务余烬闪，不进任何阈值判据
// 与 GLSL 版的语义差（记录在案，可接受）：顶点色由 NodeMaterial 在 colorNode 之后统一乘入
// ——炭黑（近黑常量）会被顶点色轻微染色，视觉上等价（旧版是炭黑不吃顶点色）。
// 铁律：族单例是进程级共享物——演出收尾/剧本 kill 必须 resetCharBurn 归零，
// 否则下一场战斗的木件还带着上一场的烧痕。
import {
  Fn, If, Discard, uniform, positionLocal, materialColor, materialEmissive,
  vec2, vec3, vec4, mix, sin, dot, floor, fract, step, smoothstep, oneMinus,
} from 'three/tsl';
import { materialOf } from '../scenes/kit/materials.js';

const PATCH_KEY = '_charBurn';

/** 会被挂烧毁特效的材质族（剧本按族给错峰参数；加新族这里与剧本的 CHAR 表同步）。 */
export const CHAR_BURN_FAMILIES = ['wood', 'cloth'];

// 0.63u 格：再细就在远处墙上糊成彩色噪点（09-23 实拍）
const cbHash = Fn(([pos]) => {
  const cell = floor(pos.mul(1.6));
  return fract(sin(dot(cell.xy.add(cell.z.mul(7.13)), vec2(12.9898, 78.233))).mul(43758.5453));
});
// 第二层噪声：细频格子，供前沿扰动与炭黑斑驳
const cbHash2 = Fn(([pos]) => {
  const cell = floor(pos.mul(5.7).add(13.7));
  return fract(sin(dot(cell.xy.add(cell.z.mul(3.71)), vec2(39.721, 91.177))).mul(24634.6345));
});

/**
 * 给材质挂烧毁特效（幂等：已挂过直接取原记录）。
 * 记录里**不反引 material**：挂在 userData 上的循环引用会让 Material.clone() 的
 * JSON 深拷贝直接抛错（族单例自首次挂载起终身携带，clone 即炸——验收 P2-3）。
 * @returns {{ uChar, uBurn, uTime }}
 */
export function attachCharBurn(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = { uChar: uniform(0), uBurn: uniform(0), uTime: uniform(0) };
  material.userData[PATCH_KEY] = rec;

  // ⚠ TSL 纪律：If/Discard 必须在 Fn 栈内——colorNode 合成整体包进 Fn 再调用
  material.colorNode = Fn(() => {
    // 对象空间位置做格块 hash（positionLocal 在片元自动插值——合批散件的 position
    // 已被合批矩阵烘进顶点，与旧 GLSL 的 position 语义一致）
    const pos = positionLocal;
    const h = cbHash(pos);
    const h2 = cbHash2(pos);
    const frontier = rec.uBurn.mul(1.35).sub(h2.mul(0.35)); // 犬牙交错的前沿
    If(h.lessThan(frontier), () => { Discard(); });          // 烧毁：格块逐格侵蚀成灰
    // 烧黑：炭黑底 + 细频噪波斑驳（落灰不均匀，带一丝暖红）
    const charCol = vec3(0.045, 0.028, 0.02).add(h2.sub(0.5).mul(0.035));
    return vec4(
      mix(materialColor.rgb, charCol, rec.uChar.mul(h2.mul(0.25).add(0.75))),
      materialColor.a);
  })();

  // 余烬只沿「活料与灰烬的交界」亮一条窄边，且逐格自己的明暗差一大（09-23 实拍：
  // 0.12 宽 + 2.2 强度时每个存活格都是一块等亮橙斑，整面旗看着像撒了彩纸）。
  // 纯算式无控制流，不必进 Fn。
  const h = cbHash(positionLocal);
  const h2 = cbHash2(positionLocal);
  const frontier = rec.uBurn.mul(1.35).sub(h2.mul(0.35));
  const rim = oneMinus(smoothstep(0.0, 0.07, h.sub(frontier)));
  const flick = sin(rec.uTime.mul(9.3).add(h.mul(47.0))).mul(sin(rec.uTime.mul(3.1).add(h.mul(11.0)))).mul(0.28).add(0.72);
  material.emissiveNode = materialEmissive.add(
    vec3(1.0, 0.3, 0.05).mul(rim).mul(step(0.001, rec.uBurn)).mul(h2.mul(0.75).add(0.55)).mul(flick));

  material.needsUpdate = true;
  return rec;
}

/** 取已挂的记录（未挂 → null）。 */
export function charBurnOf(material) { return material.userData[PATCH_KEY] ?? null; }

/** 两枚值归零（演出收尾/剧本 kill 必调——族单例跨场景共享，不复位会漏进下一场）。 */
export function resetCharBurn(rec) {
  if (!rec) return;
  rec.uChar.value = 0;
  rec.uBurn.value = 0;
}

/**
 * 入场预热：把烧毁变体的 program 在黑幕期就编好，演出里只推 uniform 不再触发重编译。
 * 教训（09-23 转段「跃变」）：补丁只在用的那一拍挂上，needsUpdate 让两枚族单例
 * 当场重编译，实测在主线程上砸出 715ms 空档（tmp/play/pyro-cam-jump.mjs 量得），
 * 正好卡在爆发那一帧——先冻一下再跳出，比任何补间曲线都刺眼。
 * 必须拿**真实舞台场景**当 targetScene：program 缓存键含灯光状态与雾，空场景预热
 * 编出来的是另一个变体，等于白暖。
 */
export function warmCharBurn({ renderer, scene, camera, families = CHAR_BURN_FAMILIES }) {
  if (!renderer || !scene || !camera) return;
  for (const fam of families) {
    try { attachCharBurn(materialOf(fam)); } catch { /* 未知族：没有件可烧，跳过 */ }
  }
  // compileAsync 走驱动并行编译（不冻主线程）；老 renderer/假 renderer 没这方法时退回同步版
  const async = renderer.compileAsync?.call(renderer, scene, camera);
  if (!async) renderer.compile?.call(renderer, scene, camera);
}
