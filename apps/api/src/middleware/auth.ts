import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../lib/redis.js';

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: AuthUser;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as AuthUser;
    if (!payload.tenantId || !payload.userId) {
      return reply.status(401).send({ error: 'invalid_token', message: 'Token invalide' });
    }
  } catch {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentification requise' });
  }
}
