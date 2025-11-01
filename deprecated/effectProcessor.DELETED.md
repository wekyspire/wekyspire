The previous central effectProcessor has been replaced by instruction-based processing:

- Start-of-turn: ProcessStartOfTurnEffectsInstruction expands individual effects.
- End-of-turn: ProcessEndOfTurnEffectsInstruction expands individual effects.
- Attack and damage flows handle their own effect hooks within instructions.

This file documents the deprecation for reference and can be removed later.

