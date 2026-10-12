// 楼层通过演出（战斗胜利回塔楼那一拍）：刚清掉的楼层敌人预览残影——
// 逐个**开裂 → 灰暗 → 崩解成灰随风散**（灰由 GPU 池 floorAsh 承载）。
// 版式与 EnemyPreviewObject 同一份排版常量；立绘走 unitArt 共享缓存（战斗刚渲染过必命中）。
// 逐敌时间线（uClear 0→1 内部分相）：
//   0.00~0.38 开裂（山脊噪声双层裂纹自中心扩开 + 前沿一闪）
//   0.22~0.62 灰暗（去饱和 + 压暗成冷灰）
//   0.45~1.00 崩解（ashErodeField 阈值侵蚀成孔 + 孔缘灰白亮线；粒子从缺口剥落）
// 发射单源纪律：stagger ≥ 侵蚀窗（0.63s），同一时刻至多一敌在剥落——
// floorAsh 只有一套发射 uniform，本驱动逐帧挑出正在侵蚀的那只换挂。
// 生命周期：宿主（FloorChromeObject）每帧 update(dt, camera) 驱动；done 后宿主摘除。
// 跟随方式：不挂进层牌组（层牌爬升远去会先压 visible 把尾巴吃掉）——挂 chrome 根，
// 每帧照层牌的世界位 + billboard 四元数换算自己的位姿。
import * as THREE from 'three';
import gsap from 'gsap';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv, texture,
  vec2, vec3, vec4, float,
  mix, dot, exp, abs, length, smoothstep, oneMinus,
} from 'three/tsl';
import { TextBlockObject } from '../objects/TextBlockObject.js';
import { PREVIEW_LAYOUT, previewShadowTexture } from '../objects/EnemyPreviewObject.js';
import { ubfFbm } from './unitBodyFx.js';
import { FLOOR_ASH, ashErodeField } from './gpu/floorAsh.js';

const ENTER_DUR = 0.28;      // 残影亮相淡入（揭幕黑场刚收，快速浮现一拍）
const HOLD = 0.14;           // 亮相后定格（玩家认出「这是刚打过的那批」）
const CLEAR_DUR = 1.15;      // 单敌 开裂→灰暗→崩解 全程
const STAGGER = 0.70;        // 逐敌交错（≥ 侵蚀窗 0.63s + 余量——单源发射纪律）
const TAIL = 1.9;            // 末敌崩解后留灰消散（粒子 ttl 1.7 + 余量）再收编

// —— 消散面片 shader（TSL；色参烘常量 vec3 节点，纪律同 spells/shaders.js）——
// base = 立绘采样（rgb, a）；输出 vec4（开裂压暗/灰暗/侵蚀 alpha + 孔缘亮线）。
const clearShade = Fn(([base, vUv, uClear, uSeed]) => {
  // 裂纹场：双层山脊噪声（主裂粗 + 支裂细），0 等高线 = 裂缝
  const p1 = vUv.mul(4.6).add(uSeed.mul(7.31));
  const p2 = vUv.mul(9.7).add(uSeed.mul(3.17)).add(vec2(2.9, 5.1));
  const r1 = abs(ubfFbm(p1).mul(2.0).sub(1.0));
  const r2 = abs(ubfFbm(p2).mul(2.0).sub(1.0));
  const crackWeb = oneMinus(smoothstep(0.02, 0.10, r1))
    .add(oneMinus(smoothstep(0.015, 0.055, r2)).mul(0.55)).toVar();
  // 开裂自中心扩开（敌人是被击破的）：reveal 半径随 uClear 推进
  const reveal = uClear.div(0.38).mul(1.9).toVar();
  const d = length(vUv.sub(vec2(0.5, 0.45))).mul(1.6).toVar();
  const crackOn = crackWeb.mul(oneMinus(smoothstep(reveal.sub(0.10), reveal.add(0.04), d))).toVar();
  // 开裂前沿一闪（新裂缝的锐亮边；开裂相收尾即灭）
  const flash = crackWeb.mul(exp(d.sub(reveal).pow(2.0).mul(-300.0)))
    .mul(oneMinus(smoothstep(0.36, 0.48, uClear)));
  // 灰暗：去饱和 + 压暗成冷灰（开裂中期起）
  const gk = smoothstep(0.22, 0.62, uClear);
  const gray = dot(base.rgb, vec3(0.299, 0.587, 0.114));
  // 崩解：侵蚀场阈值推进（×1.18 过头顶——场满值 ~1，保证全图蚀尽）
  const ek = smoothstep(0.45, 1.0, uClear).mul(1.18).toVar();
  const n = ashErodeField(vUv, uSeed).toVar();
  const alphaK = smoothstep(ek.sub(0.02), ek.add(0.10), n);
  // 孔缘灰白亮线（贴着缺口的未蚀侧窄带；阈下亮度，不抢 bloom）
  const rim = smoothstep(ek.add(0.02), ek.add(0.09), n)
    .mul(oneMinus(smoothstep(ek.add(0.09), ek.add(0.17), n)))
    .mul(smoothstep(0.45, 0.55, uClear));
  const rgb = mix(base.rgb, vec3(gray).mul(vec3(0.46, 0.48, 0.54)), gk)
    .mul(oneMinus(crackOn.mul(0.78)))
    .add(vec3(1.20, 1.26, 1.42).mul(flash.mul(0.9)))
    .add(vec3(1.05, 1.10, 1.24).mul(rim.mul(0.8)));
  return vec4(rgb, base.a.mul(alphaK));
});

/**
 * 播一行残影崩解。宿主每帧驱动返回句柄的 update；done 后宿主 dispose 摘除。
 * @param {object} o
 *   chrome  FloorChromeObject（挂点 = 其根组；marker 位姿逐帧跟）
 *   marker  目标层牌记录（_ensureMarker 的返回）
 *   encounter [{defId, name}]（刚清掉那层的敌人编成）
 *   boss    本层即 Boss（立牌放大一档，与预告同律）
 *   unitArt 立绘缓存；pool 世界 GPU 池（null = 只演面片崩解，无灰）
 */
export function playFloorClearRow({ chrome, marker, encounter, boss = false, unitArt = null, pool = null }) {
  const { STANDEE_H, STANDEE_GAP, NAME_GAP, BOSS_SCALE } = PREVIEW_LAYOUT;
  const scaleK = boss ? BOSS_SCALE : 1;
  const h = STANDEE_H * scaleK;
  const items = (encounter ?? []).slice(0, 5);
  const group = new THREE.Group();
  group.name = 'floorClearGhost';
  const entries = [];
  items.forEach((e, i) => {
    const img = unitArt?.get(e.defId, 'enemy');
    if (!img?.width) return;   // 素材缺席（理论不可达：战斗刚渲染过）——跳过该残影
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    const w = h * (img.width / img.height);
    const uClear = uniform(0);
    const uFade = uniform(0);
    const uSeed = uniform((i + 1) * 0.618 + 0.17);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    const t = texture(tex);
    // 亮相淡入只折 alpha（rgb 不动——暗色立绘提前显形会破坏「浮现」读感）；
    // uFade 经外层组合引入，不进 shade 参数表（规避 Fn 末参绑定坑）
    const shaded = clearShade(t.sample(uv()), uv(), uClear, uSeed).toVar();
    mat.colorNode = vec4(shaded.rgb, shaded.a.mul(uFade));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    // 脚下软影（开裂起即收）
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.72, h * 0.2),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, fog: false,
        ...(previewShadowTexture() ? { map: previewShadowTexture() } : { color: 0x000000 }),
      }),
    );
    shadow.position.set(0, -h / 2 + h * 0.06, -0.05);
    // 名签（与预告同位；开裂起淡出）
    const label = new TextBlockObject({ bakeText: null, fontPx: boss ? 17 : 14, tint: boss ? '#f08080' : '#c2c2c2' });
    label.setText(e.name ?? e.defId, { maxWidth: 120 });
    label.position.set(0, -h / 2 - NAME_GAP, 0.1);
    const standee = new THREE.Group();
    standee.add(shadow, mesh, label);
    group.add(standee);
    entries.push({
      standee, mesh, mat, shadow, label, tex, uClear, uFade, uSeed,
      rec: { clear: 0, fade: 0 },   // gsap 推进的标量对（update 折进 uniform）
    });
  });
  if (!entries.length) return { update() {}, dispose() {}, done: true, total: 0, visualDone: Promise.resolve() };
  // 行编排（与预告同式）：总宽 → 逐敌 x 落点
  const n = entries.length;
  const total = h * n + STANDEE_GAP * (n - 1);
  let x = -total / 2;
  for (const e of entries) { e.standee.position.x = x + h / 2; x += h + STANDEE_GAP; }
  const rowScale = chrome.previewScaleFor(total);
  chrome.add(group);

  // 逐敌时间线：亮相（齐）→ 定格 → 逐个 开裂/灰暗/崩解
  const tweens = [];
  entries.forEach((e, i) => {
    tweens.push(gsap.to(e.rec, { fade: 1, duration: ENTER_DUR, ease: 'power1.out' }));
    tweens.push(gsap.to(e.rec, {
      clear: 1, duration: CLEAR_DUR, ease: 'none',
      delay: ENTER_DUR + HOLD + i * STAGGER,
    }));
  });

  const ash = pool?.typeApi(FLOOR_ASH) ?? null;
  if (ash) {
    pool.setTypeActive(FLOOR_ASH, 1);
    pool.setTypeRateScale(FLOOR_ASH, 0);   // 闸常闭——只在某敌侵蚀段内由 update 开
  }
  const handle = {
    done: false,
    total: entries.length,
    _entries: entries,   // 探针面（验收断言读 rec.clear/fade；生产不消费）
    _group: group,
    _t: 0,
    // 视觉落定回执（末敌崩解完，不含灰尾）：爬升指令的节拍闸——本层有房间时
    // 相机不爬，靠它把「房间切幕」压到崩解演完之后
    _visualDone: false,
    _visualResolve: null,
    visualDone: null,
    _off: new THREE.Vector3(),
    update(dt, camera) {
      this._t += dt;
      // 跟随层牌：位 = 层牌世界位 + 预告同款局部锚（经层牌 billboard 四元数旋入世界）
      const m = marker;
      const a = chrome.previewAnchorLocal(m, rowScale);
      const s = rowScale * m.group.scale.x;
      this._off.set(a.x, a.y, a.z + 0.05)
        .multiplyScalar(m.group.scale.x)
        .applyQuaternion(m.group.quaternion);
      group.position.copy(m.group.position).add(this._off);
      group.quaternion.copy(m.group.quaternion);
      group.scale.setScalar(s);
      // 逐敌 uniform 折进 + 阴影/名签随开裂退席
      let emitting = null, emitEk = 0;
      for (const e of entries) {
        e.uClear.value = e.rec.clear;
        e.uFade.value = e.rec.fade;
        const c = e.rec.clear;
        const early = Math.max(0, 1 - c / 0.30);   // 开裂相内影/名签退尽
        e.shadow.material.opacity = 0.9 * e.rec.fade * early;
        e.label.material.opacity = e.rec.fade * early;
        if (c > 0.45 && c < 1.0 && !emitting) {
          // 与 shader 同口径 ek = smoothstep(0.45,1,c)×1.18（smoothstep 非线性，照算）
          const tt = (c - 0.45) / 0.55;
          emitting = e; emitEk = tt * tt * (3 - 2 * tt) * 1.18;
        }
      }
      // 灰发射：单源换挂正在侵蚀的那只；无人在侵蚀段即关闸
      if (ash) {
        if (emitting) {
          emitting.mesh.updateWorldMatrix(true, false);
          const gp = emitting.mesh.geometry.parameters;
          ash.drive({
            tex: emitting.tex, model: emitting.mesh.matrixWorld,
            quadW: gp.width, quadH: gp.height,
            front: emitEk, seed: emitting.uSeed.value,
          });
          pool.setTypeRateScale(FLOOR_ASH, 1);
        } else {
          pool.setTypeRateScale(FLOOR_ASH, 0);
        }
      }
      const lastDelay = ENTER_DUR + HOLD + (entries.length - 1) * STAGGER;
      if (!this._visualDone && this._t > lastDelay + CLEAR_DUR) {
        this._visualDone = true;
        this._visualResolve?.();
      }
      if (this._t > lastDelay + CLEAR_DUR + TAIL) this.done = true;
    },
    dispose: () => {
      for (const tw of tweens) tw.kill();
      if (!handle._visualDone) { handle._visualDone = true; handle._visualResolve?.(); }
      if (ash) { pool.setTypeRateScale(FLOOR_ASH, 0); pool.setTypeActive(FLOOR_ASH, 0); }
      for (const e of entries) {
        e.tex.dispose();
        e.mat.dispose();
        e.mesh.geometry.dispose();
        e.shadow.geometry.dispose();
        e.shadow.material.dispose();   // 影纹理是共享烘焙，只弃材质
        e.label.dispose?.();
      }
      group.removeFromParent();
    },
  };
  handle.visualDone = new Promise(res => { handle._visualResolve = res; });
  return handle;
}
