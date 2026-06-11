import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, sql } from '../../lib/db.js';
import { tenants } from '@afriflow/db';
import { authMiddleware } from '../../middleware/auth.js';
import { eq } from 'drizzle-orm';
import {
  listProviders,
  createSMSProvider,
  SMS_PROVIDER_CREDENTIAL_FIELDS,
  type SMSConfig,
  type SMSProviderName,
} from '@afriflow/sms';

import profileRoutes        from './profile.js';
import planRoutes           from './plan.js';
import paymentGatewaysRoutes from './payment-gateways.js';
import emailSettingsRoutes  from './email-settings.js';
import businessRoutes       from './business.js';
import shippingRoutes       from './shipping.js';
import customDomainsRoutes  from './custom-domains.js';
import apiKeysRoutes        from './api-keys.js';
import webhooksRoutes       from './webhooks.js';
import integrationsRoutes   from './integrations.js';
import workspaceMembersRoutes from './workspace-members.js';

const smsConfigSchema = z.object({
  provider: z.enum([
    'twilio', 'africas_talking', 'orange', 'infobip', 'termii', 'http_webhook',
  ] as [SMSProviderName, ...SMSProviderName[]]),
  senderId: z.string().max(11).optional(),
  credentials: z.record(z.string()),
});

const hooks = { preHandler: [authMiddleware] };

export default async function settingsRoutes(app: FastifyInstance) {

  // ── Sous-modules ──────────────────────────────────────────────
  await app.register(profileRoutes);
  await app.register(planRoutes);
  await app.register(paymentGatewaysRoutes);
  await app.register(emailSettingsRoutes);
  await app.register(businessRoutes);
  await app.register(shippingRoutes);
  await app.register(customDomainsRoutes);
  await app.register(apiKeysRoutes);
  await app.register(webhooksRoutes);
  await app.register(integrationsRoutes);
  await app.register(workspaceMembersRoutes);

  // ── Settings globaux (lecture) ────────────────────────────────
  app.get('/', hooks, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return { settings: {} };

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;

    if (settings.sms) {
      const sms = settings.sms as Record<string, unknown>;
      settings.sms = {
        provider:    sms.provider,
        senderId:    sms.senderId,
        credentials: maskCredentials(sms.credentials as Record<string, string>),
      };
    }

    return { settings };
  });

  // ── SMS ───────────────────────────────────────────────────────
  app.get('/sms/providers', hooks, async () => {
    const providers = listProviders().map((name) => ({
      name,
      requiredFields: SMS_PROVIDER_CREDENTIAL_FIELDS[name],
    }));
    return { providers };
  });

  app.patch('/sms', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = smsConfigSchema.parse(request.body);

    const required = SMS_PROVIDER_CREDENTIAL_FIELDS[body.provider];
    const missing  = required.filter((f) => !body.credentials[f]);
    if (missing.length > 0) {
      return reply.status(400).send({
        error:   'missing_credentials',
        message: `Champs manquants pour ${body.provider} : ${missing.join(', ')}`,
      });
    }

    try {
      createSMSProvider({ provider: body.provider, credentials: body.credentials });
    } catch (err) {
      return reply.status(400).send({
        error:   'invalid_config',
        message: String(err instanceof Error ? err.message : err),
      });
    }

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const currentSettings = (tenant?.settings ?? {}) as Record<string, unknown>;

    await db.update(tenants).set({
      settings: {
        ...currentSettings,
        sms: {
          provider:    body.provider,
          senderId:    body.senderId,
          credentials: body.credentials,
        },
      },
    }).where(eq(tenants.id, tenantId));

    return {
      message:     `Fournisseur SMS "${body.provider}" configuré avec succès`,
      sms: {
        provider:    body.provider,
        senderId:    body.senderId,
        credentials: maskCredentials(body.credentials),
      },
    };
  });

  app.post('/sms/test', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { to } = request.body as { to: string };
    if (!to) return reply.status(400).send({ error: 'missing_to', message: 'Numéro requis' });

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const settings   = (tenant?.settings ?? {}) as Record<string, unknown>;
    const smsConfig  = settings.sms as SMSConfig | undefined;

    if (!smsConfig?.provider) {
      return reply.status(400).send({
        error:   'no_sms_config',
        message: 'Aucun fournisseur SMS configuré.',
      });
    }

    const { sendSMS } = await import('@afriflow/sms');
    const result = await sendSMS(smsConfig, to, 'Test AfriFlow ✓ Votre configuration SMS fonctionne !');
    if (!result.success) {
      return reply.status(502).send({
        error:    'sms_failed',
        message:  result.error ?? 'Échec de l\'envoi',
        provider: result.provider,
      });
    }
    return { success: true, provider: result.provider, messageId: result.messageId };
  });
}

function maskCredentials(creds: Record<string, string> | undefined): Record<string, string> {
  if (!creds) return {};
  return Object.fromEntries(
    Object.entries(creds).map(([k, v]) => [k, v ? '••••' + v.slice(-4) : ''])
  );
}
