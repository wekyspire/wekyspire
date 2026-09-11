// 战斗素材预取：已知参战单位与卡组即发起立绘/卡图加载——不等 BattleStage
// 首拍 sync 建视图才惰性拉取（首拍排在幕间黑幕指令之后，揭幕前根本不会启动，
// 症状即"进战斗后卡牌/单位几百毫秒才显示"）。调用越早越好：点击「进入战斗」
// 即调，cutscene 对话与黑幕转场的整段窗口都用于加载；prep 入场时也可预热
// （遭遇已知、卡组已定——无 cutscene 的普通层同样有整个战前准备阶段可用）。
// 预取进共享单例缓存，BattleStage 建视图时同步命中：无"占位色块→补挂"跳变。
import { getSkillDefinition } from '../../core/skills/registry.js';
import { sharedCardArtCache } from './cardArtCache.js';
import { sharedUnitArtCache } from './unitArt.js';

/**
 * @param {object} battle 素材来源（与 assembleBattle 产物同构）
 *   deck:    skillRuntime 数组（卡组全量——起手从中抽，全部可能上场）
 *   enemies: Unit 数组（读 defId）
 *   allies:  Unit 数组（读 defId）
 * @param {object} caches 测试注入位（缺省共享单例）
 */
export function preloadBattleArt(
  { deck = [], enemies = [], allies = [] } = {},
  { cardCache = sharedCardArtCache, unitCache = sharedUnitArtCache } = {},
) {
  if (typeof document === 'undefined') return; // node/headless：无图可载（Image 不存在）
  unitCache.get(null, 'player');               // 玩家立牌（side 即文件名，defId 不参与）
  unitCache.getFile('unit_player_front.png');  // 状态栏头像正视图
  unitCache.getFile('knight_avatar.png');      // 状态栏骑士徽章头像
  unitCache.getFile('remi_avatar.png');        // 状态栏瑞米圆像
  for (const u of enemies) unitCache.get(u?.defId, 'enemy');
  for (const u of allies) unitCache.get(u?.defId, 'ally');
  for (const rt of deck) {
    const def = getSkillDefinition(rt?.defId);
    if (def) {
      cardCache.get(def);      // resolveUrl 读 image/type/tier，技能定义直接兼容
      cardCache.getDecor?.(def); // 系列装饰图层一并预热（素材未就位时 resolve 为 null，零开销）
    }
  }
}
