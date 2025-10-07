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
    FRONTIER_UPDATED: 'player-frontier-skills-updated',
    TIER_UPGRADED: 'player-tier-upgraded',
    ABILITY_CLAIMED: 'player-ability-claimed',
    SKILL_BURNT: 'player-skill-burnt',
    MONEY_CLAIMED: 'player-money-claimed',
    SKILL_USED: 'player-skill-used',
    SKILL_DROPPED: 'player-skill-dropped',
    SKILL_REWARD_CLAIMED: 'player-skill-claimed',
    ACTIVATED_SKILLS_UPDATED: 'player-activated-skills-updated',
    ACTIVATED_SKILL_ENABLED: 'player-activated-skill-enabled',
    ACTIVATED_SKILL_DISABLED: 'player-activated-skill-disabled'
  },
  Battle: {
    BATTLE_START: 'battle-battle-start',
    PLAYER_TURN: 'battle-player-turn',
    PLAYER_USE_SKILL: 'battle-player-use-skill',
    PLAYER_DROP_SKILL: 'battle-player-drop-skill',
    PLAYER_END_TURN: 'player-end-turn',
    ENEMY_TURN: 'battle-enemy-turn',
    BATTLE_VICTORY: 'battle-victory',
    PLAYER_STOP_ACTIVATED_SKILL: 'battle-player-stop-activated-skill'
  },
  Enemy: {
    TURN_START: 'enemy-turn-start',
    ACTION_END: 'enemy-action-end',
    TURN_END: 'enemy-turn-end',
  },
  Rest: {
    REWARDS_SPAWNED: 'rewards-spawned',
    CLAIM_MONEY: 'rest-claim-money',
    CLAIM_SKILL: 'rest-claim-skill',
    CLAIM_ABILITY: 'rest-claim-ability',
    CLAIM_BREAKTHROUGH: 'rest-claim-breakthrough',
    REORDER_SKILLS: 'rest-reorder-skills',
    PURCHASE_ITEM: 'rest-purchase-item',
    SHOP_REFRESHED: 'rest-shop-refreshed',
    FINISH: 'rest-finish',
    END: 'rest-end',
    DROP_REWARD: 'rest-drop-reward'
  },
  Shop: {
    ITEM_PURCHASED: 'item-purchased'
  }
};

export default backendEventBus;
