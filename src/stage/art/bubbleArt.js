// UI 小件美术缓存（`src/assets/ui/<key>.{png,webp,jpg}`）：场景角色头顶的**对话/思索泡泡**、
// **继续前进箭头**等——道具与立绘/卡图之外的通用 UI 贴图都放这里。
//
// 复用 `PropArtCache` 的实现（key → 共享 sRGB THREE.Texture，未命中先返 null），
// 只是换一张查表——「一 key 一张共享纹理」的语义完全一致，不必另写一份缓存类。
//
// 使用约定同道具图：**逐帧惰性套用**（`getTexture` 返 null 就下一帧再试），不订阅加载事件。

import { PropArtCache } from './propArt.js';
import { indexArtUrls } from './imageCache.js';

const UI_ART_URLS = indexArtUrls(
  import.meta.glob('../../assets/ui/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' })
);

/** 气泡美术 key（SpeechBubbleObject 用）。 */
export const BUBBLE_ART = Object.freeze({ speech: 'bubble_speech', thought: 'bubble_thought' });
/** 休息房「继续前进」箭头（ContinueButtonObject 用）。 */
export const CONTINUE_ART = 'continue_arrow';

/** 应用级共享单例（跨舞台/跨小件复用已解码图与纹理）。 */
export const sharedUiArtCache = new PropArtCache(UI_ART_URLS);
