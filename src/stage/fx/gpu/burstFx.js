// 一次性爆发 burst 门面（CPU 粒子池退役批）：以旧 `particles.spawn(x, y, opts)`
// 同名签名承接存量爆发调用，落点 = 粒子池 v2 的 uber 类型 burst。
//   · 参数签名（color/speed/ttl/gravity/size）→ 懒登记 uber 类型 + Map 缓存去重
//     （同参数效果复用同段；类型行表 32/池上限内，cap 128 够峰值爆发三连发）；
//   · 出生点 (x, y, z) 走 per-burst `at`（多爆发并发指向不同点位互不惊扰）；
//   · 渲染口径对齐旧点粒子：radial ≈ speed×0.9（旧逐粒子 0.5~1.3 随机的均值带），
//     ttlJit 0.3 ≈ 旧 ±30%，alpha×(1-age) 同旧线性淡出，ageHeat 补逐粒子亮度抖动的层次。
// 旧 CPU 池的文本/贴图粒子与剧本 emitter 由 floatFx.js 承接（见该文件头）。

import * as THREE from 'three';
import { defineParticleType } from './particleTypes.js';
import { createFloatFx } from '../floatFx.js';

/**
 * 组合门面：spawn 走 GPU 池 burst；spawnText/spawnSprite/spawnEmitter/update 与
 * points/sprites/spritesUI 容器、activeCount 读数转接 floatFx——调用点零改动。
 * @param {object|null} worldPool 粒子池 v2 世界实例（null = 无 WebGPU，spawn 静默跳过）
 */
export function createBurstFacade(worldPool) {
  const floatFx = createFloatFx();
  const typeCache = new Map();

  function spawn(x, y, o = {}) {
    if (!worldPool) return;
    const speed = o.speed ?? 20;
    const ttl = o.ttl ?? 0.55;
    const gravity = o.gravity ?? -30;
    const size = o.size ?? 1.2;
    const colorHex = o.color ?? 0xff5533;
    const key = `${colorHex}|${speed}|${ttl}|${gravity}|${size}`;
    let typeId = typeCache.get(key);
    if (typeId == null) {
      const c = new THREE.Color(colorHex);
      typeId = defineParticleType({
        name: `burst${typeCache.size}`,
        space: 'world',
        cap: 128,
        spawn: { rate: 0, ttl, ttlJit: 0.3, vel: [0, 0, 0], radial: speed * 0.9, gravity },
        render: { size, sizeEndK: 0.4, color: [c.r, c.g, c.b], ageHeat: 0.35 },
      });
      typeCache.set(key, typeId);
    }
    worldPool.burst(typeId, o.count ?? 14, { at: [x, y, o.z ?? 70] });
  }

  return {
    spawn,
    spawnText: floatFx.spawnText,
    spawnSprite: floatFx.spawnSprite,
    spawnEmitter: floatFx.spawnEmitter,
    update: floatFx.update,
    get points() { return floatFx.points; },
    get sprites() { return floatFx.sprites; },
    get spritesUI() { return floatFx.spritesUI; },
    get activeCount() { return floatFx.activeCount; },
    get activeSpriteCount() { return floatFx.activeSpriteCount; },
  };
}
