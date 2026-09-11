// 苔巨石（CATALOG2 编号 83）：「大卵石半面爬苔」——smallWall（纯 stone 单族，不声明
// topY：顶面不规则不承物）。原点=底面投影中心（高约 4，M 档）；主体=压扁 jitter 球
// 两枚相叠（rubblePile 岩语汇：明暗斑驳+随机鼓包）读作整块巨岩+半埋根脚石；
// 半面爬苔（约 π 弧段的上半球带）沿 mossPatchFloor 压扁球语汇铺开：mossDark 底层
// +moss 系亮层点睛，苔面侧根脚再压两块贴地苔。变体走 build(opts)：苔块数（苔面比）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'boulderMossy',
  place: 'smallWall',
  tags: ['stone', 'nature'],
  footprint: { x: 4.8, z: 4.2 },
  behaviors: [],
  build({ mossBlobs = 7, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('boulderMossy');
    // 主体：主卵石（压扁 jitter 球）+ 副石团相叠 + 半埋根脚石
    const main = K.sphereLo({ color: shade(P.rock, 0.04), r: 1, seg: 1, jitter: 0.18, rng: r });
    K.scaleXYZ(main, 2.05, 1.8, 1.7);
    K.tilt(main, 0, r() * Math.PI, 0);
    g.add(K.put(main, 0, 1.85, 0));
    const lobe = K.sphereLo({ color: P.rock, r: 1, seg: 1, jitter: 0.16, rng: r });
    K.scaleXYZ(lobe, 1.35, 1.05, 1.15);
    K.tilt(lobe, 0, r() * Math.PI, 0);
    g.add(K.put(lobe, 1.3, 1.5, 0.7));
    g.add(K.put(
      K.tilt(K.sphereLo({ color: shade(P.rock, -0.12), r: 0.5, seg: 0, jitter: 0.22, rng: r }), 0, r() * Math.PI, 0),
      -1.95, 0.28, -0.95,
    ));
    // 半面爬苔：mossDark 底 + moss 系亮层（深浅两层），沿上半球面按弧段铺开、微嵌岩面
    const tones = [P.mossDark, P.moss, shade(P.moss, 0.16), shade(P.moss, 0.26)];
    const m = Math.max(4, Math.min(9, mossBlobs));
    const a0 = r() * Math.PI * 2;
    for (let i = 0; i < m; i++) {
      const t = i / Math.max(1, m - 1);
      const a = a0 + (t - 0.5) * Math.PI * 0.85;   // 半面弧段（苔面比）
      const th = 0.3 + r() * 0.55;                  // 上半球带
      const st = Math.sin(th), ct = Math.cos(th);
      const blob = K.sphereLo({ color: tones[i % 4], r: 1, seg: 0, jitter: 0.2, rng: r });
      K.scaleXYZ(blob, 0.5 + r() * 0.4, 0.15 + r() * 0.06, 0.38 + r() * 0.3);
      K.tilt(blob, 0, a, (r() - 0.5) * 0.2);
      g.add(K.put(blob, Math.cos(a) * st * 1.89, 1.85 + ct * 1.66, Math.sin(a) * st * 1.56));
    }
    // 根脚苔：苔面侧两翼压贴地苔（读作苔自岩面漫到地面）
    for (let i = 0; i < 2; i++) {
      const ag = a0 + (i ? 1.05 : -1.05);
      const blob = K.sphereLo({ color: i ? P.mossDark : shade(P.moss, 0.1), r: 1, seg: 0, jitter: 0.2, rng: r });
      K.scaleXYZ(blob, 0.75, 0.13, 0.5);
      K.tilt(blob, 0, ag, (r() - 0.5) * 0.15);
      g.add(K.put(blob, Math.cos(ag) * 1.85, 0.1, Math.sin(ag) * 1.5));
    }
    return g;
  },
};
