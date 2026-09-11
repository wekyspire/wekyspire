// 最小测试内容总装配：显式 import 触发各注册表登记。
// （Core 保持环境无关，不用 import.meta.glob；应用层如需自动收集可自行 glob。）
import '../effects/definitions/strength.js';
import './effects.js';
import './skills.js';
import './bodySkills.js';
import './bladeSkills.js';
import './blockSkills.js';
import './fireBurstSkills.js';
import './fireEmberSkills.js';
import './fireEmberMoreSkills.js';
import './commonSkills.js';
import './enemies.js';
import './allies.js';
import './abilities.js';
import './relicCards.js';
import './relics.js';
