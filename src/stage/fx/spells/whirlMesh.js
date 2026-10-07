// 旋涡火幕件工厂（独立模块——不 import blocks/StageManager，chantSceneFx 与
// fireWhirlCast 共用且不引入环）：几何 = 开口圆柱 DoubleSide，背面火臂透叠读
// 「涡有厚度」。whirlShade 见 shaders.js（域扭曲 fbm + 螺旋剪切 + 掠射假厚度）。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uniform, uv, vec3 } from 'three/tsl';
import { additiveLight } from '../../post/passes.js';
import { whirlShade } from './shaders.js';

const c3 = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

export function makeWhirlMesh({ radius = 5.4, height = 13, color, hot, seed = 1.7 }) {
  const uPhase = uniform(0.0);
  const uProg = uniform(0.0);
  const uSeed = uniform(seed);
  const geo = new THREE.CylinderGeometry(radius, radius * 0.82, height, 48, 1, true);
  const mat = additiveLight(new MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  }));
  mat.colorNode = whirlShade(uv(), uPhase, uProg, c3(color), c3(hot), uSeed);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'spellFx:whirl';
  mesh.renderOrder = 50;
  mesh.rotation.y = Math.random() * Math.PI;   // 起涡方位随机（多打不撞形）
  return {
    mesh, uPhase, uProg,
    dispose() { mesh.parent?.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
