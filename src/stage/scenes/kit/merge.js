// propKit 静态合并（WORKFLOW §2.5）：BufferGeometryUtils 封装。
// 按材质族分桶合并静态道具（世界变换烘进顶点）——同族一个 draw call。
// 带 userData.interactive 标记的子树**整棵跳过**（挂 behaviors 的道具数量少，
// 独立成 draw call 换可动性；P5 PropAgent 落地后由登记层打标记）。
// 几何统一规整为 position/normal/color（删 uv——无纹理管线），indexed 一律展平。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materialOf } from './materials.js';

// 负 scale（mirror）网格的世界矩阵行列式为负，烘焙后三角形绕序翻转、会被背面剔除——
// 逐三角形反转顶点序恢复外向绕序（非索引几何直接三三换位）。
function flipWinding(g) {
  for (const name of ['position', 'normal', 'color']) {
    const attr = g.attributes[name];
    if (!attr) continue;
    const item = attr.itemSize;
    const arr = attr.array;
    for (let i = 0; i < arr.length; i += item * 3) {
      for (let k = 0; k < item; k++) {
        const a = arr[i + k], b = arr[i + item + k];
        arr[i + k] = b; arr[i + item + k] = a;
        // 第三顶点不动：交换前两个即反转绕序
      }
    }
    attr.needsUpdate = true;
  }
  return g;
}

/**
 * 合并 Group 子树里的静态网格。
 * 约定输入 root 的直接子节点 = 已摆好位的单个道具（位置/旋转/缩放已设）；
 * 返回新 Group：每族一个合并 Mesh + 原样搬入的 interactive 子树。
 * 原 root 的几何仍归调用方持有（替换后自行 dispose，kit 不代管）。
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = root.name ? `${root.name}:merged` : 'merged';
  const buckets = new Map(); // family → geometry[]

  for (const child of [...root.children]) {
    if (child.userData?.interactive) { out.add(child); continue; }
    let anySkipped = false;
    child.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData?.interactive) { anySkipped = true; return; } // 深层标记：该子树保持独立
      const fam = o.material?.userData?.kitFamily;
      if (!fam) {
        throw new Error('merge: 遇到非 kit 族材质的网格（资产禁自建材质，无法合并）');
      }
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.deleteAttribute('uv');
      if (!g.attributes.color) { // 理论不会（primitives 强制 paint），兜底填白防黑
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3).fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      }
      g.applyMatrix4(o.matrixWorld);
      if (new THREE.Matrix3().setFromMatrix4(o.matrixWorld).determinant() < 0) {
        flipWinding(g);
      }
      if (!buckets.has(fam)) buckets.set(fam, []);
      buckets.get(fam).push(g);
    });
    if (anySkipped) out.add(child); // 子树内有行为者：整棵不并
  }

  for (const [fam, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    out.add(new THREE.Mesh(merged, materialOf(fam)));
  }
  return out;
}
