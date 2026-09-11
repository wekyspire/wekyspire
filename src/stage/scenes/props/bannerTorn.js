// 半残旗（CATALOG2 编号 106）：「纹章残片+裂口飘」——wallDecor 中带挂件（cloth+wood 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内；band=mid 挂具在正 y 近原点，同 bannerHerald 口径）：
// 横杆悬旗，上半旗身尚存纹章歪菱（外角缺切=被撕去一角），下半撕裂带竖片左长右短出斜向撕口，
// 中间豁缺一格=裂口，裂口两邻片错折外扬（飘势同 tatteredCloth 下段）。变体走 build(opts)：
// 旗色 hue /飘片数 flutter（0~3）/撕裂竖片数 rag（4~6）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bannerTorn',
  place: 'wallDecor',
  band: 'mid',
  tags: ['cloth', 'barrack'],
  behaviors: [],
  build({ hue = 'red', flutter = 2, rag = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bannerTorn');
    const base = hue === 'red' ? P.bannerRed : P.bannerBlue;
    const crest = hue === 'red' ? shade(P.bannerBlue, 0.02) : shade(P.bannerRed, 0.02);
    const w = 5, upperH = 2.1;
    // 横杆 + 杆头（挂具在正 y 近原点）
    const rod = K.cyl({ color: P.woodDark, r: 0.15, h: w + 1.0, seg: 5, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.72, 0.2));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.07), size: [0.3, 0.42, 0.3], family: 'wood' }), sx * (w / 2 + 0.4), 0.72, 0.2));
    }
    // 上半旗身：自杆垂挂（残旗上半还算完整）
    const body = K.box({ color: base, size: [w, upperH, 0.12], family: 'cloth' });
    K.tilt(body, 0.02, 0, (r() - 0.5) * 0.04);
    g.add(K.put(body, 0, 0.6 - upperH / 2, 0.24));
    // 压暗饰边（旗头一道）
    g.add(K.put(K.box({ color: shade(base, -0.2), size: [w, 0.8, 0.13], family: 'cloth' }), 0, 0.18, 0.28));
    // 纹章残片：歪菱外块（一角缺切=撕缺）+ 残存提亮内芯
    const shard = K.box({ color: crest, size: [2.6, 2.6, 0.16], family: 'cloth' });
    K.tilt(shard, 0, 0, Math.PI / 4 + 0.06);
    K.chip(shard, { corner: [1, 1, 1], amount: 0.55 });
    g.add(K.put(shard, 0.25, -0.55, 0.32));
    const core = K.box({ color: shade(base, 0.16), size: [1.1, 1.1, 0.18], family: 'cloth' });
    K.tilt(core, 0, 0, Math.PI / 4);
    g.add(K.put(core, 0.1, -0.75, 0.36));
    // 下缘撕裂带：竖片长短差出斜向撕口；中间缺一格=裂口（仅留残根窄条）
    const nr = Math.min(Math.max(rag, 4), 6);
    const gap = Math.floor(nr / 2);
    const sw = w / nr - 0.1;
    const tones = [shade(base, 0.06), base, shade(base, -0.12)];
    let flyLeft = Math.min(Math.max(flutter, 0), 3);
    for (let i = 0; i < nr; i++) {
      const x = -w / 2 + (w / nr) * i + sw / 2 + 0.05;
      if (i === gap) {
        g.add(K.put(K.box({ color: tones[i % 3], size: [sw * 0.45, 0.8, 0.1], family: 'cloth' }), x, -1.55, 0.26));
        continue;
      }
      const diag = 1 - (i / nr) * 0.55;          // 左长右短的斜向撕口
      const sl = 2.6 * diag + (r() - 0.5) * 0.5;
      const piece = K.box({ color: tones[i % 3], size: [sw, sl, 0.1], family: 'cloth' });
      K.tilt(piece, 0, 0, (r() - 0.5) * 0.07);
      g.add(K.put(piece, x, -1.15 - sl / 2, 0.26 + (r() - 0.5) * 0.06));
      // 裂口邻片：裂口飘（窄条错折外扬，向裂口侧撇）
      if (flyLeft > 0 && Math.abs(i - gap) === 1) {
        flyLeft--;
        const dir = i < gap ? 1 : -1;
        const fly = K.box({ color: shade(base, -0.05), size: [sw * 0.7, 1.3, 0.09], family: 'cloth' });
        K.tilt(fly, 0, 0, dir * (0.28 + r() * 0.12));
        g.add(K.put(fly, x + dir * 0.2, -2.05, 0.42));
      }
    }
    return g;
  },
};
