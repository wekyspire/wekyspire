// 吊香炉（CATALOG2 编号 61）：「链摆炉+缕烟感件」——圣所 ceiling 顶挂件（metal+unlit+glass 三族）。
// 原点=天花板锚点：锚座顶面即 y=0，链与炉体自锚点垂挂向下（bbox.max.y≈0、身体在负 y，
// 同 chandelierChain 约定）。链=交替 90° 小环；链底锥形吊罩经三斜杆分力到炉口沿；炉=敞口
// 碗形（lathe 收张轮廓 + 加固沿口），炉膛香炭微光=unlit 冷白幽火（candleStand 同语言），
// 炉口升起缕烟=玻璃族半透明细柱两段错摆（S 曲线读作青烟）。炉体绕挂点微歪出 lean 读作摆。
// 布光职责：tags 声明 lightSource 即"这里有光"——不私设 PointLight（CATALOG §6）。
// 变体走 build(opts)：链长 chainLen / 链环数 links / 摆角 lean / 烟缕数 wisps / 香炭燃否。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'censerChain',
  place: 'prop',
  mount: 'ceiling',
  tags: ['metal', 'lightSource', 'chapel'],
  footprint: { x: 3.4, z: 3.4 },
  behaviors: [],
  build({ chainLen = 7, links = 6, lean = 0.1, wisps = 3, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('censerChain');
    // 天花板锚座（顶面贴原点 y=0）
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.5, rTop: 0.38, h: 0.5, seg: 7, family: 'metal' }), 0, -0.25, 0));
    // 吊链：交替 90° 的链环自锚座底垂挂（环长含搭接，首环藏进锚座；chandelierChain 手法）
    const n = Math.min(Math.max(links, 4), 9);
    const step = (chainLen - 0.5) / n;
    for (let i = 0; i < n; i++) {
      const link = K.cyl({ color: P.iron, r: 0.11, h: step + 0.22, seg: 5, family: 'metal' });
      K.tilt(link, 0, i * Math.PI / 2, 0);
      g.add(K.put(link, 0, -0.5 - step * (i + 0.5), 0));
    }
    // 炉体：挂点建子组再整体微摆（链保持竖直，炉体绕挂点歪出 lean）
    const lamp = new THREE.Group();
    K.tilt(lamp, 0, 0, lean + r() * 0.02);
    g.add(K.put(lamp, 0, -chainLen, 0));
    // 链底锥形吊罩 + 三斜杆：吊罩承接链底，三杆自分罩沿斜张到炉口沿（吊香炉的分力剪影）
    lamp.add(K.put(K.cone({ color: shade(P.iron, 0.06), r: 0.58, h: 0.42, seg: 6, family: 'metal' }), 0, -0.2, 0));
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.5;
      const p0 = new THREE.Vector3(Math.cos(a) * 0.5, -0.38, Math.sin(a) * 0.5);
      const p1 = new THREE.Vector3(Math.cos(a) * 1.2, -1.28, Math.sin(a) * 1.2);
      const d = p1.clone().sub(p0);
      const strut = K.cyl({ color: P.iron, r: 0.05, h: d.length(), seg: 5, family: 'metal' });
      K.aim(strut, d.x, d.y, d.z);
      strut.position.copy(p0).addScaledVector(d, 0.5);
      lamp.add(strut);
    }
    // 炉体碗身：敞口收张轮廓（lathe 自闭底），口沿加固圈承接三斜杆
    lamp.add(K.put(K.lathe({
      color: shade(P.iron, -0.02),
      profile: [[0.02, 0], [0.4, 0.06], [0.85, 0.38], [1.16, 0.72], [1.22, 0.95]],
      seg: 7, family: 'metal',
    }), 0, -2.3, 0));
    lamp.add(K.put(K.cyl({ color: shade(P.iron, 0.1), r: 1.28, rTop: 1.24, h: 0.18, seg: 7, family: 'metal' }), 0, -1.38, 0));
    // 炉膛香炭：unlit 冷白微光球（燃时亮、熄时压暗成冷灰炭堆）
    const coal = lit ? shade(P.flameCore, -0.22) : shade(P.ember, -0.4);
    const coals = K.sphereLo({ color: coal, r: 0.6, seg: 0, family: 'unlit' });
    K.tilt(coals, 0, r() * 0.5, 0);
    lamp.add(K.put(coals, 0, -1.42, 0));
    if (lit) {
      const coal2 = K.sphereLo({ color: shade(P.flameCore, -0.34), r: 0.34, seg: 0, family: 'unlit' });
      lamp.add(K.put(coal2, 0.4, -1.2, 0.3));
    }
    // 缕烟：自炉口升起的半透明玻璃族细柱两段错摆（S 曲线读作青烟，二至四缕）
    const nw = Math.min(Math.max(wisps, 2), 4);
    for (let i = 0; i < nw; i++) {
      const ox = (r() - 0.5) * 0.5, oz = (r() - 0.5) * 0.5;
      const sway = (r() - 0.5) * 0.3;
      const low = K.cyl({ color: shade(P.ember, 0.24), r: 0.26, rTop: 0.17, h: 0.7, seg: 5, family: 'glass' });
      K.tilt(low, sway * 0.4, 0, sway);
      lamp.add(K.put(low, ox, -0.7, oz));
      const high = K.cyl({ color: shade(P.ember, 0.4), r: 0.14, rTop: 0.05, h: 0.9, seg: 5, family: 'glass' });
      K.tilt(high, -sway * 0.5, 0, -sway * 1.4);
      lamp.add(K.put(high, ox - sway * 0.9, 0.1, oz + sway * 0.3));
    }
    return g;
  },
};
