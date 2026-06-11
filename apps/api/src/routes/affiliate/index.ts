import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, sql } from '../../lib/db.js';
import { affiliates, affiliateReferrals, affiliateCommissions } from '@afriflow/db';
import { authMiddleware } from '../../middleware/auth.js';
import { eq, and } from 'drizzle-orm';

const hooks = { preHandler: [authMiddleware] };

function generateRefCode(tenantId: string): string {
  // Génère un code unique de 12 chars basé sur l'UUID du tenant
  return 'af_' + tenantId.replace(/-/g, '').slice(0, 9);
}

export default async function affiliateRoutes(app: FastifyInstance) {
  // Obtenir ou créer le profil affilié du tenant
  async function getOrCreateAffiliate(tenantId: string) {
    const [existing] = await db.select().from(affiliates).where(eq(affiliates.tenantId, tenantId));
    if (existing) return existing;

    const [created] = await db.insert(affiliates).values({
      tenantId,
      refCode: generateRefCode(tenantId),
    }).returning();
    return created;
  }

  // ── Tableau de bord affilié ──────────────────────────────
  app.get('/dashboard', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const q = request.query as { from?: string; to?: string; currency?: string };

    const affiliate = await getOrCreateAffiliate(tenantId);
    const currency = q.currency ?? 'USD';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);

    // Gains par période
    const [gainsToday] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency}
        AND created_at >= ${today.toISOString()}
    `;
    const [gains7d] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency}
        AND created_at >= ${sevenDaysAgo.toISOString()}
    `;
    const [gains30d] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency}
        AND created_at >= ${thirtyDaysAgo.toISOString()}
    `;
    const [gainsPaid] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency} AND status = 'paid'
    `;
    const [gainsPending] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency} AND status = 'pending'
    `;
    const [gainsTotal] = await sql<{ sum: string }[]>`
      SELECT COALESCE(SUM(amount), 0) as sum FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency}
    `;

    // Contacts générés (referrals actifs)
    const [contactsGenerated] = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM public.affiliate_referrals
      WHERE affiliate_id = ${affiliate.id} AND status = 'active'
    `;

    // Historique des paiements (20 derniers)
    const payments = await sql`
      SELECT ac.*, ar.referred_tenant_id
      FROM public.affiliate_commissions ac
      LEFT JOIN public.affiliate_referrals ar ON ar.id = ac.referral_id
      WHERE ac.affiliate_id = ${affiliate.id}
      ORDER BY ac.created_at DESC
      LIMIT 20
    `;

    // Referrals avec détails
    const referrals = await sql`
      SELECT ar.*, t.slug as tenant_slug, t.plan as tenant_plan
      FROM public.affiliate_referrals ar
      LEFT JOIN public.tenants t ON t.id = ar.referred_tenant_id
      WHERE ar.affiliate_id = ${affiliate.id}
      ORDER BY ar.created_at DESC
      LIMIT 50
    `;

    // Série temporelle (30 jours)
    const timeSeries = await sql<{ day: string; amount: string }[]>`
      SELECT DATE(created_at) as day, COALESCE(SUM(amount), 0) as amount
      FROM public.affiliate_commissions
      WHERE affiliate_id = ${affiliate.id} AND currency = ${currency}
        AND created_at >= ${thirtyDaysAgo.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY day
    `;

    const affiliateLink = `${process.env.WEB_URL ?? 'https://app.afriflow.app'}?ref=${affiliate.refCode}`;

    return {
      affiliate: {
        id:             affiliate.id,
        refCode:        affiliate.refCode,
        status:         affiliate.status,
        commissionRate: affiliate.commissionRate,
        affiliateLink,
      },
      gains: {
        today:     Number(gainsToday?.sum ?? 0),
        last7d:    Number(gains7d?.sum ?? 0),
        last30d:   Number(gains30d?.sum ?? 0),
        paid:      Number(gainsPaid?.sum ?? 0),
        pending:   Number(gainsPending?.sum ?? 0),
        total:     Number(gainsTotal?.sum ?? 0),
        currency,
      },
      contactsGenerated: Number(contactsGenerated?.count ?? 0),
      payments,
      referrals,
      timeSeries: timeSeries.map((r) => ({ day: r.day, amount: Number(r.amount) })),
    };
  });

  // Historique des commissions paginé
  app.get('/commissions', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const q = request.query as { status?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    const affiliate = await getOrCreateAffiliate(tenantId);

    return sql`
      SELECT ac.*, ar.referred_tenant_id, t.slug as tenant_slug
      FROM public.affiliate_commissions ac
      LEFT JOIN public.affiliate_referrals ar ON ar.id = ac.referral_id
      LEFT JOIN public.tenants t ON t.id = ar.referred_tenant_id
      WHERE ac.affiliate_id = ${affiliate.id}
        AND (${q.status ?? null} IS NULL OR ac.status = ${q.status ?? null})
        AND (${q.after ?? null}::uuid IS NULL OR ac.id > ${q.after ?? null}::uuid)
      ORDER BY ac.created_at DESC
      LIMIT ${limit}
    `;
  });

  // Referrals
  app.get('/referrals', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const affiliate = await getOrCreateAffiliate(tenantId);

    return sql`
      SELECT ar.*, t.slug, t.plan, t.created_at as tenant_created_at
      FROM public.affiliate_referrals ar
      LEFT JOIN public.tenants t ON t.id = ar.referred_tenant_id
      WHERE ar.affiliate_id = ${affiliate.id}
      ORDER BY ar.created_at DESC
    `;
  });

  // Mettre à jour l'email de paiement
  app.patch('/payout', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { payoutEmail } = z.object({ payoutEmail: z.string().email() }).parse(request.body);

    const affiliate = await getOrCreateAffiliate(tenantId);
    const [updated] = await db.update(affiliates)
      .set({ payoutEmail })
      .where(eq(affiliates.id, affiliate.id))
      .returning();

    return { payoutEmail: updated.payoutEmail };
  });

  // Webhook interne : enregistrer un référencement quand un tenant s'inscrit via un lien affilié
  // Appelé depuis la route /auth/register
  app.post('/track', async (request, reply) => {
    const { refCode, referredTenantId } = request.body as { refCode: string; referredTenantId: string };
    if (!refCode || !referredTenantId) return reply.status(400).send({ error: 'missing_fields' });

    const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.refCode, refCode));
    if (!affiliate) return reply.status(404).send({ error: 'invalid_ref_code' });

    await db.insert(affiliateReferrals).values({
      affiliateId: affiliate.id,
      referredTenantId,
      status: 'active',
    }).onConflictDoNothing();

    return { tracked: true };
  });
}
