// filepath: src/renderers/effects/pulse/flash.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';

export default function createFlash(options = {}) {
  const alpha = new PIXI.AlphaFilter(1);
  const duration = options.duration ?? 300;
  let t = 0;
  return {
    kind: EffectKinds.PULSE,
    name: 'pulse:flash',
    id: options.id || genEffectId('pulse'),
    filters: [alpha],
    update(dt) {
      t += dt;
      const phase = Math.min(1, t / duration);
      const s = 0.5 - Math.cos(phase * Math.PI) * 0.5; // 0..1
      alpha.alpha = 0.5 + s * 0.5;
      return t >= duration;
    },
    interrupt() {},
    destroy() { try { alpha.destroy?.(); } catch(_) {} }
  };
}

