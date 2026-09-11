import { createRegistry } from '../registryFactory.js';

// 技能定义注册表。定义为 plain object，字段契约见计划文档 §2.4：
// { id, name, type, tier, series, subtitle, keywords, cost, charges,
//   cardMode, activated?, subscriptions?, canUse?, use, describe, battleDescribe?, meta }
// tier 取值：'D'|'C'|'B'|'A'（晋升阶梯，升序）|'S'（特级，阶梯外）|'Z'（诅咒，阶梯外）。
// 见 SKILL_DESIGN_PRINCIPLES.md「养成与等阶」节。
//
// 描述双轨（缺省主语约定：伤害默认打选中目标，效果获得默认施法者——"造成/获得"
// 省略；给目标上效果用"赋予"；层数后置；句号省略）：
//   describe       应用前（机制）：领奖 3 选 1 / 卡牌详情时显示。无战斗上下文，
//                  不得访问 sctx 的战斗字段（zone/敌人等），条件与公式写全。
//   battleDescribe 应用后（结算）：战斗中卡面显示。sctx = 实时战斗状态，数字按
//                  当前局面结算（previewDamage 干跑吃 PRE 修正），已满足的条件
//                  子句省略。缺省回落 describe。
const reg = createRegistry('技能');

export const registerSkill = reg.register;
export const getSkillDefinition = reg.get;
export const hasSkill = reg.has;
export const clearSkillRegistry = reg.clear;
export const allSkills = reg.all;
