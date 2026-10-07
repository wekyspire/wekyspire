// 火焰旋风模板（fireWhirl 群伤，2026-10-06 v2 重做——旧版「冲击环+粒子」被
// 用户判为廉价）：**旋涡火幕**为主体——主角周身立起圆柱螺旋火臂（whirlShade：
// 五臂盘旋上升、火根旺顶上散），地面冲击环降为辅助一击（起涡的地面响应）。
// 逐敌落地火仍在伤害节拍（damageFx fireWhirl → fireburst ground），施术拍
// 只演「风起于己」。rings = 2（S 焰流飓风）：双圆柱（外圈更大更慢反向）+
// 双段地面环——叠浪与双涡芯的读感。
import { cardFlare, impactBurst, lightPillar, groundRing, SPELL_DEBUG } from './blocks.js';
import { makeWhirlMesh } from './whirlMesh.js';
import { push as pushMood } from '../sceneMood.js';

// 模板内的挂场/驱动（工厂件 → 场景 + 全周期 tween；hold 定格 0.55）
function whirlCylinder(ctx, deps, { at, radius, height, color, hot, ms, spin, seed }) {
  const w = makeWhirlMesh({ radius, height, color, hot, seed });
  // 底缘坐在脚边略高处（贴地环上、不垂过台沿——「火根咬地」）
  w.mesh.position.set(at.x, at.y + height * 0.5 + 0.2, (at.z ?? 0) + 1);
  deps.scene.add(w.mesh);
  ctx.onKill(w.dispose);
  if (SPELL_DEBUG === 'hold') {
    w.uPhase.value = 4.2; w.uProg.value = 0.55;
    ctx.spawn(async (c) => { await c.wait(3000); w.dispose(); });
    return null;
  }
  const st = { t: 0 };
  return ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'sine.inOut',
    onUpdate: () => {
      w.uProg.value = st.t;
      w.uPhase.value = st.t * ms * 0.001 * spin;   // 旋臂滚动（spin rad/s）
    },
    onComplete: w.dispose,
  });
}

export const fireWhirlCast = {
  defaults: {
    color: [1.0, 0.48, 0.16], hot: [1.2, 0.92, 0.55],
    core: 0xff8c3a,
    rings: 1,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.5 });
      const player = deps.playerUnit?.();
      const feet = player ? deps.unitFeet(player) : null;
      if (feet) {
        // ① 主体：旋涡火幕（内圆柱快旋）
        const jobs = [whirlCylinder(ctx, deps, {
          at: feet, radius: 5.2, height: 17, color: prm.color, hot: prm.hot,
          ms: 1000, spin: 9.0, seed: Math.random() * 6.28 + 0.01,
        })];
        // S 焰流飓风：外圈双涡（更大更慢、反相盘旋）
        if (prm.rings >= 2) {
          jobs.push(whirlCylinder(ctx, deps, {
            at: feet, radius: 8.2, height: 19, color: prm.color, hot: prm.hot,
            ms: 1150, spin: -5.5, seed: Math.random() * 6.28 + 0.01,
          }));
        }
        // ①½ 轴心白热柱：涡芯的径向温度核——**穿出漏斗顶口**（柱高过圆柱顶
        // ~3 单位，顶口露一截亮芯——被带面遮死时三层色温塌单层的病根，glm-flash 终审）
        ctx.spawn((c) => lightPillar(c, deps, {
          at: { x: feet.x, y: feet.y - 2, z: feet.z }, color: prm.color, hot: prm.hot,
          width: 2.1, height: 20, ms: 800,
        }));
        // ② 辅助：贴地破边火环（起涡一击的地面响应——真贴地环流纹，2026-10-06
        // 审计重制）+ 上升火星；PCG 场景交互广播照旧（impact → 道具物理响应）
        deps.notify?.('impact', { at: { x: feet.x, z: feet.z ?? 0 }, power: prm.rings >= 2 ? 1.2 : 0.9 });
        jobs.push(groundRing(ctx, deps, {
          at: feet, size: prm.rings >= 2 ? 17 : 13, ms: 480, spin: 3.4,
          color: prm.color, hot: prm.hot,
        }));
        deps.particles?.spawn?.(feet.x, feet.y + 1, {
          color: 0xff8c3a, count: 14, speed: 14, size: 0.85, ttl: 0.6, gravity: 10, z: feet.z,
        });
        if (prm.rings >= 2) {
          jobs.push((async () => {
            await ctx.wait(200);
            deps.notify?.('impact', { at: { x: feet.x, z: feet.z ?? 0 }, power: 1.0 });
            deps.particles?.spawn?.(feet.x, feet.y + 1, {
              color: 0xff8c3a, count: 12, speed: 16, size: 0.85, ttl: 0.6, gravity: 10, z: feet.z,
            });
            return groundRing(ctx, deps, {
              at: feet, size: 19, ms: 520, spin: -2.6,   // 二段反向（叠浪）
              color: prm.color, hot: prm.hot,
            });
          })());
        }
        // ③ 场景缓变（sceneMood 首个消费者）：风起带一拍暖潮——异步入栈、到时
        // 自动 pop，画面按指数缓变回基线
        pushMood('fireWhirl', { warmth: prm.rings >= 2 ? 0.30 : 0.20, exposure: prm.rings >= 2 ? 1.10 : 1.05 },
          { holdMs: prm.rings >= 2 ? 750 : 520 });
        await Promise.all([flareJob, ...jobs.filter(Boolean)]);
      } else {
        await flareJob;
      }
      notify();
    };
  },
};

// 供 warm 预热与 chantSceneFx 复用（实现移独立模块防环）
export { makeWhirlMesh } from './whirlMesh.js';
