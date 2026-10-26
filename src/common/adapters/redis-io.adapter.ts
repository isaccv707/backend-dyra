import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO over Redis pub/sub: with several backend instances, an event
 * emitted by one reaches sockets connected to any of them (rooms included).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    // family 0: IPv4 or IPv6 (Railway's private network may be IPv6-only).
    const pubClient = createClient({
      url: this.redisUrl,
      socket: { family: 0 },
    });
    const subClient = pubClient.duplicate();
    for (const client of [pubClient, subClient]) {
      client.on('error', (error: Error) =>
        this.logger.error(`Redis: ${error.message}`),
      );
    }
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(
      'Socket.IO usa Redis para repartir eventos entre instancias',
    );
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options) as {
      adapter: (adapter: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
