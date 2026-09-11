import { describe, it, expect } from 'vitest';
import { LayoutEngine, HAND_FAN_MECHANICS } from '../src/stage/layout/LayoutEngine.js';

// 手牌扇容器：与 BattleStage 注册的几何参数同构（避让状态栏/牌库、下缘可出屏）
const HAND = {
  minX: -46, maxX: 64, baseY: -51.3,
  minStep: 13.5, maxStep: 27.3, radius: 95,
  arcDegMin: 5, arcGrowFrom: 4, arcDegFull: 52,
  liftY: -46.5,
};
const CX = (HAND.minX + HAND.maxX) / 2;

function make() {
  const le = new LayoutEngine();
  le.registerContainer('hand', HAND);
  return le;
}

describe('LayoutEngine 手牌扇形布局', () => {
  it('单牌正落于扇心（水平居中、baseY 高度、零旋转）', () => {
    const le = make();
    const m = le.layoutHand('hand', ['a']);
    expect(m.get('a')).toMatchObject({ x: CX, y: HAND.baseY, scale: 1, rotation: 0 });
  });

  it('少量牌（≤5）全松步长：相邻间距 = maxStep，整体沿弧对称展开', () => {
    const le = make();
    const m = le.layoutHand('hand', ['a', 'b', 'c']);
    const xs = ['a', 'b', 'c'].map(id => m.get(id).x);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
    // 弦距近似步长（微幅弧差），远大于满扇重叠间距
    expect(xs[1] - xs[0]).toBeGreaterThan(HAND.minStep + 5);
    // 中间卡在弧顶（y 最高），边缘下垂
    expect(m.get('b').y).toBeGreaterThan(m.get('a').y);
  });

  it('张数越多步长越紧：6→10 张相邻弦距单调递减，10 张压到 minStep 级重叠', () => {
    const le = make();
    let prevStep = Infinity;
    for (let n = 5; n <= 10; n++) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const m = le.layoutHand('hand', ids);
      const s = m.get('c1').x - m.get('c0').x;
      expect(s).toBeLessThan(prevStep);
      prevStep = s;
    }
    expect(prevStep).toBeLessThan(HAND.maxStep * 0.75); // 深度重叠态
  });

  it('水平区间硬护栏：任意张数卡中心不越 [minX, maxX]，且无 NaN', () => {
    const le = make();
    for (const n of [1, 3, 7, 10, 40]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const m = le.layoutHand('hand', ids);
      for (const id of ids) {
        const a = m.get(id);
        expect(Number.isFinite(a.x)).toBe(true);
        expect(a.x).toBeGreaterThanOrEqual(HAND.minX - 1e-6);
        expect(a.x).toBeLessThanOrEqual(HAND.maxX + 1e-6);
      }
    }
  });

  it('扇形几何：旋转随外扩增大、左倾为正右倾为负、边缘低于中位（下垂允许出屏方向）', () => {
    const le = make();
    const ids = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const m = le.layoutHand('hand', ids);
    const mid = m.get('c4');
    const left = m.get('c0');
    const right = m.get('c8');
    expect(mid.rotation).toBeCloseTo(0);
    expect(left.rotation).toBeGreaterThan(0.08);
    expect(right.rotation).toBeLessThan(-0.08);
    expect(mid.y).toBeGreaterThan(left.y);
    expect(mid.y).toBeGreaterThan(right.y);
    expect(Math.abs(right.rotation)).toBeCloseTo(Math.abs(left.rotation), 1); // 左右对称
  });

  it('悬浮挤开+提拉：目标牌提拉到 liftY 整牌入屏高度、放大、z 压过全场；两侧间隙扩大且整体居中不变', () => {
    const le = make();
    const ids = ['a', 'b', 'c', 'd'];
    const m = le.layoutHand('hand', ids, 'b');
    const hov = m.get('b');
    expect(hov.y).toBe(HAND.liftY);
    expect(hov.scale).toBeCloseTo(HAND_FAN_MECHANICS.liftScale);
    expect(hov.z).toBeGreaterThan(m.get('d').z + HAND_FAN_MECHANICS.liftZBoost - 1);
    // 对称性：首尾仍绕扇心对称（撑开量向两侧同环衰减）
    expect(m.get('a').x + m.get('d').x).toBeCloseTo(2 * CX);
    const plain = make().layoutHand('hand', ids);
    expect(m.get('c').x - m.get('b').x).toBeGreaterThan(plain.get('c').x - plain.get('b').x);
    expect(Math.abs(m.get('a').x - m.get('b').x)).toBeGreaterThan(Math.abs(plain.get('a').x - plain.get('b').x));
    // 提拉牌趋直（残余倾角小于静息切线角）
    expect(Math.abs(hov.rotation)).toBeLessThan(Math.abs(plain.get('b').rotation));
  });

  it('总弧角控制：少牌（≤arcGrowFrom）近乎放平，此后随张数增至 arcDegFull 封顶', () => {
    const le = make();
    const deg = rad => (rad * 180) / Math.PI;
    for (const n of [2, 3, 4]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const m = le.layoutHand('hand', ids);
      expect(deg(Math.abs(m.get('c0').rotation))).toBeLessThanOrEqual(HAND.arcDegMin / 2 + 0.5); // 平台期极平
    }
    const grow = n => {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const m = le.layoutHand('hand', ids);
      return deg(Math.abs(m.get('c0').rotation));
    };
    expect(grow(5)).toBeGreaterThan(3);           // 第 5 张起弧度开始增长
    expect(grow(10)).toBeLessThanOrEqual(HAND.arcDegFull / 2 + 1e-6); // 满手封顶
    expect(grow(10)).toBeGreaterThan(grow(6));    // 增长单调
  });

  it('锚点登记与容器注销', () => {
    const le = make();
    le.layoutHand('hand', ['a', 'b']);
    expect(le.getAnchor('a')).toBeTruthy();
    le.unregisterContainer('hand');
    expect(le.getAnchor('a')).toBeNull();
  });

  it('命名锚点', () => {
    const le = make();
    le.setNamedAnchor('deck', { x: 40, y: -35 });
    expect(le.getNamedAnchor('deck')).toEqual({ x: 40, y: -35 });
    expect(le.getNamedAnchor('nope')).toBeNull();
  });

  it('未注册容器抛错', () => {
    expect(() => new LayoutEngine().layoutHand('x', ['a'])).toThrow();
  });
});
