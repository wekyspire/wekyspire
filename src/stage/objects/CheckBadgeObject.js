// CheckBadgeObject：卡面角上的「已选取」打勾徽标（UI pass 空间的小 overlay）。
// 用途：面板里的多选卡（种子包九选三）在被勾选时给出明确视觉提示——只靠卡面材质
// 变亮会被 hover 抢走语义（hover 也是变亮），必须有一个独立、不参与 hover 的记号。
//
// 挂法：作为 CardObject 的子对象（CardObject 是 Group）——于是自动继承卡面位置与缩放，
// 不需要面板在每次布局变化时重算徽标坐标。**注意 CardObject.dispose 不释放任意子对象**，
// 宿主必须自己 dispose 徽标（PanelObject 的卡面清理里做了）。
//
// 仅浏览器可烘焙（需真实 canvas）；node 退化为占位纹理（契约测试前提）。

import * as THREE from 'three';

const PX_PER_WU = 10;

export class CheckBadgeObject extends THREE.Mesh {
  /**
   * @param {object} options
   *   size: 徽标直径（逻辑像素，10px/wu）
   *   bake: 注入烘焙（缺省内联 canvas；可注入假实现做单测）
   */
  constructor({ size = 60, bake = null } = {}) {
    super(
      new THREE.PlaneGeometry(size / PX_PER_WU, size / PX_PER_WU),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }),
    );
    this.sizePx = size;
    const bakeFn = bake || defaultBakeBadge;
    const texture = bakeFn(size);
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.map?.dispose?.();
    this.material.dispose();
  }
}

// 缺省烘焙：金色圆盘 + 深色粗勾（与卡面等阶框同色系，占位即可，素材到位后换图）
function defaultBakeBadge(size) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return texture;
  }
  const S = 4; // 超采样
  const canvas = document.createElement('canvas');
  canvas.width = size * S;
  canvas.height = size * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  const r = size / 2;
  // 底盘：金色圆 + 深色描边（外描边让徽标在任意卡图上都有边界）
  ctx.beginPath();
  ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd75e';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.strokeStyle = 'rgba(28, 22, 6, 0.92)';
  ctx.stroke();
  // 勾：两笔折线，圆头圆角
  ctx.beginPath();
  ctx.moveTo(size * 0.28, size * 0.53);
  ctx.lineTo(size * 0.44, size * 0.70);
  ctx.lineTo(size * 0.74, size * 0.32);
  ctx.lineWidth = Math.max(2, size * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2a2208';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
