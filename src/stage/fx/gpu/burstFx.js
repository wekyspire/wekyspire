// 一次性爆发 burst 门面（CPU 粒子池退役批）：以旧 `particles.spawn(x, y, opts)`
// 同名签名承接存量爆发调用，落点 = 粒子池 v2 的 uber 类型 burst。
//   · 参数签名（color/speed/ttl/gravity/size）→ 懒登记 uber 类型 + Map 缓存去重
//     （同参数效果复用同段；类型行表 32/池上限内，cap 128 够峰值爆发三连发）；
//   · 出生点 (x, y, z) 走 per-burst `at`（多爆发并发指向不同点位互不惊扰）；
//   · 渲染口径对齐旧点粒子：radial ≈ speed×0.9（旧逐粒子 0.5~1.3 随机的均值带），
//     ttlJit 0.3 ≈ 旧 ±30%，alpha×(1-age) 同旧线性淡出，ageHeat 补逐粒子亮度抖动的层次。
// CPU/GPU 分工（2026-10-07 用户定，细则见 AGENTS）：spawn/spawnEmitter = GPU（默认路径，
// 后者经 ambientMotes 桥承载）；floatFx 只承接 spawnText/spawnSprite（per-粒子纹理/文本
// 且总量十几个以内——CPU 双条件职责）。

import * as THREE from 'three';
import { defineParticleType, getParticleType } from './particleTypes.js';
import { createFloatFx } from '../floatFx.js';
import { createAmbientEmitterBridge } from './ambientMotes.js';

const BURST_TYPE_CACHE = new Map();   // 参数组合 → 类型 id（模块级跨局共享）

/**
 * 组合门面：spawn 走 GPU 池 burst；spawnEmitter 走 ambientMotes 桥（GPU custom
 * 类型）；spawnText/spawnSprite 与 sprites/spritesUI 容器转接 floatFx。
 * @param {object|null} worldPool 粒子池 v2 世界实例（null = 无 WebGPU，spawn/
 *   发射器静默降级为无操作句柄——headless 无渲染诉求）
 */
export function createBurstFacade(worldPool, getCamera = null) {
  const floatFx = createFloatFx();
  const ambience = createAmbientEmitterBridge(worldPool, getCamera);
  const nullEmitter = () => ({ rate: 0, stopped: true, stop() {}, setPosition() {} });

  function spawn(x, y, o = {}) {
    if (!worldPool) return;
    const speed = o.speed ?? 20;
    const ttl = o.ttl ?? 0.55;
    const gravity = o.gravity ?? -30;
    const size = o.size ?? 1.2;
    const colorHex = o.color ?? 0xff5533;
    // vx/vy：可选方向偏移初速（世界单位/秒；缺省 0 = 纯径向爆散，旧组合缓存键不变）。
    // 量化到 0.25：方向来自逐敌位置（连续值），不量化会让模块级类型缓存无限增生、
    // 打满池类型行后爆发静默丢失；0.25 的粒度对视觉无感。
    const vx = Math.round((o.vx ?? 0) * 4) / 4;
    const vy = Math.round((o.vy ?? 0) * 4) / 4;
    const bias = (vx || vy) ? `|${vx},${vy}` : '';
    const key = `${colorHex}|${speed}|${ttl}|${gravity}|${size}${bias}`;
    let typeId = BURST_TYPE_CACHE.get(key);
    // 缓存兼容墓碑：闲置泵可能已回收该组合（在用组合每 2s 被摸活行保活，回收的
    // 只会是淡出组合）——命中死 id 就重登记，缓存照常复用
    if (typeId == null || !getParticleType(typeId)) {
      const c = new THREE.Color(colorHex);
      typeId = defineParticleType({
        name: `burst${key}`,
        space: 'world',
        cap: 128,
        recyclable: true,   // 闲置泵可回收：一次性爆发，淡出组合不占常驻额度
        spawn: { rate: 0, ttl, ttlJit: 0.3, vel: [vx, vy, 0], radial: speed * 0.9, gravity },
        render: { size, sizeEndK: 0.4, color: [c.r, c.g, c.b], ageHeat: 0.35 },
      });
      // 模块级共享（夜测 1002 [r2路8] 根因）：缓存原是每战斗实例一份，同组合每局重复
      // 登记新类型——全局注册表跨局只增不减，单局 >32 种组合即打满池类型行、之后爆发
      // 全部静默丢失。共享后一组合一类型，跨局复用（回收后重登记也走这里）。
      BURST_TYPE_CACHE.set(key, typeId);
    }
    worldPool.burst(typeId, o.count ?? 14, { at: [x, y, o.z ?? 70] });
  }

  return {
    spawn,
    spawnText: floatFx.spawnText,
    spawnSprite: floatFx.spawnSprite,
    spawnEmitter: (x, y, o) => (ambience ? ambience.spawnEmitter(x, y, o) : nullEmitter()),
    update: (dt) => { floatFx.update(dt); ambience?.update(dt); },
    dispose: () => { ambience?.dispose(); },   // 桥拆：发射器类型登记就地回收（舞台 dispose 调，先于池 dispose）
    get sprites() { return floatFx.sprites; },
    get spritesUI() { return floatFx.spritesUI; },
    get activeSpriteCount() { return floatFx.activeSpriteCount; },
  };
}
