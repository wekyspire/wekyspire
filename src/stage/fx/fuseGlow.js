// 爆炸引线心跳辉光（blastFuse aura 主题件，L2 笼罩层）：
// 胸口一团随「心跳」搏动的辉光——level 越高（引线越短）搏动越急、色越红。
// 心跳包络 = 双搏（lub-dub：主搏 + 0.18 相位副搏，远比正弦像心跳）；
// 颜色烘两档常量色由 tick 内 lerp（不逐帧改 uniform 节点——Sprite 材质色即直通）。
// 总控一个标量 setLevel(0..1)；逐帧走 unit.addTick；dispose 由宿主层统一调。
import * as THREE from 'three';
import { glowTexture } from './orbs.js';

const COOL = new THREE.Color(1.05, 0.62, 0.22);  // 引线充足：暖橙
const HOT = new THREE.Color(1.55, 0.16, 0.06);   // 引线将尽：白炽红（过 bloom 阈）

/**
 * @param {UnitFxLayer} layer 单位特效宿主（unitFxLayer.js）
 * @returns {{ group, setLevel(0..1), dispose } | null}（headless 无画布 → null）
 */
export function makeFuseGlow(layer) {
  if (typeof document === 'undefined') return null;
  const unit = layer.unit;
  const H = unit._standeeHeight ?? 22;
  const group = new THREE.Group();
  group.name = 'fuseGlow';
  const mat = new THREE.SpriteMaterial({
    map: glowTexture('#ffffff'), color: COOL.clone(),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false,
  });
  const glow = new THREE.Sprite(mat);
  glow.position.set(0, H * 0.5, 0.9);
  group.add(glow);
  layer.groups[2].add(group); // L2 笼罩层
  let level = 0;
  let phase = Math.random(); // 心跳相位（随机起点——多只爆囊不齐步）
  const col = new THREE.Color();
  const untick = unit.addTick((dt) => {
    // 心率随 level 加速：1.1Hz → 2.7Hz（积分相位，变速不跳相）
    phase += dt * (1.1 + 1.6 * level);
    const p = phase % 1;
    // 双搏包络：主搏高窄 + 副搏低宽，相加后截断
    const lub = Math.exp(-((p - 0.12) ** 2) / 0.004);
    const dub = 0.55 * Math.exp(-((p - 0.34) ** 2) / 0.009);
    const env = Math.min(1, lub + dub);
    group.visible = level > 0.02 && !unit._dead;
    const base = H * (0.42 + 0.10 * level);
    const sc = base * (1 + 0.30 * env);
    glow.scale.set(sc, sc, 1);
    col.copy(COOL).lerp(HOT, level);
    mat.color.copy(col).multiplyScalar(0.6 + 0.75 * env);
    mat.opacity = level * (0.30 + 0.55 * env);
  });
  const dispose = () => {
    untick();
    group.parent?.remove(group);
    mat.dispose(); // glowTexture 共享缓存纹理，不销
  };
  return {
    group,
    setLevel(l) { level = Math.max(0, Math.min(1, l)); },
    dispose,
  };
}
