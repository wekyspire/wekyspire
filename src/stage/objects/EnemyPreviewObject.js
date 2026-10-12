// EnemyPreviewObject：战前准备的敌人预告（立牌列 + 名称）——FloorChromeObject 的子件
// （世界空间 billboard 链的末端：塔钉→层号→引出线→本件），自身局部单位按 ui 尺寸建、
// 由宿主缩放折到塔深处世界尺寸。数据 = prep 快照 encounter（[{defId, name}]）；立牌走
// unitArt 共享缓存（与战场同一份），晚到补挂走 addOnLoad 订阅。Boss 层立牌更大 + 名称
// 吃敌人红。入场 = 逐张上浮淡入（交错）；hover = 立牌抬升 + 名称提亮（拾取走 Picker
// world 空间，kind 'row'）；宿主整体淡出经 setFade 乘进入场/影/名称不透明度。
import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { sharedUnitArtCache } from '../art/unitArt.js';
import { UI_FONT } from '../richtext/uiFont.js';

const STANDEE_H = 17;        // 立牌高（wu）
const STANDEE_GAP = 2.6;     // 立牌间距
const NAME_GAP = 1.2;        // 名称与立牌底的间距
const ENTER_DUR = 0.5;       // 单张入场时长（秒）
const ENTER_STAGGER = 0.12;  // 逐张交错

// 排版口径导出：楼层通过演出（fx/floorClearFx.js）的残影行与预告同版式
export const PREVIEW_LAYOUT = { STANDEE_H, STANDEE_GAP, NAME_GAP, BOSS_SCALE: 1.22 };

// 脚下软影：共享烘焙（径向渐变黑椭圆——悬浮立牌的「落地」锚）
let _shadowTex = null;
export function previewShadowTexture() {
  if (_shadowTex || typeof document === 'undefined') return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

export class EnemyPreviewObject extends THREE.Group {
  constructor({ bakeText = null, unitArt = null, picker = null } = {}) {
    super();
    this.name = 'enemyPreview';
    this._bakeText = bakeText;
    this._unitArt = unitArt ?? ((typeof document !== 'undefined') ? sharedUnitArtCache : null);
    this._picker = picker;
    this._pickIds = [];
    this._entries = [];   // { defId, name, standee, mesh, mat, shadow, label, lift, liftT, index }
    this._sig = null;
    this._t = 0;
    this._fade = 1;       // 宿主淡出系数（爬升/prep 显隐），乘进入场不透明度
    this._layoutHalf = 0; // 当前编排半宽（宿主定引出线落点用）
    this._unsubArt = this._unitArt?.addOnLoad(() => this._applyArt()) ?? null;
  }

  /**
   * 敌人清单注入（签名去重；清空 = 隐藏整组）。
   * @param list [{defId, name}]；@param boss 本层即 Boss（立牌放大一档）
   */
  setEncounter(list, { boss = false } = {}) {
    const sig = JSON.stringify((list ?? []).map(e => e.defId)) + (boss ? '|boss' : '');
    if (sig === this._sig) return;
    this._sig = sig;
    this._clear();
    const items = (list ?? []).slice(0, 5);   // 超出 5 只的编成不予预告（版面纪律）
    if (!items.length) return;
    this._t = 0;
    const scale = boss ? 1.22 : 1;
    const h = STANDEE_H * scale;
    items.forEach((e, i) => {
      const g = new THREE.Group();
      // 脚下软影（立牌底缘之下，z 垫底；node 无 document 时纯黑素面回落）
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(h * 0.72, h * 0.2),
        new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, fog: false,
          ...(previewShadowTexture() ? { map: previewShadowTexture() } : { color: 0x000000 }),
        }),
      );
      shadow.position.set(0, -h / 2 + h * 0.06, -0.05);
      g.add(shadow);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h, h), mat);
      g.add(mesh);
      const label = new TextBlockObject({
        bakeText: this._bakeText, fontPx: boss ? 17 : 14,
        tint: boss ? '#f08080' : '#c2c2c2',
      });
      label.setText(e.name ?? e.defId, { maxWidth: 120 });
      label.position.set(0, -h / 2 - NAME_GAP, 0.1);
      g.add(label);
      this.add(g);
      const entry = { defId: e.defId, name: e.name, standee: g, mesh, mat, shadow, label, lift: 0, liftT: 0, index: i };
      this._entries.push(entry);
      if (this._picker) {
        const pid = `enemyPreview:${i}:${e.defId}`;
        g.userData.enemyPreview = { index: i };
        this._picker.addPickable(pid, g, { kind: 'row' });   // world 空间（宿主是场景内 billboard）
        this._pickIds.push(pid);
      }
    });
    this._layout();
    this._applyArt();
  }

  _layout() {
    const n = this._entries.length;
    if (!n) { this._layoutHalf = 0; return; }
    const h = STANDEE_H;
    const widths = this._entries.map(() => h);   // 立牌方幅（纵横比由 _applyArt 校正）
    const total = widths.reduce((a, b) => a + b, 0) + STANDEE_GAP * (n - 1);
    this._layoutHalf = total / 2;
    let x = -total / 2;
    this._entries.forEach((e, i) => {
      e.standee.position.set(x + widths[i] / 2, 0, 0);
      x += widths[i] + STANDEE_GAP;
    });
  }

  /** 当前编排半宽（自身局部单位）——宿主 FloorChromeObject 定位引出线终点用。 */
  get layoutHalfWidth() { return this._layoutHalf; }

  /** 是否持有内容（空编成 = 隐藏整组——多层实例共存时宿主据此压 visible）。 */
  get hasContent() { return this._entries.length > 0; }

  /** 立牌贴图套用（含晚到补挂）：按素材纵横比校正平面宽度。 */
  _applyArt() {
    for (const e of this._entries) {
      const img = this._unitArt?.get(e.defId, 'enemy');
      if (!img?.width) continue;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      e.mat.map?.dispose?.();
      e.mat.map = tex;
      e.mat.color.set(0xffffff);
      e.mat.needsUpdate = true;
      const aspect = img.width / img.height;
      e.mesh.geometry.dispose();
      const h = STANDEE_H * (this._sig?.endsWith('|boss') ? 1.22 : 1);
      e.mesh.geometry = new THREE.PlaneGeometry(h * aspect, h);
      e.shadow.scale.x = aspect;   // 椭圆影随立牌宽度拉伸
      e.label.position.set(0, -h / 2 - NAME_GAP, 0.1);
    }
    this._layout();
  }

  _clear() {
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    for (const e of this._entries) {
      e.mat.map?.dispose?.();
      e.mat.dispose();
      e.mesh.geometry.dispose();
      e.shadow.geometry.dispose();
      e.shadow.material.dispose();   // 影纹理是共享烘焙，只弃材质
      e.label.dispose?.();
      this.remove(e.standee);
    }
    this._entries = [];
  }

  /** 换/脱拾取器（舞台 attachInput/detachInput 时注入；重登记当前立牌）。 */
  attachPicker(picker) {
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    this._picker = picker ?? null;
    if (this._picker) {
      this._entries.forEach((e, i) => {
        const pid = `enemyPreview:${i}:${e.defId}`;
        e.standee.userData.enemyPreview = { index: i };
        this._picker.addPickable(pid, e.standee, { kind: 'row' });   // world 空间
        this._pickIds.push(pid);
      });
    }
    return this;
  }

  /** 宿主整体淡出系数（爬升/prep 显隐）：乘进立牌/影/名称的不透明度。 */
  setFade(v) { this._fade = v; }

  /** hover：index 或 null。 */
  setHover(index) {
    this._entries.forEach((e, i) => { e.liftT = (i === index) ? 1 : 0; });
  }

  static indexOfPickId(id) {
    const m = /^enemyPreview:(\d+):/.exec(id ?? '');
    return m ? Number(m[1]) : null;
  }

  update(dt) {
    this._t += dt;
    const fade = this._fade;
    for (const e of this._entries) {
      // 入场：上浮 + 淡入（交错）
      const local = Math.min(1, Math.max(0, (this._t - e.index * ENTER_STAGGER) / ENTER_DUR));
      const ease = 1 - (1 - local) * (1 - local);
      e.mat.opacity = ease * fade;
      e.shadow.material.opacity = ease * 0.9 * fade;   // 影随入场淡入
      e.label.material.opacity = fade;                  // 名称随宿主整体淡出
      // hover 抬升
      e.lift += (e.liftT - e.lift) * Math.min(1, dt * 10);
      const enterOffset = (1 - ease) * -2.2;
      e.standee.position.y = enterOffset + e.lift * 0.9;
      e.mesh.scale.setScalar(1 + e.lift * 0.05);
    }
  }

  dispose() {
    this._unsubArt?.();
    this._clear();
  }
}
