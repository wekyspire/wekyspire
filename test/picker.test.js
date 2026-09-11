import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import mitt from 'mitt';
import { Picker } from '../src/stage/picker/Picker.js';
import { StageManager } from '../src/stage/StageManager.js';
import { CardObject } from '../src/stage/objects/CardObject.js';
import { EventNames } from '../src/bridge/events.js';

function make() {
  const sm = new StageManager({ createRenderer: () => ({ render() {}, setSize() {}, dispose() {} }) });
  sm.attach({});
  sm.resize(1000, 1000); // 世界 [-50,50]²，屏幕像素 1:10 世界单位
  const bus = mitt();
  const events = [];
  for (const name of [EventNames.TOOLTIP_SHOW, EventNames.TOOLTIP_MOVE, EventNames.TOOLTIP_HIDE, EventNames.CARD_HOVER, EventNames.CARD_LEAVE]) {
    bus.on(name, (p) => events.push({ name, payload: p }));
  }
  const picker = new Picker({ stageManager: sm, bus });
  const scene = new THREE.Scene();
  return { sm, bus, events, picker, scene };
}

// 世界坐标 → 屏幕像素（走 StageManager 投影，适配斜视相机；1000px ↔ z=0 平面 100 世界单位）
const toScreen = (sm, wx, wy, wz = 0) => sm.worldToScreen(wx, wy, wz);

function addCard(picker, scene, id, wx, wy, hitRegions = []) {
  const card = new CardObject({
    uniqueID: id,
    cardWidth: 20,
    cardHeight: 27,
    bakeFace: () => ({ texture: new THREE.Texture(), hitRegions, width: 20, height: 27 }),
  });
  card.position.set(wx, wy, 0);
  card.setCard({});
  card.updateMatrixWorld(true);
  scene.add(card);
  picker.addPickable(id, card, { kind: 'card', cardObject: card });
  return card;
}

describe('Picker', () => {
  it('命中整卡（无热区处）', () => {
    const { sm, picker, scene } = make();
    addCard(picker, scene, 'c1', 0, 0);
    const { x, y } = toScreen(sm, 0, 0);
    expect(picker.pick(x, y)).toEqual({ kind: 'card', id: 'c1' });
  });

  it('未命中任何对象 → background', () => {
    const { sm, picker, scene } = make();
    addCard(picker, scene, 'c1', 0, 0);
    const { x, y } = toScreen(sm, 40, 40);
    expect(picker.pick(x, y)).toEqual({ kind: 'background' });
  });

  it('token 热区优先于整卡', () => {
    const { sm, picker, scene } = make();
    // 热区：局部 x∈[0,10], y∈[0,10]（牌面左上 10x10）
    const region = { type: 'named', payload: { name: '瑞米' }, rect: { x: 0, y: 0, w: 10, h: 10 } };
    addCard(picker, scene, 'c1', 0, 0, [region]);
    // 局部 (5,5) → 世界 (-5, 8.5)：牌中心 (0,0)，宽 20 高 27，左上 (-10, 13.5)
    const { x, y } = toScreen(sm, -5, 8.5);
    const hit = picker.pick(x, y);
    expect(hit.kind).toBe('token');
    expect(hit.region).toEqual(region);
  });

  it('叠放时近处卡优先', () => {
    const { sm, picker, scene } = make();
    addCard(picker, scene, 'back', 0, 0);
    const front = addCard(picker, scene, 'front', 0, 0);
    front.position.z = 5;
    front.updateMatrixWorld(true);
    const { x, y } = toScreen(sm, 0, 0);
    expect(picker.pick(x, y)).toEqual({ kind: 'card', id: 'front' });
  });

  it('hover 事件流：卡面 token 同时维持整卡 hover（show → move → hide，卡离场才 leave）', () => {
    const { sm, picker, scene, events } = make();
    const region = { type: 'named', payload: { name: '瑞米' }, rect: { x: 0, y: 0, w: 10, h: 10 } };
    addCard(picker, scene, 'c1', 0, 0, [region]);
    const tokenPos = toScreen(sm, -5, 8.5);
    const cardPos = toScreen(sm, 5, -5); // 卡面右下角（热区外）
    const bgPos = toScreen(sm, 45, 45);

    picker.hover(tokenPos.x, tokenPos.y);
    picker.hover(tokenPos.x + 5, tokenPos.y + 5); // 同 token 内移动
    picker.hover(cardPos.x, cardPos.y);
    picker.hover(bgPos.x, bgPos.y);

    // 进 token 即入卡悬浮（不打断），离卡（背景）才 CARD_LEAVE
    expect(events.map(e => e.name)).toEqual([
      EventNames.CARD_HOVER,
      EventNames.TOOLTIP_SHOW,
      EventNames.TOOLTIP_MOVE,
      EventNames.TOOLTIP_HIDE,
      EventNames.CARD_LEAVE,
    ]);
    expect(events[1].payload).toMatchObject({ kind: 'named', payload: { name: '瑞米' } });
    expect(events[0].payload).toEqual({ uniqueID: 'c1' });
  });

  it('卡面 token 不打断所属卡悬浮：卡身 → token 不发 leave；A 卡 token → B 卡身正常切换', () => {
    const { sm, picker, scene, events } = make();
    const region = { type: 'effect', payload: { name: '燃烧' }, rect: { x: 0, y: 0, w: 10, h: 10 } };
    addCard(picker, scene, 'a', 0, 0, [region]);
    addCard(picker, scene, 'b', 30, 0); // 另一张卡（卡身）
    const aBody = toScreen(sm, 5, -5);   // a 卡热区外
    const aToken = toScreen(sm, -5, 8.5); // a 卡热区内
    const bBody = toScreen(sm, 30, 0);

    picker.hover(aBody.x, aBody.y);   // 入 a
    picker.hover(aToken.x, aToken.y); // a 卡身 → a token：tooltip 出、无 CARD_LEAVE
    expect(events.filter(e => e.name === EventNames.CARD_LEAVE)).toHaveLength(0);
    expect(events.map(e => e.name)).toEqual([EventNames.CARD_HOVER, EventNames.TOOLTIP_SHOW]);

    picker.hover(bBody.x, bBody.y); // a token → b 卡身：离 a 入 b + tooltip 收起
    expect(events.map(e => e.name).slice(2)).toEqual([
      EventNames.TOOLTIP_HIDE, EventNames.CARD_LEAVE, EventNames.CARD_HOVER,
    ]);
    expect(events.at(-1).payload).toEqual({ uniqueID: 'b' });
  });

  it('单位 token：hover 走 tooltip 协议（载荷即热区契约）；kinds:[unit] 过滤时仍返回整单位', () => {
    const { sm, picker, scene, events } = make();
    // 单位组 + 效果行网格（userData.token 与卡面 hitRegion 同构）
    const unit = new THREE.Group();
    const row = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial());
    row.userData.token = { type: 'effect', payload: { effectId: 'burn', name: '燃烧' } };
    row.position.set(0, 6, 0.1);
    unit.add(row);
    unit.updateMatrixWorld(true);
    scene.add(unit);
    picker.addPickable('u1', unit, { kind: 'unit' });

    // hover 效果行 → tooltip show（{kind, payload} 即契约本体）→ 行内移动 move → 离开 hide
    const rowPos = toScreen(sm, 0, 6);
    picker.hover(rowPos.x, rowPos.y);
    picker.hover(rowPos.x + 3, rowPos.y);
    picker.hover(...Object.values(toScreen(sm, 45, 45)));
    expect(events.map(e => e.name)).toEqual([
      EventNames.TOOLTIP_SHOW, EventNames.TOOLTIP_MOVE, EventNames.TOOLTIP_HIDE,
    ]);
    expect(events[0].payload).toMatchObject({ kind: 'effect', payload: { effectId: 'burn', name: '燃烧' } });

    // 拖牌/瞄准路径（kinds:['unit']）：token 区域仍算单位落点，不弹 tooltip
    const hit = picker.pick(rowPos.x, rowPos.y, { kinds: ['unit'] });
    expect(hit).toEqual({ kind: 'unit', id: 'u1' });
  });

  it('可见性守卫：自身或祖先隐藏的面片不可命中（raycast 不查 visible，守卫兜底）', () => {
    const { sm, picker, scene, events } = make();
    const unit = new THREE.Group();
    const row = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial());
    row.userData.token = { type: 'effect', payload: { effectId: 'burn', name: '燃烧' } };
    row.position.set(0, 6, 0.1);
    unit.add(row);
    unit.updateMatrixWorld(true);
    scene.add(unit);
    picker.addPickable('u1', unit, { kind: 'unit' });
    const at = toScreen(sm, 0, 6);

    row.visible = false; // 面片自身隐藏（如隐藏态意图条）：无 token 幽灵命中
    expect(picker.pick(at.x, at.y)).toEqual({ kind: 'background' });
    row.visible = true;
    unit.visible = false; // 祖先组隐藏（如死亡收殓的血条行）：整链不可命中
    expect(picker.pick(at.x, at.y)).toEqual({ kind: 'background' });

    unit.visible = true;
    expect(picker.pick(at.x, at.y))
      .toEqual({ kind: 'token', id: 'u1', region: row.userData.token });
    picker.hover(at.x, at.y); // 可见时正常走 tooltip 协议
    expect(events[0].name).toBe(EventNames.TOOLTIP_SHOW);
  });
});
