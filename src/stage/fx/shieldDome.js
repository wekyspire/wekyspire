// 护盾罩（L2 笼罩层，2026-10-02 v2 质量重做）：护盾不是一次性演出，是单位身上的
// **长久存在**的半透明能量罩——盾量在则罩在。v1 被判「过分廉价」（细灰弧线 + 无体积
// + 哑光），v2 的质量语言：
//   · 体积读法 = 四层叠印：锐利罩缘（HDR 推过 bloom 阈起辉，用户定：要辉光直接输出
//     HDR 色，不必另拉通道）+ 罩缘内侧宽晕（伪菲涅尔，读出曲面）+ 极淡罩内染色
//     （底亮顶淡 + 缓慢上流微光）+ 周期上扫的扫描线（能量盾的「活」感）；
//   · 落地读法 = 脚下水平地环（罩缘与地面的交线——v1「两根浮空弧线」廉价感的根治）；
//   · 厚度读法 = 盾越厚罩缘越凝实越亮（rim 的 alpha/HDR 双双随 level 走）。
// 生命周期四态（驱动见 UnitObject.setUnit 与伤害节拍 units.js）：
//   · 获得/加厚 → pulse()：亮锋自脚底扫上 + 罩缘一亮；
//   · 被攻击（盾未破）→ hit(fromRight)：罩缘着弹点闪光 + 涟漪自护盾边界向罩内扩散 +
//     罩缘整体一震亮；
//   · 自然消失（回合开始清零）→ vanish()：蒸发线自地升起、罩向上消散（慢、柔）；
//   · 被打破（吸收归 0）→ shatter(fromRight)：全罩白热爆闪 + 裂纹自罩缘着弹点炸开 +
//     冲击波环 + **碎成扇区错峰剥落**（碎片沿椭圆径向外抛下坠，位移在 positionNode）——
//     与自然消失的「蒸发上升」拉开读法（3D 碎粒另由 _shieldBreakFx 粒子承担）。
//     演完自清槽位（onGone）。
// 悬挂点纪律：罩面竖片挂 _standee（随姿态通道前倾/蜷缩——单位突进不带罩 = 人出罩
// 穿帮）；地环挂 _rig（假透视水平椭圆必须随 yaw 对准相机——长轴与立牌底边
// 平行才读「一圈环坐地上」，固定世界朝向会歪斜；rig 只 yaw 不 pitch 故仍贴地；
// 不挂 _standee 是不吃姿态通道——squash/lean 会把贴地环掀离地面）。
// TSL 纪律照 shaders.js 头注 + tsl-fn-pitfalls：颜色烘常量 vec3、smoothstep 正向、
// 多次引用的中间量一律 .toVar()（stasisShell 验证过的安全写法）、无控制流。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv, vec2, vec3, vec4,
  float, clamp, exp, sin, fract, smoothstep, oneMinus, atan, floor, abs, positionLocal,
} from 'three/tsl';
import { gsap } from 'gsap';

// ---- 可调参（视觉/手感数值的用户旋钮都在这段）----
const DOME_W_FACTOR = 1.32;   // 罩宽 = 本体牌宽 × 此系数
const DOME_H_FACTOR = 1.12;   // 罩高 = 立牌高 × 此系数
// 椭圆（uv 空间）：半径x / 心y / 半径y——心 y 上移（0.10）让罩读「蛋形裹人」
// 而非正半球坐地（2026-10-02 用户定）；底缘仍探出 quad 下边坐进脚线
const RX = 0.45, CY = 0.10, RY = 0.78;
const RIMK = 260.0;           // 罩缘带锐度（越大越细）
const RIM_BASE = 0.34, RIM_GAIN = 0.66; // 罩缘凝实度 = BASE + GAIN × level
const FILL_BASE = 0.025, FILL_GAIN = 0.045; // 罩内染色强度（宁薄勿厚——透过罩看得见人）
const GLOW_BASE = 0.10, GLOW_GAIN = 0.22;   // 罩缘内晕（伪菲涅尔）强度
const SHIELD_LEVEL_REF = 24;  // 盾量 → level 归一基准（此值即满凝实）
const MIN_LEVEL = 0.16;       // 1 点盾也要读得出罩存在
// 罩缘/地环角向「若隐若现」：三瓣亮弧随双频正弦游走，永不成完整闭环（用户定：
// 不搞完全闭合的罩子圆弧，边界若隐若现暗示存在即可）。谷底 = BASE + GAIN × level
//（盾越厚瓣越亮、谷越浅，但谷底封顶 BASE+GAIN——缺口恒在）
const ARC_VALLEY_BASE = 0.25, ARC_VALLEY_GAIN = 0.30;
const GROUND_VALLEY_BASE = 0.30, GROUND_VALLEY_GAIN = 0.25;
const ARC_DRIFT_A = 0.13, ARC_DRIFT_B = 0.09; // 双频游走速度（角向缺口缓慢转圈）
const PULSE_MS = 720;         // 获得扫光时长
const HIT_MS = 480;           // 受击涟漪时长
const HIT_Y = 0.55;           // 受击点高度（uv.y，罩面中上部）
// 受击点 x 锚在**罩缘**（椭圆 d=1）上：波纹自护盾边界向罩内扩散。锚在 quad 角落
// （0.93/0.07，d≈1.12 在罩外）会读成「从立牌纹理边缘泛起」（2026-10-10 用户指正）
const hitRimX = (fromRight) => 0.5 + (fromRight ? 1 : -1)
  * RX * Math.sqrt(Math.max(0, 1 - ((HIT_Y - CY) / RY) ** 2));
const VANISH_MS = 860;        // 自然消散时长
// 破碎 v2（2026-10-10 重做——旧版只有爆闪+淡出，与自然消失拉不开读法）：
// 裂纹炸开 → 冲击波 → 扇区错峰剥落（碎片外抛下坠）
const SHATTER_MS = 720;          // 破碎时长（扇区错峰要留出节奏）
const SHATTER_SECTORS = 7;       // 碎裂扇区数（奇数——碎片不规则）
const SHATTER_DEATH_LO = 0.10;   // 最早扇区开始剥落的时刻（时间线分数）
const SHATTER_DEATH_SPAN = 0.52; // 剥落时刻散布窗（最晚 0.10+0.52=0.62）
const SHATTER_FLIGHT = 0.38;     // 单扇区从脱离到飞尽的时长（时间线分数）

/** 盾量 → 罩强度（薄盾虚边、厚盾凝实）。 */
export function shieldDomeLevel(shield) {
  return Math.max(0, Math.min(1, Math.max(MIN_LEVEL, shield / SHIELD_LEVEL_REF)));
}

// 破碎扇区场：按椭圆角切 N 瓣，每瓣哈希出一个「剥落时刻」。detach = 该瓣脱离进度
// （0 未动 / 1 飞尽），pieceAlive / edgeFlash 供颜色节点、detach 供位移节点——
// **颜色与位移必须共用同一套**（两节点各自算 = 碎片飞着飞着颜色先没了，节拍漂移）。
function shatterSectorField(u) {
  const vUv = uv();
  const ev = vUv.sub(vec2(0.5, CY)).mul(vec2(1.0 / RX, 1.0 / RY)).toVar();
  const ang = atan(ev.y, ev.x).toVar();
  const sectorF = ang.mul(0.5 / Math.PI).add(0.5).mul(float(SHATTER_SECTORS)).toVar();
  const sectorId = floor(sectorF).toVar();
  const hash = fract(sin(sectorId.add(1.0).mul(12.9898)).mul(43758.5453)).toVar();
  const death = float(SHATTER_DEATH_LO).add(hash.mul(SHATTER_DEATH_SPAN)).toVar();
  const detach = clamp(u.uShatter.sub(death).div(float(SHATTER_FLIGHT)), 0.0, 1.0).toVar();
  const pieceAlive = oneMinus(detach).toVar();
  const edgeFlash = sin(clamp(u.uShatter.sub(death).div(0.10), 0.0, 1.0).mul(3.14159)).toVar();
  return { vUv, ev, ang, sectorF, sectorId, detach, pieceAlive, edgeFlash };
}

function buildDomeColorNode(u, tint, hot, mid) {
  return Fn(() => {
    const sec = shatterSectorField(u);   // ev/ang 与扇区项共用一份（见上方纪律）
    const vUv = sec.vUv;
    // 椭圆场：d=1 即罩缘
    const ev = sec.ev;
    const d = ev.length().toVar();
    const inside = oneMinus(smoothstep(0.90, 1.0, d)).toVar();
    const rim = exp(d.sub(1.0).mul(d.sub(1.0)).mul(-RIMK)).toVar();
    // 罩缘角向若隐若现掩码：三瓣亮弧双频慢漂游走——罩缘永不成完整闭环；
    // 谷底随 level 抬升（盾厚瓣亮谷浅）但封顶，缺口恒在。掩码作用于罩缘/
    // 内晕/扫描线/扫光（罩的「边界」语言全部断续化）；罩内染色是淡体积感，不参与
    const arcAng = sec.ang;
    const arcWave = sin(arcAng.mul(3.0).add(u.uTime.mul(ARC_DRIFT_A)))
      .mul(sin(arcAng.mul(2.0).sub(u.uTime.mul(ARC_DRIFT_B)).add(2.1)))
      .mul(0.5).add(0.5).toVar();
    const arcLo = float(ARC_VALLEY_BASE).add(u.uLevel.mul(ARC_VALLEY_GAIN)).toVar();
    const arcMask = arcLo.add(oneMinus(arcLo).mul(arcWave)).toVar();
    const glowIn = exp(d.sub(1.0).mul(d.sub(1.0)).mul(-22.0)).mul(inside).toVar(); // 伪菲涅尔内晕
    const groundFade = smoothstep(0.0, 0.045, vUv.y).toVar(); // 罩缘坐进脚线，不硬裁
    const shimmer = sin(vUv.y.mul(14.0).sub(u.uTime.mul(1.4))).mul(0.20).add(0.80).toVar();
    // 周期扫描线（能量盾的活感；fract 斜坡 0→1 映射到罩内 -0.15..1.15）
    const scanY = fract(u.uTime.mul(0.045)).mul(1.3).sub(0.15).toVar();
    const scan = exp(vUv.y.sub(scanY).mul(vUv.y.sub(scanY)).mul(-900.0)).mul(inside).toVar();
    // 获得扫光（pBoost 包络起落，首尾归零——否则脚底残留常亮带）。
    // 扫光「画出」罩体：swept 掩码让稳态项只在扫锋已过处显现（衔接 = 罩随扫光立起，
    // 不是瞬现全亮罩 + 无关亮带）；闲置 uPulse=0 时 duringPulse=0 掩码恒 1 零回归。
    const frontY = u.uPulse.mul(1.12).sub(0.06).toVar();
    const pBoost = sin(clamp(u.uPulse, 0.0, 1.0).mul(3.14159)).toVar();
    const band = exp(vUv.y.sub(frontY).mul(vUv.y.sub(frontY)).mul(-260.0))
      .mul(inside).mul(pBoost).toVar();
    const duringPulse = smoothstep(0.0, 0.02, u.uPulse).toVar();
    const swept = oneMinus(smoothstep(frontY.sub(0.02), frontY.add(0.14), vUv.y))
      .mul(duringPulse).add(oneMinus(duringPulse)).toVar();
    // 受击：罩缘着弹点闪光 + 涟漪自边界向罩内扩散。hitEnv 必须 sin 包络（首尾皆 0）——
    // (1-uHit)² 在闲置 uHit=0 时=1，涟漪项会恒成着弹点亮斑（实测穿帮）
    const rhit = vUv.sub(vec2(u.uHitX, float(HIT_Y))).length().toVar();
    const hitEnv = sin(clamp(u.uHit, 0.0, 1.0).mul(3.14159)).toVar();
    const ringR = u.uHit.mul(1.25).toVar();
    const ring = exp(rhit.sub(ringR).mul(rhit.sub(ringR)).mul(-260.0)).mul(inside).mul(hitEnv).toVar();
    // 着弹闪贴罩缘亮：乘轻度外扩的罩内掩码——闪光骑在护盾边界上，不溢到罩外/立牌外
    const flashMask = oneMinus(smoothstep(0.99, 1.10, d)).toVar();
    const flashP = exp(rhit.mul(rhit).mul(-30.0)).mul(hitEnv).mul(flashMask).toVar();
    // 自然消散：蒸发线自地升起 + 整体淡出（顶先走）
    const fadeGrad = oneMinus(u.uFade.mul(smoothstep(0.10, 0.95, vUv.y).mul(0.9))).toVar();
    const fadeAll = oneMinus(u.uFade).toVar();
    const evapY = u.uFade.mul(1.15).sub(0.075).toVar();
    const evap = exp(vUv.y.sub(evapY).mul(vUv.y.sub(evapY)).mul(-320.0))
      .mul(inside).mul(u.uFade).mul(fadeAll).mul(6.0).toVar();
    // 破碎 v2：与自然消失拉开读法——消失 = 蒸发上升整体淡出；破碎 = 裂纹自罩缘
    // 着弹点炸开 → 白热爆闪 + 冲击波环 → 扇区错峰剥落（边缘一亮后带残光熄灭，
    // 位移侧碎片外抛下坠）。shFlash 必须升沿起步（两段 smoothstep 夹峰）——
    // 单段 oneMinus(smoothstep(0,…,uShatter)) 在闲置 uShatter=0 时=1，
    // 全罩 rgb 恒乘爆闪系数 = 整罩恒过曝（实测 1/10 白罩病根）
    const shFlash = smoothstep(0.0, 0.06, u.uShatter)
      .mul(oneMinus(smoothstep(0.08, 0.30, u.uShatter))).toVar();
    const shFade = oneMinus(smoothstep(0.18, 0.90, u.uShatter)).toVar();
    // 裂纹：扇区边界放射线 + d≈0.55 同心裂环（玻璃炸裂读法；crackEnv 夹峰包络）
    const crackEnv = smoothstep(0.0, 0.10, u.uShatter)
      .mul(oneMinus(smoothstep(0.30, 0.60, u.uShatter))).toVar();
    const bd = abs(fract(sec.sectorF).sub(0.5)).toVar();   // 0=扇区中心 0.5=边界
    const crackLine = exp(bd.sub(0.5).mul(bd.sub(0.5)).mul(-1200.0)).mul(inside).toVar();
    const crackRing = exp(d.sub(0.55).mul(d.sub(0.55)).mul(-300.0)).mul(inside).toVar();
    // 冲击波环：自着弹点快速外扩（比受击涟漪更大更亮）
    const shockEnv = smoothstep(0.0, 0.02, u.uShatter)
      .mul(oneMinus(smoothstep(0.22, 0.42, u.uShatter))).toVar();
    const shockR = u.uShatter.mul(0.95).toVar();
    const shock = exp(rhit.sub(shockR).mul(rhit.sub(shockR)).mul(-160.0))
      .mul(inside).mul(shockEnv).toVar();
    // 合成（稳态项一律乘 swept——扫光期罩体只在扫锋已过处立起；破碎期一律乘
    // pieceAlive——扇区错峰熄灭，读「碎成片剥落」而非整体淡出；
    // 边界类项再乘 arcMask——断续的瓣状弧，读「有罩」而非「关着的蛋」）
    const solid = u.uLevel.mul(RIM_GAIN).add(RIM_BASE).toVar();
    const rimA = rim.mul(solid).mul(groundFade).mul(swept).mul(arcMask)
      .mul(pBoost.mul(0.9).add(hitEnv.mul(1.2)).add(sec.edgeFlash.mul(1.6)).add(1.0))
      .mul(sec.pieceAlive).toVar();
    const fillA = inside
      .mul(u.uLevel.mul(FILL_GAIN).add(FILL_BASE))
      .mul(oneMinus(vUv.y.mul(0.6)))
      .mul(shimmer).mul(groundFade).mul(swept)
      .mul(pBoost.mul(0.6).add(1.0)).mul(sec.pieceAlive).toVar();
    const glowA = glowIn.mul(u.uLevel.mul(GLOW_GAIN).add(GLOW_BASE)).mul(swept).mul(arcMask)
      .mul(sec.pieceAlive).toVar();
    const scanP = scan.mul(sec.pieceAlive).toVar();
    const bandP = band.mul(sec.pieceAlive).toVar();
    const white = vec3(1.0).toVar();
    const rgb = hot.mul(rimA.mul(u.uLevel.mul(1.3).add(0.9)))               // 罩缘 HDR（厚盾过阈起辉）
      .add(tint.mul(fillA))
      .add(mid.mul(glowA.mul(u.uLevel.mul(0.8).add(0.6))))
      .add(hot.mul(scanP.mul(arcMask).mul(0.25).mul(u.uLevel.mul(0.5).add(0.5)).mul(swept)))
      .add(hot.mul(bandP.mul(arcMask).mul(u.uLevel.mul(0.8).add(0.8))))
      .add(hot.mul(ring.mul(1.7)).add(hot.mul(flashP.mul(2.4))))           // 受击涟漪 + 着弹闪
      .add(hot.mul(evap.mul(1.5)))                                          // 蒸发亮线
      .add(hot.mul(shock.mul(2.0)))                                         // 破碎冲击波
      .add(white.mul(crackLine.add(crackRing)).mul(crackEnv).mul(1.8))      // 玻璃裂纹（白热）
      .add(white.mul(shFlash).mul(inside).mul(0.6))                         // 爆白白纱
      .toVar();
    const alpha = clamp(
      rimA.mul(0.9).add(fillA).add(glowA.mul(0.5))
        .add(scanP.mul(arcMask).mul(0.20)).add(bandP.mul(arcMask).mul(0.5))
        .add(ring.mul(0.7)).add(flashP.mul(0.9)).add(evap.mul(0.6))
        .add(shock.mul(0.5))
        .add(crackLine.mul(crackEnv).mul(0.4)).add(crackRing.mul(crackEnv).mul(0.3)),
      0.0, 1.0,
    ).toVar();
    // 全局生死系数：爆闪增亮 → 溃散/蒸发压没
    const live = fadeGrad.mul(fadeAll).mul(shFade).toVar();
    return vec4(
      rgb.mul(shFlash.mul(3.2).add(1.0)).mul(live),
      clamp(alpha.mul(live).add(shFlash.mul(inside).mul(0.55)), 0.0, 1.0),
    );
  })();
}

// 脚下地环（水平件）：罩缘与地面的交线——「落地」是罩子不廉价的关键读法之一。
// 同款角向若隐若现：地环断续成瓣、缓慢游走（与罩缘共用漂移频率、错开相位——
// 罩与地的接缝不连成闭合圈）
function buildGroundColorNode(u, tint, hot) {
  return Fn(() => {
    const vUv = uv();
    const q = vUv.sub(vec2(0.5, 0.5)).mul(2.0).toVar();
    const r = q.length().toVar();
    // 破碎：地环外扩爆散（半径随 uShatter 外推 + 震亮）——与罩体碎裂同拍；
    // 蒸发时地环只是淡出，两种消亡读法不同
    const ring0 = float(0.86).add(u.uShatter.mul(0.30)).toVar();
    const ring = exp(r.sub(ring0).mul(r.sub(ring0)).mul(-220.0)).toVar();
    const shFlashG = smoothstep(0.0, 0.06, u.uShatter)
      .mul(oneMinus(smoothstep(0.10, 0.35, u.uShatter))).toVar();
    const pool = exp(r.mul(r).mul(-3.0)).toVar(); // 环内极淡光池
    const breathe = sin(u.uTime.mul(1.1)).mul(0.15).add(0.85).toVar();
    // 受击震亮：sin 包络（闲置 uHit=0 时=0）——(1-uHit)² 反边形式闲置恒 1，
    // 地环常亮 1.8× 且受击时反而变暗（方向反了，2026-10-10 随受击返工一并修）
    const hitEnv = sin(clamp(u.uHit, 0.0, 1.0).mul(3.14159)).toVar();
    const fadeAll = oneMinus(u.uFade).mul(oneMinus(smoothstep(0.18, 0.90, u.uShatter))).toVar();
    const gAng = atan(q.y, q.x).toVar();
    const gWave = sin(gAng.mul(3.0).add(u.uTime.mul(ARC_DRIFT_A)).add(1.3))
      .mul(sin(gAng.mul(2.0).sub(u.uTime.mul(ARC_DRIFT_B)).add(3.4)))
      .mul(0.5).add(0.5).toVar();
    const gLo = float(GROUND_VALLEY_BASE).add(u.uLevel.mul(GROUND_VALLEY_GAIN)).toVar();
    const gMask = gLo.add(oneMinus(gLo).mul(gWave)).toVar();
    const ringHot = ring.mul(gMask).mul(u.uLevel.mul(0.8).add(0.8)).mul(breathe)
      .mul(hitEnv.mul(0.8).add(shFlashG.mul(2.4)).add(1.0)).toVar();
    const poolTint = pool.mul(u.uLevel.mul(0.20).add(0.10)).toVar();
    const rgb = hot.mul(ringHot).add(tint.mul(poolTint)).toVar();
    const alpha = clamp(
      ring.mul(gMask).mul(u.uLevel.mul(0.45).add(0.35)).add(pool.mul(0.10)),
      0.0, 1.0,
    ).mul(breathe).mul(fadeAll).toVar();
    return vec4(rgb, alpha);
  })();
}

/**
 * 建护盾罩（罩面竖片挂 _standee + 地环挂单位根；几何随 setArt 牌宽自愈重算）。
 * @param {UnitFxLayer} layer
 * @param {onGone} 消亡演出播完回调（调用方据此自清槽位）
 * @returns {{ group, dying, setLevel, pulse, hit, vanish, shatter, dispose } | null}
 */
export function makeShieldDome(layer, {
  tint = [0.45, 0.68, 1.05], hot = [0.85, 1.05, 1.45], onGone = null,
} = {}) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const bodyMesh = unit._body;
  const mid = tint.map((c, i) => c * 0.5 + hot[i] * 0.5); // 内晕色 = 主色热色对半
  const domeSize = () => {
    const bw = bodyMesh.geometry?.parameters?.width ?? unit._standeeHeight * 0.72;
    return { w: bw * DOME_W_FACTOR, h: unit._standeeHeight * DOME_H_FACTOR };
  };
  const u = {
    uLevel: uniform(0.0),
    uPulse: uniform(0.0),
    uHit: uniform(0.0),
    uHitX: uniform(hitRimX(true)),   // 受击点（罩面 uv.x，锚在罩缘上——见 hitRimX；敌在右缺省右侧）
    uFade: uniform(0.0),
    uShatter: uniform(0.0),
    uQuadW: uniform(1.0),   // 罩面 quad 宽/高（碎片位移的尺度源；tick 随 setArt 自愈）
    uQuadH: uniform(1.0),
    uTime: layer.body.uTime, // 共享 L0 的钟（多 uniform 共用一钟纪律）
  };
  const tintV = vec3(...tint), hotV = vec3(...hot), midV = vec3(...mid);

  const group = new THREE.Group();
  group.name = 'shieldDomeGroup';
  group.visible = false;
  // 罩面竖片（standee 局部，L2 z 槽位）。几何必须**分片**（24×24 段）：破碎期
  // positionNode 按扇区顶点位移让碎片分离——4 角面片的位移只是平面剪切，出不来碎片感
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = buildDomeColorNode(u, tintV, hotV, midV);
  mat.positionNode = Fn(() => {
    const sec = shatterSectorField(u);
    const fly = sec.detach.mul(sec.detach).toVar();   // ease-in：起飞慢后快
    const dir = sec.ev.div(clamp(sec.ev.length(), 0.08, 4.0)).toVar();  // 椭圆径向单位向量
    const offX = dir.x.mul(u.uQuadW).mul(fly).mul(0.42).toVar();
    const offY = dir.y.mul(u.uQuadH).mul(fly).mul(0.30)
      .sub(fly.mul(u.uQuadH).mul(0.50)).toVar();      // 外抛 + 下坠（重力感）
    return positionLocal.add(vec3(offX, offY, 0.0));
  })();
  mat.transparent = true; mat.depthWrite = false; mat.fog = false;
  const s0 = domeSize();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s0.w, s0.h, 24, 24), mat);
  mesh.name = 'shieldDome';
  mesh.position.set(bodyMesh.position.x, s0.h / 2, 0.8);
  mesh.renderOrder = 1;
  group.add(mesh);
  unit._standee.add(group);
  // 地环（挂 rig 组：水平假透视椭圆必须随 yaw 对准相机——长轴与立牌底边
  // 平行才读「一圈环坐地上」，固定世界朝向会歪斜（2026-10-02 用户指正的老问题，
  // 与目标标注金环同一修法）；rig 只 yaw 不 pitch，环 yaw 后仍贴地、尸体倾倒不掀环）
  const gMat = new MeshBasicNodeMaterial();
  gMat.colorNode = buildGroundColorNode(u, tintV, hotV);
  gMat.transparent = true; gMat.depthWrite = false; gMat.fog = false;
  const gMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(s0.w * RX * 2.3, s0.w * RX * 2.3 * 0.42), gMat);
  gMesh.name = 'shieldDomeGround';
  gMesh.rotation.x = -Math.PI / 2;
  gMesh.position.set(0, 0.14, 0.8);
  gMesh.renderOrder = 1;
  unit._rig.add(gMesh);

  let level = 0, dying = false;
  let tween = null;
  const killTween = () => { tween?.kill(); tween = null; };
  const untick = unit.addTick(() => {
    const busy = u.uPulse.value > 0.001 || u.uHit.value > 0.001 || dying;
    group.visible = (level > 0.005 || busy) && !unit._dead;
    gMesh.visible = group.visible;
    // 自愈：setArt 换牌宽 → 罩/环几何随体重算
    const { w, h } = domeSize();
    const gp = mesh.geometry.parameters;
    if (Math.abs(gp.width - w) > 0.01 || Math.abs(gp.height - h) > 0.01) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(w, h, 24, 24);
      mesh.position.y = h / 2;
      gMesh.geometry.dispose();
      gMesh.geometry = new THREE.PlaneGeometry(w * RX * 2.3, w * RX * 2.3 * 0.42);
    }
    u.uLevel.value = level;
    u.uQuadW.value = w;
    u.uQuadH.value = h;
  });
  const run = (uniformNode, ms, onDone) => {
    killTween();
    const st = { v: uniformNode.value };
    tween = gsap.to(st, {
      v: 1, duration: ms / 1000, ease: 'power2.out', overwrite: 'auto',
      onUpdate: () => { uniformNode.value = st.v; },
      onComplete: () => { uniformNode.value = 0; tween = null; onDone?.(); },
      onInterrupt: () => { uniformNode.value = 0; },
    });
  };
  // 消亡期被重新激活（消亡途中又获盾）：打断消亡、生死系数归零复活
  const revive = () => {
    if (!dying) return;
    dying = false; killTween();
    u.uFade.value = 0; u.uShatter.value = 0;
  };
  const die = (uniformNode, ms) => {
    if (dying) return;
    dying = true; killTween();
    const st = { v: 0 };
    tween = gsap.to(st, {
      v: 1, duration: ms / 1000, ease: 'power1.in', overwrite: 'auto',
      onUpdate: () => { uniformNode.value = st.v; },
      onComplete: () => { onGone?.(); },
    });
  };
  const dispose = () => {
    killTween();
    untick();
    group.parent?.remove(group);
    gMesh.parent?.remove(gMesh);
    mesh.geometry.dispose(); gMesh.geometry.dispose();
    mat.dispose(); gMat.dispose();
  };
  return {
    group,
    get dying() { return dying; },
    setLevel(l) { revive(); level = Math.max(0, Math.min(1, l)); },
    /** 获得/加厚：亮锋自脚底扫上 + 罩缘一亮。可重入。 */
    pulse() { revive(); u.uPulse.value = 0; run(u.uPulse, PULSE_MS); },
    /** 被攻击（盾未破）：fromRight = 攻击来自右侧（着弹点锚在罩缘对应侧）。 */
    hit(fromRight = true) { revive(); u.uHitX.value = hitRimX(fromRight); u.uHit.value = 0; run(u.uHit, HIT_MS); },
    /** 自然消失（回合清零）：蒸发线升起、向上消散。演完 onGone。 */
    vanish() { die(u.uFade, VANISH_MS); },
    /** 被打破（吸收归 0）：爆闪 + 裂纹 + 冲击波 + 扇区碎裂剥落。演完 onGone。 */
    shatter(fromRight = true) {
      if (dying) return;
      u.uHitX.value = hitRimX(fromRight);   // 裂纹/冲击波锚在致死那一击的着弹侧
      die(u.uShatter, SHATTER_MS);
    },
    dispose,
  };
}
