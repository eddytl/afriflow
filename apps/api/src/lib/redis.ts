import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message);
});

// BullMQ workers require maxRetriesPerRequest: null (blocking commands).
// Pass these options to Queue/Worker so BullMQ creates its own managed connections.
function parseRedisUrl(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: Number(u.port) || 6379,
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

export const bullmqConnection = parseRedisUrl(
  process.env.REDIS_URL ?? 'redis://localhost:6379'
);
