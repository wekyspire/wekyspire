import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { UnitObject } from '../src/stage/objects/UnitObject.js';

function makeUnit(extra = {}) {
  const baked = [];
  const unit = new UnitObject({
    uniqueID: 'u1', side: 'player',
    bakeLabel: (text) => {
      baked.push(text);
      const texture = new THREE.Texture();
      texture.addEventListener('dispose', () => { texture.disposed = true; });
      return { texture, width: 100, height: 20 };
    },
    ...extra,
  });
  return { unit, baked };
}

const proj = (over = {}) => ({
  hp: 20, maxHp: 40, shield: 0, isDead: false, effects: [], ...over,
});

const burn = (stacks = 3) => ({
  effectId: 'burn', stacks, name: '燃烧', type: 'debuff', color: 'red', icon: '🔥',
});
const focus = (stacks = 2) => ({
  effectId: 'focus', stacks, name: '凝神', type: 'buff', color: 'blue', icon: null,
});

describe('UnitObject 护盾层', () => {
  it('无盾：护盾层隐藏，主标签不含"盾"后缀', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj());
    expect(unit._shieldGroup.visible).toBe(false);
    expect(baked[0]).toBe('20/40');
    expect(baked[0]).not.toContain('盾');
  });

  it('获得护盾：保护框可见 + 数值重烘 + chip 放缩跳动', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj());
    unit.setUnit(proj({ shield: 5 }));
    expect(unit._shieldGroup.visible).toBe(true);
    expect(baked).toContain('5'); // chip 数值文本
    expect(unit._shieldPopT).toBeGreaterThan(0); // 跳动已触发
    unit.update(0.1);
    expect(unit._shieldChip.scale.x).toBeGreaterThan(1); // 放缩中
    unit.update(1); // 跳动衰减完毕回 1
    expect(unit._shieldChip.scale.x).toBeCloseTo(1, 5);
  });

  it('数值变更（不破碎）：再跳动', () => {
    const { unit } = makeUnit();
    unit.setUnit(proj({ shield: 5 }));
    unit._shieldPopT = 0;
    unit.setUnit(proj({ shield: 8 }));
    expect(unit._shieldGroup.visible).toBe(true);
    expect(unit._shieldPopT).toBeGreaterThan(0);
  });

  it('护盾消失（>0→0）：护盾层静默隐藏、不播跳动（破碎碎粒由 BattleStage 伤害节拍驱动）', () => {
    const { unit } = makeUnit();
    unit.setUnit(proj({ shield: 5 }));
    unit._shieldPopT = 0;
    unit.setUnit(proj({ shield: 0 }));
    expect(unit._shieldGroup.visible).toBe(false);
    expect(unit._shieldPopT).toBe(0);
  });

  it('首帧带盾：直接可见但不播跳动（初始定植不算变更）', () => {
    const { unit } = makeUnit();
    unit.setUnit(proj({ shield: 5 }));
    expect(unit._shieldGroup.visible).toBe(true);
    expect(unit._shieldPopT).toBe(0);
  });

  it('护盾值不变时 chip 文本不重烘', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj({ shield: 5 }));
    const n = baked.length;
    unit.setUnit(proj({ hp: 15, shield: 5 })); // hp 变、盾不变
    expect(baked.length).toBe(n + 1); // 只有主标签重烘
    expect(baked[baked.length - 1]).toBe('15/40');
  });

  it('状态绘制浮于场景之上：depthTest 关闭 + renderOrder≥60；立牌本体仍吃深度', () => {
    const { unit } = makeUnit();
    unit.setUnit(proj({ shield: 5 }));
    const statusMeshes = [
      unit._hpBg, unit._hpFill, unit._label,
      ...unit._shieldFrame, unit._shieldLabel,
      ...unit._shieldChip.children,
    ];
    for (const m of statusMeshes) {
      expect(m.material.depthTest).toBe(false);
      expect(m.material.depthWrite).toBe(false); // 不污染体积光 RT 深度
      expect(m.renderOrder).toBeGreaterThanOrEqual(60); // 场景之上、粒子之下
      expect(m.renderOrder).toBeLessThan(70);
    }
    // renderOrder 严格递增可画序（depthTest 关闭后只能靠 painter 序）
    const orders = [unit._hpBg, unit._hpFill, unit._label].map(m => m.renderOrder);
    expect(orders[0]).toBeLessThan(orders[1]);
    expect(orders[1]).toBeLessThan(orders[2]);
    // 立牌本体仍是场景物：吃深度、可被遮蔽
    expect(unit._body.material.depthTest).toBe(true);
  });
});

describe('UnitObject 效果行（血条上方左对齐纵列）', () => {
  it('无效果：无效果行，主标签只含 HP 比', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj());
    expect(unit._fxRows.length).toBe(0);
    expect(baked[0]).toBe('20/40');
  });

  it('有效果：行建在血条上方、左对齐血条左缘，行 = 矢量图标网格 + markup（特征色名 + 层数色）', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj({ effects: [burn(3)] }));
    expect(unit._fxRows.length).toBe(1);
    // debuff：名称特征色 red，层数红；图标是独立矢量网格，不进 markup（emoji 位图发糊，弃用）
    expect(baked[1]).toBe('/red{燃烧} /red{ 3}');
    // 主标签不夹带效果文本
    expect(baked[0]).toBe('20/40');
    const row = unit._fxRows[0];
    // 行结构：暗背板 + 图标网格 + 文本网格（node 下图标烘焙退化为 1x1 占位 → 0.1wu）
    expect(row.children.length).toBe(3);
    // fake 文本烘焙 100x20px → 世界 10x2（ppw=10）；背板宽 0.55+0.1+0.35+10+0.55=11.55，高 max(2,0.1)+0.5=2.5
    // 左对齐：row 中心 x = -6 + 11.55/2 = -0.225；第一行底缘 = 0.75 + 0.4 → 中心 y = 1.15 + 1.25 = 2.4
    expect(row.position.x).toBeCloseTo(-0.225, 5);
    expect(row.position.y).toBeCloseTo(2.4, 5);
    // 行挂在 hpBar 内（随 billboard 转向），网格带 tooltip 拾取 token
    expect(row.parent).toBe(unit._hpBar);
    for (const mesh of row.children) {
      expect(mesh.userData.token).toEqual({ type: 'effect', payload: { effectId: 'burn', name: '燃烧' } });
      expect(mesh.material.depthTest).toBe(false);
      expect(mesh.renderOrder).toBeGreaterThanOrEqual(60);
      expect(mesh.renderOrder).toBeLessThan(70);
    }
  });

  it('buff：层数绿；多个效果自下而上堆叠', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj({ effects: [burn(1), focus(2)] }));
    expect(unit._fxRows.length).toBe(2);
    expect(baked[2]).toBe('/blue{凝神} /green{ 2}');
    // 第二行在第一行之上
    expect(unit._fxRows[1].position.y).toBeGreaterThan(unit._fxRows[0].position.y);
  });

  it('效果消失：行销毁摘除；效果列表不变：不重烘', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj({ effects: [burn()] }));
    const row = unit._fxRows[0];
    const rowTexture = row.children[2].material.map; // [bg, 图标, 文本]
    const n = baked.length;
    unit.setUnit(proj({ hp: 15, effects: [burn()] })); // hp 变、效果不变
    expect(baked.length).toBe(n + 1); // 只重烘主标签
    expect(unit._fxRows[0]).toBe(row); // 行未重建
    unit.setUnit(proj({ hp: 15, effects: [] }));
    expect(unit._fxRows.length).toBe(0);
    expect(unit._hpBar.children.includes(row)).toBe(false);
    expect(rowTexture.disposed).toBe(true); // 纹理已随行销毁
  });

  it('层数变化：签名驱动整列重建（tooltip 拾取 token 同步更新）', () => {
    const { unit, baked } = makeUnit();
    unit.setUnit(proj({ effects: [burn(3)] }));
    unit.setUnit(proj({ effects: [burn(2)] }));
    expect(baked[baked.length - 1]).toBe('/red{燃烧} /red{ 2}');
    expect(unit._fxRows[0].children[0].userData.token.payload)
      .toEqual({ effectId: 'burn', name: '燃烧' });
  });

  it('意图条 token：payload 携带意图投影 + 单位名；隐藏态不摘 token（守卫在 Picker）', () => {
    const { unit } = makeUnit();
    unit.setUnit(proj({ name: '针鼠', intention: { kinds: ['attack'], hits: 2, damage: 5 } }));
    expect(unit._intention.visible).toBe(true);
    expect(unit._intention.userData.token).toEqual({
      type: 'intention',
      payload: { intention: { kinds: ['attack'], hits: 2, damage: 5 }, unitName: '针鼠' },
    });
    // 隐藏（死亡/空意图）只隐面片不摘 token：raycast 不查 visible，
    // 幽灵命中由 Picker 的命中链可见性守卫统一拦截
    unit.hideIntention();
    expect(unit._intention.visible).toBe(false);
    expect(unit._intention.userData.token).not.toBeNull();
  });
});
