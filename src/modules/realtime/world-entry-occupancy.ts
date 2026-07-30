interface WorldEntryOccupancySource {
  isOccupied(
    mapId: string,
    x: number,
    y: number,
    excludingCharacterId?: string,
  ): boolean;
}

export function createWorldEntryOccupancyPredicate(
  worldState: WorldEntryOccupancySource,
  mapId: string,
  characterId: string,
): (x: number, y: number) => boolean {
  return (x, y) => worldState.isOccupied(mapId, x, y, characterId);
}
