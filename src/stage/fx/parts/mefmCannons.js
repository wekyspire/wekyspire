// MEFM-1 机炮部件（unitParts kind = 'mefmCannons'）：
//   · 两挺 2D 机炮臂（用户原画，裁剪 alpha bbox 后入库）：按 2.5D 纵深挂在
//     立牌 z 前 / z 后两层；冷/热两张图在 shader 里按 uHeat 逐帧 lerp（炮口慢慢红热）。
//   · 炮口锚点 = 素材双管端头（裁剪图归一化坐标），供剧本取世界位出弹。
//   · 弹壳场：CPU 手算粒子（重力/地面弹跳/摩擦/旋转/静置渐隐），挂在单位根节点，
//     弹壳从近/远两门机炮各自的尾部退弹口推出（两堆分落在机体左右脚下），
//     跨行动累积（上限回收）；物理逐帧积分。
//
// 动画接口（剧本经 unit.parts.get('mefmCannons').userData.cannon 取）：
//   state { heat, heatTarget, raise, recoilFront, recoilBack }
//   muzzleWorld(armKey, idx)  炮管端头世界坐标（'front' | 'back'，idx 0/1）
//   recoil(armKey)            开火后坐脉冲（tick 里指数衰减）
//   spawnCasing(worldPos, { dir })  从指定位置推一枚弹壳（dir -1/+1 = 抛向机体哪侧）
// heatTarget 由 P2 剧本推到 1（慢慢红热）；普攻期间可临时抬高、打完回落。

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  uniform as tslUniform, uv as uvOf, texture as texOf, mix, vec4, float,
} from 'three/tsl';
import { ArtImageCache } from '../../art/imageCache.js';
import { registerUnitPart } from '../unitParts.js';

// 素材直连（new URL 静态资产引用：dev/build/artpack 换汇同链，node 可导入）
const ART = {
  cannon: new URL('../../../assets/stage/unit_mefm1_cannon.webp', import.meta.url).href,
  cannonHot: new URL('../../../assets/stage/unit_mefm1_cannon_hot.webp', import.meta.url).href,
  casing: new URL('../../../assets/stage/fx_mefm1_casing.webp', import.meta.url).href,
};
const partArt = new ArtImageCache();

// ===== 机炮位置旋钮（单位：立牌高度的比例 H；x 负 = 朝玩家/左，y 0 = 脚底）=====
const ARM_ASPECT = 394 / 196;     // 裁剪后素材宽高比（加载后按实际图自动校正）
const ARM_H_K = 0.38;             // 机炮臂高度 / 立牌高度（大小）
const ARM_Y_K = 0.63;             // 近侧臂中心高度
const FRONT_FACE_X_K = -0.12;     // 铁盒前脸平面（炮管根部对齐基准）
const BARREL_ROOT_U = 0.16;       // 素材里炮管进入机匣的归一化位置（=根部）
const X_OFFSET_K = 0;             // 双机炮整体横向微调（负 = 往左/玩家侧）
const BACK_DX_K = -0.5;              // 远侧臂相对近侧的横向偏移（负 = 更左）
const BACK_DY_K = 0.01;           // 远侧臂抬高量（露头）
const BACK_SCALE = 0.92;          // 远侧臂缩放（透视收缩）
// ===========================================================================
const FRONT_Z = 1.4, BACK_Z = -1.4;
// 炮口在素材里的归一化坐标（裁剪图 247×211，用户原画双管端头）
const MUZZLES = [{ u: 0.025, v: 0.214 }, { u: 0.025, v: 0.704 }];

const CASING_MAX = 96;
const CASING_W = 2.2, CASING_H = 1.37;
const CASING_FLOOR = 0.14;

function texFromImage(img) {
  const t = new THREE.Texture(img);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function attachMefmCannons(unit) {
  if (typeof document === 'undefined') return null;
  const H = unit._standeeHeight ?? 22;
  const standee = unit.standee;
  const group = new THREE.Group();
  group.name = 'mefmCannons';
  standee.add(group);
  unit.parts.set('mefmCannons', group);

  // —— 素材加载（冷/热两张同尺寸，shader 内 lerp）——
  const urlCold = ART.cannon, urlHot = ART.cannonHot, urlCasing = ART.casing;
  let texCold = null, texHot = null, casingTex = null;
  const casings = [];   // 先于 loadTextures 声明（贴图晚到时要回填已有弹壳的 map）
  const uHeat = tslUniform(0.0);
  const uTint = tslUniform(new THREE.Vector3(1, 1, 1));
  let mat = null;

  const armH = H * ARM_H_K;
  let aspect = ARM_ASPECT;
  let armW = armH * aspect;
  let geo = new THREE.PlaneGeometry(armW, armH);
  const placeholder = new MeshBasicNodeMaterial({ transparent: true, opacity: 0 });
  const rootX = FRONT_FACE_X_K * H;
  const mkArm = (name, xOff, dy, z, scale) => {
    const mesh = new THREE.Mesh(geo, placeholder);
    mesh.name = name;
    mesh.visible = false;
    mesh.position.set(rootX - (BARREL_ROOT_U - 0.5) * armW * scale + xOff, ARM_Y_K * H + dy, z);
    mesh.scale.setScalar(scale);
    group.add(mesh);
    const tips = MUZZLES.map(({ u, v }) => new THREE.Vector3(
      (u - 0.5) * armW, (0.5 - v) * armH, 0.02,
    ));
    const arm = {
      mesh, tips, scale, xOff, baseX: mesh.position.x, baseY: mesh.position.y,
      phase: Math.random() * 6.28,
      retip() {
        this.tips = MUZZLES.map(({ u, v }) => new THREE.Vector3(
          (u - 0.5) * armW, (0.5 - v) * armH, 0.02,
        ));
      },
      relayout() {
        this.mesh.position.x = rootX - (BARREL_ROOT_U - 0.5) * armW * this.scale + this.xOff;
        this.baseX = this.mesh.position.x;
        this.retip();
      },
    };
    return arm;
  };
  const front = mkArm('cannonFront', X_OFFSET_K * H, 0, FRONT_Z, 1.0);
  const back = mkArm('cannonBack', (X_OFFSET_K + BACK_DX_K) * H, BACK_DY_K * H, BACK_Z, BACK_SCALE);

  const buildMaterial = () => {
    if (mat || !texCold || !texHot) return;
    mat = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    mat.colorNode = mix(
      texOf(texCold).sample(uvOf()),
      texOf(texHot).sample(uvOf()),
      uHeat,
    ).mul(vec4(uTint, float(1.0)));
    for (const a of [front, back]) {
      a.mesh.material = mat;
      a.mesh.visible = true;
    }
  };
  const loadTextures = () => {
    if (!texCold) {
      const img = urlCold ? partArt.getByUrl(urlCold) : null;
      if (img) texCold = texFromImage(img);
    }
    if (!texHot) {
      const img = urlHot ? partArt.getByUrl(urlHot) : null;
      if (img) texHot = texFromImage(img);
    }
    const imgNow = urlCold ? partArt.getByUrl(urlCold) : null;
    if (imgNow) {
      const a = imgNow.naturalWidth / imgNow.naturalHeight;
      if (Math.abs(a - aspect) > 0.01) {
        aspect = a;
        armW = armH * aspect;
        const next = new THREE.PlaneGeometry(armW, armH);
        for (const arm of [front, back]) { arm.mesh.geometry = next; arm.relayout(); }
        geo.dispose();
        geo = next;
      }
    }
    if (!casingTex) {
      const img = urlCasing ? partArt.getByUrl(urlCasing) : null;
      if (img) {
        casingTex = texFromImage(img);
        for (const c of casings) {
          if (!c.sp.material.map) {
            c.sp.material.map = casingTex;
            c.sp.material.needsUpdate = true;
          }
        }
      }
    }
    buildMaterial();
  };
  loadTextures();
  const offLoad = partArt.addOnLoad(() => loadTextures());

  // —— 弹壳场（CPU 手算物理；挂单位根，散落在脚下）——
  const casingGroup = new THREE.Group();
  casingGroup.name = 'mefmCasings';
  unit.add(casingGroup);
  const removeCasing = (i) => {
    const c = casings[i];
    if (!c) return;
    casingGroup.remove(c.sp);
    c.sp.material.dispose();
    casings.splice(i, 1);
  };

  const state = { heat: 0, heatTarget: 0, raise: 0, recoilFront: 0, recoilBack: 0, aimWorld: null, barrelFront: 0, barrelBack: 0 };
  const _aimV = new THREE.Vector3();
  // 目标换到立牌本地系（随立牌 lean/yaw/缩放自动校正）
  const targetLocal = () => {
    if (!state.aimWorld) return null;
    standee.updateWorldMatrix(true, false);
    return standee.worldToLocal(_aimV.set(
      state.aimWorld.x, state.aimWorld.y, state.aimWorld.z ?? 0,
    ));
  };
  // 按指定炮管的垂直偏置求角：炮管轴线穿过目标（精确解，选朝目标的解）
  const aimAngleFor = (arm, idx, localT) => {
    const tip = arm.tips[idx % arm.tips.length];
    const vx = localT.x - arm.mesh.position.x;
    const vy = localT.y - arm.mesh.position.y;
    const R = Math.hypot(vx, vy) || 1;
    const c = Math.max(-1, Math.min(1, (tip.y * arm.scale) / R));
    const alpha = Math.atan2(vx, vy);
    const a = Math.acos(c);
    const t0 = Math.atan2(-vy, -vx);
    const c1 = a - alpha, c2 = -a - alpha;
    const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    return Math.abs(wrap(c1 - t0)) <= Math.abs(wrap(c2 - t0)) ? c1 : c2;
  };
  const cannon = {
    state,
    get casingCount() { return casings.length; },
    setHeatTarget(v) { state.heatTarget = v; },
    /** 开火前立即对准指定炮管（保证本发炮口与弹道同轴；tick 后续只叠后坐/抖）。 */
    aimBarrel(armKey, idx) {
      const arm = armKey === 'back' ? back : front;
      if (armKey === 'back') state.barrelBack = idx; else state.barrelFront = idx;
      const localT = targetLocal();
      if (!localT) return;
      arm.mesh.rotation.z = aimAngleFor(arm, idx, localT) - 0.14 * state.raise;
      arm.mesh.updateWorldMatrix(true, false);
    },
    recoil(armKey) {
      if (armKey === 'back') state.recoilBack = 1;
      else state.recoilFront = 1;
    },
    muzzleWorld(armKey, idx = 0) {
      const arm = armKey === 'back' ? back : front;
      arm.mesh.updateWorldMatrix(true, false);
      return arm.mesh.localToWorld(arm.tips[idx % arm.tips.length].clone());
    },
    spawnCasing(worldPos, { dir = 1 } = {}) {
      if (!casingTex) loadTextures();
      unit.updateWorldMatrix(true, false);
      const v = worldPos.isVector3
        ? worldPos.clone()
        : new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
      const p = unit.worldToLocal(v);
      const m = new THREE.SpriteMaterial({
        map: casingTex, transparent: true, depthWrite: false, fog: false,
      });
      const sp = new THREE.Sprite(m);
      sp.position.set(p.x, p.y, p.z + 0.6);
      sp.scale.set(CASING_W, CASING_H, 1);
      sp.material.rotation = Math.random() * Math.PI * 2;
      casingGroup.add(sp);
      casings.push({
        sp,
        x: p.x, y: p.y, z: p.z + 0.6,
        // 抛壳方向按退弹口所在侧：两门机炮各自把壳甩到自己那一侧（两堆不交叉）
        vx: dir * (3 + Math.random() * 6),
        vy: 9 + Math.random() * 8,
        vz: dir > 0 ? 2 + Math.random() * 4 : -(1.5 + Math.random() * 3),
        vr: (Math.random() - 0.5) * 16,
        rest: false, restAge: 0, fade: 1,
      });
      if (casings.length > CASING_MAX) removeCasing(0);
    },
  };
  group.userData.cannon = cannon;

  // —— 逐帧：heat 逼近 / 双炮摆动与后坐 / 弹壳积分 ——
  let t = 0;
  const untick = unit.addTick((dt) => {
    t += dt;
    const d = Math.min(dt, 1 / 30);
    // 慢慢红热：单向趋近（time constant ~2.8s）
    state.heat += (state.heatTarget - state.heat) * Math.min(1, d * 0.36);
    uHeat.value = state.heat;
    const bc = unit._body?.material?.color;
    if (bc) uTint.value.set(bc.r, bc.g, bc.b);
    const decay = Math.exp(-d * 9);
    state.recoilFront *= decay;
    state.recoilBack *= decay;
    // 瞄准：目标换到立牌本地系，炮管本地 -x 指向目标
    const aimLocal = targetLocal();
    for (const [arm, rec] of [[front, state.recoilFront], [back, state.recoilBack]]) {
      const jit = state.heat > 0.2 ? Math.sin(t * (8.1 + arm.phase) + arm.phase) * 0.006 * state.heat : 0;
      // 先落位置再算角度（抬炮/后坐会移动枢轴）
      arm.mesh.position.x = arm.baseX - H * 0.05 * state.raise + H * 0.038 * rec;
      arm.mesh.position.y = arm.baseY + Math.sin(t * 1.25 + arm.phase) * H * 0.004
        + H * 0.02 * state.raise + H * 0.012 * rec;
      const idx = arm === front ? state.barrelFront : state.barrelBack;
      const aim = aimLocal ? aimAngleFor(arm, idx, aimLocal) : 0;
      arm.mesh.rotation.z = aim - 0.14 * state.raise + 0.02 * rec + jit;
    }
    // 弹壳：重力 + 地面弹跳 + 摩擦 + 静置渐隐
    for (let i = casings.length - 1; i >= 0; i--) {
      const c = casings[i];
      if (!c.rest) {
        c.vy -= 52 * d;
        c.x += c.vx * d;
        c.y += c.vy * d;
        c.z += c.vz * d;
        c.sp.material.rotation += c.vr * d;
        if (c.y <= CASING_FLOOR && c.vy < 0) {
          c.y = CASING_FLOOR;
          if (Math.abs(c.vy) < 2.4) {       // 能量耗尽：落定
            c.rest = true;
            c.vy = 0; c.vx = 0; c.vz = 0;
            c.sp.material.rotation = Math.round(c.sp.material.rotation / Math.PI) * Math.PI
              + (Math.random() - 0.5) * 0.25;
          } else {
            c.vy = -c.vy * 0.34;              // 弹跳（衰减）
            c.vx *= 0.58;
            c.vz *= 0.58;
            c.vr *= 0.55;
          }
        }
      } else {
        c.restAge += d;
        if (c.restAge > 3.5) c.fade -= d / 1.1;
        if (c.fade <= 0) { removeCasing(i); continue; }
      }
      c.sp.position.set(c.x, c.y, c.z);
      c.sp.material.opacity = Math.max(0, c.fade);
      c.sp.scale.set(CASING_W, CASING_H, 1);
    }
  });

  const dispose = () => {
    untick();
    offLoad();
    unit.parts.delete('mefmCannons');
    standee.remove(group);
    unit.remove(casingGroup);
    for (let i = casings.length - 1; i >= 0; i--) removeCasing(i);
    geo.dispose();
    placeholder.dispose();
    mat?.dispose();
    texCold?.dispose();
    texHot?.dispose();
    casingTex?.dispose();
  };
  group.userData.dispose = dispose;
  return { group, dispose };
}

export function registerMefmCannons() {
  registerUnitPart('mefmCannons', attachMefmCannons);
}
