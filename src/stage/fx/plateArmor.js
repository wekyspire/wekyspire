// 岩板甲（plateArmor，L2 壳件，穿山甲王签名件）：
// 「甲是一片片从鳞下翻出来的」——UV 转 45° 铺曼哈顿菱形鳞阵（正交矩形阵会读成
// 「金锭砖墙」），软边枕形板面 + 上缘受光倒角；吻部留白不长板（全包失生物感）；
// 上甲 = 板带自下而上逐带显形（enter 扫掠与 level 耦合，smoothstep 正向——
// oneMinus 写法会让稳态整场隐身）；蓄势（uHeat）= 板缝渗炽光；恼怒净化 =
// 板片按 hash 错峰向外崩落。
// 色板：岩褐灰鳞甲（贴立绘灰岩质感的低饱和暖褐；高光峰值压在 0.56 下——饱和金
// 会读成抛光电镀，与原画风不搭）；热缝仍走炽橙 HDR（过阈起晕交 bloom——怒气
// 才是金色的唯一来处）。
// TSL 纪律同 hexShield（颜色烘常量、多引 .toVar()、节点不混 JS 数）。
import { Fn, uniform, uv, vec2, vec3, vec4, abs, floor, fract, sin, max, mix, clamp, step, smoothstep, oneMinus } from 'three/tsl';
import { makeShellPiece, shellMask } from './bossStateFx.js';
import { ubfHash, ubfFbm } from './unitBodyFx.js';

const GRID = 9.2;

function buildPlateColor(t, u) {
  return Fn(() => {
    const vUv = uv();
    const { sa, rim } = shellMask(t, u);

    // —— 鳞板网格：UV 转 45° 取菱形格（正交方格读「砖墙/金锭堆」；菱形阵 =
    //    鳞甲/锁甲的经典读法）——
    const p = vec2(vUv.x.mul(u.uAspect), vUv.y);
    const gu = p.x.sub(p.y).mul(0.7071).mul(GRID).toVar();
    const gv = p.x.add(p.y).mul(0.7071).mul(GRID).toVar();
    const lx = fract(gu).sub(0.5).toVar();
    const ly = fract(gv).sub(0.5).toVar();
    const col = floor(gu).toVar();
    const plateId = vec2(col, floor(gv));
    const plateRnd = ubfHash(plateId).toVar();

    // —— 恼怒碎裂：每板按 hash 延迟，向外+下坠崩落；板形在位移后坐标重评 ——
    const sProg = clamp(u.uShatter.sub(plateRnd.mul(0.35)).div(0.5), 0.0, 1.0).toVar();
    const dirX = plateRnd.sub(0.5).mul(1.4).add(sign0(col.add(0.72)));
    const dispX = dirX.mul(sProg.mul(0.22));
    const dispY = sProg.mul(sProg).mul(-0.35).add(sProg.mul(plateRnd.sub(0.5).mul(0.2)));
    const lx2 = lx.sub(dispX.mul(GRID)).toVar();
    const ly2 = ly.sub(dispY.mul(GRID)).toVar();
    const plateFade = oneMinus(smoothstep(0.3, 0.85, sProg)).toVar();

    // —— 板形：曼哈顿距离菱形 + 宽落边（软枕形；板缝露出下层灰鳞 = 叠甲深度）——
    const md = abs(lx2).add(abs(ly2)).toVar();
    const plate = oneMinus(smoothstep(0.72, 0.90, md)).toVar();
    // 倒角明暗：上缘受光 + 下缘沉影（板片厚度的读感）；板面色亮度逐片微差
    // （plateRnd ±11%：均匀板阵是「贴图感」的来源）
    const bevel = smoothstep(-0.30, 0.42, ly2).mul(0.5).add(0.62)
      .mul(plateRnd.mul(0.22).add(0.89));
    const gap = oneMinus(plate).toVar(); // 板缝
    // 缝线暗影：板缘一圈深色描线
    const seam = smoothstep(0.70, 0.80, md).mul(oneMinus(smoothstep(0.86, 0.96, md))).toVar();

    // —— 头部留白：板甲不长到吻部（全包会读成石坨，生物感尽失）——
    const headD = vUv.sub(vec2(0.14, 0.36)).mul(vec2(1.6, 2.4)).length();
    const headMask = smoothstep(0.16, 0.30, headD).toVar();

    // —— 上甲扫掠：level 自下而上逐排显形（扫掠带按未旋转的 vUv.y 分带 + 板 hash
    //    抖动）。锋面越过本带 → 显形（smoothstep 正向，oneMinus 会整场恒 0 = 稳态全隐身）——
    const rowT = floor(vUv.y.mul(6.0)).add(0.5).div(6.0);
    const vis = smoothstep(rowT.sub(0.10), rowT.add(plateRnd.mul(0.08)), u.uLevel.mul(1.15))
      .mul(headMask).toVar();

    // —— 蓄势热缝：甲在 = 板缝渗光；甲碎后 gap 场退化（≈1 满屏，会糊成平涂橙板），
    //    切换到脊线裂纹 mask（裸躯熔岩裂纹）。两态按 uShatter 过渡 ——
    const crack = smoothstep(0.84, 0.96,
      oneMinus(abs(ubfFbm(vUv.mul(vec2(u.uAspect, 1.0)).mul(6.0).add(vec2(1.7, 4.3))).mul(2.0).sub(1.0))));
    const heatMask = mix(gap.mul(headMask), crack, smoothstep(0.05, 0.5, u.uShatter)).toVar();
    const heatPulse = sin(u.uTime.mul(2.2).add(vUv.y.mul(9.0)).add(plateRnd.mul(3.0))).mul(0.3).add(0.7);
    const heatGlow = heatMask.mul(u.uHeat).mul(heatPulse).toVar();

    // —— 受击震颤：全板面短促提亮 ——
    const clank = u.uPulse.mul(plate.mul(0.9)).toVar();

    // —— 合成 ——（热缝与板甲解耦：恼怒净化后板片崩落（plateFade→0），但热缝留在
    //    裸躯上继续渗光——甲没了，怒气还在）
    // 岩褐灰（贴立绘灰岩质感）：R-G 差压到 ~0.06、G-B ~0.08 的低饱和暖褐；高光峰值
    // 0.56（原 0.72 的琥珀金在暗场里会自发光，读成抛光电镀）
    const ROCK = vec3(0.24, 0.215, 0.185);
    const ROCK_HI = vec3(0.56, 0.50, 0.42);
    const SEAM = vec3(0.13, 0.115, 0.095);
    const EMBER = vec3(1.25, 0.5, 0.16);
    const plateCol = mix(ROCK, ROCK_HI, bevel.sub(0.7).mul(1.5)).toVar();
    let c = plateCol.mul(plate.mul(vis).mul(bevel).mul(plateFade));
    c = c.add(SEAM.mul(seam.mul(vis).mul(plateFade).mul(0.7))); // 缝线暗影（哑光，压在板缘）
    c = c.add(EMBER.mul(heatGlow.mul(1.6)));
    c = c.add(ROCK_HI.mul(clank.mul(plateFade)));
    c = c.add(ROCK.mul(rim.mul(0.4).mul(plateFade))); // 剪影缘微收束
    const plateAlpha = u.uLevel.mul(clamp(
      plate.mul(vis).mul(1.0).add(seam.mul(vis).mul(0.55)).add(clank.mul(0.6)).add(rim.mul(0.25)),
      0.0, 1.0)).mul(plateFade);
    const heatAlpha = clamp(heatGlow.mul(1.2), 0.0, 1.0);
    const alpha = max(plateAlpha, heatAlpha).mul(max(sa, rim.mul(0.7))).toVar();
    return vec4(c.mul(max(sa, rim.mul(0.7))), alpha);
  })();
}

// 符号（0 归 +1：中线列不向零塌）
const sign0 = (x) => max(step(0.0, x).mul(2.0).sub(1.0), 0.35);

/**
 * 在宿主层建岩板甲。
 * @returns 句柄 + { setHeat(0..1), clank(), shatter() }（headless → null）
 */
export function makePlateArmor(layer, { aspect = 0.66 } = {}) {
  let shattering = false;
  const h = makeShellPiece(layer, {
    name: 'plateArmor',
    z: 0.82,
    makeUniforms: (u) => {
      u.uAspect = uniform(aspect);
      u.uHeat = uniform(0);
      u.uPulse = uniform(0);
      u.uShatter = uniform(0);
    },
    buildColor: buildPlateColor,
    onTick: (dt, hh) => {
      if (hh.u.uPulse.value > 0) hh.u.uPulse.value = Math.max(0, hh.u.uPulse.value - dt * 4.0);
      if (!shattering) return;
      hh.u.uShatter.value += dt / 0.85;
      // 崩落后停在终态：板形已消失（plateFade→0），热缝仍由 uHeat 常驻驱动。
      // 这里不能 setLevel(0)——group 会被隐掉，直到下一次 sync 才被导演救回，
      // 热缝会在整个玩家回合里凭空消失（只留一团灰鳞）。
      if (hh.u.uShatter.value > 1.25) hh.u.uShatter.value = 1.25;
    },
  });
  if (!h) return null;
  /** 蓄势热缝强度（momentum 层数归一后由 director 直推）。 */
  h.setHeat = (k) => { h.u.uHeat.value = Math.max(0, Math.min(1, k)); };
  /** 受击震颤（打铁一拍）。 */
  h.clank = () => { h.u.uPulse.value = 1; };
  /** 恼怒净化：板甲崩落（一次性）。 */
  h.shatter = () => { shattering = true; };
  return h;
}
