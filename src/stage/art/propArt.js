// 场景道具美术图缓存（`src/assets/props/<key>.{png,webp,jpg}`）：
// 「同步取图 + 未命中即异步加载先返 null」的语义继承 ArtImageCache（与卡图/立绘同一套）。
//
// 为什么单独一条：道具本体（`stage/scenes/props/*`）是**纯几何 + 调色板**的资产契约
// （禁自建材质、颜色只走 palette token），贴图与随之而来的材质属于表现层——所以
// 道具只在几何上标记「这里是一块画牌」（`userData.artKey`），由 rig/Stage 侧把纹理贴上去
// （与彩灯材质同一条先例：逐实例材质由 rig 拥有）。
//
// 纹理按 URL 共享（多台机器/多次重建共用同一张 THREE.Texture），
// 取用方约定为**逐帧惰性套用**（`getTexture` 返 null 就下一帧再试），不做加载订阅——
// 订阅要在 rig dispose 时退订，而 rig 的生命周期由宿主随手 end()，容易漏成幽灵回调。

import * as THREE from 'three';
import { ArtImageCache, indexArtUrls } from './imageCache.js';

const PROP_ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/props/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);
// 获得物素材（`assets/items/*`）：遗物/药水/奖励的特写图放这里；**同名时 items 优先**，
// 于是"道具图"与"物品图"共用一个查表 key，调用方不必分两套。
const ITEM_ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/items/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

export class PropArtCache extends ArtImageCache {
  constructor() {
    super();
    this._textures = new Map();   // url -> THREE.Texture（进程级共享，勿 dispose）
  }

  /** key（去扩展名文件名，如 'slot_machine'）→ URL；无此素材返回 null。 */
  resolveUrl(key) {
    if (!key) return null;
    return ITEM_ART_URLS[key] ?? PROP_ART_URLS[key] ?? null;
  }

  /** 同步取图：已解码 → HTMLImageElement；未命中 → 发起加载并返回 null。 */
  get(key) {
    const url = this.resolveUrl(key);
    return url ? this.getByUrl(url) : null;
  }

  /**
   * 同步取**共享 sRGB 纹理**：图未就绪返回 null（调用方下一帧再试）。
   * 同一 key 永远返回同一个 THREE.Texture 实例（勿 dispose，进程级共享）。
   */
  getTexture(key) {
    const url = this.resolveUrl(key);
    if (!url) return null;
    const hit = this._textures.get(url);
    if (hit) return hit;
    const img = this.getByUrl(url);
    if (!img) return null;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this._textures.set(url, tex);
    return tex;
  }
}

/** 应用级共享单例（跨舞台/跨房间复用已解码图与纹理）。 */
export const sharedPropArtCache = new PropArtCache();
