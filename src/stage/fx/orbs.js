// 环绕火球挂接件（多部件敌人首件，fx Phase 5，2026-09-23）：
// 敌人 def 声明 orbs: { count, color, radius, height, size, speed, bob }，
// BattleStage 建视图时挂上；球体 = THREE.Sprite（恒屏向 billboard）+ 程序化
// 径向光晕纹理（无美术素材的缺省占位，颜色即主题，按色缓存）。
// 轨道参数挂在 group.userData.orbit——**公开可写、tick 逐帧读**（与 emitter.rate
// 同惯例）：剧本 tweenRaw 直推半径/转速/尺寸就是「狂暴化」演出，无需专用 API。
import * as THREE from 'three';

const _texCache = new Map(); // color → THREE.CanvasTexture

// 占位光晕：白热芯 → 主题色 → 透明（径向渐变；additive 混合下读出火球感）
function orbTexture(color) {
  if (_texCache.has(color)) return _texCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,240,0.95)');
  grad.addColorStop(0.35, `rgba(${rgb},0.85)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(color, tex);
  return tex;
}

/**
 * 给单位视图挂上环绕火球组（部件名 'orbs'）。
 * @returns {{ group, dispose } | null}（headless 无画布 → null，纯视觉附件跳过即安）
 */
export function attachOrbs(unit, def = {}) {
  if (typeof document === 'undefined') return null;
  const { count = 3, color = 0xff8a3a, radius = 2.4, height = 3.2,
    size = 1.2, speed = 1.4, bob = 0.35 } = def;
  const group = new THREE.Group();
  group.name = 'orbs';
  const tex = orbTexture(color);
  const sprites = [];
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    group.add(s);
    sprites.push(s);
  }
  group.userData.orbit = { radius, speed, size, height, bob }; // 剧本可写参数
  unit.add(group);
  unit.parts.set('orbs', group);
  let t = Math.random() * Math.PI * 2; // 相位随机：多单位带火球不同步转
  const untick = unit.addTick((dt) => {
    const o = group.userData.orbit;
    t += dt * o.speed;
    group.visible = !unit._dead; // 宿主死亡：火球熄（不在尸体上转）
    for (let i = 0; i < sprites.length; i++) {
      const a = t + (i * Math.PI * 2) / sprites.length;
      sprites[i].position.set(
        Math.cos(a) * o.radius,
        o.height + Math.sin(t * 2.1 + i * 2.4) * o.bob,
        Math.sin(a) * o.radius * 0.55, // 椭圆轨道（压扁纵深，绕体感）
      );
      const sc = o.size * (1 + 0.12 * Math.sin(t * 3.3 + i * 1.7)); // 呼吸脉动
      sprites[i].scale.set(sc, sc, 1);
    }
  });
  return {
    group,
    dispose: () => { untick(); unit.remove(group); unit.parts.delete('orbs'); },
  };
}
