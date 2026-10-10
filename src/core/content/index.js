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
import './commonSkills.js';
import './weirdRemiCurses.js';
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

// 子体系字段校验（SKILL_DESIGN_PRINCIPLES）：def.subsystem 与 def.deep（深入卡门禁键）
// 都必须存合法子体系 id（null = 未归属）。注册期硬失败——非法值会让亲和/门禁静默失配。
import { allSkills } from '../skills/registry.js';
import { isLegalSubsystem } from '../skills/subsystems.js';
for (const def of allSkills()) {
  if (!isLegalSubsystem(def.subsystem)) {
    throw new Error(`卡牌 ${def.id} 的 subsystem 非法：${def.subsystem}`);
  }
  if (!isLegalSubsystem(def.deep)) {
    throw new Error(`卡牌 ${def.id} 的 deep 非法：${def.deep}（深入卡门禁键必须是合法子体系）`);
  }
}
