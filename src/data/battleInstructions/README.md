# Battle Instructions: Effect Refactor

This module now handles turn-based and reactive effects purely via instructions.

- Start of Turn:
  - ProcessStartOfTurnEffectsInstruction expands into ProcessStartOfTurnEffectInstruction per effect
  - isStunned is determined and exposed
- End of Turn:
  - ProcessEndOfTurnEffectsInstruction expands into ProcessEndOfTurnEffectInstruction per effect
- During Attack/Damage:
  - LaunchAttackInstruction inlines attacker/defender effects and uses AddEffectInstruction for state changes
  - DealDamageInstruction applies damage and then instructionizes reactive effects (e.g., remove 飞行, apply 力量 from 暴怒)
- Mana changes:
  - GainManaInstruction and ConsumeManaInstruction represent all mana changes

effectProcessor.js has been deprecated and is scheduled for removal.

