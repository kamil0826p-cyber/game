import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { GameSocketIoAdapter } from './auth/game-socket-io.adapter.js';
import { GameConfigService } from './config/game-config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(GameConfigService);
  const socketAdapter = new GameSocketIoAdapter(app, config);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    Logger.log(`Received ${signal}; closing the game server.`, 'Bootstrap');
    try {
      await app.close();
    } finally {
      await socketAdapter.dispose();
    }
  };
  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch((error: unknown) => {
      Logger.error(
        `Graceful shutdown failed after ${signal}.`,
        error instanceof Error ? error.stack : String(error),
        'Bootstrap',
      );
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    await socketAdapter.connectRedisIfConfigured();
    app.useWebSocketAdapter(socketAdapter);

    app.use(helmet());
    app.enableCors({
      origin: config.corsOrigins,
      methods: ['GET'],
    });
    app.setGlobalPrefix('api');

    await app.listen(config.values.PORT, '0.0.0.0');
    Logger.log(
      `Backend listening on port ${config.values.PORT} for realm ${config.values.GAME_REALM_SLUG}.`,
      'Bootstrap',
    );
  } catch (error) {
    if (!shuttingDown) {
      shuttingDown = true;
      await Promise.allSettled([app.close(), socketAdapter.dispose()]);
    }
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    'Backend bootstrap failed.',
    error instanceof Error ? error.stack : String(error),
    'Bootstrap',
  );
  process.exitCode = 1;
});
