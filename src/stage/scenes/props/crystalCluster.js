// 晶簇（CATALOG2 编号 84）：「幽光晶柱群」——smallWall（stone 底岩 + unlit 晶柱 双族，
// 不声明 topY：晶顶尖锐不承物）。原点=底面投影中心（高约 5，M 档）；岩座=压扁毛石
// 主团+两块围岩（晶柱自岩缝长出）；中央高棱柱（prism 切面光）+环布外倾晶柱
// （aim 任意朝向、cyl 收尖），晶柱 unlit P.glowCyan 明暗三档轮转读作切面朝向差
// （crystalLamp 先例）。布光职责：tags 声明 lightSource 即「这里有光」——不私设
// PointLight。变体走 build(opts)：晶柱数/中央柱高。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'crystalCluster',
  place: 'smallWall',
  tags: ['stone', 'lightSource', 'arcane'],
  footprint: { x: 4.2, z: 4.2 },
  behaviors: [],
  build({ shards = 5, clusterH = 4.5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crystalCluster');
    const tones = [P.glowCyan, shade(P.glowCyan, -0.26), shade(P.glowCyan, 0.1)];
    // 岩座：主毛石（压扁 jitter 球）+ 两块围岩
    const mound = K.sphereLo({ color: shade(P.rock, -0.02), r: 1, seg: 1, jitter: 0.2, rng: r });
    K.scaleXYZ(mound, 1.6, 0.5, 1.45);
    K.tilt(mound, 0, r() * Math.PI, 0);
    g.add(K.put(mound, 0, 0.3, 0));
    for (const [x, z, s] of [[1.35, -0.8, 0.55], [-1.3, 0.9, 0.42]]) {
      const rock = K.sphereLo({ color: shade(P.rock, 0.1), r: s, seg: 0, jitter: 0.25, rng: r });
      K.tilt(rock, r() * 0.6, r() * Math.PI, r() * 0.6);
      g.add(K.put(rock, x, s * 0.55, z));
    }
    // 中央晶柱：高棱柱微歪（prism 三角剖面对切面光）
    const crown = K.prism({ color: tones[0], size: [0.62, clusterH, 0.62], family: 'unlit' });
    K.tilt(crown, 0.05, r() * 0.5, -0.04);
    g.add(K.put(crown, 0.06, 0.42 + clusterH / 2, 0.04));
    // 环布晶柱：围绕中央柱外倾生长（aim 任意朝向、收尖），明暗三档轮转读作切面朝向差
    const n = Math.max(3, Math.min(7, shards));
    for (let i = 0; i < n; i++) {
      const a = i * (Math.PI * 2 / n) + 0.6;
      const out = 0.35 + r() * 0.2;               // 外倾角（弧度）
      const h = clusterH * (0.3 + r() * 0.26);    // 环柱矮于中央柱
      const rr = 0.5 + r() * 0.3;                 // 根部环半径
      const dir = new THREE.Vector3(
        Math.cos(a) * Math.sin(out), Math.cos(out), Math.sin(a) * Math.sin(out));
      const shard = K.cyl({
        color: tones[(i + 1) % 3], r: 0.24 + r() * 0.08, rTop: 0.03, h, seg: 5, family: 'unlit',
      });
      K.aim(shard, dir.x, dir.y, dir.z);
      g.add(K.put(
        shard,
        Math.cos(a) * rr + (dir.x * h) / 2,
        0.5 + (dir.y * h) / 2,
        Math.sin(a) * rr + (dir.z * h) / 2,
      ));
    }
    // 岩座散晶：两枚小晶芽（亮档点睛）
    for (let i = 0; i < 2; i++) {
      const a = r() * Math.PI * 2;
      const bud = K.prism({ color: tones[2], size: [0.22, 0.5, 0.22], family: 'unlit' });
      K.tilt(bud, 0.2 + r() * 0.2, r() * Math.PI, 0.2);
      g.add(K.put(bud, Math.cos(a) * 1.15, 0.42, Math.sin(a) * 1.05));
    }
    return g;
  },
};
