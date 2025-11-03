// filepath: src/renderers/effects/index.js
// Effect registry and factory
import { EffectKinds, genEffectId, isEffect } from './core.js';
import createStateDisabled from './state/disabled.js';
import createStateHighlight from './state/highlight.js';
import createPulseCooldown from './pulse/cooldown.js';
import createPulseFlash from './pulse/flash.js';
import createPulseBurn from './pulse/burn.js';
import createAnimHit from './anim/hit.js';

// Local registry: name -> (options) => effect
const registry = new Map();

export function registerEffect(name, factory) {
  if (!name || typeof factory !== 'function') return;
  registry.set(name, factory);
}

// Pre-register built-in effects
registerEffect('state:disabled', createStateDisabled);
registerEffect('state:highlight', createStateHighlight);
registerEffect('pulse:cooldown', createPulseCooldown);
registerEffect('pulse:flash', createPulseFlash);
registerEffect('pulse:burn', createPulseBurn);
registerEffect('anim:hit', createAnimHit);

export function makeEffect(name, options = {}) {
  const factory = registry.get(name);
  if (!factory) {
    console.warn('[effects] Unknown effect name:', name);
    return null;
  }
  try {
    return factory(options) || null;
  } catch (e) {
    console.warn('[effects] Effect factory crashed:', name, e);
    return null;
  }
}

// Re-exports for consumers
export { isEffect, EffectKinds, genEffectId } from './core.js';
