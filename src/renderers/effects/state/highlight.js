// filepath: src/renderers/effects/state/highlight.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';

export default function createHighlight(options = {}) {
  const cm = new PIXI.ColorMatrixFilter();
  cm.brightness?.(1.1, false);
  return {
    kind: EffectKinds.STATE,
    name: 'state:highlight',
    id: options.id || genEffectId('state'),
    filters: [cm],
    interrupt() {},
    destroy() { try { cm.destroy?.(); } catch(_) {} }
  };
}

