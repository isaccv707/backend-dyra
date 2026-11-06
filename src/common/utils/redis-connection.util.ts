import type { ConnectionOptions } from 'bullmq';

/** REDIS_URL (redis:// or rediss://) as the ioredis options BullMQ expects. */
export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.replace('/', '');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(db && { db: Number(db) }),
    ...(url.protocol === 'rediss:' && { tls: {} }),
    // IPv4 or IPv6: Railway's private network (*.railway.internal) may be IPv6-only.
    family: 0,
    // BullMQ workers block on Redis: retry forever instead of failing commands.
    maxRetriesPerRequest: null,
  };
}
