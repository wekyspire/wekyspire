// 书堆（CATALOG2 编号 31）：「横叠七八册+一本斜倚」——容器类 prop/floor（wood 单族：皮面+书口双色）。
// 原点=底面中心（y=0 落地）；单册=上下皮面（P.woodDark 系深浅轮换）夹 P.parchment 书口块
// （页口向 +z 外露半指），逐册微转微挪读作随手码放；另有一厚册斜倚堆侧自立。
// 变体走 build(opts)：册数 count（4~9）/斜倚 lean 有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 皮面色轮换（同族深浅差读作不同皮面）
const tones = () => [P.woodDark, shade(P.woodDark, 0.08), shade(P.woodDark, -0.07)];

// 单册书（局部原点=书心）：底/顶皮面 + 内页块（前后内收、前口外露）
function makeBook(w, t, d, tone, idx) {
  const b = new THREE.Group();
  b.add(K.put(K.box({ color: tone, size: [w, 0.05, d], family: 'wood' }), 0, -t / 2 + 0.022, 0));
  b.add(K.put(K.box({ color: shade(tone, 0.06), size: [w, 0.05, d], family: 'wood' }), 0, t / 2 - 0.022, 0));
  b.add(K.put(K.box({
    color: shade(P.parchment, idx % 2 ? 0.04 : -0.04),
    size: [w - 0.06, t - 0.06, d + 0.07], family: 'wood',
  }), 0, 0, 0.035));
  return b;
}

export default {
  id: 'bookStack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'library'],
  footprint: { x: 2.6, z: 1.6 },
  behaviors: [],
  build({ count = 7, lean = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bookStack');
    const n = Math.min(Math.max(count, 4), 9);
    const cs = tones();
    // 横叠：逐册尺寸微差 + 微转微挪（y 逐册累加）
    let y = 0;
    for (let i = 0; i < n; i++) {
      const w = 1.3 + r() * 0.24, d = 0.95 + r() * 0.18, t = 0.13 + r() * 0.05;
      const bk = makeBook(w, t, d, cs[i % 3], i);
      K.tilt(bk, (r() - 0.5) * 0.03, (r() - 0.5) * 0.3, (r() - 0.5) * 0.05);
      g.add(K.put(bk, (r() - 0.5) * 0.16, y + t / 2, (r() - 0.5) * 0.12));
      y += t;
    }
    // 斜倚一册：厚册绕 z 负转，下长边贴地、上缘搭堆侧（贴地高度按倾角几何抬升）
    if (lean) {
      const L = 1.35 + r() * 0.1, T = 0.22, D = 1.0;
      const th = 0.44 + r() * 0.1;
      const bk = makeBook(L, T, D, cs[1], 1);
      K.tilt(bk, 0, -0.12, -th);
      const cy = (L / 2) * Math.sin(th) + (T / 2) * Math.cos(th) + 0.01;
      const cx = 0.58 + (L / 2) * Math.cos(th) - (T / 2) * Math.sin(th);
      g.add(K.put(bk, cx, cy, (r() - 0.5) * 0.2));
    }
    return g;
  },
};
