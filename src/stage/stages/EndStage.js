// EndStage：终局结算舞台（Three 层，与塔楼/战斗/房间并列的第四舞台）。
// 由 runController 在 gameStage='end' 时经幕间黑幕切入（取代旧 Vue EndPanel 弹窗）——
// 结算数据（击杀/金币/卡组/遗物）在 core 落成 run.stats 与 run 字段，Shell 装配成
// **视图对象**（纯数据）注入，本舞台不反查 core 注册表。
//
// 节拍：构造时全部件就位但透明 → startTally() 逐条亮出（标题 → 副题 → 讨伐清单
// 逐条 → 卡组/金币 → 遗物图标 → 再来一局），GSAP 补间，退场 dispose 统一杀。
// 文本走 TextBlockObject（bakeAutoLine 缺省烘焙）、按钮走 ButtonObject（bakeButtonFace
// 三态），与面板同一份 UI 语言。
import * as THREE from 'three';
import gsap from 'gsap';
import { TextBlockObject } from '../objects/TextBlockObject.js';
import { ButtonObject } from '../objects/ButtonObject.js';
import { Picker } from '../picker/Picker.js';
import { sharedRelicArtCache } from '../art/relicArt.js';

const PX_PER_WU = 10; // 与 TextBlockObject 同约定（10 逻辑像素 = 1 世界单位）
const KILLS_SHOW_MAX = 8;   // 讨伐清单至多逐条列 8 种，余者并入「另 K 种」
const RELIC_ICON_WU = 5.2;  // 遗物图标边长（世界单位）
const RELIC_ICON_MAX = 10;

export class EndStage {
  /**
   * @param {object} options
   *   stageManager / bus：输入通道（attachInput 注入）
   *   view: { result:'victory'|'defeat', floor, totalFloors, kills:[{name,count}],
   *          deckCount, goldEarned, relics:[{id,name}], title, subtitle }
   *   onAction(action)：按钮语义出口（'restart'）
   */
  constructor({ stageManager = null, bus = null, view = {}, onAction = null } = {}) {
    this.name = 'end';
    this.scene = new THREE.Scene();      // 世界层留空（结算内容全在 UI 正交层）
    this.uiScene = new THREE.Scene();
    this._sm = stageManager;
    this._bus = bus;
    this._view = view;
    this._onAction = onAction;
    this._picker = null;
    this._downHit = null;
    this._unsubTick = null;
    this._beats = [];        // 逐条结算的登场节拍 [{targets:[{mat,pos?}], delay}]
    this._tallied = false;
    this._relicIcons = [];   // 待惰性贴图的遗物图标 [{mesh, name}]
    this._disposables = [];
    this._content = new THREE.Group(); // 结算内容组：建完后按实际高度整体居中
    this.uiScene.add(this._content);

    this._buildBackdrop();
    this._buildContent();
    this._centerContent();
  }

  // ---- 内容搭建 ----

  /** 内容组整体居中：按实际高度把块中心对齐到取景心偏上（y=-4），顶不破 +38。 */
  _centerContent() {
    let top = -Infinity;
    let bottom = Infinity;
    for (const m of this._content.children) {
      const halfH = ((m.geometry?.parameters?.height ?? 1) * m.scale.y) / 2;
      top = Math.max(top, m.position.y + halfH);
      bottom = Math.min(bottom, m.position.y - halfH);
    }
    if (!Number.isFinite(top)) return;
    this._content.position.y = Math.min(-4 - (top + bottom) / 2, 38 - top);
  }

  /** 暗场底：纵向渐变的整屏面片（UI 层最深处），把纯黑清场压出一点纵深。 */
  _buildBackdrop() {
    const geo = new THREE.PlaneGeometry(230, 140);
    const top = new THREE.Color('#0b1020');   // 顶：极深藏青
    const bottom = new THREE.Color('#030409'); // 底：近黑
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) / 140) + 0.5;
      const c = bottom.clone().lerp(top, t);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    mesh.position.set(0, -10, -80); // UI 取景中心 y=-10，压到内容最后
    this.uiScene.add(mesh);
    this._disposables.push(mesh);
  }

  _addText(text, { x = 0, y = 0, fontPx = 16, tint = '#d4dbe8' } = {}) {
    const t = new TextBlockObject({ fontPx, tint });
    t.setText(text);
    t.placeCenterTop(x, y);
    t.position.z = 0;
    this._content.add(t);
    this._disposables.push(t);
    return t;
  }

  _buildContent() {
    const v = this._view;
    const beats = this._beats;
    const push = (meshes, step) => {
      for (const m of [].concat(meshes)) {
        m.material.transparent = true;
        m.material.opacity = 0;
      }
      beats.push({ meshes: [].concat(meshes), step });
    };

    // 标题 / 副题
    const victory = v.result === 'victory';
    push(this._addText(v.title ?? (victory ? '登顶成功' : '倒在了塔中'),
      { y: 34, fontPx: 42, tint: victory ? '#f2f2f2' : '#ff8f88' }), 0.55);
    push(this._addText(v.subtitle ?? '', { y: 27.5, fontPx: 16, tint: '#8fa0bd' }), 0.30);

    // 分隔线
    const divider = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 0.14),
      new THREE.MeshBasicMaterial({ color: '#2a3648', transparent: true, fog: false }),
    );
    divider.position.set(0, 22.5, 0);
    this._content.add(divider);
    this._disposables.push(divider);
    push(divider, 0.22);

    // 讨伐清单（逐条登场 = 结算感主体）
    let y = 18.5;
    const kills = v.kills ?? [];
    const totalKills = kills.reduce((a, k) => a + k.count, 0);
    push(this._addText(`讨伐 共 ${totalKills} 只`, { y, fontPx: 15, tint: '#8fa0bd' }), 0.26);
    y -= 3.4;
    for (const k of kills.slice(0, KILLS_SHOW_MAX)) {
      push(this._addText(`${k.name} ×${k.count}`, { y, fontPx: 17, tint: '#d4dbe8' }), 0.14);
      y -= 3.4;
    }
    if (kills.length > KILLS_SHOW_MAX) {
      push(this._addText(`……另 ${kills.length - KILLS_SHOW_MAX} 种`, { y, fontPx: 14, tint: '#6d7c96' }), 0.14);
      y -= 3.4;
    }
    if (!kills.length) {
      push(this._addText('（未尝胜绩）', { y, fontPx: 15, tint: '#6d7c96' }), 0.14);
      y -= 3.4;
    }

    // 卡组 / 金币（金色只给金钱行）
    y -= 0.8;
    push(this._addText(`卡组 ${v.deckCount ?? 0} 张`, { y, fontPx: 17, tint: '#d4dbe8' }), 0.26);
    y -= 3.4;
    push(this._addText(`金币 本局共获得 ${v.goldEarned ?? 0}`, { y, fontPx: 17, tint: '#ffd479' }), 0.26);
    y -= 4.6;

    // 遗物：标签行 + 图标行（立绘惰性贴图，未命中留底块）
    const relics = (v.relics ?? []).slice(0, RELIC_ICON_MAX);
    push(this._addText(`遗物 ${v.relics?.length ?? 0} 件`, { y, fontPx: 17, tint: '#d4dbe8' }), 0.26);
    y -= 6.4;
    if (relics.length) {
      const gap = 1.3;
      const rowW = relics.length * RELIC_ICON_WU + (relics.length - 1) * gap;
      let x = -rowW / 2 + RELIC_ICON_WU / 2;
      const icons = [];
      for (const r of relics) {
        const icon = new THREE.Mesh(
          new THREE.PlaneGeometry(RELIC_ICON_WU, RELIC_ICON_WU),
          new THREE.MeshBasicMaterial({ color: '#232c3e', transparent: true, fog: false }),
        );
        icon.userData.sharedMap = true; // 遗物立绘是进程级共享纹理——dispose 不可连带销毁
        icon.position.set(x, y, 0);
        this._content.add(icon);
        this._disposables.push(icon);
        this._relicIcons.push({ mesh: icon, name: r.name });
        icons.push(icon);
        x += RELIC_ICON_WU + gap;
      }
      push(icons, 0.30);
      y -= 5.4;
    }

    // 再来一局
    const btn = new ButtonObject({ id: 'end:restart', width: 260, height: 62, fontPx: 20 });
    btn.setData({ label: '再来一局' });
    btn.placeCenter(0, Math.max(y - 2.0, -46));
    btn.position.z = 1;
    this._content.add(btn);
    this._disposables.push(btn);
    this._button = btn;
    push(btn, 0.4);
  }

  /**
   * 逐条结算登场（切幕揭幕后由宿主调用一次；重复调用幂等）。
   * 每条 = 透明度 0→1 + 上浮 1.4wu；讨伐清单节拍更密（陈列感）。
   */
  startTally() {
    if (this._tallied) return;
    this._tallied = true;
    let delay = 0.15;
    for (const beat of this._beats) {
      for (const m of beat.meshes) {
        const targetY = m.position.y;
        m.position.y = targetY - 1.4;
        gsap.to(m.material, { opacity: 1, duration: 0.32, delay, ease: 'power2.out' });
        gsap.to(m.position, { y: targetY, duration: 0.32, delay, ease: 'power2.out' });
      }
      delay += beat.step;
    }
  }

  // ---- 输入（仅此一颗按钮；Picker 契约与 MapStage 同构）----

  attachInput({ stageManager, bus } = {}) {
    this._picker = stageManager ? new Picker({ stageManager, bus }) : null;
    this._sm = stageManager ?? this._sm;
    if (this._picker && this._button) this._picker.addPickable('end:restart', this._button, { kind: 'button', space: 'ui' });
  }

  detachInput() {
    this._picker?.removePickable?.('end:restart');
    this._picker = null;
    this._downHit = null;
  }

  handlePointerMove(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.hover(x, y);
    this._button?.setHovered(hit?.id === 'end:restart');
  }

  handlePointerDown(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this._downHit = this._picker.pick(x, y);
  }

  handlePointerUp(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.pick(x, y);
    const down = this._downHit;
    this._downHit = null;
    if (hit?.id === 'end:restart' && down?.id === 'end:restart') this._onAction?.('restart');
  }

  // ---- 帧推进：遗物立绘惰性贴图（未就绪下一帧再试）----

  onEnter(manager) {
    this._unsubTick = manager?.onTick?.(() => {
      for (const it of this._relicIcons) {
        if (it.done) continue;
        const tex = sharedRelicArtCache.getTexture(it.name);
        if (!tex) continue;
        it.done = true;
        it.mesh.material.map = tex;
        it.mesh.material.color.set('#ffffff');
        it.mesh.material.needsUpdate = true;
      }
    }) ?? null;
  }

  onExit() {
    this._unsubTick?.();
    this._unsubTick = null;
  }

  dispose() {
    this.onExit();
    this.detachInput();
    for (const m of this._disposables) {
      gsap.killTweensOf(m.material);
      gsap.killTweensOf(m.position);
      m.geometry?.dispose?.();
      if (!m.userData?.sharedMap) m.material?.map?.dispose?.(); // 共享纹理（遗物立绘）不销毁
      m.material?.dispose?.();
    }
    this._disposables.length = 0;
    this._relicIcons.length = 0;
    this._beats.length = 0;
  }
}
