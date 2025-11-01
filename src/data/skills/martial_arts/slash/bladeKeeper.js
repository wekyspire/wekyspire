// 养刀术：持续提升牌库中刀组合卡牌的强度（power up）
import Skill from '@data/skill';
import backendEventBus, { EventNames } from '@/backendEventBus';
import { backendGameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";

export class CultivateBlade extends Skill {
  constructor() {
    super('养刀术', 'normal', SkillTier.A_MINUS, 0, 2, 1, '养刀术'); // A-
    this.baseColdDownTurns = 3;
    this.cardMode = 'chant';
    this._listener = null;
  }
  onEnable(player) {
    super.onEnable(player);
    this._listener = () => {
      const allDeck = backendGameState.player.backupSkills||[];
      for (const sk of allDeck) {
        if (sk.skillSeriesName === '刀' || (sk.skillSeriesName||'').includes('斩')) {
          try { sk.powerUp(1); } catch (_) {}
        }
      }
    };
    backendEventBus.on(EventNames.Battle.PLAYER_TURN_END, this._listener);
  }
  onDisable(player) {
    super.onDisable(player);
    if (this._listener) backendEventBus.off(EventNames.Battle.PLAYER_TURN_END, this._listener);
    this._listener = null;
  }
  use(){ return true; }
  regenerateDescription(){ return `回合结束时，牌库中的刀法牌获得1点强化`; }
}

