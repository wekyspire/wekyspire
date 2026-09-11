// 彩灯串（用户定 2026-09-11：赌厅要"简陋的小彩灯"，与乱糟糟的残破场景形成戏剧对比）。
// 形态：一根松垮的电线沿墙下垂，串着十来颗**廉价彩色小球**——刻意做得参差：间距不均、
// 高度不齐、有两颗已经不亮（暗色），读作"谁随手拉的串灯"。
//
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 lanternWall/bannerLong 约定）；band=mid；
// 沿墙面横铺约 12 宽、下垂约 3.4。place='wallDecor'（走立面装饰池）。
//
// 布光职责：tags 声明 `lamp`——走**无火焰的点光池**通道（不是 lightSource：彩灯不该冒火），
// 亮色靠 unlit 族顶点色自发光；`lampGain: 0.5` 让它的光池只有机器的一半（外围点缀，
// 别抢机器灯池与中央光——「外围光减少、靠中央光撑亮度」）。颜色只取 palette token。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const BULB_COLORS = [P.potionRed, P.potionGreen, P.potionBlue, P.gold, P.potionRed, P.potionGreen];

export default {
  id: 'festoonLights',
  place: 'wallDecor',
  mount: 'wall',
  tags: ['festoon', 'lamp', 'metal'],
  band: 'mid',
  footprint: { x: 9, z: 2 },
  // 光池只有机器的一小截（外围点缀）：灯珠是 unlit 自发光（颜色已经给足），点光只负责
  // 在墙面/地面上抹一层淡淡的彩灯氛围——再亮就会变成墙上的彩色爆斑。
  lampGain: 0.2,
  behaviors: [],
  build({ span = 9, bulbs = 9, sag = 3.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('festoonLights');
    const wire = shade(P.iron, -0.15);

    // 电线：按悬链近似分段折线（段数少=简陋感）
    const segs = 7;
    const nodeAt = (i) => {
      const t = i / segs;
      return new THREE.Vector3(
        -span / 2 + t * span,
        -Math.sin(t * Math.PI) * sag,                       // 下垂
        0.45 + Math.sin(t * Math.PI * 1.3) * 0.3,           // 稍微离墙飘一点
      );
    };
    for (let i = 0; i < segs; i++) {
      const a = nodeAt(i), b = nodeAt(i + 1);
      const d = b.clone().sub(a);
      const m = K.cyl({ color: wire, r: 0.08, h: d.length(), seg: 4, family: 'metal' });
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      m.position.copy(a).addScaledVector(d, 0.5);
      g.add(m);
    }

    // 灯泡：间距不均 + 两颗坏的（暗色）+ 部分歪挂。灯珠按房间尺度取大（场景里人是 ~7 单位高，
    // 灯珠直径 ~0.9 才读得出"亮着的彩色点"），否则在 80 单位外的后墙只剩两三像素。
    const deadIdx = [3, Math.min(bulbs - 1, 7)];
    for (let i = 0; i < bulbs; i++) {
      const t = (i + 0.5) / bulbs + (r() - 0.5) * 0.02;
      const x = -span / 2 + t * span;
      const y = -Math.sin(t * Math.PI) * sag - 0.55;
      const z = 0.45 + Math.sin(t * Math.PI * 1.3) * 0.3;
      // 灯座
      g.add(K.put(K.cyl({ color: shade(P.iron, -0.3), r: 0.17, h: 0.3, seg: 5, family: 'metal' }),
        x, y + 0.28, z));
      const dead = deadIdx.includes(i);
      // 亮着的灯珠**提亮 40%（朝白插值）**：调色板原色偏深，直接用会读成"深色小球"而不是
      // "亮着的彩灯"（unlit 族不吃光，只能靠颜色本身表达亮度）；坏的不发光故用暗铁色。
      const color = dead
        ? shade(P.iron, -0.2)
        : shade(BULB_COLORS[(i + (r() < 0.5 ? 0 : 1)) % BULB_COLORS.length], 0.3);
      // 灯珠（竖直略拉长读作灯泡；坏的不发光故用暗铁色）
      const bulb = K.scaleXYZ(K.sphereLo({ color, r: 0.46, seg: 1, family: 'unlit' }), 1, 1.22, 1);
      if (r() < 0.3) K.tilt(bulb, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);  // 歪挂
      g.add(K.put(bulb, x, y, z));
    }
    return g;
  },
};
