import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db, sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { tenants } from '@afriflow/db';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';

const hooks    = { preHandler: [authMiddleware] };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tenantHk = { preHandler: [authMiddleware, tenantMiddleware] };

const profileSchema = z.object({
  displayName:  z.string().max(100).optional(),
  firstName:    z.string().max(60).optional(),
  lastName:     z.string().max(60).optional(),
  country:      z.string().length(2).optional(),
  city:         z.string().max(100).optional(),
  address:      z.string().max(255).optional(),
  postalCode:   z.string().max(20).optional(),
  region:       z.string().max(100).optional(),
  phone:        z.string().max(30).optional(),
  customerType: z.enum(['individual', 'company']).optional(),
});

const accountSchema = z.object({
  timezone:   z.string().max(60).optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
  timeFormat: z.enum(['HH:mm', 'hh:mm A']).optional(),
  locale:     z.string().max(10).optional(),
});

async function uploadAvatar(buffer: Buffer, mimeType: string): Promise<string> {
  const key  = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.${mimeType.split('/')[1]}`;
  if (process.env.S3_BUCKET) {
    // @ts-ignore — optional S3 dependency
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region:   process.env.S3_REGION ?? 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });
    await s3.send(new PutObjectCommand({
      Bucket:      process.env.S3_BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: mimeType,
    }));
    return `${process.env.STORAGE_BASE_URL}/${key}`;
  }
  const dir = path.join(process.cwd(), 'uploads', 'avatars');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(process.cwd(), 'uploads', key), buffer);
  return `${process.env.STORAGE_BASE_URL ?? 'http://localhost:3001/uploads'}/${key}`;
}

// ── Utilitaires TOTP ─────────────────────────────────────────────

/** Format : XXXXXX-XXXXXX (12 hex chars with dash) */
function generateBackupCode(): string {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `${hex.slice(0, 6)}-${hex.slice(6)}`;
}

/** SHA-256 hash of a backup code (normalised: uppercase, no dash) */
export function hashBackupCode(code: string): string {
  return createHash('sha256')
    .update(code.toUpperCase().replace(/-/g, ''))
    .digest('hex');
}

function generateBackupCodes(count = 10): { plain: string[]; hashed: string[] } {
  const plain  = Array.from({ length: count }, generateBackupCode);
  const hashed = plain.map(hashBackupCode);
  return { plain, hashed };
}

// ── Routes ───────────────────────────────────────────────────────

export default async function profileRoutes(app: FastifyInstance) {

  // ── GET profil ────────────────────────────────────────────────
  app.get('/profile', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    return {
      email:        tenant?.ownerEmail,
      displayName:  (tenant as Record<string, unknown>)?.display_name,
      firstName:    (tenant as Record<string, unknown>)?.first_name,
      lastName:     (tenant as Record<string, unknown>)?.last_name,
      country:      (tenant as Record<string, unknown>)?.country,
      city:         (tenant as Record<string, unknown>)?.city,
      address:      (tenant as Record<string, unknown>)?.address,
      postalCode:   (tenant as Record<string, unknown>)?.postal_code,
      region:       (tenant as Record<string, unknown>)?.region,
      phone:        (tenant as Record<string, unknown>)?.phone,
      customerType: (tenant as Record<string, unknown>)?.customer_type ?? 'individual',
      avatarUrl:    (tenant as Record<string, unknown>)?.avatar_url,
    };
  });

  // ── PATCH profil ──────────────────────────────────────────────
  app.patch('/profile', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = profileSchema.parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.displayName  !== undefined) cols.display_name  = body.displayName;
    if (body.firstName    !== undefined) cols.first_name    = body.firstName;
    if (body.lastName     !== undefined) cols.last_name     = body.lastName;
    if (body.country      !== undefined) cols.country       = body.country;
    if (body.city         !== undefined) cols.city          = body.city;
    if (body.address      !== undefined) cols.address       = body.address;
    if (body.postalCode   !== undefined) cols.postal_code   = body.postalCode;
    if (body.region       !== undefined) cols.region        = body.region;
    if (body.phone        !== undefined) cols.phone         = body.phone;
    if (body.customerType !== undefined) cols.customer_type = body.customerType;
    await sql`UPDATE public.tenants SET ${sql(cols)} WHERE id = ${tenantId}`;
    return { updated: true };
  });

  // ── POST avatar ───────────────────────────────────────────────
  app.post('/profile/avatar', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'no_file' });
    if (!data.mimetype.startsWith('image/')) {
      return reply.status(400).send({ error: 'invalid_type', message: 'Image requise' });
    }
    const buf = await data.toBuffer();
    if (buf.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ error: 'too_large', message: 'Max 2 Mo' });
    }
    const url = await uploadAvatar(buf, data.mimetype);
    await sql`UPDATE public.tenants SET avatar_url = ${url}, updated_at = now() WHERE id = ${tenantId}`;
    return { avatarUrl: url };
  });

  // ── DELETE avatar ─────────────────────────────────────────────
  app.delete('/profile/avatar', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    await sql`UPDATE public.tenants SET avatar_url = NULL, updated_at = now() WHERE id = ${tenantId}`;
    return { deleted: true };
  });

  // ── GET / PATCH compte (timezone, formats) ────────────────────
  app.get('/account', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [row] = await sql<{ timezone: string; date_format: string; time_format: string; locale: string }[]>`
      SELECT timezone, date_format, time_format, locale
      FROM public.tenants WHERE id = ${tenantId}
    `;
    return {
      timezone:   row?.timezone   ?? 'Africa/Douala',
      dateFormat: row?.date_format ?? 'DD/MM/YYYY',
      timeFormat: row?.time_format ?? 'HH:mm',
      locale:     row?.locale      ?? 'fr',
    };
  });

  app.patch('/account', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = accountSchema.parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.timezone   !== undefined) cols.timezone    = body.timezone;
    if (body.dateFormat !== undefined) cols.date_format = body.dateFormat;
    if (body.timeFormat !== undefined) cols.time_format = body.timeFormat;
    if (body.locale     !== undefined) cols.locale      = body.locale;
    await sql`UPDATE public.tenants SET ${sql(cols)} WHERE id = ${tenantId}`;
    return { updated: true };
  });

  // ── Sécurité — Changer le mot de passe ───────────────────────
  app.patch('/security/password', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { currentPassword, newPassword } = request.body as {
      currentPassword: string;
      newPassword: string;
    };
    if (!newPassword || newPassword.length < 8) {
      return reply.status(400).send({ error: 'password_too_short', message: 'Minimum 8 caractères' });
    }
    const [user] = await sql<{ id: string; password: string }[]>`
      SELECT id, password FROM public.users WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    if (!user) return reply.status(404).send({ error: 'not_found' });

    const bcrypt = await import('bcrypt');
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return reply.status(400).send({ error: 'wrong_password', message: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await sql`UPDATE public.users SET password = ${hash} WHERE id = ${user.id}`;
    return { updated: true };
  });

  // ── Sécurité — GET statut 2FA ─────────────────────────────────
  app.get('/security', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [user] = await sql<{
      totp_enabled:    boolean;
      totp_verified_at: string | null;
      totp_backup_codes: string[];
    }[]>`
      SELECT totp_enabled, totp_verified_at, totp_backup_codes
      FROM public.users WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    return {
      twoFaEnabled:        user?.totp_enabled     ?? false,
      twoFaVerifiedAt:     user?.totp_verified_at  ?? null,
      backupCodesRemaining: (user?.totp_backup_codes ?? []).length,
    };
  });

  // ── 2FA TOTP — Étape 1 : initier la configuration ────────────
  // Génère un secret TOTP + 10 codes de secours ; les stocke dans Redis
  // (non-persistés en DB tant que l'utilisateur n'a pas confirmé avec son premier code)
  app.post('/security/2fa/setup', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };

    const [user] = await sql<{ totp_enabled: boolean; email: string }[]>`
      SELECT totp_enabled, email FROM public.users WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    if (!user) return reply.status(404).send({ error: 'not_found' });
    if (user.totp_enabled) {
      return reply.status(400).send({ error: '2fa_already_enabled', message: '2FA déjà activé' });
    }

    const { TOTP, Secret } = await import('otpauth');
    const secret = new Secret();
    const totp   = new TOTP({
      issuer:    'AfriFlow',
      label:     user.email,
      algorithm: 'SHA1',
      digits:    6,
      period:    30,
      secret,
    });

    const uri = totp.toString();
    const b32 = secret.base32;

    const { plain: backupCodes, hashed: hashedBackups } = generateBackupCodes(10);

    // Pending: 10-minute window to confirm
    await redis.set(
      `2fa:setup:${tenantId}`,
      JSON.stringify({ secret: b32, backupCodes: hashedBackups }),
      'EX', 600,
    );

    // backupCodes sont retournés UNE SEULE FOIS ici — l'utilisateur doit les noter
    return { uri, secret: b32, backupCodes };
  });

  // ── 2FA TOTP — Étape 2 : confirmer et activer ─────────────────
  app.post('/security/2fa/confirm', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { code } = request.body as { code: string };

    if (!code || !/^\d{6}$/.test(code)) {
      return reply.status(400).send({ error: 'invalid_code_format', message: 'Code à 6 chiffres requis' });
    }

    const raw = await redis.get(`2fa:setup:${tenantId}`);
    if (!raw) {
      return reply.status(400).send({ error: 'setup_expired', message: 'Session expirée. Relancez la configuration.' });
    }

    const { secret: b32, backupCodes: hashedBackups } = JSON.parse(raw) as {
      secret:      string;
      backupCodes: string[];
    };

    const { TOTP, Secret } = await import('otpauth');
    const totp  = new TOTP({ secret: Secret.fromBase32(b32) });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return reply.status(400).send({ error: 'invalid_totp_code', message: 'Code incorrect ou expiré' });
    }

    await sql`
      UPDATE public.users
      SET totp_secret          = ${b32},
          totp_enabled         = true,
          totp_backup_codes    = ${JSON.stringify(hashedBackups)}::jsonb,
          totp_verified_at     = now(),
          totp_pending_secret  = NULL
      WHERE tenant_id = ${tenantId}
    `;
    await redis.del(`2fa:setup:${tenantId}`);

    return { enabled: true };
  });

  // ── 2FA TOTP — Désactiver (mot de passe + code TOTP requis) ──
  app.post('/security/2fa/disable', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { password, code } = request.body as { password: string; code: string };

    if (!password || !code) {
      return reply.status(400).send({ error: 'missing_fields', message: 'Mot de passe et code TOTP requis' });
    }

    const [user] = await sql<{
      id: string; password: string; totp_enabled: boolean; totp_secret: string;
    }[]>`
      SELECT id, password, totp_enabled, totp_secret
      FROM public.users WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    if (!user) return reply.status(404).send({ error: 'not_found' });
    if (!user.totp_enabled) {
      return reply.status(400).send({ error: '2fa_not_enabled', message: '2FA non activé' });
    }

    const bcrypt = await import('bcrypt');
    const pwValid = await bcrypt.compare(password, user.password);
    if (!pwValid) {
      return reply.status(400).send({ error: 'wrong_password', message: 'Mot de passe incorrect' });
    }

    const { TOTP, Secret } = await import('otpauth');
    const totp  = new TOTP({ secret: Secret.fromBase32(user.totp_secret) });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return reply.status(400).send({ error: 'invalid_totp_code', message: 'Code 2FA incorrect' });
    }

    await sql`
      UPDATE public.users
      SET totp_secret       = NULL,
          totp_enabled      = false,
          totp_backup_codes = '[]'::jsonb,
          totp_verified_at  = NULL
      WHERE id = ${user.id}
    `;

    return { enabled: false };
  });

  // ── 2FA TOTP — Régénérer les codes de secours ─────────────────
  app.post('/security/2fa/backup-codes/regenerate', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { code } = request.body as { code: string };

    if (!code || !/^\d{6}$/.test(code)) {
      return reply.status(400).send({ error: 'invalid_code_format' });
    }

    const [user] = await sql<{ id: string; totp_enabled: boolean; totp_secret: string }[]>`
      SELECT id, totp_enabled, totp_secret
      FROM public.users WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    if (!user?.totp_enabled) {
      return reply.status(400).send({ error: '2fa_not_enabled' });
    }

    const { TOTP, Secret } = await import('otpauth');
    const totp  = new TOTP({ secret: Secret.fromBase32(user.totp_secret) });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return reply.status(400).send({ error: 'invalid_totp_code', message: 'Code 2FA incorrect' });
    }

    const { plain: backupCodes, hashed: hashedBackups } = generateBackupCodes(10);
    await sql`
      UPDATE public.users
      SET totp_backup_codes = ${JSON.stringify(hashedBackups)}::jsonb
      WHERE id = ${user.id}
    `;

    return { backupCodes };
  });
}
