// Boss 剧本：燃焰术士（pyro）。一只 Boss 的全部自定义演出聚合在本文件（内容归属原则）。
// 触发点见 core enemies.js pyro act（转段拍经 presenter.playScript 上报 id）。
import { materialOf } from '../../../scenes/kit/materials.js';
import { attachCharBurn, resetCharBurn } from '../../charBurn.js';

// 转阶段「燃躯解放」（转段首拍空转 = 本剧本，约 1.7s 阻塞节拍）：
//   蓄力（~0.9s）：下蹲吸气（纵向压扁）+ 火星缭绕（慢速低粒度火花五连）+ 轻震荡铺垫
//   爆发（~0.55s）：闪橙 + 三环火星爆开（主橙/亮白/暗红大颗粒）+ 重震荡 + 渐晕 + 过冲回弹
//   场景覆写（爆发瞬间点火，常驻到战斗结束——三级覆写阶梯的 L1/L2 运行时形态）：
//     ① 相机 override 压栈：推近 + 俯角降低（后续 cutscene 可再压栈，pop 自动还原；
//        战斗结束由舞台 dispose 清栈兜底）
//     ② 光照转红亮：cast light:* 枚举到的灯一起提强度、染暖红
//     ③ 木质品烧毁&烧黑：charBurn modifier 挂上族单例 M.wood（合批/活件一视同仁），
//        uChar 烧黑先行、uBurn 格块侵蚀+余烬边随后；族单例进程级共享，归零锚舞台寿命
//     ④ 场景余烬：火盆口 + 战线上空 emitter 渐升（锚舞台寿命停发）
//     ⑤ 环绕火球狂暴：部件寻址 unit.parts('orbs')，轨道半径/转速/尺寸直推
// 常驻效果一律挂 onStageDispose（不是 ctx.onKill——onKill 在剧本正常收尾也会触发，
// 会把刚点着的常驻演出当场收掉）。自燃披风（全场燃烧7）下一拍由 act 结算——
// aura 系统经状态同步自动点燃，本剧本不管。
async function pyroP2({ ctx, args, cast, particles, shake, vignette, camera, onStageDispose, unitById }) {
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

  // —— 场景覆写 ①：相机推近 + 俯角降低（P2 常驻机位）——
  camera?.pushOverride?.('pyroP2', {
    poses: { pyroP2: { position: { x: 0, y: 12, z: 130 }, lookAt: { x: -4, y: -4, z: -40 } } },
    onEnter: (dir) => { dir.flyTo('pyroP2', { durationMs: 900 }); }, // fire-and-forget：飞行与爆发并行
  });

  // —— 场景覆写 ②：光照转红亮（全灯提强度 + 染暖红，1.2s 渐变）——
  ctx.spawn(async (c) => {
    const jobs = [];
    for (const { handle } of cast.query('light:')) {
      if (!handle?.isLight) continue; // light:root 门面跳过
      jobs.push(c.tweenRaw(handle, { intensity: handle.intensity * 1.45 }, { durationMs: 1200 }));
      const col = handle.color;
      if (col) jobs.push(c.tweenRaw(col, { r: col.r + (1.0 - col.r) * 0.5, g: col.g * 0.55, b: col.b * 0.5 }, { durationMs: 1200 }));
    }
    await Promise.all(jobs);
  });

  // —— 场景覆写 ③：木质品烧毁&烧黑（modifier shader 挂族单例 wood）——
  const charRec = attachCharBurn(materialOf('wood'));
  onStageDispose?.(() => resetCharBurn(charRec)); // 族单例跨场景共享，归零防漏场
  ctx.spawn(async (c) => {
    await c.tweenRaw(charRec.uChar, { value: 0.85 }, { durationMs: 1600 });
    await c.tweenRaw(charRec.uBurn, { value: 0.55 }, { durationMs: 2400 });
  });

  // —— 场景覆写 ④：场景余烬（火盆口 + 战线上空，rate 渐升）——
  for (const { handle } of cast.query('prop:brazierFire')) {
    const p = handle.object?.position;
    if (!p) continue;
    const em = particles.spawnEmitter(p.x, p.y + 2.5, {
      rate: 0, radius: 2.2, color: 0xff7a30, speed: 5, ttl: 1.6, size: 1.1, gravity: 3, z: p.z,
    });
    if (!em) continue;
    onStageDispose?.(() => em.stop());
    ctx.spawn(async (c) => { await c.tweenRaw(em, { rate: 14 }, { durationMs: 1800 }); });
  }
  for (const [ex, ez] of [[-10, -20], [8, -35]]) { // 战线中轴上空再飘两团
    const em = particles.spawnEmitter(ex, 6, {
      rate: 0, radius: 6, color: 0xff8a3a, speed: 4, ttl: 2.2, size: 1.0, gravity: 2.5, z: ez,
    });
    if (!em) continue;
    onStageDispose?.(() => em.stop());
    ctx.spawn(async (c) => { await c.tweenRaw(em, { rate: 10 }, { durationMs: 2200 }); });
  }

  // —— 场景覆写 ⑤：环绕火球狂暴（多部件寻址：轨道参数公开可写，直推即演出）——
  const orbit = unit.parts?.get('orbs')?.userData?.orbit;
  if (orbit) {
    ctx.spawn(async (c) => {
      await c.tweenRaw(orbit, {
        radius: orbit.radius * 1.35, speed: orbit.speed * 2.2, size: orbit.size * 1.35,
      }, { durationMs: 1100, ease: 'power2.out' });
    });
  }

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
