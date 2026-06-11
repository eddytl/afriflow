import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';

const auth = { preHandler: [authMiddleware] };

// ── Helpers ──────────────────────────────────────────────────────
async function getSettings(tenantId: string): Promise<Record<string, unknown>> {
  const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
    SELECT settings FROM public.tenants WHERE id = ${tenantId}
  `;
  return (tenant?.settings ?? {}) as Record<string, unknown>;
}

async function patchSettings(tenantId: string, key: string, patch: Record<string, unknown>) {
  const settings = await getSettings(tenantId);
  const existing = (settings[key] ?? {}) as Record<string, unknown>;
  await sql`
    UPDATE public.tenants
    SET settings = ${JSON.stringify({ ...settings, [key]: { ...existing, ...patch } })}::jsonb,
        updated_at = now()
    WHERE id = ${tenantId}
  `;
}

// ── Paramètres de paiement ────────────────────────────────────────
const paymentSettingsSchema = z.object({
  noReceiptIndividual:     z.boolean().optional(),
  noReceiptCompany:        z.boolean().optional(),
  noVat:                   z.boolean().optional(),
  defaultCurrency:         z.string().length(3).optional(),
  subscriptionAccessGrant: z.enum(['first_payment', 'any_payment']).optional(),
  termsHtml:               z.string().optional(),
  invoiceFooterHtml:       z.string().optional(),
});

// ── Paramètres de formation ───────────────────────────────────────
const courseSettingsSchema = z.object({
  saveStudentActivity:      z.boolean().optional(),
  disableMediaDownload:     z.boolean().optional(),
});

// ── Paramètres tunnels de vente ───────────────────────────────────
const funnelSettingsSchema = z.object({
  saveUtmParams:  z.boolean().optional(),
  trackingCode:   z.string().optional(),
});

// ── Paramètres livraison (activation globale) ─────────────────────
const shippingGlobalSchema = z.object({
  enabled: z.boolean(),
});

export default async function businessSettingsRoutes(app: FastifyInstance) {

  // ── Paramètres de paiement ────────────────────────────────────
  app.get('/payment-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.payment ?? {
      noReceiptIndividual:     false,
      noReceiptCompany:        false,
      noVat:                   false,
      defaultCurrency:         'XAF',
      subscriptionAccessGrant: 'first_payment',
      termsHtml:               '',
      invoiceFooterHtml:       '',
    });
  });

  app.patch('/payment-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = paymentSettingsSchema.parse(request.body);
    await patchSettings(tenantId, 'payment', body as Record<string, unknown>);
    return { updated: true };
  });

  // ── Paramètres de formation ───────────────────────────────────
  app.get('/course-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.courses ?? { saveStudentActivity: false, disableMediaDownload: false });
  });

  app.patch('/course-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = courseSettingsSchema.parse(request.body);
    await patchSettings(tenantId, 'courses', body as Record<string, unknown>);
    return { updated: true };
  });

  // ── Paramètres tunnels de vente ───────────────────────────────
  app.get('/funnel-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.funnels ?? { saveUtmParams: false, trackingCode: '' });
  });

  app.patch('/funnel-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = funnelSettingsSchema.parse(request.body);
    await patchSettings(tenantId, 'funnels', body as Record<string, unknown>);
    return { updated: true };
  });

  // ── Paramètres d'affiliation (settings) ──────────────────────
  app.get('/affiliate-program-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.affiliateProgram ?? {
      defaultCommissionRate: 40,
      secondLevelRate:       0,
      minPayoutAmount:       30,
      defaultPaymentDelay:   30,
      vendorName:            '',
      showLeadsEmail:        false,
    });
  });

  app.patch('/affiliate-program-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = z.object({
      defaultCommissionRate: z.number().min(0).max(100).optional(),
      secondLevelRate:       z.number().min(0).max(100).optional(),
      minPayoutAmount:       z.number().min(0).optional(),
      defaultPaymentDelay:   z.number().int().min(0).optional(),
      vendorName:            z.string().max(100).optional(),
      showLeadsEmail:        z.boolean().optional(),
    }).parse(request.body);
    await patchSettings(tenantId, 'affiliateProgram', body as Record<string, unknown>);
    return { updated: true };
  });

  // ── Paiement des commissions d'affiliation ────────────────────
  app.get('/affiliate-payment', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.affiliatePayment ?? { paymentMethod: null, details: {} });
  });

  app.patch('/affiliate-payment', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = z.object({
      paymentMethod: z.enum(['bank_transfer', 'paypal', 'mobile_money', 'wise']).optional(),
      details:       z.record(z.string()).optional(),
    }).parse(request.body);
    await patchSettings(tenantId, 'affiliatePayment', body as Record<string, unknown>);
    return { updated: true };
  });

  // ── Notifications ─────────────────────────────────────────────
  app.get('/notifications', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const settings = await getSettings(tenantId);
    return (settings.notifications ?? {
      courseCommentEmail:      true,
      courseCommentInApp:      true,
      communityPendingEmail:   true,
      communityPendingInApp:   true,
      newSaleEmail:            true,
      affiliateSaleEmail:      true,
      upcomingSubscriptionEmail: true,
      confirmationAfterPayment:  false,
    });
  });

  app.patch('/notifications', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = z.record(z.boolean()).parse(request.body);
    await patchSettings(tenantId, 'notifications', body);
    return { updated: true };
  });
}
