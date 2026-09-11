// 长条箱（CATALOG2 #28）：「武器运输木匣+封条」——容器类 prop/floor（wood 箱板 + metal 包角 + 石族火漆 三族）。
// 原点=底面中心（y=0 落地），x=长（约 7）；封条=盖面横压封箱条+正面锁片火漆印。
// 变体走 build(opts)：匣长 len / 封条数 battens / 火漆印 seal。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'crateLong',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'barrack'],
  footprint: { x: 7.5, z: 2.3 },
  behaviors: [],
  build({ len = 7, battens = 3, seal = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crateLong');
    const w = len, h = 1.35, d = 1.6;
    // 匣体 + 出檐盖板（压边一圈读作钉死的顶盖）
    const body = K.box({ color: P.wood, size: [w, h, d], family: 'wood' });
    K.jitter(body, r, { rot: 0.01 });
    g.add(K.put(body, 0, h / 2, 0));
    g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.2, 0.22, d + 0.2], family: 'wood' }), 0, h + 0.09, 0));
    // 板缝：长侧各一道横缝细条（读作拼板匣）
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.woodDark, size: [w + 0.02, 0.09, 0.1], family: 'wood',
      }), 0, h * 0.45, sz * (d / 2 + 0.03)));
    }
    // 封条：盖面等距横压的封箱木条（比盖板浅一档读作后钉的压条）
    const n = Math.min(Math.max(battens, 1), 5);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -w * 0.36 + (i * (w * 0.72)) / (n - 1);
      const bar = K.box({ color: shade(P.wood, 0.1), size: [0.38, 0.16, d + 0.34], family: 'wood' });
      if (rng) K.jitter(bar, rng, { rot: 0.008 });
      g.add(K.put(bar, x, h + 0.26, 0));
    }
    // 包角：四角竖楞铁护角
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.iron, size: [0.3, h + 0.1, 0.3], family: 'metal',
      }), sx * (w / 2 - 0.02), (h + 0.1) / 2, sz * (d / 2 - 0.02)));
    }
    // 锁片+火漆印：正面中位的铁锁片，上贴暗红蜡印小圆盘（读作封蜡）
    g.add(K.put(K.box({
      color: shade(P.iron, -0.1), size: [0.55, 0.3, 0.12], family: 'metal',
    }), 0, h * 0.55, d / 2 + 0.05));
    if (seal) {
      const wax = K.cyl({ color: P.potionRed, r: 0.16, h: 0.09, seg: 6 });
      K.tilt(wax, Math.PI / 2 - 0.08, 0, 0);
      g.add(K.put(wax, 0, h * 0.55, d / 2 + 0.13));
    }
    return g;
  },
};
