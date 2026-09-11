// 枯苗盆（CATALOG2 编号 90）：「陶盆+枯枝杈」——prop / mount:['floor','smallWallTop']
// （stone 陶盆 + wood 枯枝 双族，S 档柱顶件）。原点=底面中心（y=0 落地）；
// 陶盆+干土面+自土面斜出的枯枝杈（细收梢、杈分小枝、一枝折断），盆边斜搭一根
// 落下的枯枝；全高约 1.5。变体走 build(opts)：枝杈数/落枝有无/盆身微歪。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 斜出枯枝：自 start 沿 dir 生长 h 长的细收梢圆柱（aim 对向）
function twig({ color, r, h, family }, start, dir) {
  const d = new THREE.Vector3(...dir).normalize();
  const m = K.cyl({ color, r, rTop: r * 0.4, h, seg: 5, family });
  K.aim(m, d.x, d.y, d.z);
  return K.put(m, start[0] + d.x * h / 2, start[1] + d.y * h / 2, start[2] + d.z * h / 2);
}

export default {
  id: 'plantPotDead',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['pottery', 'nature'],
  footprint: { x: 1.8, z: 1.8 },
  behaviors: [],
  build({ branches = 4, fallen = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('plantPotDead');
    // 陶盆：小圈足→鼓腹→外撇盆口（lathe 拉坯），盆身微歪的窑烧感
    const pot = K.lathe({
      color: P.clay, seg: 7,
      profile: [[0.03, 0], [0.36, 0], [0.44, 0.08], [0.54, 0.42], [0.58, 0.58], [0.62, 0.66]],
    });
    K.jitter(pot, r, { rot: 0.02 });
    g.add(pot);
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.63, rTop: 0.57, h: 0.1, seg: 7 }), 0, 0.61, 0));
    // 干土面：盆口内凹的暗色土盘（枯苗缺水的干裂感）
    g.add(K.put(K.cyl({ color: shade(P.woodDark, -0.2), r: 0.52, h: 0.06, seg: 7, family: 'wood' }), 0, 0.64, 0));
    // 枯枝杈：自土面斜出的枯枝（最后一根折断成短茬），主枝上再杈小枝
    const bn = Math.max(2, Math.min(6, branches));
    for (let i = 0; i < bn; i++) {
      const a = i * (Math.PI * 2 / bn) + 0.4 + r() * 0.5;
      const broken = i === bn - 1; // 一枝折断：短茬不分杈
      const h = broken ? 0.24 + r() * 0.1 : 0.5 + r() * 0.35;
      const dir = [Math.cos(a) * 0.34, 1, Math.sin(a) * 0.3];
      const main = twig({ color: i % 2 ? shade(P.woodDark, 0.06) : P.woodDark, r: 0.045, h, family: 'wood' }, [0, 0.64, 0], dir);
      g.add(main);
      if (broken) continue;
      // 小枝杈：主枝 0.55~0.85 高度处斜挑一两根
      const twigs = r() < 0.55 ? 2 : 1;
      for (let t = 0; t < twigs; t++) {
        const at = 0.55 + r() * 0.3;
        const ta = a + (t ? 1.4 : -1.1) + r() * 0.4;
        g.add(twig(
          { color: shade(P.woodDark, 0.1), r: 0.024, h: 0.2 + r() * 0.15, family: 'wood' },
          [Math.cos(a) * 0.34 * h * at, 0.64 + h * at, Math.sin(a) * 0.3 * h * at],
          [Math.cos(ta) * 0.5, 1, Math.sin(ta) * 0.45],
        ));
      }
    }
    // 落枝：盆边斜搭的一根断落枯枝（贴地半悬）
    if (fallen) {
      const drop = twig({ color: P.woodDark, r: 0.03, h: 0.72, family: 'wood' }, [0.18, 0.07, 0.14], [1, 0.06, 0.55]);
      K.jitter(drop, r, { rot: 0.05 });
      g.add(drop);
    }
    return g;
  },
};
