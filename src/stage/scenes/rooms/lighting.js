// 房型配方层 · 布光预设（SCENE_TASKS T3.3）：torch / moon / boss-rim 三预设。
// 铁律（CATALOG §6）：光源资产只声明"有火"，光参数全部集中在此——资产禁私设 PointLight。
// 基础结构移植 dungeon3D 已调好的光参（半球保底 + 唯一投影主光 + 战线主补光 + 假反弹），
// 预设差异 = 主光来源/强度配比/染色口径。火点光由 composeRoom 收集的 fireAnchors 生成。

import * as THREE from 'three';
import { P } from '../kit/index.js';
import { FLOOR_Y } from '../dungeon3D.js';
import { LEFT_WALL_X } from './walls.js';

// 幽火点光基准（three 物理光度学 candela；同 dungeon3D TORCH_LIGHT_BASE 口径）
const FIRE_BASE = 1150;
const FLAME_RATE = 12; // 每火火焰粒子 /秒（同 dungeon3D）

/**
 * 月光平行光（唯一投影光）的 shadow 配置——dungeon3D 多轮调试实录直接继承：
 *   position 沿光轴反移 145 让整面高墙（+460）落在阴影近平面之前（防上半墙采样空=恒亮漏光）；
 *   shadow 相机须盖住加高加宽后的左墙 + 房间；bias 防自阴影痤疮。
 */
function makeMoonlight(intensity) {
  const moon = new THREE.DirectionalLight(0x9db4ec, intensity);
  moon.position.set(LEFT_WALL_X - 145, 145, -29);
  moon.target.position.set(30, FLOOR_Y, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -200; sc.right = 200; sc.top = 600; sc.bottom = -120;
  sc.near = 10; sc.far = 600;
  moon.shadow.bias = -0.0015;
  return moon;
}

export const LIGHTING_PRESETS = {
  // 对比度总处方（对照手工大厅调定，数值经 gallery URL 参数 A/B 共调）：
  // 环境光一律压到 ~1.0/0.12——逐项单开都不亮，叠加却把全场洗成牛奶蓝（衰减都很慢：
  // hemi 无衰减、fill 平行光无衰减、火 decay 1.8 + 15 盏互叠是最大洗墙源）。
  // 亮度交给局部光池（月光束/战火/战场补光 glow 5200@195 只罩战场），远墙可见性交给雾处方。
  // 单开诊断截图见 tmp/diag-*.png。
  moon: {
    hemi: [0x3a4666, 0x232030, 1.1],
    moon: 2.2,
    fill: 0.12,
    bounce: [[140, 105], [100, 90]],
    battleGlow: [0x93a5d8, 5200, 195],
    centerFill: [0x8a9ac8, 3400, 170],
    fire: { base: FIRE_BASE * 0.5, dist: 140, cap: 12 },
    tint: { base: [0.52, 0.55, 0.75], fireGain: [0.16, 0.20, 0.48], radius: 58 },
  },
  // 火把主导（1-2 章基调）：月光弱（小窗/无窗），火点光扛场景亮度（仍冷调幽火，暖橙禁用）
  torch: {
    hemi: [0x3a4666, 0x232030, 1.0],
    moon: 0.9, // 窄高窗进光量比旧小窗大，月光略抬让光束可读（火仍是主角）
    fill: 0.12,
    bounce: [[120, 100], [90, 90]],
    battleGlow: [0x93a5d8, 5200, 195],
    centerFill: [0x8a9ac8, 3800, 170],
    fire: { base: FIRE_BASE * 0.56, dist: 145, cap: 14 },
    tint: { base: [0.5, 0.53, 0.72], fireGain: [0.18, 0.22, 0.5], radius: 64 },
  },
  // Boss 血色侧逆光：主光来自敌后右上的血色 rim，月光低压、雾重（雾参数走配方）
  'boss-rim': {
    hemi: [0x463a4a, 0x281e28, 1.0],
    moon: 1.0,
    fill: 0.12,
    bounce: [[120, 100], [90, 90]],
    battleGlow: [0xa08aa0, 6000, 200],
    centerFill: [0xa08098, 3600, 175],
    rim: { color: 0x9a5a6a, intensity: 1.5, position: [170, 100, -170], target: [0, FLOOR_Y, -10] },
    fire: { base: FIRE_BASE * 0.55, dist: 145, cap: 12 },
    tint: { base: [0.55, 0.5, 0.66], fireGain: [0.22, 0.14, 0.4], radius: 60 },
  },
};

/**
 * 按预设组装灯光。fireAnchors=[{x,y,z}]（composeRoom 从 lightSource 道具收集的火位）。
 * @returns {group, torches, moonlight, tint, update(dt, particles)}
 */
export function createLighting(key, fireAnchors = []) {
  const preset = LIGHTING_PRESETS[key];
  if (!preset) throw new Error(`lighting: 未知布光预设 "${key}"`);
  const group = new THREE.Group();
  group.name = `lighting:${key}`;

  const hemi = new THREE.HemisphereLight(...preset.hemi);
  group.add(hemi);

  const moonlight = makeMoonlight(preset.moon);
  group.add(moonlight, moonlight.target);

  if (preset.rim) {
    const rim = new THREE.DirectionalLight(preset.rim.color, preset.rim.intensity);
    rim.position.set(...preset.rim.position);
    rim.target.position.set(...preset.rim.target);
    group.add(rim, rim.target);
  }

  const fill = new THREE.DirectionalLight(0x66779e, preset.fill);
  fill.position.set(30, 60, 200);
  group.add(fill);

  // 月光落地反弹（假 GI）：两处光池点光——位置离开墙面（贴墙会把挂饰打得过艳，
  // "unlit 壁画刺眼"的病灶），向房间中线收，只打地板光池
  const [bounceA, bounceB] = preset.bounce;
  const pA = new THREE.PointLight(0x8298d4, bounceA[0], bounceA[1], 1.8);
  pA.position.set(-10, FLOOR_Y + 6, -12);
  const pB = new THREE.PointLight(0x8298d4, bounceB[0], bounceB[1], 1.8);
  pB.position.set(-10, FLOOR_Y + 6, 16);
  group.add(pA, pB);

  // 战场主补光（光照焦点）：悬战线中点上空的大点光，物理衰减让战场亮、四周暗。
  // 距离收在 ~195：只罩战场+近墙——收太小全场黑洞，收太大（260=整房）又把墙面洗平
  const [glowColor, glowBase, glowDist = 195] = preset.battleGlow;
  const battleGlow = new THREE.PointLight(glowColor, glowBase, glowDist, 2.0);
  battleGlow.position.set(-4, FLOOR_Y + 60, -22);
  group.add(battleGlow);

  // 房间中央虚拟光：框住战场中央附近的道具/单位，把玩家注意力收到战区（用户定）
  const [cfColor, cfBase, cfDist] = preset.centerFill;
  const centerFill = new THREE.PointLight(cfColor, cfBase, cfDist, 2.0);
  centerFill.position.set(-4, FLOOR_Y + 42, -20);
  group.add(centerFill);

  // 火点光：一火一灯（cap 上限，超出的火只留几何火苗不发光——宁缺毋滥，光池过多会洗亮全场）
  const torches = [];
  for (const a of fireAnchors.slice(0, preset.fire.cap)) {
    const light = new THREE.PointLight(P.fireLight, preset.fire.base, preset.fire.dist, 1.8);
    light.position.set(a.x, a.y + 3, a.z + 2);
    group.add(light);
    torches.push({
      x: a.x, y: a.y, z: a.z, light,
      phase: (a.x * 7.13 + a.z * 3.71) % (Math.PI * 2), // 确定性相位（由坐标派生）
      intensity: 1, emitterAcc: 0,
    });
  }

  let time = 0;
  /** 帧驱动：幽火闪烁 + 火焰粒子发射（同 dungeon3D 口径） */
  function update(dt, particles = null) {
    time += dt;
    for (const t of torches) {
      t.intensity = 1
        + 0.16 * Math.sin(time * 11 + t.phase)
        + 0.08 * Math.sin(time * 23 + t.phase * 1.7);
      t.light.intensity = preset.fire.base * t.intensity;
      if (particles) {
        t.emitterAcc += dt * FLAME_RATE;
        while (t.emitterAcc >= 1) {
          t.emitterAcc -= 1;
          particles.spawn(t.x + (Math.random() - 0.5) * 1.6, t.y + 2.2, {
            count: 1, z: t.z, color: Math.random() < 0.35 ? 0xcfd8ff : 0x8a9ae8,
            speed: 4.2, ttl: 0.6, gravity: 2, size: 1.3,
          });
        }
      }
    }
  }

  return { group, torches, moonlight, tint: preset.tint, update };
}
