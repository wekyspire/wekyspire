// filepath: src/renderers/effects/anim/hit.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';
import frontendEventBus from '@/frontendEventBus.js';

export default function createHit(options = {}) {
  const cm = new PIXI.ColorMatrixFilter();
  const duration = options.duration ?? 400;
  let t = 0;
  return {
    kind: EffectKinds.ANIM,
    name: 'anim:hit',
    id: options.id || genEffectId('anim'),
    filters: [cm],
    update(dt) {
      t += dt;
      const phase = Math.min(1, t / duration);
      const k = 1 - phase;
      cm.matrix = [
        1 + 0.8 * k, 0, 0, 0, 0,
        0, 1 - 0.6 * k, 0, 0, 0,
        0, 0, 1 - 0.6 * k, 0, 0,
        0, 0, 0, 1, 0
      ];
      return t >= duration;
    },
    interrupt() { t = duration; },
    onFinished(payload) {
      const { spriteId, effectId, instructionId } = payload || {};
      if (instructionId) {
        frontendEventBus.emit('overlay:anim-effect-finished', { id: spriteId, effectId, name: 'anim:hit', instructionId });
      } else {
        frontendEventBus.emit('overlay:anim-effect-finished', { id: spriteId, effectId, name: 'anim:hit' });
      }
    },
    destroy() { try { cm.destroy?.(); } catch(_) {} }
  };
}

