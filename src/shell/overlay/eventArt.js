// 随机事件的幕间 CG（Shell 层）：`cutscene` 的 dialogue step 用 `bg` 播放这张图，
// 对话就压在图上面（见 CutsceneOverlay 的 `.has-bg`）。
//
// 真素材放 `src/assets/images/events/<事件 art key>.{png,jpg,webp}`——构建期经 glob 自动入册，
// **命中即顶替占位图**（换素材不用改代码）。眼下两个事件还没有美术 → 用**程序化占位图**：
// 一张符合游戏基调（暗底 + 一点主题色光晕 + 废墟剪影）的 SVG data URI，上面写着事件名与
// "占位美术"字样，一眼能看出该换成真图。
import { indexArtUrls } from '../../stage/art/imageCache.js';

const EVENT_ART = indexArtUrls(
  import.meta.glob('../../assets/images/events/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
);

/** 每个事件的主题色（占位图用；真素材不读这里）。 */
const HUES = {
  moneyBag: [40, 26],    // 暖金 → 暗棕
  spring: [176, 205],    // 泉水的青 → 冷蓝
  ascension: [24, 268],  // 进阶：火种橙 → 夜紫（与"灵力汇聚"的基调一致）
};
const DEFAULT_HUE = [258, 232];   // 未知事件：偏紫的夜色

/**
 * 事件背景图 URL：真素材优先，没有就返回程序化占位图。
 * @param {string} key 事件的 art key（= 事件 id）
 */
export function eventArtUrl(key) {
  return EVENT_ART[key] ?? placeholder(key);
}

function placeholder(key, name = '') {
  const [h1, h2] = HUES[key] ?? DEFAULT_HUE;
  const title = name || key;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="hsl(${h1},42%,17%)"/>
<stop offset="0.55" stop-color="hsl(${h2},38%,11%)"/>
<stop offset="1" stop-color="#05070d"/>
</linearGradient>
<radialGradient id="r" cx="0.5" cy="0.32" r="0.55">
<stop offset="0" stop-color="hsl(${h1},72%,46%)" stop-opacity="0.45"/>
<stop offset="1" stop-color="hsl(${h1},72%,46%)" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="1600" height="900" fill="url(#g)"/>
<rect width="1600" height="900" fill="url(#r)"/>
<g fill="#05070d" opacity="0.72">
<rect x="120" y="470" width="150" height="430"/>
<rect x="300" y="560" width="96" height="340"/>
<rect x="1180" y="500" width="180" height="400"/>
<rect x="1390" y="600" width="110" height="300"/>
<rect x="700" y="640" width="240" height="260"/>
</g>
<g fill="none" stroke="hsl(${h1},60%,58%)" stroke-opacity="0.5" stroke-width="3">
<rect x="700" y="640" width="240" height="260"/>
<path d="M700 640 L940 900"/>
</g>
<text x="800" y="250" text-anchor="middle" font-family="sans-serif" font-size="92" font-weight="bold"
fill="#f2e6c8" opacity="0.94">${title}</text>
<text x="800" y="316" text-anchor="middle" font-family="sans-serif" font-size="28"
fill="#c9b98f" opacity="0.8">幕间占位美术 · 待换 assets/images/events/${key}.webp</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 带名字的占位图（事件定义里只有 art key；标题用事件名更好读）。 */
export function eventArtUrlNamed(key, name) {
  return EVENT_ART[key] ?? placeholder(key, name);
}
