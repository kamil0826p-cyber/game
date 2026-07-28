export const ACTOR_INTERACTION_RADIUS = 1;

export interface ActorInteractionPosition {
  mapId: string;
  x: number;
  y: number;
}

export function isActorWithinInteractionRange(
  first: ActorInteractionPosition,
  second: ActorInteractionPosition,
): boolean {
  return (
    first.mapId === second.mapId &&
    Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)) <= ACTOR_INTERACTION_RADIUS
  );
}
