import { describe, expect, it } from 'vitest';
import { getIdlePose, getWalkPose } from './outfitAnimation';

describe('outfit animation poses', () => {
  it('cycles through four distinct walk frames during one movement step', () => {
    const duration = 400;
    const frames = [0, 100, 200, 300].map((now) => getWalkPose(now, 0, duration).frame);

    expect(frames).toEqual([0, 1, 2, 3]);
    expect(new Set(frames).size).toBe(4);
  });

  it('changes the silhouette while walking even when source frames are similar', () => {
    const first = getWalkPose(0, 0, 400);
    const second = getWalkPose(100, 0, 400);

    expect(second.offsetY).not.toBe(first.offsetY);
    expect(second.rotation).not.toBe(first.rotation);
    expect(second.scaleY).not.toBe(first.scaleY);
  });

  it('provides a subtle idle breathing pose', () => {
    const first = getIdlePose(0);
    const second = getIdlePose(520 * Math.PI / 2);

    expect(first.frame).toBe(0);
    expect(second.frame).toBe(0);
    expect(second.offsetY).not.toBe(first.offsetY);
    expect(second.scaleY).not.toBe(first.scaleY);
  });
});
