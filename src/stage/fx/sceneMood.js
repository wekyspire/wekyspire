// 场景级缓变参数中枢（2026-10-06 用户定架构）：场景级特效（曝光/色温冷暖/
// 压暗/相机微移/FOV 偏移）= **target scene config**，当前值每帧向 target 指数
// 趋近实现异步缓变；target 由**多个 modifier 堆叠**而成（pyro 场景演出、特殊卡
// 演出各自 push/pop，互不覆盖、自然加和）。
//
//   sceneMood.push('novaBlast', { warmth: 0.35, exposure: 1.18 }, { holdMs: 600 })
//   → 600ms 后自动 pop（或显式 pop）→ target 回落 → 画面缓回基线
//
// 字段合成规则：
//   · 加和字段（target = 基线 + Σ modifier）：warmth（-1..1 冷↔暖）、dim（0..1
//     压暗）、camX/camY/camZ（相机微移，世界单位）、fovAdd（度）
//   · 乘区字段（target = 基线 × Π modifier）：exposure（>1 提亮）
// 应用链（StageManager tick 每帧一次，渲染前）：
//   · warmth/dim/exposure → 两个终段 pass 共享的 grade uniform（线性 HDR 段乘算，
//     在帧末 tone map 之前——比后置 tint 干净，且不碰 renderer.toneMappingExposure
//     这个全帧共享状态「常驻设定」口径）
//   · camX/Y/Z → CameraDirector.setOffset('sceneMood')（叠加偏移通道——与受击
//     震荡/推镜天然可加和）
//   · fovAdd → CameraDirector.setFovOffset('sceneMood')（对称的 FOV 偏移通道）
// 缓变速度：默认 k≈4.2/s（指数趋近，~0.6s 走完 92%）；逐 modifier 可覆写。
import * as THREE from 'three';
import { uniform } from 'three/tsl';

// 两链终段共享的 grade（rgb 乘子，缺省恒 1）——uiComposer / volumetricMoon 的
// final pass 都接这一个 uniform 实例（passes.js 的 tslFinal* 第 4 参）
export const uSceneGrade = uniform(new THREE.Vector3(1, 1, 1));

const _base = { warmth: 0, dim: 0, exposure: 1, camX: 0, camY: 0, camZ: 0, fovAdd: 0 };
const _mods = new Map();          // id -> { values, speed, until, next }
const _cur = { ..._base };        // 当前值（每帧向 target 趋近）
const _tgt = { ..._base };        // 本帧 target（Σ modifier）

function _recompute(now) {
  for (const k of Object.keys(_tgt)) _tgt[k] = _base[k];
  let expMul = _base.exposure;
  let speed = 4.2;
  for (const [id, m] of [..._mods]) {
    if (m.until != null && now >= m.until) { _mods.delete(id); continue; }
    if (m.next) { // 延迟入场的第二段（如「闪后转暖」）：到期切换 values
      if (now >= m.next.at) { m.values = m.next.values; m.next = null; }
    }
    _tgt.warmth += m.values.warmth ?? 0;
    _tgt.dim += m.values.dim ?? 0;
    _tgt.camX += m.values.camX ?? 0;
    _tgt.camY += m.values.camY ?? 0;
    _tgt.camZ += m.values.camZ ?? 0;
    _tgt.fovAdd += m.values.fovAdd ?? 0;
    expMul *= m.values.exposure ?? 1;
    if (m.speed != null) speed = Math.max(speed, m.speed);
  }
  _tgt.exposure = expMul;
  _tgt.dim = Math.min(0.85, Math.max(0, _tgt.dim));
  _tgt.warmth = Math.max(-1, Math.min(1, _tgt.warmth));
  return speed;
}

/**
 * push/refresh 一路 modifier（同 id 再 push = 原地覆写值并续期）。
 * @param {string} id 稳定 id（演出名）
 * @param {object} values 字段子集
 * @param {object} [opts] { holdMs?：到时自动 pop；speed?：缓变趋近速率(1/s)；
 *   next?：{ at: performance.now()+ms, values }——到期把本路 values 切到新值
 *   （「先闪后暖」这类两段式用） }
 */
export function push(id, values = {}, opts = {}) {
  const now = (typeof performance !== 'undefined') ? performance.now() : 0;
  const prev = _mods.get(id);
  _mods.set(id, {
    values: { ...values },
    speed: opts.speed,
    until: opts.holdMs != null ? now + opts.holdMs : null,
    next: opts.next ? { at: now + opts.next.delayMs, values: { ...opts.next.values } } : (prev?.next ?? null),
  });
}

/** pop 一路 modifier（target 即刻回退，画面按当前速率缓回）。 */
export function pop(id) { return _mods.delete(id); }

/** 基线（房间/舞台档位）：战斗进出场换基调用。 */
export function setBase(partial) { Object.assign(_base, partial); }

/** 全清（舞台 dispose——modifier 不许漏给下一舞台）。 */
export function resetMood() { _mods.clear(); Object.assign(_base, { warmth: 0, dim: 0, exposure: 1, camX: 0, camY: 0, camZ: 0, fovAdd: 0 }); }

/** 当前值只读快照（调试/断言用）。 */
export function currentMood() { return { ..._cur }; }

/**
 * 每帧推进（StageManager tick 在 cameraDirector.commit 之前调）：向 target 指数
 * 趋近 + 把结果写到 grade uniform 与相机偏移通道。
 * @param {number} dt 秒
 * @param {object} director 相机导演（可缺——node 侧/无舞台时只推 grade）
 */
export function tickSceneMood(dt, director = null) {
  const now = (typeof performance !== 'undefined') ? performance.now() : 0;
  const speed = _recompute(now);
  const k = 1 - Math.exp(-(speed || 4.2) * Math.max(dt, 0));
  for (const key of Object.keys(_cur)) _cur[key] += (_tgt[key] - _cur[key]) * k;
  // grade：曝光 × (1-dim) × 冷暖偏置（暖 = R 升 B 降；线性 HDR 段乘算）
  const gain = Math.max(0, _cur.exposure) * (1 - _cur.dim);
  const w = _cur.warmth;
  uSceneGrade.value.set(gain * (1 + w * 0.16), gain * (1 + Math.abs(w) * 0.015), gain * (1 - w * 0.16));
  if (director) {
    director.setOffset('sceneMood', _cur.camX, _cur.camY, _cur.camZ);
    director.setFovOffset?.('sceneMood', _cur.fovAdd);
  }
}
