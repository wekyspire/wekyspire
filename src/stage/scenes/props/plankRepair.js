// 修补木板（CATALOG #82）：「斜钉加固板两根，钉头冒头」——wallDecor 低带挂件（wood+metal 双族）。
// 原点=墙面低位挂点（z=0 贴墙，+z 朝室内）；两根加固板斜钉在墙脚（默认交叉 X 势，
// 变体可平行错位），每板 2~3 枚铁钉自板面冒头，板端缺角=旧料感。每根板 ~5 长。
// 变体走 build(opts)：板数（2~3）/交叉或平行/板长；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单根加固板：板身（两端缺角）+ 冒头铁钉，返回以板中心为原点的 Group（板面朝 +z）
function makePlank(len, color, nails, r) {
  const p = new THREE.Group();
  const board = K.box({ color, size: [0.72, len, 0.34], family: 'wood' });
  K.chip(board, { corner: [1, 1, 1], amount: 0.13 });
  K.chip(board, { corner: [-1, -1, 1], amount: 0.1 });
  p.add(board);
  // 钉位：板身两端错位 + 中部一枚（第三枚），钉头冒出板面
  const spots = [[-0.16, len / 2 - 0.55], [0.16, -len / 2 + 0.55], [0.1, len / 2 - 1.6]];
  for (let i = 0; i < nails; i++) {
    const [nx, ny] = spots[i];
    const nail = K.box({ color: P.iron, size: [0.2, 0.2, 0.24], family: 'metal' });
    K.tilt(nail, 0, 0, (r() - 0.5) * 0.5);
    p.add(K.put(nail, nx, ny + (r() - 0.5) * 0.2, 0.3));
  }
  return p;
}

export default {
  id: 'plankRepair',
  place: 'wallDecor',
  band: 'low',
  tags: ['wood'],
  behaviors: [],
  build({ planks = 2, cross = true, len = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('plankRepair');
    const n = Math.min(Math.max(planks, 2), 3);
    const tones = [P.wood, shade(P.wood, -0.1), shade(P.woodDark, 0.08)];
    for (let i = 0; i < n; i++) {
      const p = makePlank(len, tones[i % 3], i === 2 ? 3 : 2, r);
      let x = 0, y = 2.1, rz;
      if (cross) {
        // 交叉势：两板反向斜钉成 X，第三板（若有）横压上方
        rz = (i === 0 ? 0.52 : -0.52) + (r() - 0.5) * 0.06;
        if (i === 2) { rz = 0.06; x = 0.9; y = 3.3; }
      } else {
        // 平行势：同向斜钉、错位排开
        rz = 0.4 + (r() - 0.5) * 0.08;
        x = (i - (n - 1) / 2) * 1.15;
        y = 2.0 + (i % 2) * 0.85;
      }
      K.tilt(p, 0, 0, rz);
      g.add(K.put(p, x, y, 0.18));
    }
    return g;
  },
};
