import { describe, it, expect } from 'vitest';
import { renderRichTextBlock } from '../src/stage/richtext/texture.js';

// mock canvas：记录调用，验证烘焙序列与成对替换契约
function createMockCanvas() {
  const calls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      calls,
      scale: (s) => calls.push(['scale', s]),
      fillText: (ch, x, y) => calls.push(['fillText', ch, x, y]),
      strokeText: (ch, x, y) => calls.push(['strokeText', ch, x, y]),
      measureText: (t) => ({ width: t.length * 10 }),
      set font(v) {}, set fillStyle(v) {}, set textBaseline(v) {},
      set lineJoin(v) {}, set lineWidth(v) {}, set strokeStyle(v) {},
    }),
  };
  return {
    calls,
    canvas,
    factory: (w, h) => { canvas.width = w; canvas.height = h; return canvas; },
  };
}

describe('richtext/texture', () => {
  it('产出 texture + hitRegions 成对结果', () => {
    const mock = createMockCanvas();
    const r = renderRichTextBlock('看/named{瑞米}', {
      measure: (t) => t.length * 10,
      createCanvas: mock.factory,
      scale: 2,
    });
    expect(r.texture).toBeTruthy();
    expect(r.hitRegions).toHaveLength(1);
    expect(r.hitRegions[0].payload.name).toBe('瑞米');
    // 排版尺寸是局部坐标（与 scale 无关）
    expect(r.width).toBe(30);
    // canvas 内部像素是 scale 倍
    expect(mock.canvas.width).toBe(60);
  });

  it('textStroke：先描边全部字形、再填充（描边不咬前字填充）；缺省不描边', () => {
    const plain = createMockCanvas();
    renderRichTextBlock('ab', { measure: (t) => t.length * 10, createCanvas: plain.factory, scale: 2 });
    expect(plain.calls.filter(c => c[0] === 'strokeText')).toHaveLength(0);

    const mock = createMockCanvas();
    renderRichTextBlock('ab', {
      measure: (t) => t.length * 10, createCanvas: mock.factory, scale: 2,
      textStroke: { width: 4 },
    });
    const kinds = mock.calls.map(c => c[0]);
    const strokes = kinds.filter(k => k === 'strokeText');
    const fills = kinds.filter(k => k === 'fillText');
    expect(strokes).toHaveLength(2);
    expect(fills).toHaveLength(2);
    // 两遍次序：所有 strokeText 排在所有 fillText 之前
    expect(kinds.lastIndexOf('strokeText')).toBeLessThan(kinds.indexOf('fillText'));
  });
});
