import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem } from '../src/stage/particles/ParticleSystem.js';

describe('ParticleSystem', () => {
  it('spawn 后粒子入池，update 推进位置并衰减', () => {
    const ps = new ParticleSystem({ max: 32 });
    ps.spawn(10, 5, { count: 8, color: 0xff0000, speed: 10, ttl: 1, gravity: 0 });
    expect(ps.activeCount).toBe(8);

    ps.update(0.1);
    const pos = ps.points.geometry.attributes.position.array;
    const moved = [...Array(8)].some((_, i) => pos[i * 3] !== 10 || pos[i * 3 + 1] !== 5);
    expect(moved).toBe(true);
    // 颜色已写入且未褪尽
    const col = ps.points.geometry.attributes.color.array;
    const lit = [...Array(8)].some((_, i) => col[i * 3] > 0.5);
    expect(lit).toBe(true);
  });

  it('寿命尽后粒子归还池位并颜色归零', () => {
    const ps = new ParticleSystem({ max: 32 });
    ps.spawn(0, 0, { count: 4, ttl: 0.2, speed: 5 });
    ps.update(0.3);
    expect(ps.activeCount).toBe(0);
    const col = ps.points.geometry.attributes.color.array;
    expect([...col.slice(0, 12)].every(v => v === 0)).toBe(true);
  });

  it('池满后静默丢弃，不溢出', () => {
    const ps = new ParticleSystem({ max: 4 });
    ps.spawn(0, 0, { count: 10 });
    expect(ps.activeCount).toBe(4);
    expect(() => ps.update(0.1)).not.toThrow();
  });

  it('重力改变纵向速度', () => {
    const ps = new ParticleSystem({ max: 8 });
    ps.spawn(0, 0, { count: 1, speed: 0, gravity: -10, ttl: 1 });
    ps.update(0.5);
    const pos = ps.points.geometry.attributes.position.array;
    expect(pos[1]).toBeLessThan(0); // y 已下沉
  });

  it('文本粒子：烘焙纹理精灵入池，物理推进 + 透明度衰减', () => {
    const fakeBake = () => ({ texture: new THREE.Texture(), width: 200, height: 40 });
    const ps = new ParticleSystem({ maxSprites: 4, bakeText: fakeBake });
    const rec = ps.spawnText(5, 8, '-6', { fontSize: 32, vy: 20, gravity: -60, ttl: 1 });
    expect(ps.activeSpriteCount).toBe(1);
    expect(rec.text).toBe('-6');
    // 世界尺寸 = 烘焙像素 / ppw（默认 10）
    expect(rec.w).toBe(20);
    expect(rec.h).toBe(4);

    ps.update(0.1);
    expect(rec.sprite.visible).toBe(true);
    expect(rec.sprite.position.x).toBe(5);
    expect(rec.sprite.position.y).toBeGreaterThan(8); // 初速向上
    expect(rec.sprite.material.opacity).toBeCloseTo(0.9, 5); // 线性衰减
    const vyAfter = rec.vy;
    expect(vyAfter).toBeLessThan(20); // 重力拉低纵向速度

    ps.update(0.2); // 继续上升减速后仍高于出生点一段
    expect(rec.vy).toBeLessThan(vyAfter);
  });

  it('文本粒子：寿命尽后精灵隐藏回收，一次性纹理销毁', () => {
    const texture = new THREE.Texture();
    let disposed = false;
    texture.dispose = () => { disposed = true; };
    const ps = new ParticleSystem({ maxSprites: 2, bakeText: () => ({ texture, width: 100, height: 20 }) });
    const rec = ps.spawnText(0, 0, '+3', { ttl: 0.3 });
    ps.update(0.5);
    expect(ps.activeSpriteCount).toBe(0);
    expect(rec.sprite.visible).toBe(false);
    expect(rec.sprite.material.map).toBeNull();
    expect(disposed).toBe(true);
    // 池位回收后可再发射
    expect(ps.spawnText(0, 0, 'x', {})).toBeTruthy();
  });

  it('精灵粒子：drag 阻力衰减速度，scalePop 出生弹跳回落', () => {
    const fakeBake = () => ({ texture: new THREE.Texture(), width: 100, height: 100 });
    const ps = new ParticleSystem({ maxSprites: 4, bakeText: fakeBake });
    const rec = ps.spawnSprite(0, 0, { texture: new THREE.Texture(), width: 2, height: 2, vx: 10, vy: 0, drag: 2, ttl: 1, scalePop: 0.5 });
    ps.update(0.1);
    expect(rec.vx).toBeLessThan(10); // 阻力减速
    // scalePop：出生放大 1.5 → 随时间回落
    const s1 = rec.sprite.scale.x;
    ps.update(0.2);
    const s2 = rec.sprite.scale.x;
    expect(s1).toBeGreaterThan(2);
    expect(s2).toBeLessThan(s1);
    ps.update(1); // 生命尽头回收
    expect(rec.sprite.scale.x).toBeLessThanOrEqual(2 * 1.001);
  });

  it('space 分流：ui 精灵入 spritesUI 池，死亡归还对应池位，两池互不占额', () => {
    const fakeBake = () => ({ texture: new THREE.Texture(), width: 100, height: 20 });
    const ps = new ParticleSystem({ maxSprites: 2, bakeText: fakeBake });
    const uiRec = ps.spawnText(1, 2, '-6', { space: 'ui', ttl: 0.2 });
    const worldRec = ps.spawnText(3, 4, '-8', { ttl: 10 });
    expect(uiRec.space).toBe('ui');
    expect(worldRec.space).toBe('world');
    // 各入各的组
    expect(ps.spritesUI.children.includes(uiRec.sprite)).toBe(true);
    expect(ps.sprites.children.includes(worldRec.sprite)).toBe(true);
    // ui 池独立：world 池仍有 1 个空位（world 用了 1/2），ui 池也还剩 1 个
    expect(ps._spriteUIFree.length).toBe(1);
    expect(ps._spriteFree.length).toBe(1);
    // ui 精灵死亡归还 ui 池
    ps.update(0.3);
    expect(ps._spriteUIFree.length).toBe(2);
    expect(ps._spriteFree.length).toBe(1); // world 精灵还活着
    expect(ps.activeSpriteCount).toBe(1);
  });

  it('逐粒子尺寸：spawn 的 size 写入 aSize 属性（±幅度抖动），缺省跟随构造 pointSize', () => {
    const ps = new ParticleSystem({ max: 8, pointSize: 2 });
    ps.spawn(0, 0, { count: 2, size: 5, ttl: 10 });
    ps.spawn(0, 0, { count: 1, ttl: 10 }); // 缺省 = pointSize
    const sizes = ps.points.geometry.attributes.aSize.array;
    const alive = ps._pool.map(p => sizes[p.i]).sort((a, b) => a - b);
    // 逐粒子点径抖动 ×0.8~1.3：显式 5 → [4, 6.5]，缺省 2 → [1.6, 2.6]
    expect(alive[0]).toBeGreaterThanOrEqual(1.6);
    expect(alive[0]).toBeLessThanOrEqual(2.6);
    for (const s of alive.slice(1)) {
      expect(s).toBeGreaterThanOrEqual(4);
      expect(s).toBeLessThanOrEqual(6.5);
    }
    // 材质全局 size 留 1（实际尺寸全在属性里），且 shader 已打 aSize 补丁
    expect(ps.points.material.size).toBe(1);
    expect(typeof ps.points.material.onBeforeCompile).toBe('function');
  });
});
