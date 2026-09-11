import { describe, it, expect } from 'vitest';
import { CardObject } from '../src/stage/objects/CardObject.js';
import { CardFxLayer } from '../src/stage/objects/CardFxLayer.js';

function makeBake(hitRegions = []) {
  let calls = 0;
  const bake = (cardData) => {
    calls++;
    return {
      texture: { dispose: () => { bake.disposed = (bake.disposed || 0) + 1; } },
      hitRegions,
      width: 20,
      height: 27,
    };
  };
  bake.getCalls = () => calls;
  return bake;
}

describe('CardObject', () => {
  it('setCard 重烘纹理并成对替换 hit map，旧纹理被 dispose', () => {
    const region = { type: 'named', payload: { name: '瑞米' }, rect: { x: 2, y: 3, w: 10, h: 6 } };
    const bake = makeBake([region]);
    const card = new CardObject({ uniqueID: 'c1', bakeFace: bake });
    card.setCard({ name: '斩击' });
    expect(bake.getCalls()).toBe(1);
    expect(card.hitRegions).toEqual([region]);
    card.setCard({ name: '斩击+' });
    expect(bake.getCalls()).toBe(2);
    expect(bake.disposed).toBe(1); // 旧纹理被释放
  });

  it('hitTestUV：uv 反算局部坐标命中热区', () => {
    // 热区 rect: x∈[2,12], y∈[3,9]（局部坐标，y 向下）；牌 20x27
    const region = { type: 'named', payload: { name: '瑞米' }, rect: { x: 2, y: 3, w: 10, h: 6 } };
    const card = new CardObject({ uniqueID: 'c1', bakeFace: makeBake([region]) });
    card.setCard({});
    // 局部 (7, 6) 应在热区内 → u=7/20=0.35, v=1-6/27
    expect(card.hitTestUV({ u: 0.35, v: 1 - 6 / 27 })).toEqual(region);
    // 局部 (15, 20) 在热区外
    expect(card.hitTestUV({ u: 0.75, v: 1 - 20 / 27 })).toBeNull();
  });
});

describe('CardObject Shift 详情模式', () => {
  it('setAltMode 以 textAlt+altFace 派生视图重烘，切回还原；详情态中 setCard 按新数据重出', () => {
    const views = [];
    const bake = (cardData) => {
      views.push(cardData);
      return { texture: {}, hitRegions: [], width: 20, height: 27 };
    };
    const card = new CardObject({ uniqueID: 'c1', bakeFace: bake });
    card.setCard({ name: '冲拳', text: '8伤害', textAlt: '6伤害' });
    expect(views.length).toBe(1);
    expect(views[0].text).toBe('8伤害');
    expect(views[0].altFace).toBeUndefined();

    card.setAltMode(true);
    expect(card.altMode).toBe(true);
    expect(views.length).toBe(2);
    expect(views[1].text).toBe('6伤害');
    expect(views[1].altFace).toBe(true);
    expect(card.cardData.text).toBe('8伤害'); // 基础数据不被派生视图污染

    // 详情态中内容同步：保持详情面，按新数据重出
    card.setCard({ name: '冲拳', text: '9伤害', textAlt: '6伤害' });
    expect(views.length).toBe(3);
    expect(views[2].text).toBe('6伤害');
    expect(views[2].altFace).toBe(true);

    card.setAltMode(false);
    expect(card.altMode).toBe(false);
    expect(views.at(-1).text).toBe('9伤害');
    expect(views.at(-1).altFace).toBeUndefined();
  });

  it('无 textAlt（纯机制卡）静默忽略；详情态中数据失去双轨自动回落应用面', () => {
    const plain = new CardObject({ uniqueID: 'c1', bakeFace: makeBake() });
    plain.setCard({ name: '盾', text: '5护盾' });
    plain.setAltMode(true);
    expect(plain.altMode).toBe(false);

    const dual = new CardObject({ uniqueID: 'c2', bakeFace: makeBake() });
    dual.setCard({ text: 'x', textAlt: 'y' });
    dual.setAltMode(true);
    expect(dual.altMode).toBe(true);
    dual.setCard({ text: 'z' });
    expect(dual.altMode).toBe(false);
  });
});

describe('CardObject 焚烧（焚毁离场演出）', () => {
  it('startBurn 挂燃烧着色器与余烬粒子；updateBurn 推进 uBurn，燃尽回调恰好一次', () => {
    const card = new CardObject({ uniqueID: 'c1', bakeFace: makeBake() });
    card.setCard({});
    expect(card.burning).toBe(false);

    let burnt = 0;
    card.startBurn({ durationMs: 700, onBurnt: () => { burnt += 1; } });
    expect(card.burning).toBe(true);
    expect(typeof card.faceMesh.material.onBeforeCompile).toBe('function'); // 吞蚀着色器
    expect(card._burnUniforms.uBurn.value).toBe(0);
    expect(card._embers).toBeTruthy(); // 余烬粒子已挂载

    // 半程：前沿推进、火星已喷发、颤动进行中、未回调
    card.updateBurn(0.35);
    expect(card._burnUniforms.uBurn.value).toBeCloseTo(0.5);
    expect(card._emberPool.length).toBeGreaterThan(0);
    expect(card.burning).toBe(true);
    expect(burnt).toBe(0);

    // 燃尽：回调一次、颤动归零
    card.updateBurn(0.4);
    expect(card._burnUniforms.uBurn.value).toBe(1);
    expect(card.burning).toBe(false);
    expect(burnt).toBe(1);
    expect(card.rotation.z).toBe(0);

    card.updateBurn(0.1); // 燃尽后再泵：无第二次回调
    expect(burnt).toBe(1);
  });

  it('startBurn 幂等；焚毁接管熄灭叠加特效；dispose 清理余烬资源', () => {
    const card = new CardObject({ uniqueID: 'c2', bakeFace: makeBake() });
    card.setCard({});
    card.fx.pulse({ color: 0xff0000 });
    card.fx.setCooling('cooling');
    card.startBurn({ durationMs: 100 }); // 焚毁接管牌面：脉冲/盖纱一并熄灭
    expect(card.fx.pulseVisible).toBe(false);
    expect(card.fx.coolingMode).toBeNull();
    card.startBurn({ durationMs: 999 }); // 重复点火无效
    expect(card._burn.duration).toBeCloseTo(0.1);
    card.dispose();
    expect(card._embers).toBeNull();
  });
});

describe('CardFxLayer（卡面特效层）', () => {
  it('pulse：点亮即显色，update 推进时间线，超时熄灭；重触发顶掉旧时间线', () => {
    const fx = new CardFxLayer({ width: 20, height: 27 });
    fx.pulse({ color: 0x66ff99 });
    expect(fx.pulseVisible).toBe(true);
    expect(fx.pulseColor).toBe(0x66ff99);
    fx.update(0.1);
    expect(fx.pulseVisible).toBe(true); // 时间线未走完
    fx.pulse({ color: 0xc87070 }); // 重触发重置
    expect(fx.pulseColor).toBe(0xc87070);
    fx.update(0.25);
    expect(fx.pulseVisible).toBe(false);
  });

  it('setCooling：模式幂等切换；clearTransient 一并熄灭', () => {
    const fx = new CardFxLayer({ width: 20, height: 27 });
    expect(fx.coolingMode).toBeNull();
    fx.setCooling('cooling');
    fx.setCooling('cooling'); // 幂等
    expect(fx.coolingMode).toBe('cooling');
    fx.setCooling('decayed');
    expect(fx.coolingMode).toBe('decayed');
    fx.pulse({ color: 0xffffff });
    fx.clearTransient();
    expect(fx.coolingMode).toBeNull();
    expect(fx.pulseVisible).toBe(false);
  });
});
