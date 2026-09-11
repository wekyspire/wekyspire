import { describe, it, expect } from 'vitest';
import '../src/core/content/index.js'; // 注册效果定义（燃烧等），emoji/特征色解析依赖注册表
import { bakeCardFace, CARD_FACE_SIZE, cardTheme } from '../src/stage/richtext/cardFace.js';
import { allSkills } from '../src/core/skills/registry.js';

// 全吸收 mock ctx：记录 fillText / drawImage 首参 / 画布尺寸
function createMockCanvas() {
  const texts = [];
  const images = [];
  const gradient = { addColorStop: () => {} }; // 渐变对象桩：addColorStop 可链
  const canvas = {
    width: 0, height: 0,
    getContext: () => new Proxy({
      fillText: (t) => texts.push(t),
      measureText: (t) => ({ width: t.length * 10 }),
      drawImage: (img) => images.push(img),
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {}; // 吸收所有绘制调用与属性读取
      },
      set() { return true; }, // 吸收 fillStyle/font 等赋值
    }),
  };
  return { canvas, texts, images, factory: (w, h) => { canvas.width = w; canvas.height = h; return canvas; } };
}

const CARD = {
  defId: 'punch', name: '冲拳', power: 0,
  cost: { mana: 0, actionPoint: 1 },
  keywords: [], cardMode: 'normal', charges: null,
  text: '造成 6 点伤害。',
};

describe('cardFace', () => {
  it('返回固定布局盒尺寸 + CanvasTexture', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace(CARD, {
      createCanvas: mock.factory, measure: (t) => t.length * 10, scale: 2,
    });
    expect(r.width).toBe(CARD_FACE_SIZE.width);
    expect(r.height).toBe(CARD_FACE_SIZE.height);
    expect(mock.canvas.width).toBe(400); // 200 * scale
    expect(mock.canvas.height).toBe(540);
    expect(r.texture).toBeTruthy();
  });

  it('正文热区加上正文区偏移', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace({ ...CARD, text: '施加/effect{燃烧}' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    const region = r.hitRegions.find(h => h.type === 'effect');
    expect(region).toBeTruthy();
    expect(region.rect.x).toBe(12 + 20); // BODY_OFFSET.x + 前两个字
    expect(region.rect.y).toBe(56);      // BODY_OFFSET.y
    expect(region.payload.name).toBe('燃烧');
  });

  it('名称与开销被绘制：零开销不显示徽章，正开销各显', () => {
    const mock = createMockCanvas();
    bakeCardFace(CARD, { createCanvas: mock.factory, measure: (t) => t.length * 10 });
    expect(mock.texts).toContain('冲拳');
    expect(mock.texts).not.toContain('0'); // mana=0：零开销不显示（用户定）
    expect(mock.texts).toContain('1');     // AP=1 徽章

    const mock2 = createMockCanvas();
    bakeCardFace({ ...CARD, cost: { mana: 2, actionPoint: 0 } }, { createCanvas: mock2.factory, measure: (t) => t.length * 10 });
    expect(mock2.texts).toContain('2');    // mana=2 徽章
    expect(mock2.texts).not.toContain('0'); // AP=0 不显示
  });

  it('品阶徽章字母被绘制', () => {
    const mock = createMockCanvas();
    bakeCardFace({ ...CARD, tier: 'S' }, { createCanvas: mock.factory, measure: (t) => t.length * 10 });
    expect(mock.texts).toContain('S');
  });

  it('Shift 方标：仅双轨卡的已应用卡面呈现（含 shift 热区），详情面/纯机制卡无标', () => {
    // 已应用面（双轨卡）：方标字母 + shift 热区
    const mock = createMockCanvas();
    const r = bakeCardFace({ ...CARD, textAlt: '6伤害' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    expect(mock.texts).toContain('S');
    const region = r.hitRegions.find(h => h.type === 'shift');
    expect(region).toBeTruthy();
    expect(region.payload.name).toBe('按住 Shift 显示详细信息');
    // 热区落在右下角
    expect(region.rect.x + region.rect.w).toBeCloseTo(CARD_FACE_SIZE.width - 8);
    expect(region.rect.y + region.rect.h).toBeCloseTo(CARD_FACE_SIZE.height - 8);

    // 详情面（altFace）：不带标
    const mock2 = createMockCanvas();
    const r2 = bakeCardFace({ ...CARD, textAlt: '6伤害', altFace: true }, {
      createCanvas: mock2.factory, measure: (t) => t.length * 10,
    });
    expect(r2.hitRegions.find(h => h.type === 'shift')).toBeUndefined();

    // 纯机制卡（无 textAlt）：无标
    const r3 = bakeCardFace(CARD, {
      createCanvas: createMockCanvas().factory, measure: (t) => t.length * 10,
    });
    expect(r3.hitRegions.find(h => h.type === 'shift')).toBeUndefined();
  });

  it('有卡图时正文区下移到图区之下', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace({ ...CARD, text: '施加/effect{燃烧}' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
      art: { width: 100, height: 100 }, // 占位图（drawImage 被 mock 吸收）
    });
    const region = r.hitRegions.find(h => h.type === 'effect');
    expect(region.rect.y).toBe(142); // ART_RECT 底(134) + 8
  });

  it('/effect{} 渲染：emoji 图标 + 特征色名称文本（热区两段）', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace({ ...CARD, text: '施加/effect{燃烧}' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    // emoji 图标（燃烧定义 icon=🔥）与名称文本都被绘制
    expect(mock.texts).toContain('🔥');
    expect(mock.texts).toContain('燃');
    expect(mock.texts).toContain('烧');
    // 图标 + 名称文本各一个热区
    const regions = r.hitRegions.filter(h => h.type === 'effect');
    expect(regions.length).toBe(2);
    expect(regions.every(h => h.payload.name === '燃烧')).toBe(true);
  });

  it('/named{} 渲染：术语文本 + 命名热区（payload 携带完整引用名供 tooltip 反查）', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace({ ...CARD, text: '16伤害，/named{衰败1}，/named{斩}' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    // 术语文本（含尾缀参数）绘制在卡面
    expect(mock.texts).toContain('衰');
    expect(mock.texts).toContain('败');
    expect(mock.texts).toContain('1');
    expect(mock.texts).toContain('斩');
    // 两段命名热区：衰败1（带参数）与 斩
    const regions = r.hitRegions.filter(h => h.type === 'named');
    expect(regions.map(h => h.payload.name).sort()).toEqual(['斩', '衰败1']);
  });

  it('内容契约：卡面文本里的 named 术语一律走 /named{} 热区（动词用法除外）', () => {
    const TERMS = ['后手', '破', '完美', '命中', '短暂', '洗入', '发现', '寻找', '抽出',
      '顽固', '快速咏唱', '焚毁', '衰败', '斩', '慢热', '换牌'];
    // 动词用法的白名单（「焚毁所有手牌」等不是词条用法）
    const VERB_OK = [/焚毁所有/, /手牌焚毁/, /牌焚毁/];
    const stub = {
      self: { power: 0, isActivated: false, chantCount: 0 },
      player: { getStat: () => 0, getEffectStacks: () => 0 },
      battleState: { zones: { hand: [], deck: [], burnt: [], pending: [] }, enemies: [], rng: { int: () => 0 } },
      handIndexAtPlay: null, target: null,
    };
    const bad = [];
    for (const def of allSkills()) {
      for (const fn of [def.describe, def.battleDescribe]) {
        if (!fn) continue;
        let text = '';
        try { text = fn(stub); } catch { continue; } // 需要完整战斗上下文的卡跳过
        for (const term of TERMS) {
          if (!text.includes(term) || text.includes(`/named{${term}`)) continue;
          if (term === '斩' && text.includes('斩进阶')) continue;
          if (term === '焚毁' && VERB_OK.some(re => re.test(text))) continue;
          bad.push(`${def.id}: 裸用「${term}」→ ${text}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('主题色：通用灰卡走偏白（与体修/灵脉主题色可区分）', () => {
    const common = cardTheme({ pack: 'common', type: 'normal' });
    expect(common).toBe('#e8e6e0');
    expect(cardTheme({ series: 'punch', type: 'normal' })).not.toBe(common); // 体修灰
    expect(cardTheme({ series: 'ignite', type: 'fire' })).not.toBe(common);  // 火灵脉红
  });

  it('咏唱卡：正文前缀「咏唱N：」进卡面（named 热区），页脚不重复', () => {
    const mock = createMockCanvas();
    const r = bakeCardFace({
      ...CARD, cardMode: 'chant', chantWeight: 2, text: '获得格挡1', keywords: ['消耗'],
    }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    const names = r.hitRegions.filter(h => h.type === 'named').map(h => h.payload.name);
    expect(names).toContain('咏唱2'); // 正文前缀（带咏唱值）
    expect(names).toContain('消耗');  // 页脚关键词 chip
  });

  it('页脚词条行：冷却进词条行（系统数值不写进效果文本）', () => {
    const mock = createMockCanvas();
    bakeCardFace({ ...CARD, charges: { max: 1, cooldownTurns: 8 } }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    expect(mock.texts).toContain('冷却8');
  });

  it('无卡图 → 系列字形占位水印（series 优先，回落 type，未知回落「技」）', () => {
    const mock = createMockCanvas();
    bakeCardFace({ ...CARD, type: 'fire', series: 'blade' }, {
      createCanvas: mock.factory, measure: (t) => t.length * 10,
    });
    expect(mock.texts).toContain('刃'); // series 优先

    const mock2 = createMockCanvas();
    bakeCardFace({ ...CARD, type: 'fire' }, {
      createCanvas: mock2.factory, measure: (t) => t.length * 10,
    });
    expect(mock2.texts).toContain('炎'); // 回落 type

    const mock3 = createMockCanvas();
    bakeCardFace({ ...CARD, type: 'unknownType', series: null }, {
      createCanvas: mock3.factory, measure: (t) => t.length * 10,
    });
    expect(mock3.texts).toContain('技');
  });

  it('无卡图时不发起 drawImage（占位是程序化绘制）；有卡图/decor 时各绘制一次', () => {
    const mock = createMockCanvas();
    bakeCardFace(CARD, { createCanvas: mock.factory, measure: (t) => t.length * 10 });
    expect(mock.images.length).toBe(0); // 占位不走图像

    const mock2 = createMockCanvas();
    const art = { width: 100, height: 100 };
    const decor = { width: 200, height: 270 };
    bakeCardFace(CARD, {
      createCanvas: mock2.factory, measure: (t) => t.length * 10, art, decor,
    });
    expect(mock2.images).toContain(art);
    expect(mock2.images).toContain(decor);
  });
});
