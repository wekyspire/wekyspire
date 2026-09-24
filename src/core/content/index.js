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
import './fireExpansionSkills.js';
import './woodSkills.js';
import './airSkills.js';
import './commonSkills.js';
import './gmSkills.js';
import './enemies/index.js';
import './allies.js';
import './abilities.js';
import './relicCards.js';
import './relics.js';
import './events.js';
// 卡图键覆盖：晋升链拆分（同链/同名同键、异链异键），见 core/skills/artKeys.js 头注
import { applyArtKeyOverrides } from '../skills/artKeys.js';
applyArtKeyOverrides();
