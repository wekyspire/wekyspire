import { createRegistry } from '../registryFactory.js';

// 事件定义注册表（RUN_DESIGN §4.4）。事件 = **对话 + 选项 + 逻辑**，内容与结算都在 core。
//
// 契约（事件定义 = plain object，可静态检查）：
//   { id, name, art,
//     mode?: 'both' | 'story' | 'endless',   // 出现模式（缺省 both；故事专属事件用 'story'）
//     weight?: number,                        // 抽取权重（缺省 1；按楼层/章节分化时再细分）
//     requires?(run) -> boolean,               // 出现前提（缺省恒真）
//     pages: [{speaker,text}] | (run, ctx) => [...],   // 开场白（探索前的叙述）
//     choices(run, ctx) -> [{id,label,hint?,disabled?}],
//     resolve(run, choiceId, ctx) -> { pages: [...] }   // **只返回结果页**；效果自己在里面施加
//   }
//
// 「效果自己施加」是这套系统的关键（用户定 2026-09-13）：事件选完选项后**主动**调用
// `run/runEffects.js` 的效果原语（gainMoney/healPlayer/gainRelic…），由原语负责改 run 状态
// 并声明表现意图；**不再**返回 { money: 15 } 之类载荷让 Shell 去解释执行。
// `resolve` 的返回值只有叙事（结果页），Shell 拿它继续播片即可，对"事件做了什么"一无所知。
//
// pages 的 choices 由 Shell 摆出（cutscene dialogue step 原生支持），选中的 id 交回 resolve。
const reg = createRegistry('事件');

export const registerEvent = reg.register;
export const getEventDefinition = reg.get;
export const hasEvent = reg.has;
export const clearEventRegistry = reg.clear;
export const allEvents = reg.all;
