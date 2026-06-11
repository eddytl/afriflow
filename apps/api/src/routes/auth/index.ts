import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db, sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { tenants } from '@afriflow/db';
import { createTenantSchema } from '@afriflow/db';
import { eq } from 'drizzle-orm';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { hashBackupCode } from '../settings/profile.js';

const registerSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  slug:     z.string().min(3).max(50).regex(/^[a-z0-9-]+$/),
  name:     z.string().min(2),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
});

export default async function authRoutes(app: FastifyInstance) {
  // Assure la table users (+ colonnes TOTP) dans public
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.users (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id  UUID REFERENCES public.tenants(id),
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS totp_secret          TEXT,
      ADD COLUMN IF NOT EXISTS totp_pending_secret  TEXT,
      ADD COLUMN IF NOT EXISTS totp_enabled         BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS totp_backup_codes    JSONB   NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS totp_verified_at     TIMESTAMPTZ;
  `);

  // ── Register ──────────────────────────────────────────────────
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const [existingSlug] = await db.select().from(tenants).where(eq(tenants.slug, body.slug));
    if (existingSlug) {
      return reply.status(400).send({ error: 'slug_taken', message: 'Ce slug est déjà utilisé' });
    }

    const hash = await bcrypt.hash(body.password, 12);

    const [tenant] = await db.insert(tenants).values({
      slug:       body.slug,
      ownerEmail: body.email,
      plan:       'free',
    }).returning();

    const [user] = await sql<{ id: string }[]>`
      INSERT INTO public.users (tenant_id, email, password, role)
      VALUES (${tenant.id}, ${body.email}, ${hash}, 'owner')
      RETURNING id
    `;

    await createTenantSchema(tenant.id);

    const accessToken  = issueAccessToken(app, user.id, tenant.id, 'owner');
    const refreshToken = await issueRefreshToken(user.id, tenant.id, 'owner');

    return reply.status(201).send({ accessToken, refreshToken, tenant });
  });

  // ── Login ─────────────────────────────────────────────────────
  // Lorsque 2FA est activé, renvoie un challengeToken au lieu des vrais tokens.
  app.post('/login', { preHandler: authRateLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const [user] = await sql<{
      id: string; password: string; tenant_id: string; role: string;
      totp_enabled: boolean;
    }[]>`
      SELECT id, password, tenant_id, role, totp_enabled
      FROM public.users WHERE email = ${body.email}
    `;
    if (!user) {
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Email ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(body.password, user.password);
    if (!valid) {
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Email ou mot de passe incorrect' });
    }

    // 2FA activé → émettre un challenge temporaire (10 min)
    if (user.totp_enabled) {
      const challengeToken = crypto.randomUUID();
      await redis.set(
        `2fa:challenge:${challengeToken}`,
        JSON.stringify({ userId: user.id, tenantId: user.tenant_id, role: user.role }),
        'EX', 600,
      );
      return reply.status(200).send({ requires2fa: true, challengeToken });
    }

    const accessToken  = issueAccessToken(app, user.id, user.tenant_id, user.role);
    const refreshToken = await issueRefreshToken(user.id, user.tenant_id, user.role);

    return { accessToken, refreshToken };
  });

  // ── 2FA — Vérifier le code TOTP (ou code de secours) ─────────
  app.post('/2fa/verify', { preHandler: authRateLimit }, async (request, reply) => {
    const { challengeToken, code, backupCode } = request.body as {
      challengeToken: string;
      code?:          string;
      backupCode?:    string;
    };

    if (!challengeToken) {
      return reply.status(400).send({ error: 'missing_challenge_token' });
    }
    if (!code && !backupCode) {
      return reply.status(400).send({ error: 'code_or_backup_required' });
    }

    const raw = await redis.get(`2fa:challenge:${challengeToken}`);
    if (!raw) {
      return reply.status(401).send({ error: 'challenge_expired', message: 'Session expirée ou invalide' });
    }

    const { userId, tenantId, role } = JSON.parse(raw) as {
      userId: string; tenantId: string; role: string;
    };

    const [user] = await sql<{
      totp_secret:      string;
      totp_backup_codes: string[];
    }[]>`
      SELECT totp_secret, totp_backup_codes
      FROM public.users WHERE id = ${userId}
    `;
    if (!user) return reply.status(401).send({ error: 'invalid_credentials' });

    if (code) {
      // Vérification TOTP classique
      if (!/^\d{6}$/.test(code)) {
        return reply.status(400).send({ error: 'invalid_code_format' });
      }
      const { TOTP, Secret } = await import('otpauth');
      const totp  = new TOTP({ secret: Secret.fromBase32(user.totp_secret) });
      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        return reply.status(401).send({ error: 'invalid_totp_code', message: 'Code incorrect ou expiré' });
      }
    } else if (backupCode) {
      // Suppression atomique : le code doit exister ET est retiré en une seule opération
      // Protège contre l'utilisation concurrente du même code (race condition)
      const hashed = hashBackupCode(backupCode);
      const [patched] = await sql<{ id: string }[]>`
        UPDATE public.users
        SET totp_backup_codes = (
          SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
          FROM jsonb_array_elements_text(totp_backup_codes) c
          WHERE c != ${hashed}
        )
        WHERE id = ${userId}
          AND totp_backup_codes @> ${JSON.stringify([hashed])}::jsonb
        RETURNING id
      `;
      if (!patched) {
        return reply.status(401).send({ error: 'invalid_backup_code', message: 'Code de secours invalide' });
      }
    }

    // Challenge consommé
    await redis.del(`2fa:challenge:${challengeToken}`);

    const accessToken  = issueAccessToken(app, userId, tenantId, role);
    const refreshToken = await issueRefreshToken(userId, tenantId, role);

    return { accessToken, refreshToken };
  });

  // ── Refresh ───────────────────────────────────────────────────
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) return reply.status(400).send({ error: 'missing_token' });

    const stored = await redis.get(`refresh:${refreshToken}`);
    if (!stored) return reply.status(401).send({ error: 'invalid_refresh_token' });

    await redis.del(`refresh:${refreshToken}`); // rotation anti-replay

    const data = JSON.parse(stored) as { userId: string; tenantId: string; role: string };
    const newAccessToken  = issueAccessToken(app, data.userId, data.tenantId, data.role);
    const newRefreshToken = await issueRefreshToken(data.userId, data.tenantId, data.role);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  });

  // ── Logout ────────────────────────────────────────────────────
  app.post('/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (refreshToken) await redis.del(`refresh:${refreshToken}`);
    return reply.status(204).send();
  });

  // ── Me ────────────────────────────────────────────────────────
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const { userId, tenantId, role } = request.user as { userId: string; tenantId: string; role: string };
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    return { userId, tenantId, role, tenant };
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function issueAccessToken(app: FastifyInstance, userId: string, tenantId: string, role: string): string {
  return app.jwt.sign({ userId, tenantId, role });
}

async function issueRefreshToken(userId: string, tenantId: string, role: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await redis.set(
    `refresh:${token}`,
    JSON.stringify({ userId, tenantId, role }),
    'EX', 60 * 60 * 24 * 30,
  );
  return token;
}

// Déclaration pour fastify.authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
