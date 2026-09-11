import { describe, it, expect } from 'vitest';
import { DisplayModel } from '../src/bridge/displayModel.js';

// DisplayModel（run 级显示状态权威）：纯数据迁移语义，无 three 依赖。
// 结构契约：卡条目与战斗同寿命、zone 迁移无建毁——这是"幽灵抽牌/入手消失"
// 类差分翻动 bug 的结构性根治，也是跨场景（battle/room/tower）共享状态面的地基。

describe('DisplayModel 卡牌注册表', () => {
  it('ensureCard 幂等；setZone 返回迁移记录且只在变化时返回', () => {
    const m = new DisplayModel();
    m.ensureCard('a', 'deck');
    m.ensureCard('a', 'deck'); // 幂等
    expect(m.cards.size).toBe(1);

    expect(m.setZone('a', 'deck')).toBeNull();           // 无变化
    expect(m.setZone('a', 'hand')).toEqual({ from: 'deck', to: 'hand' });
    expect(m.setZone('a', 'discard')).toEqual({ from: 'hand', to: 'discard' });
    expect(m.getZone('a')).toBe('discard');
  });

  it('removeCard 出册；beginBattle 清空卡牌面（模型跨场存活，内容按场重置）', () => {
    const m = new DisplayModel();
    m.ensureCard('a', 'hand');
    m.ensureCard('b', 'deck');
    expect(m.removeCard('a')).toBe(true);
    expect(m.removeCard('a')).toBe(false); // 重复移除
    expect(m.get('a')).toBeNull();

    m.beginBattle();
    expect(m.cards.size).toBe(0);
    expect(m.getZone('b')).toBeNull();
  });

  it('事件面：card-created / card-zone / card-removed 供跨层视图订阅', () => {
    const m = new DisplayModel();
    const events = [];
    m.on('card-created', (e) => events.push(['created', e.id, e.zone]));
    m.on('card-zone', (e) => events.push(['zone', e.id, e.from, e.to]));
    m.on('card-removed', (e) => events.push(['removed', e.id]));

    m.setZone('x', 'hand');       // ensureCard + 无迁移（首见即落位）→ created
    m.setZone('x', 'discard');    // 迁移
    m.removeCard('x');
    expect(events).toEqual([
      ['created', 'x', 'hand'],
      ['zone', 'x', 'hand', 'discard'],
      ['removed', 'x'],
    ]);
  });
});
