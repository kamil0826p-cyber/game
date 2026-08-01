import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';

const ACTION_INVALID_ERRORS = new Set([
  'COMBAT_OPERATION_ID_COLLISION',
  'COMBAT_REACTION_CLOSED',
  'COMBAT_TARGET_ILLEGAL',
  'COMBAT_FORMATION_INVALID',
]);

export function mapTacticalCombatError(error: unknown): GameError | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message === 'COMBAT_STALE_TURN') {
    return new GameError(
      GAME_ERROR_CODES.COMBAT_NOT_YOUR_TURN,
      'errors.combat.notYourTurn',
      { reason: error.message },
    );
  }
  if (ACTION_INVALID_ERRORS.has(error.message)) {
    return new GameError(
      GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
      'errors.combat.actionInvalid',
      { reason: error.message },
    );
  }
  return undefined;
}
