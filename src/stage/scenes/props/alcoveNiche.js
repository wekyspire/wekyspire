// 壁龛（CATALOG #64）：「拱顶凹龛，内置烛位（可摆小物）」——wallStructure 类（stone + unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf）；占 1 墙段（bayWidth:1），
// 高 ~10、龛深 ~1.5。凹腔用 unlit P.night 暗片读作空腔（vaseClay 手法）：暗矩形 + 暗半圆
// 叠在石环盘前 = 拱顶凹洞；龛内只留石台（烛位，无 lightSource 职责），台上可摆小物。
// 变体走 build(opts)：depth（石台进深 1.2~1.8）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'alcoveNiche',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'niche'],
  behaviors: [],
  build({ depth = 1.5, rng } = {}) {
    const g = new THREE.Group();
    // 底座 + 龛周石框（贴墙略前凸）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [5.4, 1.4, 1.2] }), 0, 0.7, 0.6));
    const surround = K.box({ color: shade(P.stone, -0.04), size: [5.4, 9.0, 0.8] });
    if (rng) K.jitter(surround, rng, { rot: 0.008 });
    g.add(K.put(surround, 0, 5.9, 0.4));
    // 拱腔：石环盘在前，暗片更前压住盘心 → 读作半圆拱凹洞
    g.add(K.put(K.tilt(K.cyl({ color: P.stone, r: 1.6, h: 0.35, seg: 9 }), Math.PI / 2), 0, 8.0, 0.625));
    g.add(K.put(K.box({ color: P.night, size: [2.6, 5.4, 0.12], family: 'unlit' }), 0, 5.3, 0.87));
    g.add(K.put(K.tilt(K.cyl({ color: P.night, r: 1.3, h: 0.12, seg: 9, family: 'unlit' }), Math.PI / 2), 0, 8.0, 0.87));
    // 拱洞侧门牙（收暗片边）+ 拱顶拱心石
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [0.35, 5.4, 0.55] }), 1.475 * s, 5.3, 0.75));
    }
    const key = K.box({ color: shade(P.stone, 0.1), size: [0.6, 0.9, 0.45] });
    if (rng) K.jitter(key, rng, { rot: 0.015 });
    g.add(K.put(key, 0, 9.3, 0.85));
    // 烛位石台：自龛底探出（只留石台不放火，台面即小物位）
    const d = Math.min(1.8, Math.max(1.2, depth));
    g.add(K.put(K.box({ color: shade(P.stone, 0.12), size: [2.7, 0.42, d] }), 0, 3.0, 0.15 + d / 2));
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [2.7, 0.16, 0.3] }), 0, 3.3, 0.15 + d - 0.15));
    return g;
  },
};
