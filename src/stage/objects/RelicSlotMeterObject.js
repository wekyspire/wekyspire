// RelicSlotMeterObject：遗物槽容量条（仅战前准备阶段显示）——加载界面粗粝进度条风味：
// 深色轨道 + 灰描边 + 每槽位分隔刻线，填充段平铺 public/ui/grit256.png 粗粝白纹。
// 摆在顶部资源行右侧（MapStage 每帧/每重排下发摆位）。签名驱动（used/total 不变不重烘）。
import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';

const BAR = { w: 13, h: 1.5 };   // 条体（世界单位）
const LABEL_GAP = 1.0;

// 粗粝纹理：模块级懒加载（与加载壳同一张 public/ui/grit256.png）
let _gritImg = null;
let _gritReady = false;
function ensureGrit(onReady) {
  if (typeof document === 'undefined') return;
  if (_gritImg) { if (_gritReady) onReady?.(); return; }
  _gritImg = new Image();
  _gritImg.onload = () => { _gritReady = true; onReady?.(); };
  _gritImg.src = `${import.meta.env.BASE_URL}ui/grit256.png`;
}

export class RelicSlotMeterObject extends THREE.Group {
  constructor({ bakeText = null } = {}) {
    super();
    this.name = 'relicSlotMeter';
    this._bakeText = bakeText;
    this._used = 0;
    this._total = 0;
    this._fill = 0;
    this._fillTarget = 0;
    this._pop = 0;

    // 标签 + 读数（文本烘焙）
    this._label = new TextBlockObject({ bakeText, fontPx: 12, tint: '#8f8f8f' });
    this._label.setText('遗物槽');
    this.add(this._label);
    this._count = new TextBlockObject({ bakeText, fontPx: 12, tint: '#c2c2c2' });
    this.add(this._count);

    // 轨道（含分隔刻线，setSlots 重烘）
    this._trackMat = new THREE.MeshBasicMaterial({ transparent: true, color: 0x141414, opacity: 0.95 });
    this._track = new THREE.Mesh(new THREE.PlaneGeometry(BAR.w, BAR.h), this._trackMat);
    this.add(this._track);
    // 填充（粗粝白纹；锚左缩放）
    this._fillMat = new THREE.MeshBasicMaterial({ transparent: true, color: 0xa8a8a8, opacity: 0.96 });
    this._fillMesh = new THREE.Mesh(new THREE.PlaneGeometry(BAR.w - 0.24, BAR.h - 0.26), this._fillMat);
    this._fillMesh.scale.x = 0.001;
    this._fillMesh.position.z = 0.1;
    this.add(this._fillMesh);
    ensureGrit(() => this._rebakeFill());   // 纹理晚到补挂

    // 静态摆位：标签在条下方（左对齐条左缘，避开上方 UI 顶缘）、读数在条右
    // （组原点 = 条中心；读数宽度随文本变，摆位在 setSlots 里每拍重锚）
    const lw = this._label.scale.x, lh = this._label.scale.y;
    this._label.position.set(-BAR.w / 2 + lw / 2, -BAR.h / 2 - 0.45 - lh / 2, 0);
  }

  /** 填充纹理：粗粝白纹平铺（未就绪时保持纯色回落）。 */
  _rebakeFill() {
    if (!_gritReady || typeof document === 'undefined') return;
    const S = 3, Wpx = Math.round((BAR.w - 0.24) * 20), Hpx = Math.round((BAR.h - 0.26) * 20);
    const c = document.createElement('canvas');
    c.width = Wpx * S; c.height = Hpx * S;
    const g = c.getContext('2d');
    const pat = g.createPattern(_gritImg, 'repeat');
    g.fillStyle = pat;
    g.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const old = this._fillMat.map;
    this._fillMat.map = tex;
    this._fillMat.color.set(0xffffff);
    this._fillMat.needsUpdate = true;
    old?.dispose?.();
  }

  /** 轨道重烘：分隔刻线随槽位总数（签名驱动）。 */
  _rebakeTrack() {
    if (typeof document === 'undefined') return;
    const segs = Math.max(1, this._total);
    const S = 3, Wpx = Math.round(BAR.w * 20), Hpx = Math.round(BAR.h * 20);
    const c = document.createElement('canvas');
    c.width = Wpx * S; c.height = Hpx * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#141414';
    g.fillRect(0, 0, Wpx, Hpx);
    g.lineWidth = 2.4;
    g.strokeStyle = 'rgba(150,150,150,0.8)';
    g.strokeRect(1.2, 1.2, Wpx - 2.4, Hpx - 2.4);
    g.strokeStyle = 'rgba(10,10,10,0.9)';
    g.lineWidth = 2;
    for (let i = 1; i < segs; i++) {
      const x = (Wpx * i) / segs;
      g.beginPath(); g.moveTo(x, 2); g.lineTo(x, Hpx - 2); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const old = this._trackMat.map;
    this._trackMat.map = tex;
    this._trackMat.color.set(0xffffff);
    this._trackMat.needsUpdate = true;
    old?.dispose?.();
  }

  /** 槽位读数：used/total 变化才重烘轨道与读数；填充走 update 缓动。 */
  setSlots(used, total) {
    used = used ?? 0; total = Math.max(1, total ?? 1);
    if (used === this._used && total === this._total) return;
    const first = this._total === 0;
    this._used = used; this._total = total;
    this._fillTarget = used / total;
    if (first) this._fill = this._fillTarget;   // 首拍直接到位（进准备不播填充）
    else this._pop = 0.3;                        // 变化 = 到位脉冲
    this._count.setText(`${used}/${total}`);
    this._count.position.set(BAR.w / 2 + LABEL_GAP + this._count.scale.x / 2, 0, 0);   // 右锚每拍重锚
    this._rebakeTrack();
  }

  update(dt) {
    const k = Math.min(1, dt * 9);
    this._fill += (this._fillTarget - this._fill) * k;
    this._fillMesh.scale.x = Math.max(0.001, this._fill);
    const w = BAR.w - 0.24;
    this._fillMesh.position.x = (-w + w * this._fillMesh.scale.x) / 2;
    if (this._pop > 0) {
      this._pop = Math.max(0, this._pop - dt);
      const s = 1 + 0.5 * Math.sin((this._pop / 0.3) * Math.PI) * 0.3;
      this.scale.set(1, s, 1);
    } else if (this.scale.y !== 1) this.scale.y = 1;
  }

  dispose() {
    for (const child of [...this.children]) {
      child.traverse?.((o) => { o.geometry?.dispose(); if (o !== child) o.material?.dispose?.(); });
      if (child.material && child.isMesh) child.material.dispose?.();
      child.dispose?.();
      child.parent?.remove(child);
    }
  }
}
