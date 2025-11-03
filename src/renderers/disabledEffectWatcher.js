// filepath: src/renderers/disabledEffectWatcher.js
// Watches reactive game state and toggles Pixi overlay disabled effect for in-scene skills
import { computed, watch } from 'vue';
import { displayGameState } from '@/data/gameState.js';
import frontendEventBus from '@/frontendEventBus.js';

function getInSceneSkills(player) {
  try {
    const arr = Array.isArray(player?.skills) ? player.skills : [];
    return arr.filter(s => s && s.uniqueID != null);
  } catch(_) { return []; }
}

export function initDisabledEffectWatcher() {
  const player = computed(() => displayGameState.player);

  // Build a computed map: id -> disabled:boolean for all in-scene skills
  const disabledMap = computed(() => {
    const p = player.value;
    const modified = typeof p?.getModifiedPlayer === 'function' ? p.getModifiedPlayer() : p;
    const list = getInSceneSkills(p);
    const map = new Map();
    for (const s of list) {
      let disabled = true;
      try { disabled = !s.canUse(modified); } catch (_) { disabled = true; }
      map.set(s.uniqueID, !!disabled);
    }
    return map;
  });

  const prev = new Map();
  let scheduled = false;
  let pendingMap = null;

  const flush = () => {
    scheduled = false;
    const nextMap = pendingMap || disabledMap.value;
    pendingMap = null;

    // Remove effects for ids no longer present
    for (const [prevId, wasDisabled] of prev.entries()) {
      if (!nextMap.has(prevId)) {
        if (wasDisabled) {
          frontendEventBus.emit('overlay:effect:remove', { id: prevId, name: 'state:disabled' });
        }
        prev.delete(prevId);
      }
    }

    // Toggle per id
    for (const [id, isDisabled] of nextMap.entries()) {
      const wasDisabled = prev.get(id);
      if (wasDisabled === undefined) {
        if (isDisabled) {
          frontendEventBus.emit('overlay:effect:add', { id, name: 'state:disabled', options: {} });
        } else {
          frontendEventBus.emit('overlay:effect:remove', { id, name: 'state:disabled' });
        }
        prev.set(id, isDisabled);
        continue;
      }
      if (wasDisabled !== isDisabled) {
        if (isDisabled) {
          frontendEventBus.emit('overlay:effect:add', { id, name: 'state:disabled', options: {} });
        } else {
          frontendEventBus.emit('overlay:effect:remove', { id, name: 'state:disabled' });
        }
        prev.set(id, isDisabled);
      }
    }
  };

  // Batch updates per animation frame
  watch(disabledMap, (nextMap) => {
    pendingMap = nextMap;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });

  // Initial flush on next frame
  requestAnimationFrame(() => { pendingMap = disabledMap.value; flush(); });
}
