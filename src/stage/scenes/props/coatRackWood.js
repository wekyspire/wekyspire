// 衣帽架（CATALOG2 #15）：「立杆+枝杈挂钩+搭衣」——起居家具 prop（wood+cloth 双族）。
// 圆盘底座 + 微歪立杆，顶端附近枝杈短杈螺旋错落外伸上翘（末梢上翘小尖=挂钩）；
// 最粗一杈搭一袭斗篷（肩鼓球 + 垂身布片 + 前襟错折一片），另一杈搭一条围巾垂下。
// 原点=底面中心（y=0 落地），总高约 5.8。变体走 build(opts)：枝杈数/搭衣件数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 一根枝杈挂钩：斜伸短杆 + 末端上翘小尖，返回原点在杆根、朝 +x 外伸的 Group
// （杆轴自竖直向 +x 倾 ANGLE，末端挂点局部坐标按同一三角算出，供搭衣定位复用）
const ANGLE = 0.85;

function makeProng(len) {
  const dx = Math.sin(ANGLE), dy = Math.cos(ANGLE);
  const prong = new THREE.Group();
  const arm = K.cyl({ color: P.woodDark, r: 0.075, rTop: 0.055, h: len, seg: 5, family: 'wood' });
  K.tilt(arm, 0, 0, -ANGLE);
  prong.add(K.put(arm, (dx * len) / 2, (dy * len) / 2, 0));
  const tip = K.cyl({ color: shade(P.woodDark, 0.08), r: 0.05, h: 0.26, seg: 5, family: 'wood' });
  K.tilt(tip, 0, 0, 0.3);
  prong.add(K.put(tip, dx * len, dy * len + 0.09, 0));
  return prong;
}

export default {
  id: 'coatRackWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth', 'quarters'],
  footprint: { x: 3.2, z: 3.2 },
  behaviors: [],
  build({ prongs = 4, clothes = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('coatRackWood');
    // 底座圆盘 + 微歪立杆
    g.add(K.put(K.cyl({ color: P.woodDark, r: 0.88, h: 0.24, seg: 7, family: 'wood' }), 0, 0.12, 0));
    const pole = K.cyl({ color: shade(P.wood, 0.06), r: 0.14, rTop: 0.11, h: 5.6, seg: 6, family: 'wood' });
    K.tilt(pole, 0.01, 0, 0.015);
    g.add(K.put(pole, 0, 2.92, 0));
    // 枝杈挂钩：顶端附近螺旋错落伸出，第 0 杈最粗最长（承斗篷），记下挂点供搭衣
    const n = Math.min(Math.max(prongs, 3), 5);
    const hang = [];
    for (let i = 0; i < n; i++) {
      const len = 0.62 + r() * 0.28 + (i === 0 ? 0.3 : 0);
      const prong = makeProng(len);
      const yaw = i * 2.4 + r() * 0.35;
      prong.rotation.y = yaw;
      K.tilt(prong, 0, 0, (r() - 0.5) * 0.1);
      g.add(K.put(prong, 0, 4.55 + i * 0.24, 0));
      hang.push({ prong, len, yaw });
    }
    // 搭衣一：斗篷挂最粗杈（肩鼓 + 垂身 + 前襟错折），进杈组随其朝向
    if (clothes >= 1) {
      const main = hang[0];
      const tx = Math.sin(ANGLE) * main.len, ty = Math.cos(ANGLE) * main.len;
      main.prong.add(K.grp(
        K.put(K.scaleXYZ(
          K.sphereLo({ color: shade(P.bannerBlue, 0.07), r: 0.5, seg: 1, family: 'cloth' }),
          1.15, 0.5, 0.62), tx, ty, 0),
        K.put(K.box({ color: P.bannerBlue, size: [1.3, 2.75, 0.14], family: 'cloth' }), tx, ty - 1.45, 0),
      ));
      const flap = K.box({ color: shade(P.bannerBlue, -0.07), size: [0.85, 2.3, 0.1], family: 'cloth' });
      K.tilt(flap, 0, 0, 0.05);
      main.prong.add(K.put(flap, tx + 0.14, ty - 1.32, 0.04));
    }
    // 搭衣二：粗织围巾搭次杈，垂下一长条
    if (clothes >= 2 && hang[1]) {
      const sec = hang[1];
      const sx = Math.sin(ANGLE) * sec.len, sy = Math.cos(ANGLE) * sec.len;
      const scarf = K.box({ color: P.sack, size: [0.55, 1.7, 0.1], family: 'cloth' });
      K.tilt(scarf, 0, 0, 0.04);
      sec.prong.add(K.put(scarf, sx, sy - 0.85, 0));
    }
    return g;
  },
};
