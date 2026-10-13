// 菌络脉络（sporeVeins，L2 壳件，腐败之源签名件）：
// 「它的身体是一张活着的菌网」——剪影内爬 ridged fbm 脉络（域扭曲防直纹），
// 亮度沿脉络缓慢行波（代谢在流）；孢囊节点 = 网格 hash 选点的脉动亮斑；
// pulse() = 治疗/召唤拍全网一涌（养分推送的读感）。
// 哑光偏亮：主色暗绿压在 bloom 阈下，行波峰与孢囊才推 HDR。
// TSL 纪律同 hexShield（颜色烘常量、多引 .toVar()、节点不混 JS 数）。
import { Fn, uniform, uv, vec2, vec3, vec4, abs, floor, fract, sin, max, clamp, step, smoothstep, oneMinus } from 'three/tsl';
import { makeShellPiece, shellMask } from './bossStateFx.js';
import { ubfHash, ubfFbm } from './unitBodyFx.js';

function buildVeinColor(t, u) {
  return Fn(() => {
    const vUv = uv();
    const { sa, rim } = shellMask(t, u);
    const asp = vec2(u.uAspect, 1.0);

    // —— 菌络：域扭曲 ridged fbm（v 接近脊线 = 脉络）——
    const warp = vec2(
      ubfFbm(vUv.mul(asp).mul(2.6).add(vec2(3.1, 7.7))),
      ubfFbm(vUv.mul(asp).mul(2.6).add(vec2(9.2, 1.3))),
    ).sub(0.5).mul(0.9);
    const n = ubfFbm(vUv.mul(asp).mul(3.2).add(warp)).toVar();
    const ridge = oneMinus(abs(n.mul(2.0).sub(1.0))).toVar();
    const vein = smoothstep(0.78, 0.93, ridge).toVar(); // 细脉络（阈值低了会糊成整片绿斑）

    // —— 行波：亮度沿脉络场流动（代谢泵送）；受击/治疗 pulse 全网一涌 ——
    const flow = sin(u.uTime.mul(1.5).sub(n.mul(9.0))).mul(0.35).add(0.65);
    const lit = vein.mul(flow.mul(0.8).add(u.uPulse.mul(0.9))).toVar();

    // —— 孢囊节点：粗网格 hash 选点（<0.24 有囊），囊斑缓慢呼吸 ——
    const cellId = floor(vUv.mul(asp).mul(5.0));
    const has = step(ubfHash(cellId), 0.24);
    const cc = fract(vUv.mul(asp).mul(5.0)).sub(0.5);
    const cystD = cc.x.mul(cc.x).add(cc.y.mul(cc.y));
    const breathe = sin(u.uTime.mul(2.4).add(ubfHash(cellId.add(7.0)).mul(6.28))).mul(0.35).add(0.65);
    const cyst = smoothstep(0.06, 0.01, cystD).mul(has).mul(breathe).toVar();

    // —— 合成 ——（立绘自带亮绿纹理：只加亮线读不出。脉间微压暗造对比，
    //    脉络行波峰推 HDR——「网」是明暗差，不是更绿）
    const VEIN = vec3(0.36, 0.75, 0.30);
    const HOT = vec3(0.75, 1.35, 0.55);
    const DARK = vec3(0.05, 0.09, 0.05);
    const dim = oneMinus(vein).mul(0.14).toVar(); // 脉间压暗量
    const c = VEIN.mul(lit.mul(1.15))
      .add(HOT.mul(vein.mul(vein).mul(flow.mul(1.1)))) // 行波峰过阈起晕
      .add(HOT.mul(vein.mul(u.uPulse).mul(0.9)))
      .add(HOT.mul(cyst.mul(0.9)))
      .add(VEIN.mul(rim.mul(0.35)))
      .add(DARK.mul(dim));
    const alpha = u.uLevel.mul(clamp(
      lit.mul(0.75).add(cyst.mul(0.8)).add(dim).add(rim.mul(0.2)),
      0.0, 1.0).mul(max(sa, rim.mul(0.6)))).toVar();
    return vec4(c.mul(max(sa, rim.mul(0.6))), alpha);
  })();
}

/**
 * 在宿主层建菌络脉络。
 * @returns 句柄 + { pulse(k) }（headless → null）
 */
export function makeSporeVeins(layer, { aspect = 0.62 } = {}) {
  const h = makeShellPiece(layer, {
    name: 'sporeVeins',
    z: 0.78,
    makeUniforms: (u) => {
      u.uAspect = uniform(aspect);
      u.uPulse = uniform(0);
    },
    buildColor: buildVeinColor,
    onTick: (dt, hh) => {
      if (hh.u.uPulse.value > 0) hh.u.uPulse.value = Math.max(0, hh.u.uPulse.value - dt * 1.8);
    },
  });
  if (!h) return null;
  /** 治疗/召唤拍的全网一涌。 */
  h.pulse = (k = 1) => { h.u.uPulse.value = Math.min(1.3, Math.max(h.u.uPulse.value, k)); };
  return h;
}
