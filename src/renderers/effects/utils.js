// filepath: src/renderers/effects/utils.js
// Helpers for ColorMatrix adjustments
export function setDesaturate(filter, amount = 1) {
  // amount: 0..1, 1 fully grayscale
  const inv = 1 - amount;
  const r = 0.2126 * amount + inv;
  const g = 0.7152 * amount + inv;
  const b = 0.0722 * amount + inv;
  filter.matrix = [
    r, 0.2126 * inv, 0.2126 * inv, 0, 0,
    0.7152 * inv, g, 0.7152 * inv, 0, 0,
    0.0722 * inv, 0.0722 * inv, b, 0, 0,
    0, 0, 0, 1, 0
  ];
}

