// 战斗素材预取（preload.js）与共享素材缓存的监听器/就绪信号（cardArtCache/unitArt）。
// node 环境无 Image/document：监听器测试用 FakeImage 桩（src 赋值后微任务触发
// onload，模拟浏览器异步加载）；预取测试注入假缓存 + 桩 document 过浏览器守卫。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../src/core/content/index.js'; // 技能/敌人定义登记（BODY_STARTER_DECK 反查依赖）
import { CardArtCache } from '../src/stage/art/cardArtCache.js';
import { UnitArtCache } from '../src/stage/art/unitArt.js';
import { preloadBattleArt } from '../src/stage/art/preload.js';
import { BODY_STARTER_DECK } from '../src/core/content/bodySkills.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';

class FakeImage {
  set src(url) { queueMicrotask(() => this.onload?.()); }
}

describe('素材缓存监听器（共享单例语义）', () => {
  beforeEach(() => { vi.stubGlobal('Image', FakeImage); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('加载完成通知全部订阅方；退订后不再通知', async () => {
    const cache = new UnitArtCache();
    const a = vi.fn();
    const b = vi.fn();
    const offA = cache.addOnLoad(a);
    cache.addOnLoad(b);
    expect(cache.getFile('unit_player_front.png')).toBeNull(); // 未命中即发起加载
    await cache.whenIdle();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    cache.getFile('unit_remi.png');
    await cache.whenIdle();
    expect(a).toHaveBeenCalledTimes(1); // 已退订
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('whenIdle 等到全部在途加载落定；落定后同步命中已加载图', async () => {
    const cache = new CardArtCache();
    // inflame = fire 系 C 阶 → fire-1.png（有素材才真正发起加载；normal 系无图不加载）
    const def = getSkillDefinition('inflame');
    expect(cache.get(def)).toBeNull();
    expect(cache.get({ ...def })).toBeNull(); // 同 url 去重：不重复发起
    await cache.whenIdle();
    expect(cache.get(def)).toBeInstanceOf(FakeImage); // 已解码，同步命中
  });
});

describe('preloadBattleArt（战斗素材预取）', () => {
  beforeEach(() => { vi.stubGlobal('document', {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('覆盖玩家立牌/头像正视图/敌我单位与整副卡组', () => {
    const unitCache = { get: vi.fn(() => null), getFile: vi.fn(() => null) };
    const cardCache = { get: vi.fn(() => null) };
    const deck = BODY_STARTER_DECK.map(defId => ({ defId }));

    preloadBattleArt(
      { deck, enemies: [{ defId: 'slime' }, { defId: 'pyro' }], allies: [{ defId: 'remi' }] },
      { cardCache, unitCache },
    );

    expect(unitCache.get).toHaveBeenCalledWith(null, 'player');
    expect(unitCache.getFile).toHaveBeenCalledWith('unit_player_front.png');
    expect(unitCache.get).toHaveBeenCalledWith('slime', 'enemy');
    expect(unitCache.get).toHaveBeenCalledWith('pyro', 'enemy');
    expect(unitCache.get).toHaveBeenCalledWith('remi', 'ally');
    // 卡组全量预热，且传给缓存的是技能定义（image/type/tier 与投影同源）
    expect(cardCache.get).toHaveBeenCalledTimes(deck.length);
    for (const [def] of cardCache.get.mock.calls) expect(def).toHaveProperty('tier');
  });

  it('node 环境无 document 时不触碰缓存（headless 安全）', () => {
    vi.unstubAllGlobals();
    const unitCache = { get: vi.fn(), getFile: vi.fn() };
    preloadBattleArt({ deck: [{ defId: 'agileCombo' }], enemies: [{ defId: 'slime' }] }, { unitCache });
    expect(unitCache.get).not.toHaveBeenCalled();
    expect(unitCache.getFile).not.toHaveBeenCalled();
  });
});
