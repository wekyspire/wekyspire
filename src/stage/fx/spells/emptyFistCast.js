// 空形拳施术模板（S 签名「空」）：全演出谱只有**静场蓄意**——慢吸压暗 + fov 微收
// （聚焦读感，非天斩的广角压迫）+ 微震渐起 + 主角拳面白核**收束**（缩而不胀——
// 气的密度）。兑付不在本拍：后手成立 → 伤害拍 voidStrike 炸开（静极而动）；
// 不成立 → 没有伤害拍、什么也没有——「打空就是空」，留白即语义。
// 全程无目标向运动（whiff 安全：不成立的出拳不该有命中预告）。
import { cardFlare, dreadVeil, spellQuad, linearColor } from './blocks.js';
import { projectileShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const emptyFistCast = {
  defaults: {
    veil: 0.38,                    // 静场压暗（克制——给兑付的白爆留量程）
    inMs: 460, holdMs: 320, outMs: 280,
    core: 0xeef2fa,                // 卡面起手脉冲（冷白）
    fovPull: 1.2,                  // fov 收束量（聚焦，方向与天斩相反）
    tremble: 0.12,                 // 微震峰值（压抑的嗡，不是抖）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const origin = deps.playerAnchor?.() ?? null;
      // 复原保险：协程被杀也必须还相机、停微震、熄卡面蓄势
      const cam = deps.camera ?? null;
      ctx.onKill(() => {
        deps.shake?.sustain?.(0);
        cam?.flyHome?.({ durationMs: 300, ease: 'power2.out' });
        deps.cardView?.setVisualState?.('normal');
      });

      const veil = dreadVeil(ctx, deps);
      const ramp = veil.set(prm.veil, prm.inMs, 'sine.in');
      const base = cam?.basePose ?? null;
      if (cam && base) cam.flyTo({ ...base, fov: base.fov - prm.fovPull }, { durationMs: prm.inMs + 200, ease: 'sine.in' });
      if (deps.shake?.sustain) {
        const st = { v: 0 };
        ctx.spawn(async (c) => {
          await c.tweenRaw(st, { v: prm.tremble }, {
            durationMs: prm.inMs, ease: 'sine.in',
            onUpdate: () => deps.shake.sustain(st.v),
          });
        });
      }
      deps.cardView?.setVisualState?.('highlighted');
      ctx.spawn((c) => cardFlare(c, deps, { color: prm.core, ms: 320, scale: 1.2 }));

      // 拳面白核收束：shader 相位推满 + 几何收缩（蓄 = 密度上升，体积收敛）
      let coreJob = null;
      if (origin) {
        coreJob = ctx.spawn(async (c) => {
          const uProg = uniform(0.0);
          const { quad, release } = spellQuad({
            shade: projectileShade(uv(), uProg, linearColor([0.94, 0.96, 1.02]), linearColor([1.45, 1.48, 1.55])),
            width: 4.2, height: 4.2, name: 'spellFx:voidGather',
          });
          quad.position.set(origin.x, origin.y, (origin.z ?? 0) + 1);
          deps.scene.add(quad);
          c.onKill(release);
          const st = { t: 0 };
          await c.tweenRaw(st, { t: 1 }, {
            durationMs: prm.inMs + prm.holdMs, ease: 'power2.in',
            onUpdate: () => { uProg.value = st.t * 10; const s = 1.3 - 0.85 * st.t; quad.scale.set(s, s, 1); },
          });
          release();   // 收进身体——无形
        });
      }

      await ramp;
      await ctx.wait(prm.holdMs);
      // 松场：压暗/收束/微震同拍释放——之后的事（有没有那一拳）不归本拍管
      deps.cardView?.setVisualState?.('normal');
      deps.shake?.sustain?.(0);
      cam?.flyHome?.({ durationMs: 340, ease: 'power2.inOut' });
      await Promise.all([veil.set(0, prm.outMs, 'power2.out'), coreJob?.promise].filter(Boolean));
      notify();   // S 卡实体锁口径：静场给足，全程演完
    };
  },
};
