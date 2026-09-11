// propKit 图元与修饰器（WORKFLOW §2.3）：高层快捷件 + 顶点色烘焙。
// 所有图元返回已烘焙顶点色的 Mesh（材质 = 族单例，颜色画进顶点）；资产代码不直接摸材质。
// 统一参数形 { color, size, seg, family }——color 必填且应传 P.* token（禁裸 hex）。
// 修饰器全部原地修改并返回原对象，供链式组装：K.put(K.tilt(K.box({...}), …), x, y, z)。
// flatShading 的法线由片元导数计算，jitter/chip 位移顶点后无需重算法线。

import * as THREE from 'three';
import { materialOf } from './materials.js';

/**
 * 顶点色烘焙：把颜色写进 geometry 的 color attribute（线性空间，与材质 color 同管道）。
 * 族材质 vertexColors:true，几何缺 color attribute 会渲染成黑——kit 产出的几何一律先过它。
 */
export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function prim(geo, color, family) {
  if (color === undefined) throw new Error('primitives: color 参数必填（用 P.* token）');
  return new THREE.Mesh(paint(geo, color), materialOf(family));
}

/** 长方体：size=[宽w, 高h, 深d]；seg 供顶点细分（配 jitter 用）。 */
export function box({ color, size = [1, 1, 1], seg = 1, family = 'stone' }) {
  return prim(new THREE.BoxGeometry(size[0], size[1], size[2], seg, seg, seg), color, family);
}

/** 圆柱/圆台：r=底半径，rTop=顶半径（缺省=r），seg=边数（低模 5~8）。 */
export function cyl({ color, r = 1, rTop, h = 1, seg = 6, family = 'stone' }) {
  return prim(new THREE.CylinderGeometry(rTop ?? r, r, h, seg), color, family);
}

/** 圆锥：火焰/尖顶用（unlit 族时即发光感纯色锥）。 */
export function cone({ color, r = 1, h = 1, seg = 5, family = 'stone' }) {
  return prim(new THREE.ConeGeometry(r, h, seg), color, family);
}

/** 三棱柱（山墙/楔/屋顶剖面）：size=[w,h,d]，剖面为 XY 平面三角形（底边在下、尖朝上），沿 z 挤出。 */
export function prism({ color, size = [1, 1, 1], family = 'stone' }) {
  const [w, h, d] = size;
  const A0 = [-w / 2, -h / 2, -d / 2], A1 = [-w / 2, -h / 2, d / 2];
  const B0 = [w / 2, -h / 2, -d / 2], B1 = [w / 2, -h / 2, d / 2];
  const C0 = [0, h / 2, -d / 2], C1 = [0, h / 2, d / 2];
  // 外向绕序（底面朝 -y / 两坡朝外上 / 两端三角帽朝 ±z）
  const tris = [
    A0, B1, A1,  A0, B0, B1,      // 底面
    A0, C1, C0,  A0, A1, C1,      // 左坡
    B0, C1, B1,  B0, C0, C1,      // 右坡
    A0, C0, B0,                    // z- 帽
    A0, B0, C0,                    // z+ 帽
  ];
  const arr = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => { arr[i * 3] = v[0]; arr[i * 3 + 1] = v[1]; arr[i * 3 + 2] = v[2]; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return prim(geo, color, family);
}

/**
 * 旋转体（陶罐/瓶/碗/柱础轮廓）：profile=[[半径, y], …] 自下而上，seg=环向段数（低模 6~8）。
 */
export function lathe({ color, profile = [[1, 0], [0.8, 1]], seg = 7, family = 'stone' }) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return prim(new THREE.LatheGeometry(pts, seg), color, family);
}

/**
 * 低模球（石块/瓮口堆）：IcosahedronGeometry 低细分；jitter>0 时按原始坐标一致地
 * 随机鼓包（同位置顶点同偏移，面不撕裂），rng 缺省用固定种子保证确定性。
 */
export function sphereLo({ color, r = 1, seg = 0, jitter = 0, rng = null, family = 'stone' }) {
  const geo = new THREE.IcosahedronGeometry(r, seg);
  if (jitter > 0) {
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const seen = new Map(); // 原始坐标 → 偏移量（保持水密）
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      let off = seen.get(key);
      if (off === undefined) {
        off = (rng ? rng() : 0.5) * 2 - 1; // [-1,1]
        seen.set(key, off);
      }
      const k = 1 + off * jitter;
      pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
  }
  return prim(geo, color, family);
}

/** 贴地薄板（地砖/垫板/瓦砾底）：自动落底（中心 y=th/2）。 */
export function plate({ color, w = 1, d = 1, th = 0.5, family = 'stone' }) {
  const m = prim(new THREE.BoxGeometry(w, th, d), color, family);
  m.position.y = th / 2;
  return m;
}

// ---- 修饰器（原地修改，返回原对象） ----

/** 姿态旋转（弧度，增量累加，可在组装中叠加微倾）。 */
export function tilt(obj, rx = 0, ry = 0, rz = 0) {
  obj.rotation.x += rx; obj.rotation.y += ry; obj.rotation.z += rz;
  return obj;
}

/** 随机抖动：pos/rot/scale 各轴 ±幅度（rot 单位弧度；scale 为相对比例）。 */
export function jitter(obj, rng, { pos = 0, rot = 0, scale = 0 } = {}) {
  const s = a => (rng() * 2 - 1) * a;
  obj.position.x += s(pos); obj.position.y += s(pos); obj.position.z += s(pos);
  obj.rotation.x += s(rot); obj.rotation.y += s(rot); obj.rotation.z += s(rot);
  if (scale) {
    const k = 1 + s(scale);
    obj.scale.x *= k; obj.scale.y *= k; obj.scale.z *= k;
  }
  return obj;
}

/**
 * 缺角：把匹配 corner 符号（各轴 ±1）的顶点整体向内拉 amount——平面感削角，
 * flatShading 下自动出现斜切面。适合"缺口陶罐/掉砖/断木"。
 */
export function chip(mesh, { corner = [1, 1, 1], amount = 0.2 } = {}) {
  if (mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.sign(x) === corner[0] && Math.sign(y) === corner[1] && Math.sign(z) === corner[2]) {
      pos.setXYZ(i, x - corner[0] * amount, y - corner[1] * amount, z - corner[2] * amount);
    }
  }
  pos.needsUpdate = true;
  return mesh;
}

/** 镜像（负 scale；three 渲染器对负行列式自动翻面剔除，直接可用）。 */
export function mirror(obj, axis = 'x') {
  obj.scale[axis] *= -1;
  return obj;
}

/** 三轴缩放（直接设值）。 */
export function scaleXYZ(obj, sx, sy, sz) {
  obj.scale.set(sx, sy, sz);
  return obj;
}

/**
 * 轴角对向：把对象 +Y 轴指向 dir 方向（quaternion 直设）。
 * 躺倒/斜靠件别用 tilt 叠 rx+ry（rx 会钉死 ry 的旋转轴，产物沿错误轴躺平）——
 * 任意朝向一律走本修饰器。
 */
export function aim(obj, dx, dy, dz) {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return obj;
}

/** 设位置并返回原对象（链式组装糖）。 */
export function put(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

/** 打包成 Group。 */
export function grp(...children) {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}
