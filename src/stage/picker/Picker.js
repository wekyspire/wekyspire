// Picker（§4.7）：raycast 拾取 + hit map 二级查询 + hover 事件。
// 优先级铁律：token 热区 > 整卡 > 场景按钮 > 背景。
// token 热区 = 任意对象挂 userData.token（{ type, payload, rect 不要求 }，与卡面
// hitRegion 同构）——单位效果行/意图条等场景侧热区都走这个通用挂钩。
// 命中链可见性守卫：three 的 raycast 不检查 visible（r185 实测隐藏面片照常
// 命中），统一在拾取层向上遍历——隐藏对象（死亡收殓的血条行、空意图条）不可
// 命中，token 源不必各自「隐藏时摘 userData」。
// 命中 token 热区 → 发 tooltip:*（Shell 消费）；卡面 token（富文本/S 标）同时
// 维持所属卡的 hover（悬浮到关键词上不该让手牌退出撑开态）；单位 token
// 照旧离卡（单位无卡悬浮概念）。
// 拖拽由 BattleStage 在 Picker 的 card 命中基础上驱动（射线与牌桌平面求交），不在本模块内。
//
// 双相机路由：pickable 带 space（'world'|'ui'，缺省 world）——UI pass 用专用 uiCamera
// 渲染且永远盖在世界 pass 上方，故拾取也先查 UI（uiCamera 射线）再查世界（camera 射线），
// UI 命中即返回。three 的 Raycaster 是纯数学，node 单测可用真实射线 + 真实 plane 验证优先级。

import * as THREE from 'three';
import { EventNames } from '../../bridge/events.js';

// 命中链可见性：任一祖先 invisible 即视为不可命中（raycast 只查 layers 不查 visible）
function visibleUp(object) {
  for (let cur = object; cur; cur = cur.parent) {
    if (!cur.visible) return false;
  }
  return true;
}

export class Picker {
  /**
   * @param {object} options
   *   stageManager: StageManager   相机（世界 + UI）与 viewSize 来源
   *   bus: 事件总线（tooltip/card-hover 协议事件的出口，接哪条总线由装配层定）
   */
  constructor({ stageManager, bus }) {
    this._sm = stageManager;
    this._bus = bus;
    this._raycaster = new THREE.Raycaster();
    this._pickables = new Map(); // id -> { object3D, kind:'card'|'button'|'unit', space, cardObject? }
    this._hoverToken = null;     // { id, region }
    this._hoverCard = null;      // id
  }

  addPickable(id, object3D, { kind = 'card', cardObject = null, space = 'world' } = {}) {
    object3D.userData.pickableId = id;
    this._pickables.set(id, { object3D, kind, cardObject, space });
  }

  removePickable(id) {
    this._pickables.delete(id);
    if (this._hoverCard === id) this._hoverCard = null;
    if (this._hoverToken?.id === id) this._hoverToken = null;
  }

  /**
   * 拾取查询（纯函数，不发事件）。
   * @param {object} filter  kinds: 只取这些 kind 的 pickable；excludeIds: 排除的 id（如拖拽中的卡）
   * @returns { kind:'token', id, region } | { kind:'card'|'button'|'unit'|'pile'|'viewer', id } | { kind:'background' }
   */
  pick(screenX, screenY, { kinds = null, excludeIds = null } = {}) {
    const { width, height } = this._sm.viewSize;
    const ndc = new THREE.Vector2(
      (screenX / width) * 2 - 1,
      -((screenY / height) * 2 - 1),
    );
    // UI 先世界后（UI pass 渲染次序即覆盖次序）
    for (const space of ['ui', 'world']) {
      const camera = space === 'ui' ? this._sm.uiCamera : this._sm.camera;
      const entries = [...this._pickables.entries()]
        .filter(([id, p]) => (p.space ?? 'world') === space
          && (!kinds || kinds.includes(p.kind)) && !excludeIds?.includes(id));
      if (!camera || !entries.length) continue;
      camera.updateMatrixWorld(); // 相机不在场景图内，matrixWorld 需手动刷新
      this._raycaster.setFromCamera(ndc, camera);
      const hits = this._raycaster.intersectObjects(entries.map(([, p]) => p.object3D), true);
      for (const hit of hits) {
        if (!visibleUp(hit.object)) continue; // 隐藏对象不可命中（幽灵 token 统一防线）
        const owner = this._findPickable(hit.object);
        if (!owner) continue;
        // 通用 token 热区（与卡面 hitRegion 同构）：**任意** pickable 带 userData.token 皆可命中，
        // 面板行（遗物效果）、顶端资源栏遗物槽、单位效果行/意图条共用这一个挂钩。
        // token 挂在 pickable 的根对象或命中面片上都认（前者更省事：槽位是 Group→Mesh 两级）。
        const tokenRegion = owner.entry.object3D?.userData?.token ?? hit.object.userData?.token;
        if (tokenRegion && (!kinds || kinds.includes('token'))) {
          return { kind: 'token', id: owner.id, region: tokenRegion };
        }
        // 整卡命中后做 hit map 二级查询（仅卡面面片）
        if (owner.entry.kind === 'card' && owner.entry.cardObject && hit.uv) {
          const region = owner.entry.cardObject.hitTestUV({ u: hit.uv.x, v: hit.uv.y });
          if (region) return { kind: 'token', id: owner.id, region };
        }
        return { kind: owner.entry.kind, id: owner.id };
      }
    }
    return { kind: 'background' };
  }

  /** hover 轮询：按命中变化发 tooltip:* / card:hover/leave。 */
  hover(screenX, screenY) {
    const hit = this.pick(screenX, screenY);

    if (hit.kind === 'token') {
      const same = this._hoverToken && this._hoverToken.id === hit.id && this._hoverToken.region === hit.region;
      // 卡面 token = 仍悬浮在所属卡上：维持整卡 hover 不中断（tooltip 与撑开并存）
      if (this._pickables.get(hit.id)?.kind === 'card') this._hoverCardOn(hit.id);
      else this._leaveCard();
      if (!same) {
        this._hoverToken = { id: hit.id, region: hit.region };
        // 载荷即热区契约本体：{ kind, payload }（tooltipModel 按此解析）+ 指针坐标
        this._bus.emit(EventNames.TOOLTIP_SHOW, {
          kind: hit.region.type,
          payload: hit.region.payload,
          x: screenX,
          y: screenY,
        });
      } else {
        this._bus.emit(EventNames.TOOLTIP_MOVE, { x: screenX, y: screenY });
      }
      return hit;
    }

    this._leaveToken();
    if (hit.kind === 'card') {
      this._hoverCardOn(hit.id);
    } else {
      this._leaveCard();
    }
    return hit;
  }

  // 卡悬浮维护：目标卡变化时先离后入（同卡在 整卡↔卡面token 间移动不抖动）
  _hoverCardOn(id) {
    if (this._hoverCard === id) return;
    this._leaveCard();
    this._hoverCard = id;
    this._bus.emit(EventNames.CARD_HOVER, { uniqueID: id });
  }

  _leaveToken() {
    if (this._hoverToken) {
      this._hoverToken = null;
      this._bus.emit(EventNames.TOOLTIP_HIDE, {});
    }
  }

  _leaveCard() {
    if (this._hoverCard) {
      const id = this._hoverCard;
      this._hoverCard = null;
      this._bus.emit(EventNames.CARD_LEAVE, { uniqueID: id });
    }
  }

  _findPickable(object) {
    let cur = object;
    while (cur) {
      const id = cur.userData?.pickableId;
      if (id != null && this._pickables.has(id)) return { id, entry: this._pickables.get(id) };
      cur = cur.parent;
    }
    return null;
  }
}
