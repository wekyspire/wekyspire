// 骑士火流环绕件（咏唱场景演出的单位侧成员）：N 道完整火环带绕宿主单位螺旋排布——
// 每道 = 竖直圆环带（开口圆柱侧壁）+ 沿环滚动的火焰纹理（纹理滚动即火流），
// 「他在操控这团火」的读感锚点。
// 注意：sprite 火舌方案已废弃——条带绕到正前/正后时速度扎进屏幕、透视缩成正点
// （验收「条带塌缩成短划痕/孤立点」的病根）；完整环带没有端点、任何角度连续，
// 且后壁被立牌裁、前壁盖上（depthTest 保留），天然读出「环绕」而非「贴图」。
// 包络驱动：setLevel(k) 推 0..1（透明度/半径/滚动转速同随），管理器每帧 update(dt)。
import * as THREE from 'three';

// 沿环无缝拼接的火焰舌纹理：横向数朵斜向火舌（倾向 = 流向，静态帧也读得出旋转
// 方向）；每朵 wrap 三份绘制保左右缘无缝（RepeatWrapping 滚动）；纵向中心旺、
// 上下缘渐隐（发光面片边缘熄灭 mask 铁律——直边会穿帮成硬切条）
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const W = 512, H = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tongues = 6;
  for (let i = 0; i < tongues; i++) {
    const x0 = (i / tongues) * W + Math.random() * 30;
    const len = 90 + Math.random() * 80;
    const lean = 14 + Math.random() * 10;                      // 斜向 = 流向可读
    const hgt = 0.5 + Math.random() * 0.4;                     // 纵向占比
    for (const ox of [x0 - W, x0, x0 + W]) {
      const grad = g.createLinearGradient(ox, 0, ox + len, -lean);
      grad.addColorStop(0, 'rgba(255,90,20,0)');
      grad.addColorStop(0.45, 'rgba(255,140,50,0.55)');
      grad.addColorStop(0.8, 'rgba(255,215,150,0.95)');
      grad.addColorStop(1, 'rgba(255,250,235,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(ox + len / 2, H / 2, len / 2, H * 0.5 * hgt, -lean / 120, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 纵向边缘熄灭（上/下 22% 渐隐）
  const mask = g.createLinearGradient(0, 0, 0, H);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.22, 'rgba(0,0,0,1)');
  mask.addColorStop(0.78, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = mask;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  _ringTex = new THREE.CanvasTexture(c);
  _ringTex.colorSpace = THREE.SRGBColorSpace;
  _ringTex.wrapS = THREE.RepeatWrapping;
  return _ringTex;
}

/**
 * 创建火流环绕件。
 * @param {object} opts
 *   scene: 宿主场景（世界空间）
 *   anchor: () => ({ x, y, z, H } | null) —— 宿主锚（单位脚底位置 + 立牌高）
 */
export function createChantOrbit({ scene, anchor }) {
  const group = new THREE.Group();
  group.name = 'chantOrbit';
  group.visible = false;
  scene.add(group);

  const rings = [];   // { mesh, mat, tex, yFrac, wob, phase, scroll }
  let level = 0;
  let t = 0;
  let cfg = { count: 3, radius: 5.8, speed: 2.9, size: 6.4, heat: 1 };

  function rebuild() {
    for (const rg of rings) {
      group.remove(rg.mesh);
      rg.mesh.geometry.dispose();
      rg.mat.dispose();
      rg.tex.dispose();
    }
    rings.length = 0;
    for (let i = 0; i < cfg.count; i++) {
      // 每环克隆纹理 = 独立滚动相位（共享画布，显存只一份图）
      const tex = ringTexture().clone();
      tex.needsUpdate = true;
      tex.repeat.x = 2;
      const r = cfg.radius * (0.9 + (i % 2) * 0.14 + Math.random() * 0.08);
      const w = cfg.size * 0.5 * (0.8 + Math.random() * 0.4);      // 环带竖直厚度
      const geo = new THREE.CylinderGeometry(r, r, w, 48, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      // HDR 染色：火焰舌亮部乘算推过 bloom 阈（内容色 ≤1、发光件乘算过阈的约定）
      mat.color.setRGB(2.2 * cfg.heat, 0.95 * cfg.heat, 0.38 * cfg.heat);
      mat.opacity = 0;
      const mesh = new THREE.Mesh(geo, mat);
      // 微倾角破同心规整（全同轴的圆环叠起来读作「弹簧线圈/泳圈」——验收打磨项）
      mesh.rotation.x = (Math.random() - 0.5) * 0.12;
      mesh.rotation.z = (Math.random() - 0.5) * 0.12;
      group.add(mesh);
      // 垂向螺旋：各环分到自脚边至头顶上的固有高度道（均布 + 抖动）
      const lane = cfg.count > 1 ? i / (cfg.count - 1) : 0.5;
      rings.push({
        mesh, mat, tex,
        yFrac: 0.15 + lane * 0.78 + (Math.random() - 0.5) * 0.04,  // 立牌高分数
        wob: 0.018 + Math.random() * 0.02,                         // 道内起伏幅
        phase: Math.random() * Math.PI * 2,
        // 火焰沿环线速 ≈ speed×r；环周 2πr 含 repeat.x 个纹理周期 → uv/秒
        scroll: cfg.speed * (0.26 + Math.random() * 0.12),
      });
    }
  }

  /** 形态参数（环数/半径/流速/厚度/温度色），等阶包络的静态半（点火时设一次）。 */
  function setParams(p) {
    const next = { ...cfg, ...p };
    const shapeChanged = next.count !== cfg.count || next.size !== cfg.size;
    cfg = next;
    if (shapeChanged || rings.length === 0) rebuild();
    else {
      // 非形态变化：半径/流速/色在线推（不重建——重建会闪没整组环）
      for (const rg of rings) {
        rg.scroll = cfg.speed * (0.26 + Math.random() * 0.12);
        rg.mat.color.setRGB(2.2 * cfg.heat, 0.95 * cfg.heat, 0.38 * cfg.heat);
      }
    }
  }

  /** 包络 0..1：透明度/半径/转速同随（0 = 全隐停泵）。 */
  function setLevel(k) {
    level = k;
    group.visible = k > 0.01;
  }

  function update(dt) {
    if (!group.visible) return;
    const a = anchor();
    if (!a) { group.visible = false; return; }   // 宿主没了（离场/假死）——隐去等下帧
    t += dt;
    group.position.set(a.x, a.y, a.z);
    const rk = 0.6 + 0.4 * level;                // 半径随包络收放（起 = 环从体边荡开）
    const opaK = 0.35 + 0.65 * level;            // 低包络保可见度底（C 档也读得出环带）
    for (const rg of rings) {
      rg.tex.offset.x -= rg.scroll * (0.4 + 0.6 * level) * dt;
      // 椭圆呼吸破规整（半径两轴各自微幅脉动——完美圆环几何感太强）
      const bx = 1 + 0.05 * Math.sin(t * 1.3 + rg.phase);
      const bz = 1 + 0.05 * Math.sin(t * 1.1 + rg.phase * 2);
      rg.mesh.scale.set(rk * bx, 1, rk * bz);
      rg.mesh.position.y = a.H * (rg.yFrac + rg.wob * Math.sin(t * 1.9 + rg.phase));
      // 每环独立闪烁 × 包络（火不是恒亮管）
      const fl = 0.78 + 0.3 * Math.sin(t * 7.5 + rg.phase * 5);
      rg.mat.opacity = Math.min(1, opaK * fl * 0.85);
    }
  }

  function dispose() {
    for (const rg of rings) {
      group.remove(rg.mesh);
      rg.mesh.geometry.dispose();
      rg.mat.dispose();
      rg.tex.dispose();
    }
    rings.length = 0;
    scene.remove(group);
  }

  return { setParams, setLevel, update, dispose, group };
}
