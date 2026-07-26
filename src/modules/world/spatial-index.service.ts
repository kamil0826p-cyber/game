import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../../config/game-config.service.js';

@Injectable()
export class SpatialIndexService {
  private readonly maps = new Map<string, Map<string, Set<string>>>();
  private readonly bucketSize: number;

  constructor(config: GameConfigService) {
    this.bucketSize = config.values.SPATIAL_BUCKET_SIZE;
  }

  add(characterId: string, mapId: string, x: number, y: number): void {
    const bucket = this.getOrCreateBucket(mapId, this.bucketKey(x, y));
    bucket.add(characterId);
  }

  remove(characterId: string, mapId: string, x: number, y: number): void {
    const mapBuckets = this.maps.get(mapId);
    if (!mapBuckets) {
      return;
    }
    const key = this.bucketKey(x, y);
    const bucket = mapBuckets.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(characterId);
    if (bucket.size === 0) {
      mapBuckets.delete(key);
    }
    if (mapBuckets.size === 0) {
      this.maps.delete(mapId);
    }
  }

  move(
    characterId: string,
    previousMapId: string,
    previousX: number,
    previousY: number,
    nextMapId: string,
    nextX: number,
    nextY: number,
  ): void {
    if (
      previousMapId === nextMapId &&
      this.bucketKey(previousX, previousY) === this.bucketKey(nextX, nextY)
    ) {
      return;
    }
    this.remove(characterId, previousMapId, previousX, previousY);
    this.add(characterId, nextMapId, nextX, nextY);
  }

  queryRectangle(
    mapId: string,
    minimumX: number,
    maximumX: number,
    minimumY: number,
    maximumY: number,
  ): Set<string> {
    const result = new Set<string>();
    const mapBuckets = this.maps.get(mapId);
    if (!mapBuckets) {
      return result;
    }

    const minimumBucketX = Math.floor(minimumX / this.bucketSize);
    const maximumBucketX = Math.floor(maximumX / this.bucketSize);
    const minimumBucketY = Math.floor(minimumY / this.bucketSize);
    const maximumBucketY = Math.floor(maximumY / this.bucketSize);

    for (let bucketY = minimumBucketY; bucketY <= maximumBucketY; bucketY += 1) {
      for (let bucketX = minimumBucketX; bucketX <= maximumBucketX; bucketX += 1) {
        const bucket = mapBuckets.get(`${bucketX}:${bucketY}`);
        if (!bucket) {
          continue;
        }
        for (const characterId of bucket) {
          result.add(characterId);
        }
      }
    }

    return result;
  }

  private bucketKey(x: number, y: number): string {
    return `${Math.floor(x / this.bucketSize)}:${Math.floor(y / this.bucketSize)}`;
  }

  private getOrCreateBucket(mapId: string, key: string): Set<string> {
    let mapBuckets = this.maps.get(mapId);
    if (!mapBuckets) {
      mapBuckets = new Map<string, Set<string>>();
      this.maps.set(mapId, mapBuckets);
    }
    let bucket = mapBuckets.get(key);
    if (!bucket) {
      bucket = new Set<string>();
      mapBuckets.set(key, bucket);
    }
    return bucket;
  }
}
