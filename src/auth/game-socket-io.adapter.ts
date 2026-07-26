import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server, type ServerOptions } from 'socket.io';
import { GameConfigService } from '../config/game-config.service.js';

export class GameSocketIoAdapter extends IoAdapter {
  private readonly logger = new Logger(GameSocketIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private publisherClient?: ReturnType<typeof createClient>;
  private subscriberClient?: ReturnType<typeof createClient>;

  constructor(
    app: INestApplicationContext,
    private readonly config: GameConfigService,
  ) {
    super(app);
  }

  async connectRedisIfConfigured(): Promise<void> {
    const redisUrl = this.config.values.REDIS_URL;
    if (!redisUrl) {
      this.logger.log('Socket.IO Redis adapter is disabled.');
      return;
    }

    this.publisherClient = createClient({ url: redisUrl });
    this.subscriberClient = this.publisherClient.duplicate();
    this.publisherClient.on('error', (error: Error) => {
      this.logger.error('Socket.IO Redis publisher error.', error.stack);
    });
    this.subscriberClient.on('error', (error: Error) => {
      this.logger.error('Socket.IO Redis subscriber error.', error.stack);
    });

    try {
      await Promise.all([this.publisherClient.connect(), this.subscriberClient.connect()]);
    } catch (error) {
      await this.dispose();
      throw error;
    }
    this.adapterConstructor = createAdapter(this.publisherClient, this.subscriberClient, {
      key: `grid-mmorpg:${this.config.values.GAME_REALM_SLUG}`,
    });
    this.logger.log(
      `Socket.IO Redis adapter connected for realm ${this.config.values.GAME_REALM_SLUG}.`,
    );
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      transports: ['websocket'],
      allowEIO3: false,
      serveClient: false,
      perMessageDeflate: false,
      maxHttpBufferSize: this.config.values.SOCKET_MAX_PAYLOAD_BYTES,
      pingInterval: this.config.values.SOCKET_PING_INTERVAL_MS,
      pingTimeout: this.config.values.SOCKET_PING_TIMEOUT_MS,
      cors: {
        origin: this.config.corsOrigins,
        methods: ['GET', 'POST'],
      },
    }) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([
      this.subscriberClient?.quit() ?? Promise.resolve(),
      this.publisherClient?.quit() ?? Promise.resolve(),
    ]);
  }
}
