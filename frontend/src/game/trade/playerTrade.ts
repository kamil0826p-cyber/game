import type { PublicPlayerState, SelfCharacterState } from '../../contracts/game';

export const PLAYER_TRADE_RADIUS = 2;

export function canTradeWithPlayer(
  self: Pick<SelfCharacterState, 'characterId' | 'mapId' | 'x' | 'y'>,
  player: Pick<PublicPlayerState, 'characterId' | 'mapId' | 'x' | 'y'>,
): boolean {
  return self.characterId !== player.characterId &&
    self.mapId === player.mapId &&
    Math.max(Math.abs(self.x - player.x), Math.abs(self.y - player.y)) <= PLAYER_TRADE_RADIUS;
}
