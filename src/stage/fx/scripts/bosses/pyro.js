// Boss 剧本：燃焰术士（pyro）。一只 Boss 的全部自定义演出聚合在本文件（内容归属原则）。
// 触发点见 core enemies.js pyro act（转段拍经 presenter.playScript 上报 id）。

// 转阶段「燃躯解放」（转段首拍空转 = 本剧本，约 1.7s 阻塞节拍）：
//   蓄力（~0.9s）：下蹲吸气（纵向压扁）+ 火星缭绕（慢速低粒度火花五连）+ 轻震荡铺垫
//   爆发（~0.55s）：闪橙 + 三环火星爆开（主橙/亮白/暗红大颗粒）+ 重震荡 + 渐晕 + 过冲回弹
// 自燃披风（全场燃烧7）在下一拍由 act 结算——aura 系统经状态同步自动点燃，本剧本不管。
async function pyroP2({ ctx, args, particles, shake, vignette, unitById }) {
  const unit = unitById(args.unit);
  if (!unit) return; // 快照缺失兜底：静默收拍
  const id = unit.uniqueID;
  const ux = unit.position.x;
  const uy = unit.position.y;
  const uz = unit.position.z;
  const s = unit._baseScale ?? 1;

  // —— 蓄力：火星缭绕（并行子本，~0.8s 放完即自然收）——
  ctx.spawn(async (c) => {
    for (let i = 0; i < 5; i++) {
      particles.spawn(ux, uy + 2, { count: 6, color: 0xff8c3a, speed: 4, ttl: 0.7, size: 1.0, z: uz });
      await c.wait(160);
    }
  });
  shake.impulse(0.4);
  // 下蹲吸气：压得慢（power2.in 越压越急——「绷住」）
  await ctx.custom(id, {
    durationMs: 900, ease: 'power2.in',
    onUpdate: (t) => unit.scale.set(s * (1 - 0.12 * t), s * (1 - 0.3 * t), 1),
  });

  // —— 爆发 ——
  unit.flash?.(0xff7a30);
  particles.spawn(ux, uy + 2, { count: 26, color: 0xff6a3d, speed: 26, size: 1.8, z: uz });
  particles.spawn(ux, uy + 2, { count: 16, color: 0xffd9a0, speed: 36, ttl: 0.7, size: 1.2, z: uz });
  particles.spawn(ux, uy + 2, { count: 10, color: 0xc23a1a, speed: 16, ttl: 1.1, size: 2.2, z: uz });
  shake.impulse(6);
  vignette.pulse(2.5);
  // 过冲弹起（0.82/0.70 → 1.15）再回稳，终态硬化到 _baseScale（防 reconcile 前的残形）
  await ctx.custom(id, {
    durationMs: 220, ease: 'power3.out',
    onUpdate: (t) => unit.scale.set(s * (0.88 + 0.27 * t), s * (0.70 + 0.45 * t), 1),
  });
  await ctx.custom(id, {
    durationMs: 320, ease: 'power2.out',
    onUpdate: (t) => { const k = 1.15 - 0.15 * t; unit.scale.set(s * k, s * k, 1); },
  });
  unit.scale.set(s, s, 1);
  unit.restoreColor?.();
}

export function registerPyroScripts(register) {
  register('bosses/pyroP2', pyroP2);
}
