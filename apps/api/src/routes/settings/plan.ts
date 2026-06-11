import type { FastifyInstance } from 'fastify';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };
const auth  = { preHandler: [authMiddleware] };

// Quotas par plan (adapté marché africain)
const PLANS = [
  {
    id: 'free', name: 'Gratuit', price: 0, currency: 'XAF', billingMonthly: 0,
    limits: {
      contacts: 2000, funnels: 3, funnelSteps: 15, blogs: 1, courses: 1,
      creatorPages: 1, creatorProducts: 3, automationRules: 1, workflows: 1,
      tags: 1, emailCampaigns: 1, oneClickUpsells: 1, orderBumps: 1,
      abTests: 1, coupons: 1, customDomains: 1, websites: 1,
      websiteLanguages: 2, autoWebinars: 0, communities: 1, physicalVariants: 50,
      pipelines: 1, eventCalendars: 1, students: 500,
    },
  },
  {
    id: 'startup', name: 'Startup', price: 10000, currency: 'XAF', billingMonthly: 10000,
    limits: {
      contacts: 5000, funnels: 10, funnelSteps: 50, blogs: 5, courses: 5,
      creatorPages: 3, creatorProducts: 15, automationRules: 10, workflows: 5,
      tags: 10, emailCampaigns: 10, oneClickUpsells: 10, orderBumps: 10,
      abTests: 10, coupons: 10, customDomains: 3, websites: 5,
      websiteLanguages: -1, autoWebinars: 0, communities: 5, physicalVariants: 100,
      pipelines: 5, eventCalendars: 5, students: -1,
    },
  },
  {
    id: 'webinar', name: 'Webinaire', price: 27500, currency: 'XAF', billingMonthly: 27500,
    limits: {
      contacts: 10000, funnels: 50, funnelSteps: 300, blogs: 20, courses: 20,
      creatorPages: 10, creatorProducts: 50, automationRules: 100, workflows: 20,
      tags: 100, emailCampaigns: 100, oneClickUpsells: 100, orderBumps: 100,
      abTests: 50, coupons: 50, customDomains: 10, websites: 20,
      websiteLanguages: -1, autoWebinars: 10, communities: 20, physicalVariants: 250,
      pipelines: 20, eventCalendars: 5, students: -1,
    },
  },
  {
    id: 'unlimited', name: 'Illimité', price: 57000, currency: 'XAF', billingMonthly: 57000,
    limits: {
      contacts: -1, funnels: -1, funnelSteps: -1, blogs: -1, courses: -1,
      creatorPages: -1, creatorProducts: -1, automationRules: -1, workflows: -1,
      tags: -1, emailCampaigns: -1, oneClickUpsells: -1, orderBumps: -1,
      abTests: -1, coupons: -1, customDomains: -1, websites: -1,
      websiteLanguages: -1, autoWebinars: -1, communities: -1, physicalVariants: -1,
      pipelines: -1, eventCalendars: -1, students: -1,
    },
  },
];

export default async function planRoutes(app: FastifyInstance) {

  // ── Liste des plans disponibles ───────────────────────────────
  app.get('/plan/plans', auth, async () => ({ plans: PLANS }));

  // ── Plan actuel + utilisation ─────────────────────────────────
  app.get('/plan', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await sql<{ plan: string; slug: string }[]>`
      SELECT plan, slug FROM public.tenants WHERE id = ${tenantId}
    `;
    const currentPlan = PLANS.find((p) => p.id === tenant?.plan) ?? PLANS[0];

    // Compter les ressources utilisées (schéma tenant courant)
    const [usage] = await sql<{
      contacts: string; funnels: string; campaigns: string;
      automations: string; tags: string; websites: string;
      communities: string; coupons: string; workflows: string;
    }[]>`
      SELECT
        (SELECT COUNT(*) FROM contacts)        as contacts,
        (SELECT COUNT(*) FROM funnels)         as funnels,
        (SELECT COUNT(*) FROM campaigns WHERE type = 'email') as campaigns,
        (SELECT COUNT(*) FROM automation_rules) as automations,
        (SELECT COUNT(*) FROM tags)            as tags,
        (SELECT COUNT(*) FROM sites WHERE type = 'website') as websites,
        (SELECT COUNT(*) FROM communities)     as communities,
        (SELECT COUNT(*) FROM coupons)         as coupons,
        (SELECT COUNT(*) FROM automations)     as workflows
    `;

    return {
      plan:       currentPlan,
      tenantSlug: tenant?.slug,
      usage: {
        contacts:     Number(usage?.contacts  ?? 0),
        funnels:      Number(usage?.funnels   ?? 0),
        emailCampaigns: Number(usage?.campaigns ?? 0),
        automationRules: Number(usage?.automations ?? 0),
        tags:         Number(usage?.tags      ?? 0),
        websites:     Number(usage?.websites  ?? 0),
        communities:  Number(usage?.communities ?? 0),
        coupons:      Number(usage?.coupons   ?? 0),
        workflows:    Number(usage?.workflows ?? 0),
      },
    };
  });

  // ── Gérer mes abonnements (invoices AfriFlow) ─────────────────
  app.get('/manage-subscriptions', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const invoices = await sql<{
      id: string; plan: string; amount: number; currency: string;
      status: string; created_at: string; current_period_end: string;
    }[]>`
      SELECT s.id, s.plan, s.status, s.current_period_end,
             pt.amount, pt.currency, pt.created_at
      FROM public.subscriptions s
      LEFT JOIN public.payment_transactions pt ON pt.tenant_id = s.tenant_id
        AND pt.created_at >= s.created_at - interval '1 day'
        AND pt.status = 'succeeded'
      WHERE s.tenant_id = ${tenantId}
      ORDER BY s.created_at DESC
    `;
    return invoices;
  });
}
