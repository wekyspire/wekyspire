import { describe, it, expect } from 'vitest';
import { parseRichText } from '../src/stage/richtext/parser.js';
import { layoutRichText } from '../src/stage/richtext/layout.js';

// 假 measure：等宽 10px，icon 不经过 measure
const fakeMeasure = (text) => text.length * 10;
const layout = (text, opts = {}) =>
  layoutRichText(parseRichText(text), { maxWidth: 100, measure: fakeMeasure, ...opts });

describe('richtext/layout', () => {
  it('纯文本单行放置', () => {
    const r = layout('你好');
    expect(r.width).toBe(20);
    expect(r.height).toBe(22);
    expect(r.placements).toHaveLength(2);
    expect(r.placements[0]).toMatchObject({ kind: 'glyph', char: '你', x: 0, y: 0, width: 10 });
    expect(r.hitRegions).toEqual([]);
  });

  it('超宽自动换行', () => {
    const r = layout('一二三四五六七八九十甲乙'); // 12 字，每行最多 10
    expect(r.height).toBe(44);
    expect(r.placements[10]).toMatchObject({ char: '甲', x: 0, y: 22 });
  });

  it('named token 产出 hitRegion', () => {
    const r = layout('看 /named{瑞米} 吧');
    expect(r.hitRegions).toHaveLength(1);
    expect(r.hitRegions[0]).toEqual({
      type: 'named',
      payload: { name: '瑞米' },
      rect: { x: 20, y: 0, w: 20, h: 22 },
    });
  });

  it('named 跨行时每行各产一个 hitRegion', () => {
    const r = layout('一二三四五六七八九/named{甲乙丙丁}'); // named 从 x=90 开始，第二字换行
    expect(r.hitRegions).toHaveLength(2);
    expect(r.hitRegions[0].rect).toEqual({ x: 90, y: 0, w: 10, h: 22 });
    expect(r.hitRegions[1].rect).toEqual({ x: 0, y: 22, w: 30, h: 22 });
  });

  it('card token = 图标 + 反查卡名文本（特征色），两段都是热区且携带 id 与参数', () => {
    const r = layout('/card{ironShard, damage=10}', {
      resolveCard: (id) => (id === 'ironShard' ? { name: '碎铁', color: '#c9a06a' } : {}),
    });
    const icon = r.placements.find(p => p.kind === 'icon');
    expect(icon).toMatchObject({ iconType: 'card', name: '碎铁' });
    // 印出的是反查到的卡名而非 id
    expect(r.placements.filter(p => p.kind === 'glyph').map(g => g.char).join('')).toBe('碎铁');
    expect(r.hitRegions.length).toBe(2);
    expect(r.hitRegions.every(h => h.type === 'card'
      && h.payload.cardId === 'ironShard' && h.payload.params.damage === '10')).toBe(true);
  });

  it('effect token = 图标 + 特征色名称文本，两段都是热区', () => {
    const r = layout('施加/effect{燃烧}吧', { resolveEffect: () => ({ color: 'red' }) });
    const icon = r.placements.find(p => p.kind === 'icon');
    expect(icon).toMatchObject({ iconType: 'effect', name: '燃烧', x: 20 });
    // 名称文本作为 glyph 放置（特征色经颜色表解析）
    const glyphs = r.placements.filter(p => p.kind === 'glyph');
    expect(glyphs.map(g => g.char).join('')).toBe('施加燃烧吧');
    const nameGlyph = glyphs.find(g => g.char === '燃');
    expect(nameGlyph.style.color).toBe('#ff4444');
    // 图标 + 名称文本各一个热区
    const regions = r.hitRegions.filter(h => h.type === 'effect');
    expect(regions.length).toBe(2);
    expect(regions.every(h => h.payload.name === '燃烧')).toBe(true);
    expect(regions[0].rect.x).toBe(20); // 图标（前两个字之后）
    expect(regions[1].rect.x).toBe(40); // 名称文本（图标 18+gap 2 之后）
  });

  it('颜色 token 不改变布局只改样式', () => {
    const r = layout('/red{危险}');
    expect(r.placements).toHaveLength(2);
    expect(r.placements[0].style.color).toBe('#ff4444');
  });

  it('缺 measure 抛错', () => {
    expect(() => layoutRichText([], { maxWidth: 100 })).toThrow();
  });
});
