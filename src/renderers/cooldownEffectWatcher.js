// filepath: src/renderers/cooldownEffectWatcher.js
import frontendEventBus from '@/frontendEventBus.js';

export function initCooldownEffectWatcher() {
  // Simple per-frame batching: id -> latest payload
  const pending = new Map();
  let scheduled = false;

  function flush() {
    scheduled = false;
    for (const [id, payload] of pending.entries()) {
      pending.delete(id);
      try {
        if (!payload || payload.type !== 'cooldown-tick') continue;
        const delta = Number(payload.deltaCooldown);
        const strongCooldown = Number.isFinite(delta) && delta >= 2;
        const reverseCooldown = Number.isFinite(delta) && delta < 0;
        frontendEventBus.emit('overlay:effect:add', {
          id,
          name: 'pulse:cooldown',
          options: { strongCooldown, reverseCooldown, duration: 600 }
        });
      } catch (_) {}
    }
  }

  function onOverlayEffect(evt) {
    try {
      if (!evt || evt.type !== 'cooldown-tick') return;
      const id = evt.id;
      if (id == null) return;
      pending.set(id, evt);
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    } catch (_) {}
  }

  frontendEventBus.on('skill-card-overlay-effect', onOverlayEffect);

  // return disposer
  return () => frontendEventBus.off('skill-card-overlay-effect', onOverlayEffect);
}

