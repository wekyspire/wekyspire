// 遗物立绘缓存（`src/assets/relics/<遗物名>.{png,webp,jpg}`）——
// key 就是**遗物显示名**（与 core 注册的 `name` 同字），不引 id：
// 素材由「遗物名」直接对应美术文件（`art_src/遗物/` 的生产管线也按名落盘），
// 中间不再加一层 id 映射；core 侧改名时素材文件同步改名即可（构建期查表，失配只会退化成无色块）。
//
// 「同步取图 + 未命中即异步加载先返 null」「key → 共享 sRGB 纹理」的语义全部继承
// PropArtCache（与卡图/道具图同一套实现，吃同一个 `ArtImageCache` 基类）——
// 这里只提供一张独立的 key → URL 表，所以不复用道具表（遗物名与道具名同域，混表会互相遮蔽）。
//
// 取用方（选遗物界面的候选卡、获得物特写）**逐帧/订阅式惰性套用**：
// 素材由 assetManifest 统一预载进浏览器缓存，但道具/遗物这类不进 warm 名单，
// 首次 getTexture 仍是一次异步解码 —— 未就绪就下一帧再试或订阅 addOnLoad。

import { PropArtCache } from './propArt.js';
import { indexArtUrls } from './imageCache.js';

const RELIC_ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/relics/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
);

/** 应用级共享单例（跨舞台/跨面板复用已解码图与纹理）。 */
export const sharedRelicArtCache = new PropArtCache(RELIC_ART_URLS);
