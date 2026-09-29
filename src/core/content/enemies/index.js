// 敌人定义装配（显式登记，不用 import.meta.glob——与 core 内容注册表同律）：
// 按四 章 小怪 / 精英 / Boss 三分类拆分。

// 敌人定义总集。约定：
//   * 行动序列固定循环，按 unit.actionIndex 取模分支；行动即提交指令，无特判；
//   * 攻击数值一律走「基数 + unit.attack 面板」（battle.md F1 同源算式）；
//     getIntention 的 damage 用同一算式（意图预告 = 实际数值，所见即所算）；
//   * difficulty 难度元数据（难度制 v2，见 battle_gameplay/ENEMY_GENERATION.md）：
//     { base, floorMin, floorMax }——数值恒用 createUnit() 的授权面板（不按难度缩放），
//     base 仅作生成选材与展示/调试的战力档位；楼层超出 [floorMin,floorMax] 不再生成
//     （机制老旧 / 数值漂移超出设计包络的敌人自然退役）；elite/unique 标志见生成器；
//   * getIntention(unit, battleState) 返回 { kinds, hits?, damage? }：kinds 是基础
//     意图集合（最多两两组合）——'attack'（附 hits×damage，hits=1 时前端省略次数）/
//     'defend' / 'buff'（自我/友军增强，含再生/荆棘/蓄势/自愈）/ 'debuff'（赋予
//     玩家削弱，含燃烧/虚弱/滞气）/ 'summon'（召唤援军，附 unitSpawned）。
//     前端只按种类画图标，不写详细信息。

import './chapter1.js';
import './chapter2.js';
import './chapter3.js';
import './chapter4.js';
import './elites.js';
import './bosses.js';
