import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../lib/redis.js';

const WINDOW_MS = 60_000;
const DEFAULT_MAX = 500;
const AUTH_MAX = 10; // anti brute-force login

export function rateLimitMiddleware(max = DEFAULT_MAX) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const tenantId = (request.user as { tenantId?: string })?.tenantId ?? request.ip;
    const key = `ratelimit:${tenantId}:${Math.floor(Date.now() / WINDOW_MS)}`;

    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, WINDOW_MS);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', Math.max(0, max - count));

    if (count > max) {
      reply
        .status(429)
        .header('Retry-After', '60')
        .send({ error: 'rate_limit_exceeded', message: 'Trop de requêtes. Réessayez dans 60s.' });
    }
  };
}

export const authRateLimit = rateLimitMiddleware(AUTH_MAX);
export const defaultRateLimit = rateLimitMiddleware(DEFAULT_MAX);
