// Boss 剧本：MEFM-1（mefm1，11 层 Boss 池三之一）。一只 Boss 的全部自定义演出聚合在
// 本文件（内容归属原则，同 pyro.js）。触发点见 core enemies.js mefm1 act 的转段拍
//（血量跌至 80 → 铁壳剥落、故障空转一拍，本剧本占住那一拍）。
//
// 主题（lore：警戒的无人战体）＝「故障 · 断电 · 打火 · 点火」，读法：
//   故障（1.5s）：机体抽搐（阶梯式 scale/姿态抖动，不做平滑补间——机器的抖是离散的）+
//     红蓝交替告警闪 + 警笛双拍红灯 + 白蓝电火花迸溅 + 机炮空转乱抖（后坐乱发、热图乱跳）
//   断电（0.9s）：灯丝断续熄灭（不是渐暗）+ 机体塌陷 + 顶口泄最后一口气。留白拍：
//     「它停了」与「它还想活」之间的呼吸口
//   打火两试两灭（0.5s）：顶口窜一下火星又熄——第一次点不着，第二次也点不着
//   点火（1.25s）：白热一闪 + 三口排焰口逆序喷火（顶→右→左，系统逐段恢复）+
//     冲击环/脚下尘 + 机体弹性回胀 + 熔炉光起燃（暗红→亮橙→深红）
// 常驻（挂舞台寿命）：熔炉光 + 三路双层排焰（外焰 + 火芯）+ 低位热浪环 + 低频电火花
//   + 过压喘气（大片蒸汽从机体后方腾起）+ 场景抬亮（结构光微抬 + 火光乘子反抬）。
// 与另外两位的差异：pyro 烧房间、kardas 烧自己，mefm1 是**机器过热**——光和焰以机体
// 为圆心向半场铺开，P2 整体比 P1 更亮更热（真实点光 + mood，无加色假面片）。
// 美术口径：mefm1 暂无立绘（占位色块），全部效果按立牌体量派生、不依赖贴图内容。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv as uvOf, vec2, vec3, vec4, float,
  exp, abs, smoothstep, oneMinus, fract, normalView,
} from 'three/tsl';
import { duelPose } from '../../camera.js';
import { arcProjectile, lampPulse, spellQuad } from '../../spells/blocks.js';
import { unitH } from '../enemies/fxPieces.js';
import { registerMefmCannons } from '../../parts/mefmCannons.js';
import { registerEnemyHitBeat, enemyImpactBeat, registerEnemyNoLunge } from '../../spells/enemyHitFx.js';
import { registerEnemyAct } from '../enemyAct.js';
import { registerBossStateFx, registerBossHurtFx } from '../../bossStateFx.js';
import { makeHexShield } from '../../hexShield.js';
import { isAttackKind, isBuffKind, isDebuffKind } from '../../../../core/intentKinds.js';

// 电火花纹理：横向拉长的白蓝炽核 + 尾迹（与 pyro 余烬拖影同构、换色温——冷电 vs 热火）
let _sparkTex = null;
function sparkTexture() {
  if (_sparkTex) return _sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(8, 64, 120, 64);
  grad.addColorStop(0, 'rgba(120,190,255,0)');
  grad.addColorStop(0.6, 'rgba(150,205,255,0.5)');
  grad.addColorStop(1, 'rgba(235,250,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(64, 64, 58, 9, 0, 0, Math.PI * 2);
  g.fill();
  const core = g.createRadialGradient(104, 64, 1, 104, 64, 16);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sparkTex = tex;
  return tex;
}

// 细环冲击纹理（同 pyro/kardas 的「白热细峰」口径）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 100, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,130,50,0)');
  grad.addColorStop(0.74, 'rgba(255,140,60,0.1)');
  grad.addColorStop(0.94, 'rgba(255,246,232,1)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ringTex = tex;
  return tex;
}

// 枪口焰纹理：金色四芒星闪（白热核 + 十字主芒 + 斜芒 + 暖晕）——机发那一瞬的
// 「发射源在喷火」读感，配灯闪与迸射火光粒子
let _muzzleTex = null;
function muzzleTexture() {
  if (_muzzleTex) return _muzzleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const spike = (rot, len, wid) => {
    g.save(); g.translate(64, 64); g.rotate(rot);
    const grad = g.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,190,90,0)');
    grad.addColorStop(0.5, 'rgba(255,230,170,0.52)');
    grad.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  spike(0, 52, 8); spike(Math.PI / 2, 52, 8);
  spike(Math.PI / 4, 32, 5); spike(-Math.PI / 4, 32, 5);
  const halo = g.createRadialGradient(64, 64, 2, 64, 64, 60);
  halo.addColorStop(0, 'rgba(255,210,130,0.28)');
  halo.addColorStop(0.5, 'rgba(255,190,110,0.10)');
  halo.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  const core = g.createRadialGradient(64, 64, 1, 64, 64, 26);
  core.addColorStop(0, 'rgba(255,252,240,0.88)');
  core.addColorStop(0.45, 'rgba(255,224,150,0.52)');
  core.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _muzzleTex = tex;
  return tex;
}

// 膛口定向焰：金色喷焰从膛口向左（玩家方向）伸出。四芒星闪只交代点光，
// 方向感由这层承担；纹理左缘即焰尖，精灵定位时按宽度左移锚回膛口。
let _coneTex = null;
function muzzleConeTexture() {
  if (_coneTex) return _coneTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.translate(240, 64);
  const flame = (len, half, stops) => {
    const grad = g.createLinearGradient(0, 0, -len, 0);
    for (const [p, s] of stops) grad.addColorStop(p, s);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -half);
    g.quadraticCurveTo(-len * 0.42, -half * 0.9, -len, 0);
    g.quadraticCurveTo(-len * 0.42, half * 0.9, 0, half);
    g.closePath();
    g.fill();
  };
  flame(180, 30, [[0, 'rgba(255,210,120,0.55)'], [0.55, 'rgba(255,150,60,0.24)'], [1, 'rgba(255,110,40,0)']]);
  flame(130, 18, [[0, 'rgba(255,244,214,0.72)'], [0.6, 'rgba(255,196,100,0.34)'], [1, 'rgba(255,150,60,0)']]);
  const core = g.createRadialGradient(0, 0, 1, 0, 0, 34);
  core.addColorStop(0, 'rgba(255,255,250,0.82)');
  core.addColorStop(0.4, 'rgba(255,235,180,0.55)');
  core.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = core;
  g.fillRect(-40, -40, 80, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _coneTex = tex;
  return tex;
}

// 蓄能柔光点（膛口蓄势/钩爪端口）：白热核 + 暖晕，精灵自控透明度。
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,252,240,1)');
  grad.addColorStop(0.3, 'rgba(255,225,160,0.75)');
  grad.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _glowTex = tex;
  return tex;
}

// 冷却水汽：柔白雾团（CPU 贴图粒子，只在炮管收火后短暂出现；无色块硬边）
let _steamTex = null;
function steamTexture() {
  if (_steamTex) return _steamTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const x = 64 + Math.cos(a) * (8 + (i % 3) * 7);
    const y = 64 + Math.sin(a) * (6 + (i % 4) * 6);
    const r = 34 + (i % 3) * 10;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(226,232,238,0.34)');
    grad.addColorStop(0.55, 'rgba(196,204,214,0.16)');
    grad.addColorStop(1, 'rgba(170,180,192,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _steamTex = tex;
  return tex;
}

const T = {
  FAULT: 1500,  // 故障：离散抽搐 + 警笛红灯 + 电火花 + 机炮空转
  STALL: 900,   // 断电：灯丝断续熄灭 + 机体塌陷
  IGNITE: 1250, // 点火：三口逆序喷火 + 回胀 + 熔炉起燃
  STUTTER: 0.09, // 抽搐步长（秒）：机器的抖是离散的，不是平滑补间
};

// 立绘主炮口（画左上大圆膛）在局部坐标的锚点：膛心 = -0.40H、+0.77H。
// 弹雨/钩爪都从这里出——身体中线凭空冒火会读成「肚子在喷」。
function boreAnchor(unit) {
  const H = unitH(unit);
  return {
    x: unit.position.x - H * 0.40,
    y: unit.position.y + H * 0.77,
    z: (unit.position.z ?? 0) + 0.4,
  };
}

// ============ 钩爪（debuff 拍主体）：机械抓钩 + 世界钢缆 ============
// 3D 爪体：尾环 + 轴杆 + 三趾（120° 放射，飞行时张开、咬合时向内后扣），
// 深钢本体 + 视向边缘光；P1 工业琥珀（灰甲上醒目）、P2 炽橙并放大。
const HOOK_X = new THREE.Vector3(1, 0, 0);
// 机械件共用材质（钩爪/炮管）：深钢本体 + 视向边缘光（法线掠射面发亮）——
// 暗场里读「金属轮廓」而不是一整根发光棒。相位色两套烘常量（钢蓝/炽橙），
// 同相位内多件共用，跨相位换材质不重编译。
let _metalA = null;
function metalAssets(p2) {
  if (!_metalA) {
    const mk = (base, rim) => {
      const mat = new MeshBasicNodeMaterial({ fog: false });
      const f1 = oneMinus(abs(normalView.z));
      const f2 = oneMinus(abs(normalView.z));
      const f3 = oneMinus(abs(normalView.z));
      mat.colorNode = vec4(
        vec3(base[0], base[1], base[2])
          .add(vec3(rim[0], rim[1], rim[2]).mul(f1.mul(f2).mul(1.9)))
          .add(vec3(rim[0], rim[1], rim[2]).mul(f3.mul(0.10))),
        float(1.0),
      );
      return mat;
    };
    _metalA = {
      steel: mk([0.16, 0.11, 0.06], [1.25, 0.72, 0.30]),
      hot: mk([0.24, 0.10, 0.05], [1.80, 0.72, 0.30]),
    };
  }
  return p2 ? _metalA.hot : _metalA.steel;
}
let _hookA = null;
function hookAssets() {
  if (_hookA) return _hookA;
  const talon = new THREE.ConeGeometry(0.44, 2.1, 5, 1, false);
  talon.rotateZ(-Math.PI / 2);
  talon.translate(1.05, 0, 0);
  const shaft = new THREE.CylinderGeometry(0.24, 0.38, 2.4, 7);
  shaft.rotateZ(-Math.PI / 2);
  shaft.translate(1.20, 0, 0);
  const collar = new THREE.TorusGeometry(0.44, 0.10, 6, 16);
  collar.rotateY(Math.PI / 2);
  collar.translate(0.34, 0, 0);
  const core = new THREE.OctahedronGeometry(0.40, 0);
  core.translate(2.0, 0, 0);
  _hookA = { talon, shaft, collar, core };
  return _hookA;
}
function makeHook(p2) {
  const A = hookAssets();
  const mat = metalAssets(p2);
  const root = new THREE.Group();
  root.name = 'fx:mefmHook';
  const part = (geo, parent) => {
    const b = new THREE.Mesh(geo, mat);
    b.renderOrder = 71;
    parent.add(b);
  };
  part(A.shaft, root);
  part(A.collar, root);
  part(A.core, root);
  const talons = [];
  for (let i = 0; i < 3; i++) {
    const az = new THREE.Group();
    az.rotation.x = (i / 3) * Math.PI * 2;
    const tilt = new THREE.Group();
    tilt.position.x = 2.25;
    part(A.talon, tilt);
    az.add(tilt);
    root.add(az);
    talons.push(tilt);
  }
  const setSpread = (s) => { for (const t of talons) t.rotation.z = s; };
  setSpread(0.85);
  root.scale.setScalar(p2 ? 2.0 : 1.9);
  return { root, setSpread };
}

// 钢缆 fragment：白热细核 + 钢蓝电晕 + 沿缆行进的脉冲（绞盘在放缆/收缆）。
// 四顶点直写世界端点（截面取「尽量世界 Y」——同 zapArc，任意相机角度都贴着航线）。
const cableShade = Fn(([vUv, uPhase, uFade]) => {
  const px = vUv.x.sub(float(0.5));
  const core = exp(px.mul(px).mul(-1500.0));
  const haloMain = exp(vUv.x.sub(float(0.5)).mul(vUv.x.sub(float(0.5))).mul(-52.0));
  const haloWave = exp(vUv.x.sub(float(0.5)).mul(vUv.x.sub(float(0.5))).mul(-52.0));
  const haloTip = exp(vUv.x.sub(float(0.5)).mul(vUv.x.sub(float(0.5))).mul(-52.0));
  const edge = oneMinus(smoothstep(float(0.40), float(0.50), abs(px)))
    .mul(oneMinus(smoothstep(float(0.46), float(0.50), abs(vUv.y.sub(float(0.5))))));
  const wave = exp(vUv.y.sub(fract(uPhase)).mul(vUv.y.sub(fract(uPhase))).mul(-90.0));
  const tip = smoothstep(float(0.55), float(1.0), vUv.y);
  const rgb = vec3(0.62, 0.82, 1.35).mul(core.mul(3.2))
    .add(vec3(0.30, 0.44, 0.85).mul(haloMain.mul(1.35)))
    .add(vec3(0.55, 0.75, 1.25).mul(wave.mul(haloWave).mul(0.55)))
    .add(vec3(0.45, 0.62, 1.05).mul(tip.mul(haloTip).mul(0.9)));
  return vec4(rgb.mul(edge).mul(uFade), float(1.0));
});

function makeCable(ctx, deps) {
  const uPhase = uniform(0.0);
  const uFade = uniform(1.0);
  const { quad, geo, mat, release } = spellQuad({
    shade: cableShade(uvOf(), uPhase, uFade), width: 1, height: 1,
    name: 'spellFx:mefmCable',
  });
  mat.side = THREE.DoubleSide;
  quad.frustumCulled = false;
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const pos = geo.attributes.position;
  const setEnds = (a, b) => {
    const ax = a.x, ay = a.y, az = (a.z ?? 0) + 1.2;
    const bx = b.x, by = b.y, bz = (b.z ?? 0) + 1.2;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    let cx = -ux * uy, cy = 1 - uy * uy, cz = -uz * uy;
    if (Math.hypot(cx, cy, cz) < 0.3) { cx = 1 - ux * ux; cy = -uy * ux; cz = -uz * ux; }
    const cl = Math.hypot(cx, cy, cz) || 1;
    cx /= cl; cy /= cl; cz /= cl;
    const h = 0.34;
    pos.setXYZ(0, bx + cx * h, by + cy * h, bz + cz * h);
    pos.setXYZ(1, bx - cx * h, by - cy * h, bz - cz * h);
    pos.setXYZ(2, ax + cx * h, ay + cy * h, az + cz * h);
    pos.setXYZ(3, ax - cx * h, ay - cy * h, az - cz * h);
    pos.needsUpdate = true;
  };
  return {
    setEnds,
    flow: (v) => { uPhase.value = v; },
    fade: (v) => { uFade.value = v; },
    release,
  };
}

function makeGlowSprite(texture, colorHex) {
  const mat = new THREE.SpriteMaterial({
    map: texture, color: colorHex, transparent: true, depthWrite: false,
    fog: false, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 73;
  return { sprite, mat };
}

/**
 * 单发钩爪：端口蓄能 → 飞行（钢缆跟着放）→ 咬合（收爪 + 冲击环/火花/灯）
 * → 绷缆一顿 → 收缆回膛。P2 双钩由调用方排两次（第二个延迟发射）。
 */
async function fireHook(ctx, deps, { from, to, p2, flightMs = 240, arcH = 2.3 }) {
  if (!from || !to) return;
  const { scene, particles, shake } = deps;
  const port = { x: from.x, y: from.y, z: from.z + 1.0 };
  const tgt = { x: to.x, y: to.y, z: to.z + 2.0 };   // 拉到立牌前方，咬合不被人物挡住
  const reach = p2 ? 4.5 : 3.8;                       // 爪根到爪尖（世界单位，含缩放的爪趾枢轴距）
  const glow = makeGlowSprite(glowTexture(), p2 ? 0xffa060 : 0xffd8a0);
  glow.sprite.position.set(port.x, port.y, port.z + 0.3);
  glow.sprite.scale.setScalar(0.5);
  scene.add(glow.sprite);
  const cable = makeCable(ctx, deps);
  const claw = makeHook(p2);
  claw.root.position.set(port.x, port.y, port.z);
  scene.add(claw.root);
  const bite = makeGlowSprite(glowTexture(), p2 ? 0xffb070 : 0xffd8a0);
  bite.sprite.position.set(tgt.x, tgt.y, tgt.z + 0.3);
  bite.sprite.scale.setScalar(3.2);
  bite.mat.opacity = 0;
  scene.add(bite.sprite);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    scene.remove(glow.sprite);
    glow.mat.dispose();
    scene.remove(bite.sprite);
    bite.mat.dispose();
    scene.remove(claw.root);
    cable.release();
  };
  ctx.onKill(cleanup);

  // ① 端口蓄能：光斑胀大 + 火星内吸（绞盘上膛）
  const pull = ctx.spawn(async (c) => {
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 3; j++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2.0 + Math.random() * 2.0;
        const px = port.x + Math.cos(a) * r;
        const py = port.y + Math.sin(a) * r * 0.8;
        const rec = particles?.spawnSprite?.(px, py, {
          texture: sparkTexture(), width: 1.8, height: 0.5, z: port.z + 1.3,
          vx: (port.x - px) / 0.22, vy: (port.y - py) / 0.22,
          gravity: 0, ttl: 0.22, scalePop: 0.2,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(port.y - py, port.x - px);
      }
      await c.wait(70);
    }
  }).promise;
  const pre = { t: 0 };
  await Promise.all([
    ctx.tweenRaw(pre, { t: 1 }, {
      durationMs: 130, ease: 'power2.in',
      onUpdate: () => {
        glow.sprite.scale.setScalar(0.5 + pre.t * 5.0);
        glow.mat.opacity = 0.22 + pre.t * 0.78;
      },
    }),
    pull,
  ]);
  particles?.spawnSprite?.(port.x, port.y, {
    texture: muzzleTexture(), width: 4.2, height: 4.2, z: port.z + 1.6,
    ttl: 0.12, scalePop: 0.4,
  });
  glow.sprite.visible = false;

  // ② 飞行：爪尖沿轨迹切线指向；爪根 = 轨迹点后退一个爪长（爪尖抵达目标），
  // 缆从端口连到爪根尾环。缆走世界端点，纵深差大时也两端都贴着。
  const fromV = new THREE.Vector3(port.x, port.y, port.z);
  const toV = new THREE.Vector3(tgt.x, tgt.y, tgt.z);
  const arc = Math.max(arcH, fromV.distanceTo(toV) * 0.10);
  const place = (px, py, pz, dx, dy, dz) => {
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    claw.root.position.set(px - dir.x * reach, py - dir.y * reach, pz - dir.z * reach);
    claw.root.quaternion.setFromUnitVectors(HOOK_X, dir);
    cable.setEnds(fromV, claw.root.position);
  };
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: flightMs, ease: 'power1.in',
    onUpdate: () => {
      const t = st.t, u = 1 - t;
      const px = u * fromV.x + t * toV.x;
      const py = u * fromV.y + t * toV.y + Math.sin(Math.PI * t) * arc;
      const pz = u * fromV.z + t * toV.z;
      // 切线方向（弧顶前上扬、后半程下压）
      place(px, py, pz,
        toV.x - fromV.x,
        (toV.y - fromV.y) + Math.PI * arc * Math.cos(Math.PI * t),
        toV.z - fromV.z);
      cable.flow(t * 2.4);
    },
  });

  // ③ 咬合：收爪（爪趾向内侧后扣）+ 冲闪 + 钢火花 + 蓝环 + 灯 + 震
  const snap = { t: 0 };
  const snapJob = ctx.tweenRaw(snap, { t: 1 }, {
    durationMs: 90, ease: 'power3.in',
    onUpdate: () => claw.setSpread(0.85 + 0.9 * snap.t),
  });
  bite.mat.opacity = 0.85;
  const ring = particles?.spawnSprite?.(tgt.x, tgt.y, {
    texture: ringTexture(), width: 4.2, height: 4.2, z: tgt.z + 0.5,
    ttl: 0.26, scalePop: 0.35, gravity: 0,
  });
  if (ring) {
    ctx.tweenRaw(ring, { w: 9, h: 9 }, { durationMs: 260, ease: 'power2.out' });
    ring.sprite.material.rotation = 0;
  }
  particles?.spawn?.(tgt.x, tgt.y, {
    color: p2 ? 0xffb070 : 0xffcf8a, count: p2 ? 20 : 14, speed: 24,
    size: 1.0, ttl: 0.42, gravity: -6, z: tgt.z + 1,
  });
  shake?.impulse?.(p2 ? 3.0 : 2.2);
  ctx.spawn((c) => lampPulse(c, deps, {
    name: 'light:fx1', at: { x: tgt.x, y: tgt.y, z: tgt.z + 2 },
    color: p2 ? [1.0, 0.55, 0.3] : [1.0, 0.78, 0.45],
    peak: p2 ? 1700 : 1300, attackMs: 20, decayMs: 220,
  }));
  await snapJob;

  // ④ 绷缆一顿：爪咬着目标，缆上脉冲继续跑；一滴余电落下
  await ctx.wait(170);
  particles?.spawn?.(tgt.x, tgt.y - 1.2, {
    color: p2 ? 0xffa060 : 0xffc070, count: 5, speed: 7, size: 0.7,
    ttl: 0.3, gravity: -14, z: tgt.z + 1,
  });

  // ⑤ 收缆回膛：开爪、沿原弧线倒飞，端口收口闪
  const st2 = { t: 0 };
  claw.setSpread(1.75);
  await ctx.tweenRaw(st2, { t: 1 }, {
    durationMs: 200, ease: 'power2.in',
    onUpdate: () => {
      const t = st2.t;
      const px = toV.x + (fromV.x - toV.x) * t;
      const py = toV.y + (fromV.y - toV.y) * t + Math.sin(Math.PI * t) * 0.8;
      const pz = toV.z + (fromV.z - toV.z) * t;
      place(px, py, pz, fromV.x - toV.x, fromV.y - toV.y + 1.4, fromV.z - toV.z);
      claw.setSpread(1.75 - 0.9 * Math.min(1, t * 2.5));
      cable.flow(2.4 + t * 3.0);
      cable.fade(1.0 - 0.25 * t);
      bite.mat.opacity = 0.85 * (1 - t);
    },
  });
  particles?.spawn?.(port.x, port.y, {
    color: p2 ? 0xffa060 : 0xffc070, count: 6, speed: 10,
    size: 0.8, ttl: 0.25, z: port.z + 1,
  });
  cleanup();
}

/** 迸一撮白蓝电火花（点粒 + 一两道拖影）。 */
function burstSparks(particles, ux, uy, uz, H, n = 10) {
  particles.spawn(ux, uy + H * 0.5, {
    count: n, color: 0xbfe0ff, speed: 26, ttl: 0.5, size: 1.1, z: uz + 1,
  });
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 16 + Math.random() * 12;
    const rec = particles.spawnSprite(ux, uy + H * 0.5, {
      texture: sparkTexture(), width: 2.6, height: 0.7, z: uz + 2,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, gravity: -10, ttl: 0.3,
    });
    if (rec) rec.sprite.material.rotation = Math.atan2(Math.sin(a) * 0.7, Math.cos(a));
  }
}

/** 跳弹落地：一小蓬土石 + 金属火星（脱靶弹「打在环境里」的交代）。 */
function groundPuff(particles, x, y, z) {
  particles.spawn(x, y, { count: 8, color: 0x8a7a5e, speed: 7, size: 0.9, ttl: 0.55, gravity: -14, z });
  particles.spawn(x, y + 0.4, { count: 5, color: 0xffc35a, speed: 11, size: 0.7, ttl: 0.3, gravity: -8, z });
}

async function mefm1P2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, runScript, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const id = unit.uniqueID;
  const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
  const s = unit._baseScale ?? 1;
  const H = unit._standeeHeight ?? 22;

  // —— 转段机位（演出期间接管，收尾弹栈）：长焦平视，比 kardas 略松（看整台机器）——
  const base = camera?.basePose;
  const pose = base ? duelPose(base, { fovScale: 0.85, elScale: 0.55 }) : null;
  camera?.pushOverride?.('mefm1P2', {
    poses: pose ? { mefm1P2: pose } : {},
    onEnter: (dir) => { if (pose) dir.flyTo('mefm1P2', { durationMs: 650, ease: 'power2.out' }); },
  });

  // —— 池灯分工：fx0 = 常驻告警灯 → 熔炉灯（挂机体，真实照明）；fx1 = 打火/点火
  // 瞬态灯击。借池不 new：中途 add 灯 = 全场景着色器重编译冻帧（池灯入场即在场，
  // 重挂到单位不改变灯数）。
  const alarm = cast.get('light:fx0');
  if (alarm) {
    alarm.color.set(0xff2f2a);
    alarm.distance = H * 5;
    alarm.position.set(0, H * 0.6, H * 0.3);
    unit.add(alarm);
    onStageDispose?.(() => { alarm.intensity = 0; unit.remove(alarm); });
  }
  // 瞬态灯击（fx1）：短促打火/点火闪，不碰常驻熔炉灯
  const pulse = (at, peak, decayMs = 220) => lampPulse(ctx, { cast }, {
    name: 'light:fx1', at: { x: at.x, y: at.y, z: (at.z ?? uz) + 1.5 },
    color: [1, 0.55, 0.22], peak, attackMs: 24, decayMs,
  });
  // 被拆台/换舞台：姿态归零（姿态是每帧合成的，晾着会让后续行动一直歪着）
  ctx.onKill(() => unit.resetPose?.());

  const cannon = unit.parts?.get('mefmCannons')?.userData?.cannon ?? null;
  // 三口排焰口：故障漏电 / 打火 / 点火 / 常驻共用同一组位置（机械逻辑一致），
  // out = 喷口朝向（世界 x/y 方向），rot = 定向焰贴图的旋转
  const VENTS = [
    {
      dx: -H * 0.30, dy: H * 0.45, rot: 0, out: [-1, 0.35], lag: 200,
      rate: 24, color: 0xff7a2c, speed: 8.0, size: 6.0,
      innerRate: 12, innerColor: 0xffd27a, innerSize: 3.6,
    },
    {
      dx: H * 0.34, dy: H * 0.28, rot: Math.PI, out: [1, 0.30], lag: 700,
      rate: 19, color: 0xff8a3a, speed: 7.0, size: 5.2,
      innerRate: 10, innerColor: 0xffe0a0, innerSize: 3.2,
    },
    {
      dx: 0, dy: H * 0.72, rot: -Math.PI / 2, out: [0, 1], lag: 1200,
      rate: 16, color: 0xff6424, speed: 10.0, size: 6.6,
      innerRate: 9, innerColor: 0xffcf82, innerSize: 3.8,
    },
  ];
  // 机体四周的低位热浪/余烬上升环（常驻；「整台机器在往外烤」的环境层）
  const HEAT_RING = { dx: 0, dy: H * 0.10, rate: 18, radius: H * 0.55, color: 0xff5e22, speed: 3.0, size: 5.0 };
  const ventAt = (v) => ({ x: ux + v.dx, y: uy + v.dy, z: uz + 0.8 });
  // 定向焰柱：贴图尖端朝 rot 方向，base 压在喷口上（宽端在口内、尖端冲外）
  const jet = (v, w, at) => {
    const [ox, oy] = v.out;
    const sp = particles.spawnSprite(at.x + ox * w * 0.3, at.y + oy * w * 0.3, {
      texture: muzzleConeTexture(), width: w, height: w * 0.52, z: at.z + 1.5,
      ttl: 0.24, scalePop: 0.4, gravity: 0,
    });
    if (sp) sp.sprite.material.rotation = v.rot;
    return sp;
  };

  // 装甲失效（转段核心事件）：蜂窝力场当场碎裂剥落——「它最硬的东西没了」
  unit._armorShattered = true;
  unit._bossPhase = 2;
  unit._fxLayer?.get('bossArmor')?.shatter?.();

  // —— ① 故障 1.5s：离散抽搐 + 警笛双拍红灯 + 电火花 + 机炮空转乱抖 ——
  let step = -1;
  await ctx.custom(id, {
    durationMs: T.FAULT, ease: 'none',
    onUpdate: (t) => {
      const sec = (t * T.FAULT) / 1000;
      const nowStep = Math.floor(sec / T.STUTTER);
      if (nowStep !== step) {            // 每步换一组离散的抖动目标（机器抽搐，非平滑）
        step = nowStep;
        unit.scale.set(
          s * (0.93 + Math.random() * 0.15),
          s * (0.94 + Math.random() * 0.13),
          1,
        );
        unit.setPose({ lean: (Math.random() - 0.5) * 0.035, widen: 1 + (Math.random() - 0.5) * 0.04 });
        unit.flash?.(Math.random() < 0.5 ? 0x9ecbff : 0xff5a5a);
        // 机炮空转：随机后坐 + 冷热图乱跳（炮管还在动，控制权已经没了）
        if (cannon) {
          cannon.recoil(Math.random() < 0.5 ? 'front' : 'back');
          cannon.state.heatTarget = 0.12 + Math.random() * 0.7;
        }
      }
      // 警笛 = 短-长双拍（红灯在报警，不是呼吸灯）
      if (alarm) {
        const ph = sec % 0.72;
        alarm.intensity = (ph < 0.12 || (ph > 0.23 && ph < 0.31)) ? 980 : 70;
      }
      if (Math.random() < 0.10) shake.impulse(0.55);
      if (Math.random() < 0.085) burstSparks(particles, ux, uy, uz, H, 6);
      if (Math.random() < 0.035) {   // 顶部线路烧灼：偶尔一撮灰烟往上
        const v = VENTS[2];
        particles.spawn(ux + v.dx, uy + v.dy, {
          count: 3, color: 0x6e717a, speed: 2.4, vy: 2.4, size: 1.15, ttl: 1.0, gravity: 1.6,
          z: uz + 1,
        });
      }
    },
  });

  // —— ② 断电 0.9s：灯丝断续熄灭 → 机体塌陷 → 顶口最后一口气 ——
  const die = { t: 0 };
  await ctx.tweenRaw(die, { t: 1 }, {
    durationMs: T.STALL, ease: 'power2.in',
    onUpdate: () => {
      const u = 1 - die.t;
      // 断续而非平滑熄灭：断电是几下「啪」渐弱，不是一口气渐暗
      if (alarm) alarm.intensity = u * (Math.sin(die.t * 42) > -0.25 ? 820 : 90);
      unit.scale.set(s * (0.965 - 0.06 * die.t), s * (0.955 - 0.075 * die.t), 1);
      unit.setPose({ lean: 0.04 * die.t, squash: 1 - 0.055 * die.t, widen: 1 + 0.025 * die.t });
    },
  });
  if (cannon) ctx.tweenRaw(cannon.state, { heatTarget: 0 }, { durationMs: T.STALL, ease: 'power2.in' });
  // 顶口泄掉最后一口气：一缕慢烟；一粒白火花从中段落到熄灭
  particles.spawn(ux, uy + H * 0.78, {
    count: 5, color: 0x777a82, speed: 2.2, vy: 3.2, size: 1.35, ttl: 1.4, gravity: 1.2, z: uz + 1.4,
  });
  const ember = particles.spawnSprite(ux + H * 0.2, uy + H * 0.55, {
    texture: sparkTexture(), width: 1.5, height: 0.5, z: uz + 2,
    vy: -2.2, gravity: -2.5, ttl: 0.9, fadeIn: true,
  });
  if (ember) ember.sprite.material.rotation = Math.PI / 2;
  shake.impulse(1.2);
  await ctx.wait(180);

  // —— ③ 打火两试两灭 0.5s：顶口窜一下又熄（想醒，醒不来）——
  for (let k = 0; k < 2; k++) {
    const v = VENTS[2];
    const at = ventAt(v);
    unit.flash?.(0xffc07a);
    jet(v, 8.0, at);
    particles.spawn(at.x, at.y, {
      count: 6, color: 0xffb060, speed: 9, vy: 9, size: 0.95, ttl: 0.36, gravity: -5, z: at.z,
    });
    pulse(at, 850);
    await ctx.custom(id, {
      durationMs: 130, ease: 'power2.out',
      onUpdate: (t) => {
        const kick = Math.sin(t * Math.PI) * 0.03;   // 打火反冲：机体一挺又落
        unit.scale.set(s * (0.905 + kick), s * (0.88 + kick), 1);
      },
    });
    // 没点着：火星落尽 + 一口青烟（打火的物理残留）
    particles.spawn(at.x, at.y + 1.4, {
      count: 4, color: 0x8a8d95, speed: 2.6, vy: 4.2, size: 1.3, ttl: 1.0, gravity: 1.4, z: at.z,
    });
    await ctx.wait(120);
  }

  // —— ④ 点燃 1.25s：白热一闪 → 三口逆序喷火 → 冲击环 + 尘 + 机体回胀 + 熔炉光 ——
  unit.resetPose?.();
  unit.flash?.(0xfff1d6);
  shake.impulse(6.2);
  vignette.pulse(2.6);
  pulse({ x: ux, y: uy + H * 0.52, z: uz + 1.2 }, 2600, 520);
  const ring = particles.spawnSprite(ux, uy + H * 0.52, {
    texture: ringTexture(), width: H * 0.3, height: H * 0.3, z: uz + 2, ttl: 0.66, gravity: 0,
  });
  if (ring) (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    await c.tweenRaw(ring, { w: H * 1.5, h: H * 1.5 }, { durationMs: 620, ease: 'power2.out' });
  });
  // 脚下震起一圈尘
  particles.spawn(ux, uy + 0.4, {
    count: 26, color: 0x8a7a5e, speed: 18, size: 1.35, ttl: 0.7, gravity: -10, z: uz + 0.5,
  });
  // 三口逆序点火（顶 → 右 → 左，各隔 110ms）：每口一道定向火柱 + 火星 + 振屏——
  // 「系统逐段恢复」，不是一次性整台喷火
  for (let k = 0; k < VENTS.length; k++) {
    const v = VENTS[2 - k];
    const at = ventAt(v);
    const [ox, oy] = v.out;
    jet(v, 15 + k * 2, at);
    particles.spawn(at.x, at.y, {
      count: 22, color: 0xffa352, speed: 20, vx: ox * 24, vy: oy * 24 + 4,
      size: 1.5, ttl: 0.6, gravity: -4, z: at.z + 1,
    });
    particles.spawn(at.x, at.y + 0.5, {
      count: 4, color: 0x8a8274, speed: 3, vx: ox * 3, vy: 4.5, size: 1.8, ttl: 0.9,
      gravity: 1.2, z: at.z + 1,
    });
    shake.impulse(k === 0 ? 2.2 : 1.1);
    await ctx.wait(110);
  }
  // 机体回胀 + 熔炉灯起燃：暗红 → 亮橙 → 收成深红（光色三段，强度冲高再落）
  const warm = new THREE.Color(0xffb060), deep = new THREE.Color(0xff4a1e);
  const ign = { t: 0 };
  await ctx.tweenRaw(ign, { t: 1 }, {
    durationMs: T.IGNITE, ease: 'none',
    onUpdate: () => {
      const t = ign.t;
      const k = 1 + 0.09 * Math.sin(t * Math.PI * 1.15) * (1 - t * 0.3);  // 回胀过冲
      const baseK = 0.9 + 0.13 * t;
      unit.scale.set(s * baseK * k, s * baseK * k, 1);
      if (alarm) {
        const k1 = Math.min(1, t / 0.30), k2 = Math.max(0, (t - 0.30) / 0.5);
        alarm.color.set(0xff2f2a).lerp(warm, k1).lerp(deep, Math.min(1, k2));
        alarm.intensity = t < 0.18 ? 4500 + 2000 * (t / 0.18) : 6500 - 1500 * Math.min(1, (t - 0.18) / 0.5);
        alarm.distance = H * (5 - 0.6 * Math.min(1, t * 1.6));
      }
    },
  });
  unit.scale.set(s * 1.03, s * 1.03, 1);
  // 卸甲后狂躁过热：机炮臂慢慢红热（部件 tick 单向趋近），熔炉光转深红。
  // 泛红一律走真实点光（furnace 池灯挂在机体上照亮地面/家具），不铺加色假光晕
  // mesh——fake 面片会在场景里叠出无法归因的透明层。
  if (cannon) cannon.setHeatTarget(1);
  if (alarm) {
    alarm.color.set(0xff4a1e);
    // 极端热力：熔炉灯照亮整机与半场地面（场景抬亮 = 这盏真实点光 + mood 通道）
    alarm.distance = H * 4.4;
    alarm.position.set(-H * 0.45, H * 0.5, H * 0.25);
    alarm.intensity = 5000;
  }

  // —— 常驻（挂舞台寿命）：三路排焰错峰开喷 + 机体四周热浪 + 火光乘子 + 电火花 + 过压喘气 ——
  (runScript ?? ((body) => ctx.spawn(body)))(async (c) => {
    const jobs = [];
    for (const v of VENTS) {
      // 外层大橙焰（吞口的大团热浪）+ 内层亮黄芯（火心）——两层叠出体积感
      const em = particles.spawnEmitter(ux + v.dx, uy + v.dy, {
        rate: 0, radius: H * 0.16, color: v.color, speed: v.speed, ttl: 2.0,
        size: v.size * 0.5, gravity: 6, zJitter: H * 0.14, z: uz + 0.5,
      });
      if (em) {
        onStageDispose?.(() => em.stop());
        jobs.push(c.tweenRaw(em, { rate: v.rate }, { durationMs: 1600, delayMs: v.lag }));
      }
      const core = particles.spawnEmitter(ux + v.dx, uy + v.dy, {
        rate: 0, radius: H * 0.09, color: v.innerColor, speed: v.speed * 0.75, ttl: 1.1,
        size: v.innerSize * 0.5, gravity: 7, zJitter: H * 0.08, z: uz + 0.7,
      });
      if (core) {
        onStageDispose?.(() => core.stop());
        jobs.push(c.tweenRaw(core, { rate: v.innerRate }, { durationMs: 1600, delayMs: v.lag + 120 }));
      }
    }
    // 低位热浪环：沿机体四周一圈往上烤（outward 环向 + 上升），把热力铺满整个轮廓
    const ring = particles.spawnEmitter(ux + HEAT_RING.dx, uy + HEAT_RING.dy, {
      rate: 0, radius: HEAT_RING.radius, outward: true, color: HEAT_RING.color,
      speed: HEAT_RING.speed, ttl: 2.6, size: HEAT_RING.size, gravity: 6,
      zJitter: H * 0.18, z: uz + 0.4,
    });
    if (ring) {
      onStageDispose?.(() => ring.stop());
      jobs.push(c.tweenRaw(ring, { rate: HEAT_RING.rate }, { durationMs: 1800, delayMs: 600 }));
    }
    const mood = cast.get('light:mood');
    if (mood) {
      // 结构光不压反抬（P2 要「整间屋子被烤亮」），火色乘子大幅反抬
      jobs.push(c.tweenRaw(mood, { dim: Math.min(1.1, mood.dim * 1.05) }, { durationMs: 1800, delayMs: 300 }));
      jobs.push(c.tweenRaw(mood, { fireGain: mood.fireGain * 2.0 }, { durationMs: 1600, delayMs: 400 }));
    }
    await Promise.all(jobs);
    // 低频电火花 + 过压喘气：机器还是那台坏机器（无限循环到舞台寿命为止）
    let beat = 0;
    for (;;) {
      await c.wait(2400 + Math.random() * 1200);
      if (!unit.parent) break;
      burstSparks(particles, ux, uy, uz, H, 4);
      if (++beat % 2 === 0) {
        // 过压喘气：大口蒸汽从机体背板后腾起（尺寸大、数量多、淡入慢升），
        // 再在正面淡入两团——不从机体中间单点蹦出来
        for (let j = 0; j < 8; j++) {
          const w = 8 + Math.random() * 5;
          particles.spawnSprite(
            ux + (Math.random() - 0.5) * H * 0.9,
            uy + H * (0.28 + Math.random() * 0.55),
            {
              texture: steamTexture(), width: w, height: w * 0.86,
              z: uz - 1.2 - Math.random() * 3.0,
              vx: (Math.random() - 0.5) * 1.4, vy: 2.0 + Math.random() * 1.8,
              gravity: 0.5, ttl: 1.9 + Math.random() * 0.9,
              fadeIn: true, scalePop: 0.25,
            },
          );
        }
        for (let j = 0; j < 3; j++) {
          const w = 6 + Math.random() * 3;
          particles.spawnSprite(
            ux + (Math.random() - 0.5) * H * 0.7,
            uy + H * (0.40 + Math.random() * 0.32),
            {
              texture: steamTexture(), width: w, height: w * 0.85,
              z: uz + 1.4, vx: (Math.random() - 0.5) * 1.0, vy: 1.5 + Math.random(),
              gravity: 0.4, ttl: 1.6 + Math.random() * 0.6,
              fadeIn: true, scalePop: 0.3,
            },
          );
        }
        // 蒸汽里夹几粒被带出来的火星（物理上随排气翻出来，不是独立爆点）
        const v = VENTS[Math.floor(Math.random() * VENTS.length)];
        particles.spawn(ux + v.dx, uy + v.dy, {
          count: 6, color: 0xff9a48, speed: 4, vx: v.out[0] * 4, vy: v.out[1] * 4 + 2,
          size: 1.2, ttl: 0.8, gravity: -2, z: uz - 0.4,
        });
        if (alarm) {
          c.tweenRaw(alarm, { intensity: 3500 }, { durationMs: 90, ease: 'power2.out' })
            .then(() => c.tweenRaw(alarm, { intensity: 3000 }, { durationMs: 380 }));
        }
      }
    }
  });

  // 演出机位退场：先补间飞回基准（flyHome 连 fov），再弹栈——瞬时硬切是病灶
  await camera?.flyHome?.({ durationMs: 720, ease: 'power2.inOut' }) ?? null;
  camera?.popOverride?.('mefm1P2');
  unit.restoreColor?.();
}

// —— 命中 beat（钢铁电蚀主题）：弹链/普攻都是金属撞击的
// 白蓝电火花（不是血肉撞击），多段连发时读成「挨了一梭子」。共享底座
// enemyImpactBeat，garnish 复用本文件的 burstSparks（电火花 + 拖影）。
async function mefm1HitBeat(ctx, deps, args) {
  const rapid = args.fx.tier === 'rapid';
  await enemyImpactBeat(ctx, deps, {
    ...args,
    pal: {
      color: rapid ? [0.62, 0.72, 0.86] : [0.72, 0.78, 0.88],
      hot: rapid ? [0.85, 0.95, 1.2] : [0.9, 0.95, 1.15],
      rim: [0.6, 0.78, 1.05],
      sparkColor: 0xbfe0ff,
      flashColor: 0xcfe4ff,
    },
    garnish: (c2, d, { at, heavy: hv }) => {
      burstSparks(d.particles, at.x, at.y - 7, at.z ?? 0, 14, hv ? 12 : 7);   // uy - H/2 抵消内部 +H/2 偏移
    },
  });
}

// —— 起手 beat：攻击拍 = 金色曳光弹幕扫射（狂躁化）——实弹数 = 伤害段数，
// 脱靶弹两族**飞越玩家**（擦头顶 / 高抛越顶，端点落在玩家身后，弹道在玩家平面处
// 继续延伸而不是到点即灭）+ 贴地跳弹族（落点迸土石）；外观与实弹一致、不做区分，
// 压迫感来自弹幕密度与「打穿了整条走廊」而非命中数。脱靶弹按 x 排成一条扫线
// （方向随机）= 弹着点从一侧扫到另一侧的「压着枪口扫」，实弹均布插进弹链藏起。
// **膛口锚定**：弹幕/枪口焰/抛壳全从机炮素材炮口出。开火前抬手蓄势（机体后仰
// 把炮口抬起 + 膛口蓄能 + 火星倒吸 + 池灯预热）；每发 = 四芒星闪 + 定向喷焰 +
// 火星迸射 + 抛壳（落地一粒金属火花）+ 后坐脉冲；枪口光走单轨频闪（逐发
// lampPulse 同灯互踩会发虚）。少量曳光弹携 light:fx2 点光飞越玩家（照亮沿途
// 地面/家具）。P2 弹量/射速/焰闪全面上调，抛壳加倍（热壳）。命中侧的电火花由
// hit beat 承接。
// 钩爪拍（赋予伤残，无伤害）= 机械抓钩 + 钢缆：端口蓄能 → 飞行放缆 → 收爪咬合
// （冲击环/钢火花/灯/震）→ 绷缆一顿 → 收缆回膛；P2 伤残2 = 双钩双咬点。
// 积焰拍（P1 buff）= 排焰口「加压 → 点火 → 泄压」三段（蓄能光斑/火星内吸 →
// 双口定向火柱/冲击环/点光 → 余压小喷 + 灰烟 + 余焰）；点火完成拍（P2 buff，炎魔2）
// = 蓄势→三口齐喷大拍。攻击拍在第一发抵达玩家时 releaseBeat() 提前放行后端，
// 命中拍与剩余扫射并行。
async function mefm1Act({ ctx, deps, unit, player, kinds, args, releaseBeat }) {
  const H = unitH(unit);
  const bore = boreAnchor(unit);
  const to = player
    ? { x: player.position.x, y: player.position.y + unitH(player) * 0.56, z: player.position.z }
    : null;
  if (kinds.some(isAttackKind)) {
    const hits = Math.max(1, Math.min(args?.hits ?? 1, 6));
    const p2 = (unit._bossPhase ?? 1) >= 2;
    const extras = p2 ? 14 : 7;           // 脱靶弹（P2 弹幕密度翻倍——狂躁）
    const total = hits + extras;
    const gap = p2 ? 58 : 82;             // 射速（间隔 < 飞行时长 = 空中同时多弹）
    const flyMs = p2 ? 255 : 290;
    const windupMs = p2 ? 220 : 280;
    const burstMs = total * gap;
    const tailMs = p2 ? 560 : 520;
    const uy = unit.position.y, uz = unit.position.z ?? 0;
    const floorY = player?.position.y ?? (to ? to.y - unitH(player) * 0.56 : uy);
    const id = unit.uniqueID;
    const lamp = deps.cast?.get?.('light:fx1') ?? null;
    const tracerLamp = deps.cast?.get?.('light:fx2') ?? null;   // 飞行曳光弹携灯（少量）
    // 机炮部件（单位多部件；素材未就绪时回落膛口锚，演出不中断）
    const cannon = unit.parts?.get('mefmCannons')?.userData?.cannon ?? null;
    const tipOf = (arm, idx) => {
      if (!cannon) return { x: bore.x, y: bore.y, z: bore.z + 0.4 };
      const v = cannon.muzzleWorld(arm, idx);
      return { x: v.x, y: v.y, z: v.z + 0.4 };
    };
    unit.flash?.(p2 ? 0xffb066 : 0xffd27a);

    // ① 抬手蓄势：双机炮臂上抬（raise 由部件 tick 落到 sprite 变换）+ 机体后仰 +
    // 炮口蓄能光斑 + 火星倒吸 + 池灯预热。开火点在素材双管端头。
    if (cannon) {
      cannon.setHeatTarget(Math.max(cannon.state.heatTarget, p2 ? 1 : 0.62));
      if (to) cannon.state.aimWorld = { x: to.x, y: to.y, z: to.z }; // 炮管指向真实目标
      ctx.tweenRaw(cannon.state, { raise: 1 }, { durationMs: windupMs, ease: 'power2.out' });
    }
    const charge = makeGlowSprite(glowTexture(), p2 ? 0xff8a3a : 0xffc35a);
    charge.sprite.scale.setScalar(0.6);
    charge.mat.opacity = 0;
    deps.scene?.add(charge.sprite);
    if (lamp) {
      lamp.color.setRGB(1.0, p2 ? 0.5 : 0.72, p2 ? 0.2 : 0.32);
      lamp.intensity = 0;
    }
    ctx.onKill(() => {
      deps.scene?.remove(charge.sprite);
      charge.mat.dispose();
      if (lamp) lamp.intensity = 0;
      if (tracerLamp) tracerLamp.intensity = 0;
    });
    const suck = ctx.spawn(async (c) => {
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 3; j++) {
          const tip = tipOf('front', 0);
          const a = Math.random() * Math.PI * 2;
          const r = 2.4 + Math.random() * 2.4;
          const px = tip.x + Math.cos(a) * r;
          const py = tip.y + Math.sin(a) * r * 0.8;
          const rec = deps.particles?.spawnSprite?.(px, py, {
            texture: sparkTexture(), width: 1.9, height: 0.55, z: tip.z + 1.3,
            vx: (tip.x - px) / 0.24, vy: (tip.y - py) / 0.24,
            gravity: 0, ttl: 0.24, scalePop: 0.2,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(tip.y - py, tip.x - px);
        }
        await c.wait(Math.round(windupMs / 3.4));
      }
    }).promise;
    await Promise.all([
      ctx.custom(id, {
        durationMs: windupMs, ease: 'power2.out',
        onUpdate: (t) => {
          const tip = tipOf('front', 0);
          charge.sprite.position.set(tip.x, tip.y, tip.z + 1.2);
          charge.sprite.scale.setScalar(0.6 + 5.6 * t * t);
          charge.mat.opacity = 0.10 + 0.85 * t;
          unit.setPose({ lean: -0.105 * t, squash: 1 + 0.035 * t, widen: 1 - 0.02 * t });
          if (lamp) lamp.intensity = (p2 ? 520 : 340) * t;
        },
      }),
      suck,
    ]);
    if (cannon) cannon.state.raise = 0;   // 蓄势抬炮结束：落回瞄准线（弹道与炮管同轴）

    // 弹着点表：脱靶弹两族飞越玩家（端点落在玩家身后/头顶之上，弹道在玩家平面处
    // 继续延伸——「压不住、打穿了整条走廊」），只有贴地族留在玩家脚下犁地（迸土石）。
    let chain = [];
    if (to) {
      for (let i = 0; i < extras; i++) {
        const fam = Math.random();
        if (fam < 0.36) {        // 贴地跳弹：弹雨犁地，落点迸土石
          chain.push({
            x: to.x + (Math.random() - 0.5) * 2 * (5 + Math.random() * 16),
            y: floorY + 0.6 + Math.random() * 1.4, z: to.z, ground: true,
          });
        } else if (fam < 0.72) { // 过顶飞越：擦着玩家头顶飞过去，继续飞出后场
          chain.push({
            x: to.x - (8 + Math.random() * (p2 ? 26 : 18)),
            y: to.y + 15 + Math.random() * (p2 ? 7 : 5), z: to.z,
          });
        } else {                 // 高抛流弹：更高的抛线越过玩家
          chain.push({
            x: to.x - (12 + Math.random() * (p2 ? 30 : 22)),
            y: to.y + 22 + Math.random() * (p2 ? 10 : 7), z: to.z,
          });
        }
      }
      const sweepDir = Math.random() < 0.5 ? 1 : -1;
      chain.sort((a, b) => sweepDir * (a.x - b.x));
      for (let k = 0; k < hits; k++) {
        chain.splice(Math.floor(((k + 0.5) / hits) * (chain.length + 1)), 0, to);
      }
    } else {
      chain = Array(hits).fill(null);
    }

    // ② 连射：双机炮臂交替开火（每梭四根管轮流），后坐脉冲由单轨体态曲线驱动；
    // 枪口光单轨频闪（逐发 lampPulse 同灯互踩会发虚）
    const shotTimes = Array.from({ length: total }, (_, i) => i * gap);
    const jobs = [];
    // 后端提前放行：第一发抵达玩家时告诉 sequencer「起手演出已结束」——命中拍
    // 立刻入队，与剩余扫射并行（子弹/枪口焰继续自己播，不再等整梭打完）
    let beatReleased = false;
    const releaseOnce = () => {
      if (beatReleased) return;
      beatReleased = true;
      releaseBeat?.();
    };
    jobs.push(ctx.spawn(async (c) => {
      await c.wait(Math.round(flyMs * 0.92));
      releaseOnce();
    }).promise);
    jobs.push(ctx.spawn(async (c) => {
      await c.custom(id, {
        durationMs: burstMs + tailMs, ease: 'none',
        onUpdate: (t) => {
          const ms = t * (burstMs + tailMs);
          let kick = 0;
          for (const at of shotTimes) {
            const d = ms - at;
            if (d >= 0) kick += Math.exp(-d / 95) * (p2 ? 0.042 : 0.034);
          }
          const settle = Math.min(1, ms / 240);
          unit.setPose({
            lean: -0.105 * (1 - settle) + kick,
            squash: 1 + 0.035 * (1 - settle) - kick * 0.3,
            widen: 1 - 0.02 * (1 - settle) + kick * 0.55,
          });
        },
      });
      unit.resetPose?.();
    }).promise);
    if (lamp) {
      jobs.push(ctx.spawn(async (c) => {
        const st = { t: 0 };
        const lampMs = burstMs + (p2 ? 260 : 220);
        await c.tweenRaw(st, { t: 1 }, {
          durationMs: lampMs, ease: 'none',
          onUpdate: () => {
            const ms = st.t * lampMs;
            let v = 0;
            for (const at of shotTimes) {
              const d = ms - at;
              if (d >= 0) v += Math.exp(-d / (p2 ? 58 : 76));
            }
            lamp.intensity = Math.min(1.6, v) * (p2 ? 2100 : 1500);
          },
        });
        lamp.intensity = 0;
      }).promise);
    }
    // 退弹口：原画无明确抛壳口，取两门机炮各自的尾部（近侧屁股 + 远侧后段），
    // 两堆弹壳分落机体左右脚下——两门炮都看得见在掉壳
    let rearPort = null, rearPortBack = null;
    if (cannon) {
      const Hl = unit._standeeHeight ?? 22;
      unit.updateWorldMatrix(true, false);
      rearPort = unit.localToWorld(new THREE.Vector3(Hl * 0.38, Hl * 0.55, 0.6));
      rearPortBack = unit.localToWorld(new THREE.Vector3(-Hl * 0.52, Hl * 0.52, -0.4));
    }
    // 收尾：打完那口气的枪管冷却
    if (cannon && !p2) {
      jobs.push(ctx.spawn(async (c) => {
        await c.wait(burstMs + 360);
        await c.tweenRaw(cannon.state, { heatTarget: 0 }, { durationMs: 1800 });
      }).promise);
    }
    for (let i = 0; i < total; i++) {
      const arm = i % 2 === 0 ? 'front' : 'back';
      // 远侧机炮只抬上管（下管被盒体挡住）；近侧两管轮流
      const barrel = arm === 'back' ? 0 : (i >> 1) % 2;
      // 先对准该管再取炮口位（本发炮口与弹道同轴）
      if (cannon) cannon.aimBarrel(arm, barrel);
      const tip = tipOf(arm, barrel);
      const muzzle = {
        x: tip.x + (Math.random() - 0.5) * 1.4,
        y: tip.y + (Math.random() - 0.5) * 1.1,
        z: tip.z,
      };
      if (lamp) lamp.position.set(muzzle.x, muzzle.y, muzzle.z + 2);
      const tgt = chain[i] ?? to;
      // 少量曳光弹携灯飞越（间隔 6 发 > 单发飞行时长，同一盏灯不会多弹抢写）
      const carryLight = tracerLamp && i % 6 === 0;
      jobs.push(ctx.spawn(async (c) => {
        await arcProjectile(c, deps, {
          from: muzzle, to: tgt,
          shape: 'tracer',
          color: p2 ? [1.12, 0.82, 0.32] : [1.05, 0.75, 0.26],
          hot: p2 ? [1.8, 1.45, 0.7] : [1.65, 1.3, 0.6],
          size: p2 ? 2.5 : 2.2, ms: flyMs, arcH: tgt?.ground ? 0.25 : 0.6,
          stretch: 3.4, darting: 0.05,
          lampName: carryLight ? 'light:fx2' : null,
          lampIntensity: p2 ? 950 : 720,
          trail: { color: 0xffb45a, speed: 1.6, size: 0.7, ttl: 0.2 },
        });
        if (tgt?.ground) groundPuff(deps.particles, tgt.x, tgt.y, tgt.z);
      }).promise);
      const flashK = i === 0 ? 1.35 : 1.0;
      const star = deps.particles?.spawnSprite?.(muzzle.x, muzzle.y, {
        texture: muzzleTexture(), width: (p2 ? 6.4 : 5.6) * flashK,
        height: (p2 ? 6.4 : 5.6) * flashK,
        z: muzzle.z + 1.6, ttl: 0.13, scalePop: 0.9, gravity: 0,
      });
      if (star) star.sprite.material.rotation = 0;
      const coneW = (p2 ? 8.6 : 7.4) * flashK;
      const cone = deps.particles?.spawnSprite?.(muzzle.x - coneW * 0.28, muzzle.y, {
        texture: muzzleConeTexture(), width: coneW, height: coneW * 0.5,
        z: muzzle.z + 1.5, ttl: 0.15, scalePop: 0.6, gravity: 0,
      });
      if (cone) cone.sprite.material.rotation = 0;
      if (i === 0) {
        const blast = deps.particles?.spawnSprite?.(muzzle.x, muzzle.y, {
          texture: ringTexture(), width: 5.0, height: 5.0, z: muzzle.z + 1.2,
          ttl: 0.36, scalePop: 0.25, gravity: 0,
        });
        if (blast) {
          ctx.tweenRaw(blast, { w: 11, h: 11 }, { durationMs: 300, ease: 'power2.out' });
          blast.sprite.material.rotation = 0;
        }
        deps.shake?.impulse?.(p2 ? 2.4 : 1.7);
      }
      deps.particles?.spawn?.(muzzle.x, muzzle.y, {
        color: 0xffc35a, count: p2 ? 18 : 12, speed: 20, size: 1.1, ttl: 0.3,
        vx: -16, vy: 1.5, gravity: -8, z: muzzle.z + 1,
      });
      if (i % 3 === 0) {   // 膛口残烟：每三发一小口，慢飘后散（枪口的物理残留）
        deps.particles?.spawn?.(muzzle.x, muzzle.y, {
          color: 0x8a8274, count: 2, speed: 3, vx: -2.4, vy: 2.2,
          size: 1.3, ttl: 0.65, gravity: 1.5, z: muzzle.z + 1,
        });
      }
      if (cannon && rearPort) {
        cannon.recoil(arm);
        // 主抛壳 = 开火侧机炮；每两发再由对侧机炮联动掉一枚（弹壳量比单口多一半），
        // P2 过热时再加密——两堆弹壳随行动累积
        const mainPort = arm === 'front' ? rearPort : rearPortBack;
        cannon.spawnCasing(mainPort, { dir: arm === 'front' ? 1 : -1 });
        if (i % 2 === 0) {
          const otherPort = arm === 'front' ? rearPortBack : rearPort;
          cannon.spawnCasing(otherPort, { dir: arm === 'front' ? -1 : 1 });
        }
        if (p2 && i % 3 === 0) cannon.spawnCasing(mainPort, { dir: arm === 'front' ? 1 : -1 });
      }
      if (i === 0) charge.sprite.visible = false;
      if (i % 2 === 0) deps.shake?.impulse?.(p2 ? 0.7 : 0.45);
      if (i < total - 1) await ctx.wait(gap);
    }
    // ③ 冷却水汽：打完两梭，四根枪管同时冒白汽（慢升、渐散）
    jobs.push(ctx.spawn(async (c) => {
      await c.wait(burstMs + 30);
      for (let k = 0; k < 3; k++) {
        for (const arm of ['front', 'back']) {
          for (const idx of [0, 1]) {
            const tip = tipOf(arm, idx);
            const size = 2.6 + Math.random() * 2.2 + k * 0.6;
            deps.particles?.spawnSprite?.(tip.x + (Math.random() - 0.5) * 1.2, tip.y + (Math.random() - 0.5) * 0.8, {
              texture: steamTexture(), width: size, height: size * 0.9, z: tip.z + 2,
              vx: -1.5 - Math.random() * 2, vy: 2 + Math.random() * 2.5,
              gravity: -0.2, ttl: 1.2 + Math.random() * 0.8, fadeIn: true, scalePop: 0.35,
            });
          }
        }
        await c.wait(170);
      }
    }).promise);
    await Promise.all(jobs);
    if (cannon) cannon.state.aimWorld = null;   // 解除瞄准，回待机摆动
    // 枪口余烬：两颗慢落火星收尾（热枪管的物理收束）
    for (const arm of ['front', 'back']) {
      const tip = tipOf(arm, 1);
      deps.particles?.spawn?.(tip.x, tip.y, {
        color: 0xffa04c, count: 2, speed: 2.5, size: 0.8, ttl: 0.8, gravity: 1, z: tip.z + 1,
      });
    }
    unit.flash?.(p2 ? 0xffb066 : 0xffd27a);
    return;
  }
  if (kinds.some(isDebuffKind)) {
    if (!to) return;
    const p2 = (unit._bossPhase ?? 1) >= 2;
    const jobs = [];
    jobs.push(fireHook(ctx, deps, { from: bore, to, p2, flightMs: p2 ? 210 : 250, arcH: 2.4 }));
    // P2 = 伤残2 → 双钩：主炮口 + 艇体下沿舱口同时打两条缆，两个咬点
    if (p2) {
      jobs.push(fireHook(ctx, deps, {
        from: { x: unit.position.x - H * 0.33, y: unit.position.y + H * 0.46, z: bore.z },
        to: { x: to.x + 1.0, y: to.y - 1.3, z: to.z },
        p2, flightMs: 220, arcH: 3.0,
      }));
    }
    // 机体：后仰抬膛（与端口 130ms 蓄能同拍）→ 发射前扑 → 回正
    jobs.push((async () => {
      await ctx.custom(unit.uniqueID, {
        durationMs: 130, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: -0.06 * t, squash: 1 + 0.025 * t }),
      });
      await ctx.custom(unit.uniqueID, {
        durationMs: 150, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ lean: -0.06 + 0.17 * t, squash: 1.025 - 0.045 * t }),
      });
      await ctx.custom(unit.uniqueID, {
        durationMs: 520, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: 0.11 * (1 - t), squash: 0.98 + 0.02 * t }),
      });
      unit.resetPose?.();
    })());
    await Promise.all(jobs);
    return;
  }
  if (kinds.some(isBuffKind)) {
    const ux = unit.position.x, uy = unit.position.y, uz = unit.position.z;
    if ((unit._bossPhase ?? 1) >= 2) {
      // —— 点火完成（炎魔2）：大动作前摇——火星倒吸回排焰口 + 机体绷紧
      // 下压 + 熔炉灯先憋暗，顶点憋一拍（高频微颤）；再三口排焰同时全开：火柱 +
      // 电火花风暴 + 冲击炽闪 + 熔炉灯冲顶回落 + 机体弹性回胀。
      const VENTS = [
        { dx: -H * 0.3, dy: H * 0.45 }, { dx: H * 0.34, dy: H * 0.28 }, { dx: 0, dy: H * 0.72 },
      ];
      const furnace = deps.cast?.get?.('light:fx0') ?? null; // P2 剧本挂的常驻熔炉灯
      const furnaceBase = furnace?.intensity ?? 0;
      const jobs = [];
      // ① 蓄势（~0.6s）：三批火星倒吸（渐急）+ 熔炉灯憋暗 + 机体下压绷紧
      jobs.push(ctx.spawn(async (c) => {
        for (let i = 0; i < 3; i++) {
          for (const v of VENTS) {
            for (let k = 0; k < 3; k++) {
              const px = ux + v.dx + (Math.random() - 0.5) * H * 0.55;
              const py = uy + v.dy + (Math.random() - 0.5) * H * 0.35;
              const pull = 0.24;
              const rec = deps.particles?.spawnSprite?.(px, py, {
                texture: sparkTexture(), width: 2.4, height: 0.65, z: uz + 1.5,
                vx: (ux + v.dx - px) / pull, vy: (uy + v.dy - py) / pull,
                gravity: 0, ttl: pull, scalePop: 0.25,
              });
              if (rec) rec.sprite.material.rotation = Math.atan2((uy + v.dy - py) / pull, (ux + v.dx - px) / pull);
            }
          }
          await c.wait(155 - i * 30);
        }
      }).promise);
      if (furnace) {
        jobs.push(ctx.spawn((c) => c.tweenRaw(furnace, { intensity: furnaceBase * 0.35 }, { durationMs: 520, ease: 'power2.in' })).promise);
      }
      const id = unit.uniqueID;
      await ctx.custom(id, {
        durationMs: 600, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ squash: 1 - 0.14 * t, widen: 1 + 0.10 * t }),
      });
      // 顶点憋 150ms（蓄不住的高频微颤）
      await ctx.custom(id, {
        durationMs: 150, ease: 'none',
        onUpdate: (t) => {
          const sh = Math.sin(t * Math.PI * 2 * 6) * 0.018 * (0.5 + t);
          unit.setPose({ squash: 0.86, widen: 1.10 + sh });
        },
      });
      unit.resetPose?.();
      // ② 齐喷：三口火柱 + 径向电火花风暴 + 炽闪 + 震 + 熔炉灯冲顶回落
      unit.flash?.(0xff8a3a);
      deps.shake?.impulse?.(3.2);
      for (const v of VENTS) {
        deps.particles?.spawn?.(ux + v.dx, uy + v.dy, {
          color: 0xff8a3a, count: 22, speed: 12, vy: 26, size: 1.8, ttl: 0.9, gravity: 3, z: uz + 0.6,
        });
        deps.particles?.spawnSprite?.(ux + v.dx, uy + v.dy + 2, {
          texture: ringTexture(), width: 4.5, height: 4.5, z: uz + 1.6, ttl: 0.5, scalePop: 0.7, gravity: 0,
        });
      }
      for (let i = 0; i < 14; i++) {   // 机器的火带着电——白蓝电火花风暴
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 18 + Math.random() * 9;
        const rec = deps.particles?.spawnSprite?.(ux, uy + H * 0.5, {
          texture: sparkTexture(), width: 3.2, height: 0.8, z: uz + 1.5,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 + 2, gravity: 4, ttl: 0.7, scalePop: 0.3,
        });
        if (rec) rec.sprite.material.rotation = Math.atan2(Math.sin(a) * 0.6, Math.cos(a));
      }
      jobs.push(ctx.spawn((c) => lampPulse(c, deps, {
        name: 'light:fx1', at: { x: ux, y: uy + H * 0.5, z: uz + 2 },
        color: [1.0, 0.55, 0.2], peak: 2400, attackMs: 50, decayMs: 650,
      })).promise);
      if (furnace) {
        jobs.push(ctx.spawn(async (c) => {
          await c.tweenRaw(furnace, { intensity: furnaceBase * 2.2 }, { durationMs: 120, ease: 'power3.out' });
          await c.tweenRaw(furnace, { intensity: furnaceBase }, { durationMs: 900, ease: 'power2.inOut' });
        }).promise);
      }
      // 机体弹性回胀（喷完那口气的舒张）
      await ctx.custom(id, {
        durationMs: 380, ease: 'power3.out',
        onUpdate: (t) => {
          const k = 1 + 0.10 * Math.sin(t * Math.PI);
          unit.setPose({ widen: k, squash: 1 - (k - 1) * 0.7 });
        },
      });
      unit.resetPose?.();
      await Promise.all(jobs);
      return;
    }
    // P1 积焰（buff 起手）= 机械排焰口的「加压 → 点火 → 泄压」三段动作：
    //   ① 蓄压：机体下压绷紧 + 两口蓄能光斑 + 火星向阀口内吸（压力升高）
    //   ② 点火：双口定向火柱（vx 向外 + vy 向上）+ 喷口拖影 + 冲击环 + 橙闪 + 点光 + 震
    //   ③ 泄压：两次错峰余压小喷 + 灰烟 + 余焰上飘，机体弹性回正
    // 粒子一律带方向/物理动机（内吸、喷出、上浮），不做无来由的随机爆发。
    const id = unit.uniqueID;
    const VENTS = [
      { dx: -H * 0.3, dy: H * 0.45, sx: -1 },
      { dx: H * 0.34, dy: H * 0.28, sx: 1 },
      { dx: 0, dy: H * 0.72, sx: 0 },   // 顶部熔炉口：主火柱（积焰的视觉主体）
    ];
    const charge = VENTS.map((v) => {
      const g = makeGlowSprite(glowTexture(), 0xffa04c);
      g.sprite.position.set(ux + v.dx, uy + v.dy, uz + 1.3);
      g.sprite.scale.setScalar(0.5);
      g.mat.opacity = 0;
      deps.scene?.add(g.sprite);
      return g;
    });
    const lamp = deps.cast?.get?.('light:fx0') ?? null;
    if (lamp) {
      lamp.color.setRGB(1.0, 0.62, 0.24);
      lamp.position.set(ux, uy + H * 0.38, uz + 1.5);
      lamp.intensity = 0;
    }
    ctx.onKill(() => {
      for (const g of charge) { deps.scene?.remove(g.sprite); g.mat.dispose(); }
      if (lamp) lamp.intensity = 0;
    });
    // ① 蓄压 460ms
    const suck = ctx.spawn(async (c) => {
      for (let k = 0; k < 3; k++) {
        for (const v of VENTS) {
          for (let j = 0; j < 3; j++) {
            const a = Math.random() * Math.PI * 2;
            const r = 2.2 + Math.random() * 2.2;
            const px = ux + v.dx + Math.cos(a) * r;
            const py = uy + v.dy + Math.sin(a) * r * 0.7;
            const rec = deps.particles?.spawnSprite?.(px, py, {
              texture: sparkTexture(), width: 1.8, height: 0.5, z: uz + 1.4,
              vx: (ux + v.dx - px) / 0.22, vy: (uy + v.dy - py) / 0.22,
              gravity: 0, ttl: 0.22, scalePop: 0.2,
            });
            if (rec) rec.sprite.material.rotation = Math.atan2(uy + v.dy - py, ux + v.dx - px);
          }
        }
        await c.wait(140);
      }
    }).promise;
    await Promise.all([
      ctx.custom(id, {
        durationMs: 460, ease: 'power2.in',
        onUpdate: (t) => {
          const sh = Math.sin(t * Math.PI * 2 * 7) * 0.006 * t;
          unit.setPose({ squash: 1 - 0.08 * t + sh, widen: 1 + 0.06 * t });
          charge.forEach((g) => {
            g.sprite.scale.setScalar(0.5 + 2.6 * t * t);
            g.mat.opacity = 0.08 + 0.72 * t;
          });
          if (lamp) lamp.intensity = 520 * t;
        },
      }),
      suck,
    ]);
    // ② 点火：蓄能光斑转为白热喷口 + 三波定向火柱（0/90/180ms）+ 冲击环
    unit.flash?.(0xffb066);
    deps.shake?.impulse?.(1.6);
    if (lamp) lamp.intensity = 1500;
    for (const g of charge) {
      g.mat.opacity = 0.95;
      ctx.spawn(async (c) => {
        await Promise.all([
          c.tweenRaw(g.sprite.scale, { x: 5.2, y: 5.2, z: 1 }, { durationMs: 380, ease: 'power2.out' }),
          c.tweenRaw(g.mat, { opacity: 0 }, { durationMs: 440, ease: 'power2.in' }),
        ]);
      });
    }
    for (let w = 0; w < 3; w++) {
      for (const v of VENTS) {
        const top = v.sx === 0;
        deps.particles?.spawn?.(ux + v.dx, uy + v.dy, {
          color: w === 0 ? 0xffd27a : 0xff8a3a, count: top ? (w === 0 ? 26 : 14) : (w === 0 ? 18 : 10),
          speed: 3.5, vx: top ? (Math.random() - 0.5) * 3 : v.sx * (11 + w * 2), vy: top ? 26 + w * 3 : 19 + w * 3,
          size: top ? 2.0 : (w === 0 ? 1.8 : 1.5), ttl: 0.65, gravity: 4, z: uz + 0.6,
        });
        for (let k = 0; k < 2; k++) {
          const sp = 12 + Math.random() * 8;
          const rec = deps.particles?.spawnSprite?.(ux + v.dx, uy + v.dy, {
            texture: sparkTexture(), width: 3.0, height: 0.8, z: uz + 1.5,
            vx: top ? (Math.random() - 0.5) * 6 : v.sx * sp, vy: sp * 1.15,
            gravity: 3, ttl: 0.3, scalePop: 0.3,
          });
          if (rec) rec.sprite.material.rotation = Math.atan2(sp * 1.15, top ? 0.01 : v.sx * sp);
        }
      }
      if (w === 0) {
        for (const v of VENTS) {
          deps.particles?.spawnSprite?.(ux + v.dx, uy + v.dy, {
            texture: ringTexture(), width: 3.4, height: 3.4, z: uz + 1.4,
            ttl: 0.34, scalePop: 0.9, gravity: 0,
          });
        }
        // 机体一圈卸压气浪：积焰是「整台机器烧起来」，不只两个喷口在冒火
        const ring = deps.particles?.spawnSprite?.(ux, uy + H * 0.5, {
          texture: ringTexture(), width: H * 0.35, height: H * 0.35,
          z: uz + 1.5, ttl: 0.52, gravity: 0,
        });
        if (ring) {
          ctx.spawn((c) => c.tweenRaw(ring, { w: H * 1.15, h: H * 1.15 }, { durationMs: 420, ease: 'power2.out' }));
          ring.sprite.material.rotation = 0;
        }
      }
      await ctx.wait(90);
    }
    // ③ 泄压
    const relief = ctx.spawn(async (c) => {
      if (lamp) c.tweenRaw(lamp, { intensity: 0 }, { durationMs: 760, ease: 'power2.in' });
      await c.wait(170);
      deps.particles?.spawn?.(ux - H * 0.3, uy + H * 0.45, {
        color: 0xffa04c, count: 6, speed: 2.4, vx: -4, vy: 8,
        size: 1.0, ttl: 0.7, gravity: 1, z: uz + 0.6,
      });
      await c.wait(190);
      deps.particles?.spawn?.(ux + H * 0.34, uy + H * 0.28, {
        color: 0xff8a3a, count: 5, speed: 2.2, vx: 4, vy: 7,
        size: 0.9, ttl: 0.6, gravity: 1, z: uz + 0.6,
      });
      for (const v of VENTS) {
        deps.particles?.spawn?.(ux + v.dx, uy + v.dy + 1.2, {
          color: 0x666a72, count: 3, speed: 1.6, vx: v.sx * 2.2, vy: 4,
          size: 1.8, ttl: 1.1, gravity: 1.2, z: uz + 0.7,
        });
      }
      for (let k = 0; k < 4; k++) {
        deps.particles?.spawn?.(ux + (Math.random() - 0.5) * H * 0.18, uy + H * 0.78, {
          color: 0xffb066, count: 1, speed: 1.4, vy: 7,
          size: 0.7, ttl: 0.9, gravity: 0.5, z: uz + 0.7,
        });
        await c.wait(120);
      }
    }).promise;
    await Promise.all([
      ctx.custom(id, {
        durationMs: 520, ease: 'power3.out',
        onUpdate: (t) => {
          const k = 1 + 0.09 * Math.sin(t * Math.PI);
          unit.setPose({ widen: k, squash: 1 - (k - 1) * 0.7 });
        },
      }),
      relief,
    ]);
    unit.resetPose?.();
    if (lamp) lamp.intensity = 0;
  }
}

export function registerMefm1Scripts(register) {
  registerMefmCannons(); // 多部件：双机炮臂 + 弹壳场（def.unitParts 声明挂接）
  register('bosses/mefm1P2', mefm1P2);
  registerEnemyHitBeat('mefm1', mefm1HitBeat);
  registerEnemyAct('mefm1', mefm1Act);
  // 射击机器：不突进——笨重战体的攻击是原地扫射（曳光弹承担距离），不是飞扑
  registerEnemyNoLunge('mefm1');
  // 常驻装甲导演（bossStateFx）：P1 持有 defense = 六边形能量硬化装甲在线；
  // 转段拍剧本置 _armorShattered 并播碎裂，此后不再重建（甲没了就是没了）
  registerBossStateFx('mefm1', (obj, unitProj) => {
    if (unitProj.isDead) return;
    const def = unitProj.effects?.find((e) => e.effectId === 'defense');
    const on = (def?.stacks ?? 0) > 0 && !obj._armorShattered;
    if (on) obj._fxLayer?.overlay('bossArmor', 2, (l) => makeHexShield(l));
    obj._fxLayer?.setLevel('bossArmor', on ? 1 : 0);
  });
  // 受击补充（目标侧）：甲在 = 命中点涟漪 + 白蓝金属火星（打在力场上）；
  // 甲碎后 = 橙白火花 + 灰烟星点（打在裸露机壳上）
  registerBossHurtFx('mefm1', (ctx, deps, { unit, dealt, fromX }) => {
    const H = unit._standeeHeight ?? 22;
    const armor = unit._fxLayer?.get('bossArmor');
    const nx = fromX == null ? 0.5 : (fromX < unit.position.x ? 0.24 : 0.76);
    if (armor && armor.levelNow() > 0.25) {
      armor.impact(nx + (Math.random() - 0.5) * 0.14, 0.35 + Math.random() * 0.35);
      deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.55, {
        color: 0xbfe0ff, count: Math.min(4 + Math.round(dealt / 4), 12), speed: 14,
        size: 0.8, ttl: 0.45, z: unit.position.z + 1,
      });
      return;
    }
    deps.particles?.spawn?.(unit.position.x, unit.position.y + H * 0.55, {
      color: 0xffb066, count: Math.min(5 + Math.round(dealt / 4), 14), speed: 16,
      size: 0.9, ttl: 0.5, gravity: -6, z: unit.position.z + 1,
    });
  });
}
