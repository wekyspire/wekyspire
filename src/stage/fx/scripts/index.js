// 剧本注册表（fx 架构「剧本」筐，2026-09-22 Phase 3）：
// 一文件一剧本，显式装配（不用 import.meta.glob——与 core 内容注册表同律）。
//   bosses/     Boss 转阶段/特殊战斗演出（core 经 presenter.playScript 触发）
//   cutscenes/  幕间/事件编排（cutscene 播放器直调，不经 core）
//   cameras/    跨战斗复用的相机行为（内容归属原则：Boss 专属机位跟 Boss 剧本同文件）
// 剧本签名：async (sctx) => {}；sctx = {
//   ctx        协程原语（tween/custom/wait/waitEvent/spawn/onKill，见 fx/script.js）
//   args       core 侧透传的标量参数（unit 等一律 uniqueID 标量，wire 可序列化）
//   cast       命名寻址注册表（unit:<uniqueID> / role:player / prop:* / light:*）
//   particles / shake / vignette   舞台 FX 服务
//   camera     CameraDirector（flyTo/pushOverride；Boss 专属机位写本文件 poses）
//   notify     PCG 道具单向事件口（fx/notify.js）
//   onStageDispose(fn)  舞台寿命钩子——**常驻**效果（场景覆写/emitter/烧痕）的收尾
//              挂这里；ctx.onKill 在剧本正常收尾也会触发，挂它会误收常驻演出
//   unitById(uniqueID) → UnitObject|null（多部件寻址：unit.parts.get(key) ?? unit，
//              或 unit.partOrRoot(key) 回落根）
// }
// 节拍语义：ANIM_SCRIPT 是阻塞节拍——剧本跑完才 finish；未知 id 静默回落收拍（不炸队列）。
import { registerPyroScripts } from './bosses/pyro.js';
import { registerKardasScripts } from './bosses/kardas.js';
import { registerMefm1Scripts } from './bosses/mefm1.js';

const REG = new Map();

export function registerScript(id, fn) {
  if (REG.has(id)) console.warn(`[fx/scripts] 剧本重名覆盖：${id}`);
  REG.set(id, fn);
  return fn;
}

export function getScript(id) { return REG.get(id) ?? null; }
export function hasScript(id) { return REG.has(id); }

// ---- 显式装配 ----
registerPyroScripts(registerScript);
registerKardasScripts(registerScript);
registerMefm1Scripts(registerScript);
