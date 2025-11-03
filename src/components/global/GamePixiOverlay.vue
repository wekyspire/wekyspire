<template>
  <div class="pixi-overlay" ref="host"></div>
</template>

<script>
import PixiAppManager from '@/webgl/PixiAppManager.js'
import animator from '@/utils/animator.js'
import BakeManager from '@/webgl/BakeManager.js'
import frontendEventBus from '@/frontendEventBus.js'
import { makeEffect } from '@/renderers/effects/index.js'

export default {
  name: 'GamePixiOverlay',
  data() {
    return {
      layer: null,
      spriteMap: new Map(),
      effectsById: new Map(),
      _deferredFilters: [],
      _deferredTextures: [],
      _deferredSprites: [],
      _frame: 0
    };
  },
  mounted() {
    const host = this.$refs.host;
    const { app, PIXI, getLayer } = PixiAppManager.init(host);
    this.layer = getLayer('cards-overlay', 1150);
    this.layer.blendMode = PIXI.BLEND_MODES.NORMAL;

    const computeSizeKey = (el) => {
      const n = el?.firstElementChild || el;
      const w = n?.offsetWidth || n?.clientWidth || 0;
      const h = n?.offsetHeight || n?.clientHeight || 0;
      return (w > 0 && h > 0) ? `${w}x${h}` : '';
    };

    // Attach a MutationObserver to watch content changes and enqueue re-bake
    this._attachObserver = (id, rec) => {
      try { rec._observer?.disconnect?.(); } catch(_) {}
      if (!rec?.wrapperEl) { rec._observer = null; return; }
      // const target = rec.wrapperEl;
      // Use internal element
      const target = rec.wrapperEl.firstElementChild || rec.wrapperEl;
      if (!target) { rec._observer = null; return; }
      const cb = () => {
        // debounce per frame
        if (rec._contentRaf) return;
        rec._contentRaf = requestAnimationFrame(() => {
          rec._contentRaf = 0;
          this._requestBake(id);
        });
      };
      const mo = new MutationObserver((muts) => { cb(); });
      try {
        mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
        rec._observer = mo;
      } catch(_) { rec._observer = null; }
    };

    this._ensureRecord = (id) => {
      let rec = this.spriteMap.get(id);
      if (!rec) {
        rec = { sprite: null, bakedTex: null, bakeScale: 1, pendingTex: null, pendingScale: 1, baking: false, wrapperEl: null, sizeKey: '', filtersDirty: true, _observer: null, _contentRaf: 0 };
        this.spriteMap.set(id, rec);
      }
      return rec;
    };

    const onContentUpdated = ({ id }) => {
      const reg = animator.getRegisteredByAdapter('card').find(r => r.id === id);
      if (!reg) return;
      const rec = this._ensureRecord(id);
      rec.wrapperEl = reg.element;
      this._attachObserver(id, rec);
      const key = computeSizeKey(reg.element);
      if (key && rec.sizeKey !== key) { rec.sizeKey = key; rec.baking = false; rec.pendingTex = null; }
      // Always request bake on content update (even if size unchanged)
      this._requestBake(id);
    };
    frontendEventBus.on('card-content-updated', onContentUpdated);
    this._offContentUpdated = () => frontendEventBus.off('card-content-updated', onContentUpdated);

    const onAddEffect = ({ id, name, options }) => { this._addEffect(id, name, options || {}); };
    const onRemoveEffect = ({ id, effectId, name }) => { this._removeEffect(id, { effectId, name }); };
    const onInterruptEffect = ({ id, effectId, name }) => { this._interruptEffect(id, { effectId, name }); };
    frontendEventBus.on('overlay:effect:add', onAddEffect);
    frontendEventBus.on('overlay:effect:remove', onRemoveEffect);
    frontendEventBus.on('overlay:effect:interrupt', onInterruptEffect);
    this._offEffectBus = () => {
      frontendEventBus.off('overlay:effect:add', onAddEffect);
      frontendEventBus.off('overlay:effect:remove', onRemoveEffect);
      frontendEventBus.off('overlay:effect:interrupt', onInterruptEffect);
    };

    this._rebuildFilters = (id, rec) => {
      if (!rec?.sprite) return;
      const list = this.effectsById.get(id) || [];
      const ordered = list.slice().sort((a,b) => { const rank = { state: 0, pulse: 1, anim: 2 }; return (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9); });
      const filters = [];
      for (const fx of ordered) { if (fx?.filters?.length) filters.push(...fx.filters); }
      rec.sprite.filters = filters.length ? filters : null;
      rec.filtersDirty = false;
    };

    this._requestBake = async (id) => {
      const rec = this.spriteMap.get(id);
      if (!rec || !rec.wrapperEl || rec.baking) return;
      rec.baking = true;
      try {
        const contentEl = rec.wrapperEl.firstElementChild || rec.wrapperEl;
        const baked = await BakeManager.enqueue(id, contentEl, {});
        rec.pendingTex = baked.texture;
        rec.pendingScale = baked.scaleUsed || 1;
      } finally {
        rec.baking = false;
      }
    };

    app.ticker.add(() => {
      this._frame++;
      const regs = animator.getRegisteredByAdapter('card');
      const snaps = animator.getTransformsSnapshotByAdapter('card');
      const dt = app.ticker.deltaMS || 16.7;

      // Phase 1: ensure records and trigger bake
      for (const { id, element } of regs) {
        const rec = this._ensureRecord(id);
        if (rec.wrapperEl !== element) rec.wrapperEl = element;
        if (!rec.sizeKey) {
          const key = computeSizeKey(element);
          if (key) { rec.sizeKey = key; this._requestBake(id); }
        }
        // Ensure content observer is attached when element assigned/changed
        if (rec.wrapperEl === element && !rec._observer) this._attachObserver(id, rec);
        if (rec.wrapperEl !== element) { rec.wrapperEl = element; this._attachObserver(id, rec); }
      }

      // Phase 2: commit/new sprites and texture swaps
      for (const [id, rec] of this.spriteMap.entries()) {
        const snap = snaps.find(s => s.id === id);
        if (!snap) continue;
        if (!rec.sprite && rec.pendingTex) {
          const sprite = new PIXI.Sprite(rec.pendingTex);
          sprite.__cardId = id;
          sprite.anchor.set(0.5);
          sprite.eventMode = 'none';
          sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
          this.layer.addChild(sprite);
          rec.sprite = sprite;
          rec.bakedTex = rec.pendingTex;
          rec.bakeScale = rec.pendingScale || 1;
          rec.pendingTex = null;
          rec.filtersDirty = true;
        } else if (rec.sprite && rec.pendingTex) {
          const oldTex = rec.sprite.texture;
          rec.sprite.texture = rec.pendingTex;
          rec.sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
          rec.bakedTex = rec.pendingTex;
          rec.bakeScale = rec.pendingScale || rec.bakeScale || 1;
          rec.pendingTex = null;
          if (oldTex) this._deferredTextures.push(() => { try { oldTex.destroy(true); } catch(_) {} });
          rec.filtersDirty = true;
          rec.applyAfter = this._frame + 1;
        }
      }

      // Phase 3: update effects (pulse/anim), queue finished disposals
      for (const [id, list] of this.effectsById.entries()) {
        if (!list?.length) continue;
        let changed = false;
        for (let i = list.length - 1; i >= 0; i--) {
          const fx = list[i];
          if (typeof fx.update === 'function' && fx.update(dt)) {
            list.splice(i, 1);
            changed = true;
            // defer destroy of effect filters
            if (fx.filters?.length) {
              for (const f of fx.filters) this._deferredFilters.push(() => { try { f.destroy?.(); } catch(_) {} });
            }
          }
        }
        if (changed && (this.spriteMap.get(id)?.sprite)) this.spriteMap.get(id).filtersDirty = true;
        if ((this.effectsById.get(id)?.length || 0) === 0) this.effectsById.delete(id);
      }

      // Phase 4: sync transforms and rebuild filters for dirty sprites
      for (const snap of snaps) {
        const rec = this.spriteMap.get(snap.id);
        if (!rec?.sprite) continue;
        const s = Math.max(1, rec.bakeScale || 1);
        rec.sprite.position.set(snap.cx, snap.cy);
        rec.sprite.scale.set(snap.sx / s, snap.sy / s);
        rec.sprite.rotation = snap.rot;
        rec.sprite.alpha = Math.max(0, Math.min(1, snap.opacity));
        rec.sprite.visible = !!snap.visible;
        if (rec.filtersDirty && (rec.applyAfter == null || this._frame >= rec.applyAfter)) {
          this._rebuildFilters(snap.id, rec);
          delete rec.applyAfter;
        }
      }

      // Phase 5: cleanup missing regs (defer sprite/texture destroys)
      const regIds = new Set(regs.map(r => r.id));
      for (const [id, rec] of [...this.spriteMap.entries()]) {
        if (!regIds.has(id)) {
          if (rec.sprite) {
            try { rec.sprite.filters = null; } catch(_) {}
            try { this.layer.removeChild(rec.sprite); } catch(_) {}
            const toDestroy = rec.sprite;
            this._deferredSprites.push(() => { try { toDestroy.destroy({ children:false, texture:false, baseTexture:false }); } catch(_) {} });
          }
          if (rec.bakedTex) this._deferredTextures.push(() => { try { rec.bakedTex.destroy(true); } catch(_) {} });
          if (rec.pendingTex) this._deferredTextures.push(() => { try { rec.pendingTex.destroy(true); } catch(_) {} });
          try { rec._observer?.disconnect?.(); } catch(_) {}
          this.spriteMap.delete(id);
        }
      }

      // Phase 6: run deferred disposals (from previous frame)
      try {
        const filters = this._deferredFilters; this._deferredFilters = [];
        for (const d of filters) { try { d(); } catch(_) {} }
        const texs = this._deferredTextures; this._deferredTextures = [];
        for (const d of texs) { try { d(); } catch(_) {} }
        const sprites = this._deferredSprites; this._deferredSprites = [];
        for (const d of sprites) { try { d(); } catch(_) {} }
      } catch(_) {}
    });
  },
  methods: {
    _addEffect(id, name, options = {}) {
      const list = this.effectsById.get(id) || [];
      const fx = makeEffect(name, options);
      if (!fx) return null;
      list.push(fx);
      this.effectsById.set(id, list);
      const rec = this.spriteMap.get(id);
      if (rec?.sprite) { rec.filtersDirty = true; rec.applyAfter = this._frame + 1; }
      return fx.id;
    },
    _removeEffect(id, { effectId, name } = {}) {
      const list = this.effectsById.get(id);
      if (!list?.length) return false;
      let removed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const fx = list[i];
        if ((effectId && fx.id === effectId) || (name && fx.name === name)) {
          list.splice(i, 1);
          // defer filter destroy
          if (fx.filters?.length) for (const f of fx.filters) this._deferredFilters.push(() => { try { f.destroy?.(); } catch(_) {} });
          removed = true; if (effectId) break;
        }
      }
      if (removed) {
        const rec2 = this.spriteMap.get(id);
        if (rec2?.sprite) { rec2.filtersDirty = true; rec2.applyAfter = this._frame + 1; }
        if ((this.effectsById.get(id)?.length || 0) === 0) this.effectsById.delete(id);
      }
      return removed;
    },
    _interruptEffect(id, { effectId, name } = {}) {
      const list = this.effectsById.get(id);
      if (!list?.length) return false;
      let changed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const fx = list[i];
        const matched = (effectId && fx.id === effectId) || (name && fx.name === name) || (!effectId && !name && fx.kind === 'anim');
        if (matched) {
          try { fx.interrupt?.(); } catch(_) {}
          list.splice(i, 1);
          if (fx.filters?.length) for (const f of fx.filters) this._deferredFilters.push(() => { try { f.destroy?.(); } catch(_) {} });
          changed = true; if (effectId) break;
        }
      }
      if (changed) {
        const rec3 = this.spriteMap.get(id);
        if (rec3?.sprite) { rec3.filtersDirty = true; rec3.applyAfter = this._frame + 1; }
        if ((this.effectsById.get(id)?.length || 0) === 0) this.effectsById.delete(id);
      }
      return changed;
    }
  },
  beforeUnmount() {
    try { this._offContentUpdated?.(); } catch(_) {}
    try { this._offEffectBus?.(); } catch(_) {}
    for (const [, rec] of this.spriteMap.entries()) {
      try { rec.sprite && (rec.sprite.filters = null); } catch(_) {}
      try { rec.sprite && this.layer.removeChild(rec.sprite); } catch(_) {}
      if (rec.sprite) this._deferredSprites.push(() => { try { rec.sprite.destroy({ children:false, texture:false, baseTexture:false }); } catch(_) {} });
      if (rec.bakedTex) this._deferredTextures.push(() => { try { rec.bakedTex.destroy(true); } catch(_) {} });
      if (rec.pendingTex) this._deferredTextures.push(() => { try { rec.pendingTex.destroy(true); } catch(_) {} });
      try { rec._observer?.disconnect?.(); } catch(_) {}
    }
    // flush disposals immediately
    for (const d of this._deferredFilters) { try { d(); } catch(_) {} }
    for (const d of this._deferredTextures) { try { d(); } catch(_) {} }
    for (const d of this._deferredSprites) { try { d(); } catch(_) {} }
    this.spriteMap.clear();
    this.effectsById.clear();
  }
}
</script>

<style scoped>
.pixi-overlay {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 1100;
  background-color: transparent;
}
</style>
