// 格挡/架势施术模板（block 体系默认，2026-10-02）：防御语言与攻击语言分家——
// 攻击链（掌/腿/破架）在 index.js 逐卡映射到 fistCast（体修同源），本模板只管
// 「守」的两态（params.mode，缺省 ring）：
//   wall  格挡/盾链（guard/屏障/铜城/灵能盾…）：蓝白光壁在身前立起（wallShade
//         前锋自地拔起）+ 冷色灯——读「挡住」
//   ring  架势/气场链（龟守/武者/天一/狂战/聚力/集结…）：脚下气场环扩散 + 主色
//         灯——读「进架」。主题色经 params 换（狂战红/集结金/默认灵蓝）
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { cardFlare, impactBurst, spellQuad, linearColor } from './blocks.js';
import { wallShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const blockCast = {
  defaults: {
    mode: 'ring',
    color: [0.55, 0.75, 1.20],     // 主色（灵能蓝白——守势冷调）
    hot: [1.05, 1.20, 1.45],       // 前锋/热核（过 bloom 阈）
    core: 0x9db8e8,                // 卡面起手脉冲
    wallMs: 520,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const def = (() => { try { return getSkillDefinition(p?._defId); } catch { return null; } })();
    return async (ctx, deps, notify) => {
      const player = deps.playerUnit?.();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 220, scale: 1.3 });
      // 安全网：enemy 目标卡漏映射到本模板时只留起手（防「守势特效打向敌人」误读）
      if (!player || def?.targetMode === 'enemy') { await flareJob; notify(); return; }
      const feet = deps.unitFeet(player);

      if (prm.mode === 'wall') {
        // 光壁立在身前（玩家面朝 +x 敌列）：底坐脚边、顶过头顶——「一壁」的体量；
        // z 只 +1（拉近相机的透视会让墙在屏上向下栽）
        const uProg = uniform(0.0);
        const { quad, geo, mat } = spellQuad({
          shade: wallShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot)),
          width: 5.5, height: 16.0, name: 'spellFx:wall',
        });
        quad.position.set(feet.x + 4.2, feet.y + 8.0, (feet.z ?? 0) + 1);
        deps.scene.add(quad);
        ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
        const lamp = deps.cast?.get?.('light:fx0') ?? null;
        if (lamp) {
          lamp.color.setRGB(prm.color[0], prm.color[1], prm.color[2]);
          lamp.position.copy(quad.position);
        }
        ctx.onKill(() => { if (lamp) lamp.intensity = 0; });
        // hold：定格立墙中段（调参/取证画布；const 排障模式同样定格——红墙隔离装配层）
        const dbg = new URLSearchParams(location.search).get('spelldebug');
        if (dbg === 'hold' || dbg === 'const') {
          uProg.value = 0.42;
          if (lamp) lamp.intensity = 380;
          await ctx.wait(3000);
        } else {
          const st = { t: 0 };
          await ctx.tweenRaw(st, { t: 1 }, {
            durationMs: prm.wallMs, ease: 'power2.out',
            onUpdate: () => {
              uProg.value = st.t;
              if (lamp) lamp.intensity = 380 * Math.sin(Math.min(1, st.t * 1.5) * Math.PI);
            },
          });
        }
        deps.scene.remove(quad); geo.dispose(); mat.dispose();
        if (lamp) lamp.intensity = 0;
        await flareJob;
        notify();
        return;
      }

      // ring：脚下气场环（纯环闪光，粒子压低——架势是「沉」不是「爆」）
      const burstJob = impactBurst(ctx, deps, {
        at: feet,
        color: prm.color, hot: prm.hot, burstColor: prm.core,
        count: 8, speed: 9, size: 0.7, ttl: 0.7, gravity: 2,
        flashSize: 7.5, flashMs: 400,
        lampIntensity: 500, lampMs: 380,
      });
      await Promise.all([flareJob, burstJob]);
      notify();
    };
  },
};
