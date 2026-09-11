// 壁装火把（CATALOG #71）：「铁架火把，火苗锥形」——墙饰类范例（金属+unlit 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内），band=mid（中带）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——点光参数走 rooms/lighting.js
// 预设，资产内**不私设 PointLight**（CATALOG §6 横切约定）；火苗用 unlit 族自发光感。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'wallTorch',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal', 'lightSource', 'fire'],
  behaviors: [],
  build({ armLen = 1.15, flameH = 1.8 } = {}) {
    const g = new THREE.Group();
    // 壁座板 + 斜臂（自板面伸向室内上方）+ 托碗
    g.add(K.put(K.box({ color: shade(P.iron, -0.12), size: [1.0, 1.3, 0.22] }), 0, 1.3, 0.11));
    const arm = K.cyl({ color: P.iron, r: 0.15, h: armLen * 1.5, seg: 5, family: 'metal' });
    g.add(K.put(K.tilt(arm, 0.95), 0, 1.0 + armLen * 0.5, armLen * 0.42));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.32, rTop: 0.52, h: 0.5, seg: 6, family: 'metal' }), 0, 1.0 + armLen, armLen * 0.85));
    // 火苗：外锥压暗 + 内芯微降（冷白幽火，同 dungeon3D 语言，防过曝纯白）
    g.add(K.put(K.cone({ color: shade(P.flameCore, -0.34), r: 0.48, h: flameH, seg: 6, family: 'unlit' }), 0, 1.0 + armLen + flameH * 0.52, armLen * 0.85));
    g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.3, h: flameH * 0.6, seg: 5, family: 'unlit' }), 0, 1.0 + armLen + flameH * 0.3, armLen * 0.85));
    return g;
  },
};
