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
export { freshState, freshStateFromSave, exec, stageCn } from './session/engine.mjs';
export { render, renderDeck, renderLib, renderRelics, renderTerms } from './session/render.mjs';
export { defOf } from './session/format.mjs';
export { sessionDir, sessionPath, listSessions, readSession, writeSession } from './session/files.mjs';

export const HELP = `建档：
  new <种子> [路线]         从零开一局（路线 = body/fire/wood/air，缺省 body 体修）
  load <存档名|路径.json> [--force]  从**存档快照**起跑（saveForge 产出 / 面板「导出存档」导出的 JSON；
                           --force = 会话已存在时重建，迭代构筑时沿用同一会话名）
                           ——层数/卡组/遗物/能力/灵脉/体修等级/房内现场原样恢复；
                           存档名解析到 tmp/saves/<名>.json，带路径或 .json 后缀则按路径读。
动作表（按当前阶段）：
  战斗: play <手牌#> <卡名> [敌#] | play <卡名> [敌#] | dump（2026-09-21 D3 一键全弃：
        付一次费弃掉全部手牌，首次免费之后逐次+1；不接受挑选参数） | end | auto
        in <候选#> <卡名>（应答输入请求） | lib（查牌库——抽牌严格按顺序，可预知未来抽到什么）
  奖励: pack <#|基础|体修|火|通用> | take <候选#> <卡名> | take <卡名> | skip | next
  房间: act rest | act remi | act upgrade <构筑#> <卡名> | act up <构筑#> <卡名> | act draw
        | act take <候选#> <卡名> | act skipdraw | act skip | act play | next
        | act spin | act claim <#|id> [卡名] | act drop | act devour relic <id> | act devour card <构筑#> [卡名]
        | act gift <cola|chicken>（老虎机安慰奖：本房拉满次数且全程未中奖时欠着，领了才能离房）
        | act shop buy <#> | act shop claim <#|defId> [卡名]（售货机与房间并存，不消耗房间行动）
  删卡: remove <构筑#> [卡名]（Boss 层胜利奖励的删卡机会，战斗外随时可用）
  预览: preview up <构筑#>（升阶前后对比，只读）
  进阶: dim 火|木|空|跳过（首次点亮某系：获赠该系基石卡2张+体系能力，再开种子九选三；
        跳过=体修等级+1：之后能抽到更高阶的体修卡牌） | reroll | ability <#|skip>
        | seed <#> <卡名>,<#> <卡名>,<#> <卡名>（选3张入组）
  通用: state | deck | lib | relics（遗物效果一览） | terms（词条/效果释义） | note <文本> | help
※ 打牌/选牌：**批处理里请只用卡名**（如 play 拳）——卡名是**精确匹配**（2026-09-26 定：不再前缀容错，
  「盾」不会打到「盾墙」）。同名同态直接取第一张；消歧三选一：「拳#2」（第几张）｜「拆招B」（等阶
  后缀）｜「编号+卡名」（仅单次调用可靠——出牌后手牌编号会整体前移）。找不到时报错会附相近名
  与升级改名提示（点火→烈焰后旧名会指路）。
※ 三个 claim 别敲混（敲错会明确指路，不会再假成功）：act claim = 老虎机产出｜act shop claim =
  售货机卡包/遗物包｜act gurpas claim = 古尔帕斯之店。
※ 老虎机未中奖不产生产出：act spin 未中奖可直接再拉，不需要 claim/drop。
※ why <手牌#>|<卡名>（只读）：逐项定位「这张牌为什么打不出」——费用/充能冷却/咏唱压力/自定义条件/目标。
※ dev（**仅覆盖局用**，正常局不要用；用了必须在报告里标注）：dev relic <id> | dev relics <id,id,..>
   | dev listed（全部遗物 id + 效果） | dev card <defId|卡名> | dev cards <逗号列表>（塞卡进构筑） | dev money <n> | dev heal`;
