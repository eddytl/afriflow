import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply, type InjectOptions } from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';

export const TEST_USER = {
  userId:   '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  role:     'owner',
} as const;

export const JWT_SECRET = 'test-secret-key-32-characters!!';

export async function buildTestApp(
  plugin: FastifyPluginAsync,
  prefix = '/'
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Required by auth routes (logout/me handlers)
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'unauthorized' });
    }
  });

  if (prefix !== '/') {
    await app.register(plugin, { prefix });
  } else {
    await app.register(plugin);
  }

  await app.ready();
  return app;
}

/** Sign a JWT for authenticated test requests */
export function signToken(app: FastifyInstance, payload = TEST_USER): string {
  return app.jwt.sign(payload);
}

/** Shorthand for authenticated inject calls */
export function authInject(app: FastifyInstance, opts: InjectOptions) {
  const hasBody = opts.payload !== undefined && opts.payload !== null;
  const headers: Record<string, string> = {
    authorization: `Bearer ${signToken(app)}`,
    // Only set JSON content-type when there's a body; otherwise Fastify tries to parse
    // an empty string as JSON and returns 400 "Unexpected end of JSON input".
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  };
  return app.inject({ ...opts, headers });
}

/** UUID factory for predictable test IDs */
export const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
