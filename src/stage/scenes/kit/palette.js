// propKit 调色板：场景颜色的唯一合法来源（WORKFLOW §2.1）。
// token 按主题分组（PALETTES.dungeon / PALETTES.boss / …），各主题键集必须一致——
// 换主题 = setTheme() 切活动组，资产代码里的 P.* 零改动即整体换肤（章节/Boss 房机制）。
// 资产内禁裸 hex：只许 P.* 或对已有色 shade(c, k) 微调（k∈[-1,1]，正提亮负压暗）。
//
// dungeon 组的前 11 个 token 与旧 dungeon3D.js 的 COL 常量逐值对齐（收敛迁移，
// 老场景表现不回退）；其余为道具库新增 token（冷调：暖橙禁用、绿只留一丝）。

import * as THREE from 'three';

const THEMES = {
  // 地牢（现行基调：冷调蓝白紫，石材蓝灰泛紫 + 蓝紫/冷白幽火）
  dungeon: {
    floor: 0x404042,     // 石板地面
    slab: 0x48484a,      // 错位石板（略亮一档）
    wall: 0x404042,      // 墙面
    brick: 0x48484a,     // 砖块补丁
    stone: 0x3a415c,     // 柱/框/扶壁（蓝灰泛紫）
    rock: 0x3d4358,      // 碎石
    iron: 0x4a4e64,      // 铁件
    bannerRed: 0x5a4f40, // 破幡·暗红
    bannerBlue: 0x3a5a6e,// 破幡·青绿
    night: 0x060a1a,     // 夜空/暗槽色
    flameCore: 0xeef2ff, // 幽火内焰（冷白）
    fireLight: 0x7474a0, // 火光颜色（点光参数，非表面色）
    // ---- 道具库新增（冷调低饱和） ----
    wood: 0x54483a,
    woodDark: 0x3f362c,
    clay: 0x66584a,      // 陶器
    clayDark: 0x524638,
    wax: 0xcfd4e0,       // 蜡烛/烛泪
    gold: 0x8a7d4a,      // 金币/铁箍包金（冷金）
    moss: 0x496e50,
    mossDark: 0x37543e,
    bone: 0x9aa0ac,
    boneDark: 0x767c88,
    blood: 0x5a2830,
    straw: 0x776a4d,     // 干草/草垫
    rope: 0x6b5d4a,      // 绳索
    sack: 0x6b6050,      // 麻袋
    water: 0x3d5a6e,     // 水洼
    potionGreen: 0x4f7a5c,
    potionRed: 0x7a4048,
    potionBlue: 0x46628a,
    ember: 0x9aa8d8,     // 余烬/火星粒子
    // ---- CATALOG2 增补（塔身物件多样化；仍守冷调低饱和） ----
    bread: 0x8a795a,
    cheese: 0x9c8d62,
    flour: 0xb0aa9c,
    copper: 0x7c5a48,
    silver: 0x9aa4b2,
    herb: 0x5d7a5e,
    glowCyan: 0x9ad8e8,  // 幽光青：晶簇/微光蘑菇专用
    wine: 0x4e2c38,
    parchment: 0x9c9278,
  },

  // Boss 房（血色基调：更深更暗的岩 + 血色点缀；P3 房型配方联调时再精调）
  boss: {
    floor: 0x3a2c30,
    slab: 0x453539,
    wall: 0x3a2c30,
    brick: 0x453539,
    stone: 0x4a3038,
    rock: 0x403036,
    iron: 0x4c3a44,
    bannerRed: 0x6e2a30,
    bannerBlue: 0x39465e,
    night: 0x0a0408,
    flameCore: 0xeef2ff,
    fireLight: 0x8a5060,
    wood: 0x4c3a34,
    woodDark: 0x382a26,
    clay: 0x5c4438,
    clayDark: 0x483428,
    wax: 0xd8ccd0,
    gold: 0x8a7048,
    moss: 0x3f6448,
    mossDark: 0x2f4c38,
    bone: 0xa8a0a4,
    boneDark: 0x7c7478,
    blood: 0x6a2028,
    straw: 0x6e5c44,
    rope: 0x604c40,
    sack: 0x605248,
    water: 0x345064,
    potionGreen: 0x4a7058,
    potionRed: 0x8a3844,
    potionBlue: 0x425a84,
    ember: 0xb098a8,
    bread: 0x7a6a4e,
    cheese: 0x8a7c56,
    flour: 0xa09a8e,
    copper: 0x6e4c40,
    silver: 0x8e96a4,
    herb: 0x4e6852,
    glowCyan: 0x8ec4d8,
    wine: 0x44242e,
    parchment: 0x8a8068,
  },
};

// 主题键集一致性在模块加载时校验：P.* 按主题换值不换键，漏键 = 换肤炸资产
{
  const ref = Object.keys(THEMES.dungeon).sort().join(',');
  for (const [name, t] of Object.entries(THEMES)) {
    const keys = Object.keys(t).sort().join(',');
    if (keys !== ref) throw new Error(`palette: 主题 "${name}" token 键集与 dungeon 不一致`);
  }
}

let activeTheme = 'dungeon';

// 活动主题视图：P.stone / P.woodDark …（读未知 token 直接抛错，宁可炸也别白）
export const P = new Proxy({}, {
  get(_t, token) {
    if (typeof token !== 'string') return undefined;
    const t = THEMES[activeTheme];
    if (!(token in t)) {
      throw new Error(`palette: 未知 token "P.${token}"（当前主题 ${activeTheme}）——用 PALETTES 里的既有键`);
    }
    return t[token];
  },
});

/** 切换活动主题（章节/Boss 换肤入口；颜色在 build 时烘进顶点色，切主题需重建场景）。 */
export function setTheme(name) {
  if (!THEMES[name]) throw new Error(`palette: 未知主题 "${name}"`);
  activeTheme = name;
}

/** 当前活动主题名。 */
export function getTheme() {
  return activeTheme;
}

/** 全部主题的原始分组（配方层/陈列页直取特定主题色用；资产内一律走 P.*）。 */
export const PALETTES = THEMES;

// shade 的黑 白端点（ColorManagement 下 lerp 在线性空间，getHex 回 sRGB）
const WHITE = new THREE.Color(0xffffff);
const BLACK = new THREE.Color(0x000000);

/**
 * 明暗微调：k∈[-1,1]，正数向白插值、负数向黑插值，返回 hex（与 token 同类型）。
 * 例：shade(P.stone, -0.2) = 压暗两成的石材。
 */
export function shade(c, k) {
  const col = new THREE.Color(c);
  col.lerp(k >= 0 ? WHITE : BLACK, Math.min(1, Math.abs(k)));
  return col.getHex();
}
