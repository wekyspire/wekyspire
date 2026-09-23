// 环绕火球挂接件（多部件敌人首件，fx Phase 5，2026-09-23；同日视觉大改）：
// 敌人 def 声明 orbs: { count, color, radius, height, size, speed, bob }，
// BattleStage 建视图时挂上。
// 每团火 = 四层 sprite 叠出「火焰感」（纯程序化纹理，无美术素材）：
//   光晕（大范围柔光 additive）→ 焰身（水滴形火苗，底芯白热→顶梢暗红）→
//   内芯（小尺寸炽白，压住过曝）→ 彗尾 ×3（滞后相位的淡影，转起来拖出尾迹）。
// 逐帧抖焰（双正弦叠加 ≈ 伪噪声）+ 一团 PointLight 真的把 Boss 脸打上橙光
// （强度同火炬量级、随 heat 涨）。
// 轨道参数挂在 group.userData.orbit——**公开可写、tick 逐帧读**（与 emitter.rate
// 同惯例）：剧本 tweenRaw 直推半径/转速/尺寸就是「狂暴化」演出；新增的 heat
// （0→1）驱动亮度/抖幅/尾迹/灯光的整体升温，Boss 转段剧本只推这一个标量。
import * as THREE from 'three';

const _texCache = new Map(); // `${kind}:${color}` → THREE.CanvasTexture
const TEX_RES = 192; // 贴图布面实际边长（绘制坐标仍按 128 空间）

const rgbOf = (color) => {
  const col = new THREE.Color(color);
  return `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
};

function cachedTex(key, color, draw) {
  const ck = `${key}:${color}`;
  if (_texCache.has(ck)) return _texCache.get(ck);
  const c = document.createElement('canvas');
  c.width = c.height = TEX_RES;
  const g = c.getContext('2d');
  // 绘制坐标一律按 128 空间写；布面实际 192——火苗那两缕细火舌在 128 上锯成阶梯，
  // 缩放到屏幕上正好是玩家盯着看的部分
  g.scale(TEX_RES / 128, TEX_RES / 128);
  draw(g, rgbOf(color));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(ck, tex);
  return tex;
}

// 柔光晕：中心主题色 65% → 透明（additive 下读出"热空气"）
function glowTexture(color) {
  return cachedTex('glow', color, (g, rgb) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, `rgba(${rgb},0.7)`);
    grad.addColorStop(0.45, `rgba(${rgb},0.28)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

// 焰身：水滴火苗。底 1/3 白热芯 → 中段主题色 → 两缕上挑火舌渐隐成暗红。
// 画在 128 方布的下半→顶部（贴图原点左上），sprite 中心即焰心偏下。
function flameTexture(color) {
  return cachedTex('flame', color, (g, rgb) => {
    // 主体泪滴：贝塞尔轮廓 + 纵向渐变
    const body = g.createLinearGradient(64, 118, 64, 18);
    body.addColorStop(0, 'rgba(255,252,235,1)');
    body.addColorStop(0.2, `rgba(${rgb},0.95)`);
    body.addColorStop(0.66, `rgba(${rgb},0.5)`);
    body.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(64, 10);                                  // 顶梢
    g.bezierCurveTo(96, 52, 100, 84, 82, 106);         // 右侧收进
    g.bezierCurveTo(74, 116, 54, 116, 46, 106);        // 圆底
    g.bezierCurveTo(28, 84, 32, 52, 64, 10);           // 左侧上挑
    g.fill();
    // 侧掠火舌：左一缕短翘、右一缕细长（不对称 = 活火，不是灯泡）
    const tongue = g.createLinearGradient(64, 110, 64, 30);
    tongue.addColorStop(0, 'rgba(255,240,200,0.9)');
    tongue.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = tongue;
    g.beginPath();
    g.moveTo(40, 96); g.quadraticCurveTo(20, 70, 34, 42); g.quadraticCurveTo(44, 66, 52, 92); g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(84, 98); g.quadraticCurveTo(104, 66, 88, 30); g.quadraticCurveTo(80, 64, 74, 94); g.closePath();
    g.fill();
    // 白热芯：底缘一小团（additive 叠在主体上提亮度层次）
    const core = g.createRadialGradient(64, 96, 2, 64, 96, 30);
    core.addColorStop(0, 'rgba(255,255,245,0.95)');
    core.addColorStop(1, 'rgba(255,255,245,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, 128, 128);
  });
}

/**
 * 给单位视图挂上环绕火球组（部件名 'orbs'）。
 * @returns {{ group, dispose } | null}（headless 无画布 → null，纯视觉附件跳过即安）
 */
export function attachOrbs(unit, def = {}) {
  if (typeof document === 'undefined') return null;
  const { count = 3, color = 0xff8a3a, radius = 2.4, height = 3.2,
    size = 1.5, speed = 1.4, bob = 0.35 } = def;
  const group = new THREE.Group();
  group.name = 'orbs';
  const glowTex = glowTexture(color);
  const flameTex = flameTexture(color);
  const mk = (tex, opacity) => new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false,
    transparent: true, opacity, fog: false,
  }));
  const orbs = [];
  for (let i = 0; i < count; i++) {
    // 一团火 = { glow, flame, core, trail[3] }（全部 additive；材质逐件独立以便
    // heat/抖焰逐帧改 opacity，纹理共享缓存不逐件销）
    const glow = mk(glowTex, 0.5), flame = mk(flameTex, 0.95), core = mk(glowTex, 0.85);
    const trail = [mk(flameTex, 0.34), mk(flameTex, 0.2), mk(flameTex, 0.11)];
    for (const s of [glow, flame, core, ...trail]) group.add(s);
    orbs.push({ glow, flame, core, trail, ph: i * 1.37 }); // ph：各团去同步的初相
  }
  // 火光照明：一团跟一颗的均值走不如直接钉在轨道中心（三团共浴，Boss 正面受光）；
  // 量级按 Boss 房火炬（数百 + 物理衰减）口径，距离盖过轨道半径
  const light = new THREE.PointLight(color, 420, 46, 2);
  light.position.set(0, height, 0);
  group.add(light);
  group.userData.orbit = { radius, speed, size, height, bob, heat: 0 }; // 剧本可写参数（heat 0→1 整体升温）
  unit.add(group);
  unit.parts.set('orbs', group);
  let t = Math.random() * Math.PI * 2; // 相位随机：多单位带火球不同步转
  // 每颗自己的高度偏置（±1.2u 错层）：三颗同高会叠成一条线、且恰好被 Boss
  // billboard 全身挡死；错层后总有火球露在头顶/腰侧，绕体感才出得来
  for (let i = 0; i < orbs.length; i++) orbs[i].hOff = Math.sin(i * 2.1 + 0.7) * 2.2;
  const untick = unit.addTick((dt) => {
    const o = group.userData.orbit;
    t += dt * o.speed * (1 + o.heat * 0.35);
    group.visible = !unit._dead; // 宿主死亡：火球熄（不在尸体上转）
    const heat = o.heat ?? 0;
    for (let i = 0; i < orbs.length; i++) {
      const ob = orbs[i];
      const a = t + (i * Math.PI * 2) / orbs.length;
      // 双正弦叠加 ≈ 伪噪声抖焰（heat 抬幅度：狂暴态火苗乱窜）
      const fl = 1 + (0.09 + 0.1 * heat) * Math.sin(t * 17.3 + ob.ph * 9.1)
                   + (0.05 + 0.07 * heat) * Math.sin(t * 29.7 + ob.ph * 5.3);
      const sc = o.size * (1 + 0.12 * Math.sin(t * 3.3 + i * 1.7)) * fl * (1 + 0.22 * heat);
      const wob = Math.sin(t * 2.1 + i * 2.4) * o.bob;
      const x = Math.cos(a) * o.radius;
      const y = o.height + ob.hOff + wob;
      const z = Math.sin(a) * o.radius * 0.55; // 椭圆轨道（压扁纵深，绕体感）
      ob.glow.position.set(x, y + sc * 0.1, z);
      // 光晕收成"热空气"而不是主角（09-23 实拍：2.7 倍 + 0.4 不透明度下整颗读成
      // 红色气球，焰身的火苗轮廓全被洗掉）——焰身必须比光晕亮、比光晕高
      ob.glow.scale.set(sc * 2.0, sc * 2.0, 1);
      ob.glow.material.opacity = 0.26 + 0.16 * heat + 0.05 * fl;
      // 焰身锚点：sprite 中心对齐"焰心偏下"→ 位置略抬，视觉重心落在轨道点上
      ob.flame.position.set(x, y + sc * 0.32, z);
      ob.flame.scale.set(sc * 0.98, sc * 1.9, 1);
      ob.flame.material.opacity = 1;
      ob.flame.material.rotation = 0.1 * Math.sin(t * 12 + ob.ph * 7); // 火苗摆尾
      ob.core.position.set(x, y + sc * 0.1, z);
      ob.core.scale.set(sc * 0.46, sc * 0.46, 1);
      ob.core.material.opacity = 0.5 + 0.4 * heat;
      // 彗尾：滞后相位淡影（heat 拉开拖尾角距 = 转得越热尾越长）
      const lag = 0.16 + 0.14 * heat;
      for (let k = 0; k < ob.trail.length; k++) {
        const ta = a - lag * (k + 1);
        const tr = ob.trail[k];
        tr.position.set(
          Math.cos(ta) * o.radius,
          o.height + ob.hOff + Math.sin(t * 2.1 + i * 2.4 - lag * (k + 1)) * o.bob + sc * 0.3,
          Math.sin(ta) * o.radius * 0.55,
        );
        const tk = sc * (0.5 - k * 0.13);
        tr.scale.set(tk * 0.95, tk * 1.7, 1);
        tr.material.rotation = 0.12 * Math.sin(t * 10 + k * 2.2);
      }
    }
    light.intensity = (420 + 520 * heat) * (0.92 + 0.1 * Math.sin(t * 21.7)); // 火光呼吸
    light.position.y = o.height;
  });
  const dispose = () => {
    untick();
    unit.remove(group);
    unit.parts.delete('orbs');
    for (const ob of orbs) { // 每单位独立材质要销；纹理是 _texCache 共享，不销
      for (const s of [ob.glow, ob.flame, ob.core, ...ob.trail]) s.material.dispose();
    }
  };
  group.userData.dispose = dispose; // UnitObject.dispose 经此收尾（部件自检约定）
  return { group, dispose };
}
