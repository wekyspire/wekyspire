// 格挡/架势施术模板（block 体系默认，2026-10-02）：防御语言与攻击语言分家——
// 攻击链（掌/腿/破架）在 index.js 逐卡映射到 fistCast（体修同源），本模板只管
// 「守」的两态（params.mode，缺省 ring）：
//   ward  加盾链（guard/屏障/铜城/灵能盾…）：起手卡面脉冲 + 单位身前一亮即止——
//         「盾」的读法由护盾罩（fx/shieldDome.js，随盾量常驻的 L2 罩件）在增益
//         同步拍呈现；施术侧不许再立「墙」（白柱假墙廉价穿帮，用户 2026-10-02 定）
//   ring  架势/气场链（龟守/武者/天一/狂战/聚力/集结…）：脚下气场环扩散 + 主色
//         灯——读「进架」。主题色经 params 换（狂战红/集结金/默认灵蓝）
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { cardFlare, groundRing, lampPulse } from './blocks.js';

export const blockCast = {
  defaults: {
    mode: 'ring',
    color: [0.55, 0.75, 1.20],     // 主色（灵能蓝白——守势冷调）
    hot: [1.05, 1.20, 1.45],       // 前锋/热核（过 bloom 阈）
    core: 0x9db8e8,                // 卡面起手脉冲
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const def = (() => { try { return getSkillDefinition(p?._defId); } catch { return null; } })();
    return async (ctx, deps, notify) => {
      const player = deps.playerUnit?.();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 220, scale: 1.3 });
      // 安全网：enemy 目标卡漏映射到本模板时只留起手（防「守势特效打向敌人」误读）
      if (!player || def?.targetMode === 'enemy') { await flareJob; notify(); return; }

      if (prm.mode === 'ward') {
        // 身前一亮即止：借 fx 灯池给单位一记柔光（罩子在增益拍接管视觉主体）
        const feet = deps.unitFeet(player);
        const lamp = deps.cast?.get?.('light:fx0') ?? null;
        if (lamp) {
          lamp.color.setRGB(prm.color[0], prm.color[1], prm.color[2]);
          lamp.position.set(feet.x, feet.y + 8, feet.z ?? 0);
        }
        ctx.onKill(() => { if (lamp) lamp.intensity = 0; });
        if (lamp) {
          const st = { t: 0 };
          await ctx.tweenRaw(st, { t: 1 }, {
            durationMs: 340, ease: 'power2.out',
            onUpdate: () => { lamp.intensity = 300 * Math.sin(st.t * Math.PI); },
          });
          lamp.intensity = 0;
        }
        await flareJob;
        notify();
        return;
      }

      // ring：脚下气场环——**真贴地**（quad 平躺 + 环流纹 + 破边，2026-10-06 审计
      // 重制：竖直 billboard 假压扁环读「光滩/门环」）。粒子压低（架势是「沉」不是
      // 「爆」）；尺寸要大到环探出主角轮廓（站姿 5.6 宽 × 立绘高 ~7）
      const feet = deps.unitFeet(player);
      const ringJob = groundRing(ctx, deps, {
        at: feet, size: 15.0, ms: 560, spin: 2.2,
        color: prm.color, hot: prm.hot,
      });
      deps.particles?.spawn?.(feet.x, feet.y + 0.5, {
        color: prm.core, count: 8, speed: 8, size: 0.7, ttl: 0.8, gravity: 3, z: feet.z,
      });
      ctx.spawn(async (c) => {
        await lampPulse(c, deps, {
          name: 'light:fx0', at: { x: feet.x, y: feet.y + 6, z: (feet.z ?? 0) + 2 },
          color: prm.color, peak: 460, attackMs: 180, decayMs: 380,
        });
      });
      await Promise.all([flareJob, ringJob]);
      notify();
    };
  },
};
