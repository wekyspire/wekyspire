// 全量美术清单（assetManifest）：目录自动登记 + 统一预载的进度/分区预热/失败不阻语义。
// FakeImage 桩与 artPreload.test.js 同款：src 赋值后微任务触发 onload。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ART_MANIFEST, preloadAllArt } from '../src/stage/art/assetManifest.js';

class FakeImage {
  set src(url) { queueMicrotask(() => this.onload?.()); }
}

describe('ART_MANIFEST 目录自动登记', () => {
  it('assets 下全部位图入册（stage/cards/根级散图），非位图不混入，条目 url 有效', () => {
    const paths = ART_MANIFEST.map(e => e.path);
    expect(paths.some(p => p.endsWith('/assets/stage/unit_player.webp'))).toBe(true);
    expect(paths.some(p => p.includes('/assets/cards/'))).toBe(true);
    expect(paths.some(p => p.endsWith('/assets/remi.webp'))).toBe(true); // 根级散图（** 命中）
    expect(paths.every(p => /\.(png|jpe?g|webp)$/.test(p))).toBe(true); // css/mp3 天然排除
    expect(ART_MANIFEST.every(e => typeof e.url === 'string' && e.url.length > 0)).toBe(true);
  });
});

describe('preloadAllArt 统一预载', () => {
  beforeEach(() => { vi.stubGlobal('Image', FakeImage); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('无 Image 环境（headless）立即放行，不挡测试路径', async () => {
    vi.stubGlobal('Image', undefined);
    const onProgress = vi.fn();
    const r = await preloadAllArt({ onProgress, caches: { stage: {}, card: {} } });
    expect(r.failed).toBe(0);
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });

  it('逐张计数进度到满；stage/cards 分区 warm 对应缓存，其余目录只温浏览器缓存', async () => {
    const stage = { warm: vi.fn(() => true) };
    const card = { warm: vi.fn(() => true) };
    const onProgress = vi.fn();
    const r = await preloadAllArt({ onProgress, caches: { stage, card } });
    expect(r.total).toBe(ART_MANIFEST.length);
    expect(r.failed).toBe(0);
    expect(onProgress).toHaveBeenLastCalledWith(r.total, r.total);
    const stageN = ART_MANIFEST.filter(e => e.path.includes('/assets/stage/')).length;
    const cardN = ART_MANIFEST.filter(e => e.path.includes('/assets/cards/')).length;
    expect(stage.warm).toHaveBeenCalledTimes(stageN);
    expect(card.warm).toHaveBeenCalledTimes(cardN);
    expect(stage.warm.mock.calls[0][1]).toBeInstanceOf(FakeImage); // warm 的是已加载图实例
    expect(stageN + cardN).toBeLessThan(r.total); // cutscenes/images 等其余素材存在且不入缓存
  });

  it('单张失败不阻塞：计入 failed，整体仍落定；warm 进共享缓存后 getFile 同步命中', async () => {
    class HalfFail {
      set src(url) {
        queueMicrotask(() => (url.includes('cards') ? this.onerror?.() : this.onload?.()));
      }
    }
    const { UnitArtCache } = await import('../src/stage/art/unitArt.js');
    const stageCache = new UnitArtCache();
    const r = await preloadAllArt({
      imageFactory: HalfFail,
      caches: { stage: stageCache, card: { warm: vi.fn() } },
    });
    expect(r.failed).toBeGreaterThan(0);
    expect(r.total).toBe(ART_MANIFEST.length);
    // 预载成果已 warm：不发起异步加载、同步拿到图（舞台首拍零占位的依据）
    expect(stageCache.getFile('unit_player_front.png')).toBeInstanceOf(HalfFail);
  });
});
