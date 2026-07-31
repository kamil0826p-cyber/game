import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const booleanFromEnvironment = (defaultValue: boolean) =>
  z.preprocess((value: unknown) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return value;
  }, z.boolean());

const integerFromEnvironment = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess((value: unknown) => {
    if (value === undefined || value === '') return defaultValue;
    return Number(value);
  }, z.number().int().min(minimum).max(maximum));

const optionalUrl = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? undefined : value),
  z.url().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: integerFromEnvironment(3000, 1, 65535),
  DATABASE_URL: z.string().min(1),
  GAME_REALM_SLUG: z.string().min(1).max(64).default('world-1'),
  GAME_REALM_INSTANCE_ID: z.string().min(1).max(128).default('world-1-primary'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  MOVE_STEP_MS: integerFromEnvironment(200, 100, 2000),
  AUTOSAVE_INTERVAL_MS: integerFromEnvironment(5000, 1000, 60000),
  AUTOSAVE_CONCURRENCY: integerFromEnvironment(16, 1, 128),
  FOV_HALF_WIDTH: integerFromEnvironment(12, 1, 64),
  FOV_HALF_HEIGHT: integerFromEnvironment(8, 1, 64),
  MAX_FOV_HALF_WIDTH: integerFromEnvironment(24, 1, 128),
  MAX_FOV_HALF_HEIGHT: integerFromEnvironment(18, 1, 128),
  SPATIAL_BUCKET_SIZE: integerFromEnvironment(16, 4, 128),
  MAX_PATH_STEPS: integerFromEnvironment(192, 1, 512),
  MAX_PATH_NODES: integerFromEnvironment(16_384, 64, 65_536),
  SOCKET_MAX_PAYLOAD_BYTES: integerFromEnvironment(65_536, 1024, 1_048_576),
  SOCKET_PING_INTERVAL_MS: integerFromEnvironment(25_000, 5000, 120_000),
  SOCKET_PING_TIMEOUT_MS: integerFromEnvironment(20_000, 5000, 120_000),

  MAX_CHARACTER_LEVEL: integerFromEnvironment(100, 1, 1000),
  PROGRESSION_RULESET_VERSION: z.string().trim().min(1).max(64).default('v1'),
  COMBAT_ROUND_MODE: z.enum(['CLASSIC', 'SIMULTANEOUS']).default('CLASSIC'),
  COMBAT_TURN_TIMEOUT_MS: integerFromEnvironment(12_000, 3000, 60_000),
  COMBAT_MAX_TEAM_SIZE: integerFromEnvironment(5, 1, 10),

  TELEMETRY_ENABLED: booleanFromEnvironment(false),
  TELEMETRY_ENDPOINT: optionalUrl,
  TELEMETRY_BATCH_SIZE: integerFromEnvironment(100, 1, 1000),
  TELEMETRY_MAX_QUEUE: integerFromEnvironment(10_000, 100, 100_000),
  TELEMETRY_FLUSH_MS: integerFromEnvironment(5000, 250, 60_000),
  TELEMETRY_REQUEST_TIMEOUT_MS: integerFromEnvironment(5000, 250, 30_000),
  TELEMETRY_SHUTDOWN_TIMEOUT_MS: integerFromEnvironment(3000, 100, 30_000),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  FIREBASE_CHECK_REVOKED: booleanFromEnvironment(true),
  REDIS_URL: z.string().optional(),
});

export type GameEnvironment = z.infer<typeof environmentSchema>;

@Injectable()
export class GameConfigService {
  private readonly environment: GameEnvironment;

  constructor() {
    const parsed = environmentSchema.safeParse(process.env);
    if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    this.environment = parsed.data;

    if (this.environment.FOV_HALF_WIDTH > this.environment.MAX_FOV_HALF_WIDTH) throw new Error('FOV_HALF_WIDTH cannot exceed MAX_FOV_HALF_WIDTH.');
    if (this.environment.FOV_HALF_HEIGHT > this.environment.MAX_FOV_HALF_HEIGHT) throw new Error('FOV_HALF_HEIGHT cannot exceed MAX_FOV_HALF_HEIGHT.');
    if (this.environment.TELEMETRY_ENABLED && !this.environment.TELEMETRY_ENDPOINT) {
      throw new Error('TELEMETRY_ENDPOINT is required when TELEMETRY_ENABLED is true.');
    }
  }

  get values(): Readonly<GameEnvironment> {
    return this.environment;
  }

  get corsOrigins(): string[] {
    return this.environment.CORS_ORIGINS.split(',').map((origin: string) => origin.trim()).filter(Boolean);
  }

  get isProduction(): boolean {
    return this.environment.NODE_ENV === 'production';
  }
}
