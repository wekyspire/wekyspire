// 铺盖卷（CATALOG2 #19）：「被卷半开+小枕」——起居类 prop（cloth 单族，bannerBlue 被褥色系）。
// 原点=底面中心（y=0 落地），x=长 z=宽：一端被卷（横置圆柱+端面卷芯+松出的被角），
// 向 +x 摊开褥面（双层错位=被里被面），尽头小枕（压扁 jitter 软球）。
// 变体走 build(opts)：unroll 卷开度（0.5 收拢 ~ 1.3 摊开）；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bedRoll',
  place: 'prop',
  mount: 'floor',
  tags: ['cloth', 'quarters'],
  footprint: { x: 3.6, z: 2.0 },
  behaviors: [],
  build({ unroll = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bedRoll');
    const mat = P.bannerBlue;
    const open = Math.min(Math.max(unroll, 0.5), 1.3);
    // 摊开的褥面：底层褥垫 + 上层薄被错位微搭（两色微差读出层次）
    const padLen = 2.3 * open;
    const pad = K.box({ color: shade(mat, -0.08), size: [padLen, 0.12, 1.5], family: 'cloth' });
    K.tilt(pad, 0, (r() - 0.5) * 0.1, (r() - 0.5) * 0.03);
    g.add(K.put(pad, -0.95 + padLen / 2, 0.06, 0));
    const sheet = K.box({ color: mat, size: [padLen * 0.72, 0.1, 1.4], family: 'cloth' });
    K.tilt(sheet, 0, (r() - 0.5) * 0.08, 0.02);
    g.add(K.put(sheet, -0.9 + (padLen * 0.72) / 2, 0.16, 0.04));
    // 被卷：横置圆柱（沿 z 轴）+ 两端亮色卷芯微凸（卷层断面）
    const roll = K.cyl({ color: mat, r: 0.44, h: 1.55, seg: 7, family: 'cloth' });
    K.tilt(roll, Math.PI / 2, 0, 0);
    g.add(K.put(roll, -1.15, 0.44, 0));
    for (const sz of [-1, 1]) {
      const cap = K.cyl({ color: shade(mat, 0.13), r: 0.31, h: 0.12, seg: 7, family: 'cloth' });
      K.tilt(cap, Math.PI / 2, 0, 0);
      g.add(K.put(cap, -1.15, 0.44, sz * 0.78));
    }
    // 松出的被角：自卷筒上缘斜搭到褥面（「半开」的读法）
    const flap = K.box({ color: shade(mat, 0.05), size: [1.0, 0.08, 1.25], family: 'cloth' });
    K.tilt(flap, 0, (r() - 0.5) * 0.06, -0.7);
    g.add(K.put(flap, -0.62, 0.5, 0.06));
    // 捆带：两道绳箍还挂在卷筒上（半开后松垮）
    for (const sz of [-1, 1]) {
      const strap = K.cyl({ color: P.rope, r: 0.5, h: 0.13, seg: 6, family: 'cloth' });
      K.tilt(strap, Math.PI / 2, 0, 0);
      g.add(K.put(strap, -1.15, 0.44, sz * 0.5));
    }
    // 小枕：压扁 jitter 软球（比被褥亮一档），躺在褥面尽头
    const pillow = K.sphereLo({
      color: shade(mat, 0.16), r: 1, seg: 1, jitter: 0.13, rng: r, family: 'cloth',
    });
    K.scaleXYZ(pillow, 0.95, 0.36, 0.62);
    K.tilt(pillow, 0, r() * Math.PI, 0.03);
    g.add(K.put(pillow, -0.95 + padLen - 0.55, 0.32, 0.08));
    return g;
  },
};
