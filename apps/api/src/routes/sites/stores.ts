import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const storeSchema = z.object({
  name:               z.string().min(1),
  domain:             z.string().optional(),
  urlPath:            z.string().min(1),
  language:           z.enum(['fr', 'en', 'ar', 'sw', 'pt', 'ha']).optional(),
  currency:           z.string().length(3).optional(),
});

const profileSchema = z.object({
  displayName:        z.string().optional(),
  bio:                z.string().optional(),
  avatarUrl:          z.string().url().optional(),
  socialLinks:        z.record(z.string()).optional(), // {instagram, tiktok, youtube, twitter, ...}
  showAffiliateBadge: z.boolean().optional(),
});

const seoSchema = z.object({
  title:         z.string().optional(),
  description:   z.string().optional(),
  keywords:      z.string().optional(),
  author:        z.string().optional(),
  noindex:       z.boolean().optional(),
  trackingCode:  z.string().optional(),
});

export default async function storeRoutes(app: FastifyInstance) {
  // ── Liste des stores ──────────────────────────────────────
  app.get('/', hooks, async () => {
    return sql`SELECT * FROM stores ORDER BY created_at DESC`;
  });

  // ── Créer un store ─────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = storeSchema.parse(request.body);
    const [store] = await sql`
      INSERT INTO stores (name, domain, url_path, language, currency)
      VALUES (
        ${body.name},
        ${body.domain ?? null},
        ${body.urlPath},
        ${body.language ?? 'fr'},
        ${body.currency ?? 'XOF'}
      )
      RETURNING *
    `;
    return reply.status(201).send(store);
  });

  // ── Détail d'un store ─────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [store] = await sql`SELECT * FROM stores WHERE id = ${id}`;
    if (!store) return reply.status(404).send({ error: 'not_found' });
    return store;
  });

  // ── Paramètres de base ────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = storeSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.name !== undefined)     cols.name      = body.name;
    if (body.domain !== undefined)   cols.domain    = body.domain;
    if (body.urlPath !== undefined)  cols.url_path  = body.urlPath;
    if (body.language !== undefined) cols.language  = body.language;
    if (body.currency !== undefined) cols.currency  = body.currency;
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const [updated] = await sql`UPDATE stores SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Profil public (nom, bio, avatar, réseaux sociaux) ────
  app.patch('/:id/profile', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = profileSchema.parse(request.body);
    const cols: Record<string, unknown> = {};
    if (body.displayName !== undefined)        cols.display_name          = body.displayName;
    if (body.bio !== undefined)                cols.bio                   = body.bio;
    if (body.avatarUrl !== undefined)          cols.avatar_url            = body.avatarUrl;
    if (body.socialLinks !== undefined)        cols.social_links          = JSON.stringify(body.socialLinks);
    if (body.showAffiliateBadge !== undefined) cols.show_affiliate_badge  = body.showAffiliateBadge;
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const [updated] = await sql`UPDATE stores SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── SEO et tracking ───────────────────────────────────────
  app.patch('/:id/seo', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = seoSchema.parse(request.body);
    const [current] = await sql<{ seo: Record<string, unknown>; tracking_code: string | null }[]>`
      SELECT seo, tracking_code FROM stores WHERE id = ${id}
    `;
    if (!current) return reply.status(404).send({ error: 'not_found' });

    const mergedSeo = {
      ...(current.seo ?? {}),
      ...(body.title !== undefined       ? { title: body.title }             : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.keywords !== undefined    ? { keywords: body.keywords }       : {}),
      ...(body.author !== undefined      ? { author: body.author }           : {}),
      ...(body.noindex !== undefined     ? { noindex: body.noindex }         : {}),
    };

    const cols: Record<string, unknown> = { seo: JSON.stringify(mergedSeo) };
    if (body.trackingCode !== undefined) cols.tracking_code = body.trackingCode;

    const [updated] = await sql`UPDATE stores SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    return updated;
  });

  // ── Supprimer un store ───────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM stores WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── URL publique du store ─────────────────────────────────
  // Retourne l'URL complète selon le domaine ou le sous-domaine plateforme
  app.get('/:id/url', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [store] = await sql<{ domain: string | null; url_path: string }[]>`
      SELECT domain, url_path FROM stores WHERE id = ${id}
    `;
    if (!store) return reply.status(404).send({ error: 'not_found' });
    const base = store.domain
      ? `https://${store.domain}`
      : `${process.env.WEB_URL ?? 'https://app.afriflow.app'}`;
    return { url: `${base}/${store.url_path}` };
  });
}
