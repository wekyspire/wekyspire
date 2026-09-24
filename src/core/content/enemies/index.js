// 敌人定义装配（显式登记，不用 import.meta.glob——与 core 内容注册表同律）：
// 按四 章 小怪 / 精英 / Boss 三分类拆分（2026-09-24；此前是单文件 3000 行大杂烩）。

// 敌人定义总集。约定：
//   * 行动序列固定循环，按 unit.actionIndex 取模分支；行动即提交指令，无特判；
//   * 攻击数值一律走「基数 + unit.attack 面板」（battle.md F1 同源算式）——
//     floorEnemyGenerator 按实例难度抬高 attack 面板即可全场统一缩放，
//     getIntention 的 damage 用同一算式（意图预告 = 实际数值，所见即所算）；
//   * difficulty 难度元数据（2026-09 难度制，见 battle_gameplay/ENEMY_GENERATION.md）：
//     { base, min, max, floorMin, floorMax }——base 为设计基准难度（白板强度锚点），
//     实例难度 d ∈ [min,max] 决定属性加成；楼层超出 [floorMin,floorMax] 不再生成
//     （机制老旧 / 数值漂移超出设计包络的敌人自然退役）；
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
