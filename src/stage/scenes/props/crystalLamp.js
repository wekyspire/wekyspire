// 晶石灯（CATALOG2 编号 44）：「座上晶簇幽光」——prop 类（stone 灯座 + unlit 晶簇 双族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档可上桌沿/断柱顶）。
// 布光职责：tags 声明 lightSource 即"这里有光"——不私设 PointLight（CATALOG §6），
// 幽光用 unlit 族 P.glowCyan 晶柱组合（按档明暗分色读作切面），碗内幽光芯同族点亮。
// 变体走 build(opts)：晶柱数 shards / 中央柱高 clusterH。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'crystalLamp',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['stone', 'lightSource', 'arcane'],
  footprint: { x: 2, z: 2 },
  behaviors: [],
  build({ shards = 6, clusterH = 1.35, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crystalLamp');
    // 灯座：柱础束腰轮廓（盘座→细腰→承晶托碗，lathe 旋转体），全高约 2.65
    g.add(K.put(K.lathe({
      color: shade(P.stone, -0.12),
      profile: [[0.55, 0], [0.5, 0.16], [0.26, 0.4], [0.21, 0.95], [0.44, 1.2], [0.52, 1.28]],
      seg: 7,
    }), 0, 0, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.05), r: 0.58, rTop: 0.5, h: 0.12, seg: 7 }), 0, 1.3, 0));
    // 托碗幽光芯：unlit 小球读作光源心脏（自晶柱根部透亮）
    g.add(K.put(K.sphereLo({ color: shade(P.glowCyan, 0.18), r: 0.26, seg: 0, family: 'unlit' }), 0, 1.36, 0));
    // 中央晶柱：高棱柱（prism 三角剖面对切面光），微歪求自然
    const crown = K.prism({ color: P.glowCyan, size: [0.34, clusterH, 0.34], family: 'unlit' });
    K.tilt(crown, 0.06, r() * 0.4, -0.05);
    g.add(K.put(crown, 0.05, 1.3 + clusterH / 2, 0.03));
    // 环布晶柱：围绕中央柱外倾生长（cyl 收尖，明暗三档轮转读作切面朝向差）
    const ring = Math.max(0, Math.min(7, shards - 1));
    for (let i = 0; i < ring; i++) {
      const a = i * (Math.PI * 2 / ring) + 0.7;
      const out = 0.34 + r() * 0.22;             // 外倾角（弧度）
      const h = clusterH * (0.42 + r() * 0.3);   // 环柱矮于中央柱
      const rr = 0.3 + r() * 0.16;               // 根部环半径
      const shard = K.cyl({
        color: [P.glowCyan, shade(P.glowCyan, -0.26), shade(P.glowCyan, 0.1)][i % 3],
        r: 0.16 + r() * 0.07, rTop: 0.02, h, seg: 5, family: 'unlit',
      });
      K.tilt(shard, 0, -a, -out);
      g.add(K.put(
        shard,
        Math.cos(a) * (rr + Math.sin(out) * h / 2),
        1.3 + Math.cos(out) * h / 2,
        Math.sin(a) * (rr + Math.sin(out) * h / 2),
      ));
    }
    return g;
  },
};
