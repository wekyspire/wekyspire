// playSession：headless 对局引擎的**稳定入口**（barrel）。
//
// 会话 = tmp/playtests/<名>.json { seed, actions: [] }。每次调用把全部动作确定性
// 重放一遍（战斗种子由 run 种子派生、奖励走 run rng，同种子同动作序列必同局），
// 新动作成功后才入档——中途战斗状态无需序列化。
//
// 两个消费者共用同一份 exec/render，输出不漂移：
//   tools/headlessPlay.mjs —— 一次性 CLI（一个动作一个进程，agent 用）
//   tools/broadcast.mjs    —— 直播守护进程（内存态常驻 + 只对新动作开流）
//
// 实现在 tools/session/：engine.mjs（状态机 + 动作解释器）/ render.mjs（状态渲染）/
// format.mjs（中文文本）/ addressing.mjs（编号+卡名寻址）/ files.mjs（会话文件）。
// 本文件只做汇总再导出，故 import 路径保持 `tools/playSession.mjs` 不变。
export { freshState, exec, stageCn } from './session/engine.mjs';
export { render, renderDeck, renderLib, renderRelics, renderTerms } from './session/render.mjs';
export { defOf } from './session/format.mjs';
export { sessionDir, sessionPath, listSessions, readSession, writeSession } from './session/files.mjs';

export const HELP = `动作表（按当前阶段）：
  战斗: play <手牌#> <卡名> [敌#] | play <卡名> [敌#] | swap <手牌#> <卡名> | swap <卡名>
        （弃1抽1，首次免费之后逐次+1） | end | auto
        in <候选#> <卡名>（应答输入请求） | lib（查牌库——抽牌严格按顺序，可预知未来抽到什么）
  奖励: pack <#|体修|火|通用> | take <候选#> <卡名> | take <卡名> | skip | next
  房间: act rest | act remi | act upgrade <构筑#> <卡名> | act up <构筑#> <卡名> | act draw
        | act take <候选#> <卡名> | act skipdraw | act skip | act play | next
        | act spin | act claim <#|id> [卡名] | act drop | act devour relic <id> | act devour card <构筑#>
        | act shop buy <#> | act shop claim <#|defId> [卡名]（售货机与房间并存，不消耗房间行动）
  预览: preview up <构筑#>（升阶前后对比，只读）
  进阶: dim 火|跳过（首次点亮火系：获赠点火+火弹术+体系能力「火灵脉」，再开种子九选三；
        跳过=体修等级+1：之后能抽到更高阶的体修卡牌） | reroll | ability <#|skip>
        | seed <#> <卡名>,<#> <卡名>,<#> <卡名>（选3张入组）
  通用: state | deck | lib | relics（遗物效果一览） | terms（词条/效果释义） | note <文本> | help
※ 打牌/选牌：**批处理里请只用卡名**（如 play 拳）——同名同态会直接取第一张，可用「拳#2」指定第几张。
  带编号的「编号+卡名」只在单次调用时可靠：**出牌（尤其带抽牌）后手牌编号会整体前移**，一次批处理里连用编号几乎必然错位。
※ 老虎机未中奖不产生产出：act spin 未中奖可直接再拉，不需要 claim/drop。
※ why <手牌#>|<卡名>（只读）：逐项定位「这张牌为什么打不出」——费用/充能冷却/咏唱压力/自定义条件/目标。
※ dev（**仅覆盖局用**，正常局不要用；用了必须在报告里标注）：dev relic <id> | dev relics <id,id,..>
   | dev listed（全部遗物 id + 效果） | dev money <n> | dev heal`;
