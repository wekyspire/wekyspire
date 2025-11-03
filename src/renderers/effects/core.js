export const EffectKinds = Object.freeze({ STATE: 'state', PULSE: 'pulse', ANIM: 'anim' });

let __idSeq = 0;
export function genEffectId(prefix = 'fx') {
  return `${prefix}-${Date.now().toString(36)}-${(++__idSeq).toString(36)}`;
}

export function isEffect(obj) {
  return !!obj && typeof obj === 'object' && obj.kind && (obj.filters?.length >= 1);
}