import mitt from 'mitt';

const backendEventBus = mitt();

export const EventNames = {
  Game: {
    PRE_GAME_START: 'pre-game-start',
    GAME_START: 'game-start',
    ENTER_BATTLE_STAGE: 'enter-battle-stage',
    ENTER_REST_STAGE: 'enter-rest-stage',
    PRE_BATTLE: 'pre-battle',
    POST_BATTLE: 'post-battle',
    GAME_OVER: 'game-over',
  },
  Player: {
    // 休息/通用事件（由后端触发的结果类事件）
    TIER_UPGRADED: 'player-tier-upgraded',
    ABILITY_CLAIMED: 'player-ability-claimed',
    MONEY_CLAIMED: 'player-money-claimed',
    SKILL_REWARD_CLAIMED: 'player-skill-claimed',
    // 战斗事件（后端广播的状态更新/通知）
    FRONTIER_UPDATED: 'player-frontier-skills-updated',
    ACTIVATED_SKILLS_UPDATED: 'player-activated-skills-updated',
    ACTIVATED_SKILL_ENABLED: 'player-activated-skill-enabled',
    ACTIVATED_SKILL_DISABLED: 'player-activated-skill-disabled',
    EFFECT_CHANGED: 'player-effect-changed', // param: effectName, deltaStacks
    SKILL_BURNT: 'player-skill-burnt',
    SKILL_DISCOVERED: 'player-skill-discovered',
    SKILL_USED: 'player-skill-used',
    SKILL_DROPPED: 'player-skill-dropped',
    SKILL_DRAWN: 'player-skill-drawn' // param: skillID
  },
  // 新增：玩家操作事件（仅由前端发起，用于告知后端进行结算/流程推进）
  PlayerOperations: {
    // 战斗内玩家操作
    PLAYER_USE_SKILL: 'battle-player-use-skill',
    PLAYER_SHIFT_SKILL: 'battle-player-shift-skill',
    PLAYER_END_TURN: 'player-end-turn',
    PLAYER_STOP_ACTIVATED_SKILL: 'battle-player-stop-activated-skill',
    // 休整阶段操作
    CLAIM_MONEY: 'rest-claim-money',
    CLAIM_SKILL: 'rest-claim-skill',
    CLAIM_ABILITY: 'rest-claim-ability',
    CLAIM_BREAKTHROUGH: 'rest-claim-breakthrough',
    REORDER_SKILLS: 'rest-reorder-skills',
    PURCHASE_ITEM: 'rest-purchase-item',
    FINISH: 'rest-finish',
    DROP_REWARD: 'rest-drop-reward',
    // Overlay 操作
    CONFIRM_OVERLAY_SKILL_SELECTIONS: 'overlay-confirm-skill-selections'
  },
  Battle: {
    // 战斗流程事件
    BATTLE_START: 'battle-battle-start',
    // 玩家回合阶段事件（用于区分顺序）
    PRE_PLAYER_TURN_START: 'battle-pre-player-turn-start',
    PLAYER_TURN_START: 'battle-player-turn-start',
    PLAYER_TURN: 'battle-player-turn',
    PLAYER_TURN_END: 'battle-player-turn-end',
    POST_PLAYER_TURN_END: 'battle-post-player-turn-end',
    // 敌人回合阶段事件（整合自 Enemy）
    ENEMY_TURN: 'battle-enemy-turn',
    ENEMY_TURN_START: 'battle-enemy-turn-start',
    ENEMY_ACTION_END: 'battle-enemy-action-end',
    ENEMY_TURN_END: 'battle-enemy-turn-end',
    // 结算
    BATTLE_VICTORY: 'battle-victory',
  },
  Rest: {
    REWARDS_SPAWNED: 'rewards-spawned',
    SHOP_REFRESHED: 'rest-shop-refreshed',
    END: 'rest-end'
  },
  Shop: {
    ITEM_PURCHASED: 'item-purchased'
  }
};

export default backendEventBus;
