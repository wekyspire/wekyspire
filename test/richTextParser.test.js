import { describe, it, expect } from 'vitest';
import { parseRichText, isInteractiveToken } from '../src/stage/richtext/parser.js';

describe('richtext/parser', () => {
  it('空输入返回空数组', () => {
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText(undefined)).toEqual([]);
  });

  it('纯文本原样输出', () => {
    expect(parseRichText('造成 3 点伤害')).toEqual([
      { type: 'text', content: '造成 3 点伤害' },
    ]);
  });

  it('颜色 token', () => {
    expect(parseRichText('造成 /red{3} 点伤害')).toEqual([
      { type: 'text', content: '造成 ' },
      { type: 'color', color: 'red', content: '3' },
      { type: 'text', content: ' 点伤害' },
    ]);
  });

  it('effect / named / card 不被颜色正则吞掉', () => {
    const tokens = parseRichText('/effect{燃烧} /named{瑞米} /card{slash}');
    expect(tokens).toEqual([
      { type: 'effect', effectName: '燃烧' },
      { type: 'text', content: ' ' },
      { type: 'named', content: '瑞米' },
      { type: 'text', content: ' ' },
      { type: 'card', cardId: 'slash', params: {} },
    ]);
  });

  it('card 卡参数解析（k=v 对，值恒为字符串；裸段丢弃）', () => {
    expect(parseRichText('/card{ironShard, damage=10, tier=B}')).toEqual([
      { type: 'card', cardId: 'ironShard', params: { damage: '10', tier: 'B' } },
    ]);
    expect(parseRichText('/card{instantStrike}')).toEqual([
      { type: 'card', cardId: 'instantStrike', params: {} },
    ]);
  });

  it('多段混合保持源顺序', () => {
    const tokens = parseRichText('用 /named{瑞米} 的 /card{throwingKnife} 造成 /red{5} 伤害');
    expect(tokens.map(t => t.type)).toEqual(['text', 'named', 'text', 'card', 'text', 'color', 'text']);
  });

  it('named / card / effect 是可交互热区，其余不是', () => {
    expect(isInteractiveToken({ type: 'named' })).toBe(true);
    expect(isInteractiveToken({ type: 'card' })).toBe(true);
    expect(isInteractiveToken({ type: 'effect' })).toBe(true);
    expect(isInteractiveToken({ type: 'text' })).toBe(false);
    expect(isInteractiveToken({ type: 'color' })).toBe(false);
  });
});
