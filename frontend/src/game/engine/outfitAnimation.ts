export interface OutfitAnimationPose {
  frame: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

const WALK_FRAMES = [0, 1, 2, 3] as const;
const WALK_OFFSET_Y = [0, -2, 0, -1] as const;
const WALK_ROTATION = [-0.018, 0.025, 0.018, -0.025] as const;
const WALK_SCALE_X = [1, 0.97, 1, 1.03] as const;
const WALK_SCALE_Y = [1, 1.025, 1, 0.985] as const;

export const getWalkPose = (
  now: number,
  movementStartedAt: number,
  movementDuration: number,
): OutfitAnimationPose => {
  const elapsed = Math.max(0, now - movementStartedAt);
  const frameDuration = Math.max(55, movementDuration / WALK_FRAMES.length);
  const poseIndex = Math.floor(elapsed / frameDuration) % WALK_FRAMES.length;

  return {
    frame: WALK_FRAMES[poseIndex]!,
    offsetY: WALK_OFFSET_Y[poseIndex]!,
    rotation: WALK_ROTATION[poseIndex]!,
    scaleX: WALK_SCALE_X[poseIndex]!,
    scaleY: WALK_SCALE_Y[poseIndex]!,
  };
};

export const getIdlePose = (now: number): OutfitAnimationPose => {
  const phase = now / 520;
  const breathing = Math.sin(phase);

  return {
    frame: 0,
    offsetY: breathing * -0.45,
    rotation: Math.sin(phase * 0.5) * 0.004,
    scaleX: 1 - breathing * 0.004,
    scaleY: 1 + breathing * 0.008,
  };
};
