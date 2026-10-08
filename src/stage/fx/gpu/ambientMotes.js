// 环境飘浮粒子桥（spawnEmitter 全量迁 GPU 的承载件，2026-10-07）：旧 floatFx
// spawnEmitter 的替代（该路径 WebGPU 下渲染件坏死，且违反 CPU/GPU 分工铁律，
// 见 AGENTS）。消费者零改动：burstFacade.spawnEmitter 转接到本桥，handle 语义
// 原样（rate 可直写/可 gsap 补间、stop 幂等、setPosition 改位）。
// 实现 = **每发射器一个 uber 类型**（全走类型行既有字段——颜色/尺寸/速度/锥形
// 抖动/重力/风——零新 shader 面）：rate 语义 = 类型行 rate=1 × rateScale=handle.rate；
// 位置 = spawnPos 逐帧同步（setPosition/建位）；spread 盒抖动近似旧 radius 圆盘 +
// zJitter 纵深；outward 环向发射走 radial。风场天然同源（windK）。
// ⚠ 类型行预算：每 handle 独占一行（位置互异不可共享），并发上限 16 +
// burst/场景/环绕等 ≈ 28 < 32/池——新增常驻发射器大户时核对预算。
// 弃案存档（2026-10-07 两轮实测）：单 custom 类型 + uniform/storage 发射器参数表
// 均不可行——TSL 不支持 uniform(数组)（NodeBuilder 抛「Uniform "null" not
// implemented」且同步抛在帧内打死 rAF）；storage 表 CPU 写 needsUpdate 后 shader
// 读回仍全零（分区表零 → 发射器槽落空 → ttl 兜底 0.05s 即死）。
import * as THREE from 'three';
import { defineParticleType } from './particleTypes.js';

export const MAX_AMBIENT_EMITTERS = 16;   // 并发发射器上限（≈类型行预算的 ambient 份额）

export function createAmbientEmitterBridge(pool, getCamera = null) {
  if (!pool) return null;
  const emitters = [];   // handle 记账（stop 即摘 + 关发射）
  let seq = 0;
  // 旧 floatFx 点径口径换算（2026-10-07 用户定「巨大化」根因修复）：floatFx 的
  // gl_PointSize 公式 = size × (半高/视深)——**无 proj 因子**；GPU 池的世界单位
  // 口径 = size × proj11 × (半高/视深)。两条约定差 proj11（fov24 ≈ 4.7 倍），
  // 存量发射器数值（咏唱主题/Boss 尾巴）全部按旧口径写——在桥里一次性换算，
  // 调用方数值语义不动。proj11 **逐次实读不缓存**：首次调用可能撞上施术压迫谱
  // 的临时 fov 或相机未就绪，一次缓存会把瞬时值焊死（兜底 2.75 vs fov24 的 4.7
  // = 永久 1.7× 过大——「咏唱大粒子」病灶之一）。读取开销可忽略（每次 spawn 才调）。
  const projFactor = () => {
    const e5 = getCamera?.()?.projectionMatrix?.elements?.[5];
    return (typeof e5 === 'number' && e5 > 0.1) ? e5 : 2.75;   // 缺省按 fov40
  };

  return {
    spawnEmitter(x, y, options = {}) {
      if (emitters.length >= MAX_AMBIENT_EMITTERS) {
        console.warn('[ambientMotes] 发射器槽满（16），静默丢弃');
        return { rate: 0, stopped: true, stop() {}, setPosition() {} };
      }
      const c = new THREE.Color(options.color ?? 0xff5533);
      const z = options.z ?? 0;
      const o = {
        radius: options.radius ?? 0,
        zJitter: options.zJitter ?? 0,
        outward: !!options.outward,
        speed: options.speed ?? 20,
        vbx: options.vbx ?? 0,
        vby: options.vby ?? 0,
        ttl: options.ttl ?? 0.55,
        ttlJit: options.ttlJit ?? 0.3,
        gravity: options.gravity ?? -30,
        size: options.size ?? 1.2,
      };
      const typeId = defineParticleType({
        name: `ambient${seq++}`,
        space: 'world',
        cap: 256,
        // render.size 已换算为池世界单位（旧口径 ÷ proj11）
        // rate=1 × rateScale：handle.rate 即每秒发射数（可逐帧直写/补间）
        spawn: {
          rate: 1, ttl: o.ttl, ttlJit: o.ttlJit,
          vel: [o.vbx, o.vby, 0],
          velJit: o.outward ? 0 : o.speed,          // 全向锥形抖动 ≈ 旧方向窗采样
          radial: o.outward ? o.speed : 0,          // 环向发射（热浪环）：径向匀速 + vby 升
          spread: Math.max(o.radius, o.zJitter),    // 盒抖动近似圆盘 + 纵深
          gravity: o.gravity, drag: 0, windK: 1.0,
        },
        render: {
          size: o.size / projFactor(), sizeEndK: 1.0,
          // 淡入 20% + 线性淡出：发射器类粒子不许满尺寸弹入（「凭空出现」病灶）
          alphaMode: 'in',
          color: [c.r, c.g, c.b], alpha: 0.85, heat: 0.5, ageHeat: 0.6, softness: 1,
        },
      });
      const handle = {
        x, y, rate: options.rate ?? 12, stopped: false, _typeId: typeId, _z: z,
        stop() { handle.stopped = true; },   // 幂等：update 泵到即摘
        setPosition(nx, ny) { handle.x = nx; handle.y = ny; },
      };
      emitters.push(handle);
      pool.setTypeSpawnPos(typeId, x, y, z);
      pool.setTypeActive(typeId, 1);
      pool.setTypeRateScale(typeId, handle.rate);
      return handle;
    },

    update() {
      for (let i = emitters.length - 1; i >= 0; i--) {
        const h = emitters[i];
        if (h.stopped) {
          pool.setTypeActive(h._typeId, 0);   // 在飞粒子自然活到 ttl
          emitters.splice(i, 1);
          continue;
        }
        // 逐帧同步：rate（外部可直写/补间）与发射点（setPosition/建位；z 建时恒定）
        pool.setTypeRateScale(h._typeId, h.rate);
        pool.setTypeSpawnPos(h._typeId, h.x, h.y, h._z);
      }
    },

    get count() { return emitters.length; },
  };
}
