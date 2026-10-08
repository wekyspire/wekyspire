// 粒子类型注册表（PARTICLE_SYSTEM_V2 §三）——类型 = 全局静态描述符，显存不随登记分配；
// 池在类型首次使用时才 bump 分段（懒注册），场景切换 pool.reset() 全释放。
// 两类粒子：
//   · uber（默认）：spawn/行为/终结/渲染全参数化，一条 dispatch 罩全池所有 uber 段；
//   · custom：desc.custom.build(ctx) 提供 JS→TSL 模块函数，独立编译独立 dispatch，
//     只管自己的段（uber dispatch 按类型行 kind 标志跳过 custom 段）。
// 字段只许尾部追加（L1 属性分块纪律），默认值集中在此文件。
//
// 描述符形状：
//   defineParticleType({
//     name, space: 'world' | 'ui', cap,
//     kind: 'uber' | 'custom',
//     spawn: { rate, ttl, ttlJit, vel, velJit, spread, gravity, drag, windK },
//     destination: null | { domainMode, steerDelay, steerRamp, steerK, arriveR, curveK },
//     endMode: 0 ttl | 1 arrive | 2 ttlOrArrive | 3 lingerAfterArrive,
//     progressMode: 0 ageProgress | 1 distanceProgress,
//     render: { size, sizeEndK, sizeMode, color, colorEnd, alpha, heat },
//     custom: { build(ctx) → { nodes: [] } },   // kind=custom 必填
//   })
//
// 目的地参数块（uber 能力，需求族 = 汇聚/流向/吸收）：
//   domainMode  0 随机填充 | 1 出生序均布填充 | 2 随机边缘 | 3 出生序均布边缘
//               （边缘 = 矩形周长 / 圆环；≥2 走边缘解释，奇数档走出生序均布）
//   steerDelay  出生多少秒后开始汇聚（= 爆散相位时长）
//   steerRamp   汇聚强度 0→1 渐入时长（秒）
//   steerK      汇聚速度（单位/秒）
//   arriveR     到达半径（endMode 1/2 死、3 驻留的判定距离）
//   curveK      侧向弯曲系数（初速垂直分量随汇聚进度衰减 → 弧线轨迹）
// spawn.radial：径向爆散初速（随机方向匀速爆开；与 vel 锥形基准叠加）
// 运行时锚点（出生锚/目的锚）不进类型行静态段——burst/持续发射调用时指定，
// 出生帧盖进粒子 payload（多 burst 并发指向不同锚点互不惊扰）。

/** 全局类型上限（每池行表 32，全局登记放宽到 64）。 */
export const PARTICLE_MAX_TYPES = 64;

const TYPES = [];

/**
 * 登记一个粒子类型，返回全局 typeId（喂给各池的 burst/setTypeActive/useType）。
 * 纯登记，不分配任何 GPU 资源。
 */
export function defineParticleType(desc = {}) {
  if (TYPES.length >= PARTICLE_MAX_TYPES) {
    throw new Error(`粒子类型登记超限（${PARTICLE_MAX_TYPES}）`);
  }
  const render = {
    size: 0.5, sizeEndK: 0.4, color: [1, 1, 1], colorEnd: null, alpha: 1, heat: 1,
    ageHeat: 0, // 随年龄衰减的亮度增益（燃烧火星类「新鲜更亮」用；0 = 关）
    softness: 1, // sprite 径向衰减指数（1 = 池缺省平底+边沿衰减；>1 = 中心亮缘更虚）
    sizeMode: 'prog', // 尺寸斜坡驱动：'prog' = progress 通道（uber 缺省）；'age' = 年龄
                     //（亮度与尺寸解耦用——progress 是亮度包络的类型（orbit 族）不得
                     //   让族亮/闪烁/level 泄漏进尺寸）
    alphaMode: 'out', // alpha 包络：'out' = 线性淡出（缺省）；'in' = 淡入20%再线性淡出
                     //（发射器类防满尺寸弹入）
    ...(desc.render || {}),
  };
  if (!render.colorEnd) render.colorEnd = [...render.color];
  const d = {
    name: desc.name ?? `type${TYPES.length}`,
    space: desc.space ?? 'world',
    cap: Math.max(1, desc.cap ?? 1024),
    kind: desc.kind ?? 'uber',
    spawn: {
      rate: 0, ttl: 1, ttlJit: 0.25, vel: [0, 1, 0], velJit: 0.5, spread: 0.2,
      gravity: 0, drag: 0, windK: 0, radial: 0, ...(desc.spawn || {}),
    },
    destination: desc.destination ? {
      domainMode: 0, steerDelay: 0, steerRamp: 0.2, steerK: 30, arriveR: 1.5, curveK: 0,
      ...desc.destination,
    } : null,
    // 有目的地时寿命降级为保险丝，终结默认 ttlOrArrive、进度默认距离口径
    endMode: desc.endMode ?? (desc.destination ? 2 : 0),
    progressMode: desc.progressMode ?? (desc.destination ? 1 : 0),
    render,
    custom: desc.custom ?? null,
  };
  if (d.kind === 'custom' && typeof d.custom?.build !== 'function') {
    throw new Error(`粒子类型 ${d.name}：kind=custom 必须提供 custom.build(ctx)`);
  }
  TYPES.push(d);
  return TYPES.length - 1;
}

/** 反查类型描述符（池分配时读静态参数）。 */
export function getParticleType(typeId) {
  return TYPES[typeId] ?? null;
}
