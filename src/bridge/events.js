// Bridge 协议事件枚举（唯一事实源）。
// 两条总线分工：
//   backendBus  —— 状态/日志/输入请求/战斗生命周期（Shell 消费）
//   frontendBus —— 动画指令（Stage 消费）+ 动画完成回调（Stage → sequencer）
// Core 不知道这些事件的存在；它只调 presenter，翻译全部在这里完成。
export const EventNames = {
  // ---- backendBus：状态与生命周期 ----
  BATTLE_START: 'battle:start',
  BATTLE_END: 'battle:end',
  STATE_DIRTY: 'battle:state-dirty',        // 状态已变，投影缓存失效（拉取 getProjection）
  BATTLE_LOG: 'battle:log',                 // { text, kind } 战斗日志条目
  INPUT_REQUESTED: 'battle:input-requested',   // { request } 结算期输入请求（Shell 弹交互）
  INPUT_RESOLVED: 'battle:input-resolved',     // { selection } 输入已应答

  // ---- frontendBus：动画指令（payload = presenter 调用参数） ----
  ANIM_DAMAGE: 'anim:damage',
  ANIM_HEAL: 'anim:heal',
  ANIM_SHIELD: 'anim:shield',
  ANIM_RESOURCE: 'anim:resource',
  ANIM_EFFECT: 'anim:effect',
  ANIM_UNIT_DEATH: 'anim:unit-death',
  ANIM_UNIT_SPAWN: 'anim:unit-spawn',     // 单位入场（召唤）：billboard 立起 + 扬尘 + 摇晃站稳
  ANIM_SKILL_USED: 'anim:skill-used',
  ANIM_CHANT_TOGGLED: 'anim:chant-toggled', // 咏唱双态翻转（on: 发动点亮 / off: 关停或离手熄灭）
  ANIM_COOLDOWN_TICK: 'anim:cooldown-tick',
  ANIM_CARD_DRAWN: 'anim:card-drawn',
  ANIM_CARD_DISCARDED: 'anim:card-discarded',
  ANIM_CARD_BURNT: 'anim:card-burnt',
  ANIM_CARD_MOVED: 'anim:card-moved',
  ANIM_CARD_ADDED: 'anim:card-added',
  ANIM_CARD_SHOWCASE: 'anim:card-showcase', // 结算宾语入结算区展示（原位 → 场中央）
  ANIM_CARD_TRANSFORMED: 'anim:card-transformed',
  ANIM_CARD_SWAPPED: 'anim:card-swapped',
  // 状态同步节拍：前端**显示状态**只在此时推进（快照在 start 时拉取，合并此前全部变更）。
  // 精髓（老版设计）：后端状态与前端显示状态是两套状态；显示状态不随后端即时变，
  // 而由本指令在动画队列中按节拍应用——因此"先播受伤动画再扣血""卡牌飞进坟堆数字才+1"
  // 这类时序由 sync 指令与动画指令的相对入队位置表达：
//   效果类（伤害/治疗/护盾/资源/特效/死亡）→ 先动画节拍，后 sync（演完再变数字）
//   入场类（抽牌/造牌/转化/咏唱发动）→ 先 sync，后动画节拍（先转移再播动画）
//   离场类（弃/焚/迁移）→ 先离场飞行动画节拍，后 sync（飞进坟堆数字才+1）
  ANIM_STATE_SYNC: 'anim:state-sync',

  // ---- frontendBus：动画完成回调（Stage → sequencer，协议名保持旧仓库兼容） ----
  ANIMATION_INSTRUCTION_FINISHED: 'animation-instruction-finished', // { id }

  // ---- UI 协议（Stage Picker → Shell 消费） ----
  TOOLTIP_SHOW: 'tooltip:show',   // { kind:'named'|'card'|'effect'|'intention'|'shift', payload, x, y }（x/y 为 canvas 内像素；payload 即热区契约，见 shell/tooltip.js）
  TOOLTIP_MOVE: 'tooltip:move',   // { x, y }
  TOOLTIP_HIDE: 'tooltip:hide',   // {}
  CARD_HOVER: 'card:hover',       // { uniqueID } 整卡悬浮（token 未命中时）
  CARD_LEAVE: 'card:leave',       // { uniqueID }
};

// 动画时序档位（durationMs 超时强杀兜底）。
// ⚠ 这是"前端卡死/漏回 finish 时防队列僵死"的保险丝，不是调度依据——
// 节拍衔接一律以 Stage 回 finish 为准。取值必须远宽于实际动画时长（≥5 倍余量），
// 切勿按"实际动画时长"收紧：复杂卡牌一次发动可能带出一长串效果节拍，
// 任何节拍被超时强杀都会让后续动画提前衔接（如离场飞行压住伤害演出）。
export const ANIM_TIMING = {
  [EventNames.ANIM_DAMAGE]: 3000,
  [EventNames.ANIM_HEAL]: 2000,
  [EventNames.ANIM_SHIELD]: 2000,
  [EventNames.ANIM_RESOURCE]: 2000,
  [EventNames.ANIM_EFFECT]: 2000,
  [EventNames.ANIM_UNIT_DEATH]: 6000,   // 倾倒470+回弹220+焚毁430 ≈1.1s，按 ≥5 倍余量
  [EventNames.ANIM_UNIT_SPAWN]: 3000,   // 立起~350+摇晃站稳~750，按 ≥2.5 倍余量
  [EventNames.ANIM_SKILL_USED]: 5000,   // 发动展示（飞中放大180+停留380）+ 充分余量
  [EventNames.ANIM_CHANT_TOGGLED]: 2500,
  [EventNames.ANIM_COOLDOWN_TICK]: 2000,
  [EventNames.ANIM_CARD_DRAWN]: 2500,
  [EventNames.ANIM_CARD_DISCARDED]: 2500,
  [EventNames.ANIM_CARD_BURNT]: 3000,
  [EventNames.ANIM_CARD_MOVED]: 2500,
  [EventNames.ANIM_CARD_ADDED]: 2500,
  [EventNames.ANIM_CARD_SHOWCASE]: 2500,
  [EventNames.ANIM_CARD_TRANSFORMED]: 3000,
  [EventNames.ANIM_CARD_SWAPPED]: 2500,
  [EventNames.ANIM_STATE_SYNC]: 2000,   // 实际时长≈0（Stage 应用快照即回 finish），兜底同理
};
