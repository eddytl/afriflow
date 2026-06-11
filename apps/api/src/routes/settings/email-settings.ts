import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };
const auth  = { preHandler: [authMiddleware] };

const emailSettingsSchema = z.object({
  // Expéditeur par défaut
  defaultFromName:  z.string().max(100).optional(),
  defaultFromEmail: z.string().email().optional(),
  // Test
  testEmail: z.string().email().optional(),
  // Double opt-in
  doubleOptIn: z.boolean().optional(),
  // Nettoyage auto
  autoCleanEnabled:          z.boolean().optional(),
  autoCleanNoBuyWeeks:       z.number().int().min(1).optional(),
  autoCleanNoBuyUnsubscribe: z.boolean().optional(),
  autoCleanBuyersEnabled:    z.boolean().optional(),
  autoCleanBuyersWeeks:      z.number().int().min(1).optional(),
  // Pied de page
  showAffiliateLink:     z.boolean().optional(),
  showUnsubscribeLink:   z.boolean().optional(),
  unsubscribeText:       z.string().max(100).optional(),
  footerText:            z.string().max(500).optional(),
  footerDomain:          z.string().max(255).optional(),
  // SendGrid custom
  useCustomSendgrid:     z.boolean().optional(),
  sendgridApiKey:        z.string().optional(),
});

export default async function emailSettingsRoutes(app: FastifyInstance) {

  // ── Lire les paramètres email ─────────────────────────────────
  app.get('/email-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
      SELECT settings FROM public.tenants WHERE id = ${tenantId}
    `;
    const s = (tenant?.settings ?? {}) as Record<string, unknown>;
    const emailSettings = (s.email ?? {}) as Record<string, unknown>;

    // Masquer la clé SendGrid
    if (emailSettings.sendgridApiKey) {
      emailSettings.sendgridApiKey = '••••' + String(emailSettings.sendgridApiKey).slice(-4);
    }

    return emailSettings;
  });

  // ── Mettre à jour les paramètres email ────────────────────────
  app.patch('/email-settings', auth, async (request) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = emailSettingsSchema.parse(request.body);

    const [tenant] = await sql<{ settings: Record<string, unknown> }[]>`
      SELECT settings FROM public.tenants WHERE id = ${tenantId}
    `;
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const existing = (settings.email ?? {}) as Record<string, unknown>;

    const updated: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) updated[k] = v;
    }

    await sql`
      UPDATE public.tenants
      SET settings = ${JSON.stringify({ ...settings, email: updated })}::jsonb, updated_at = now()
      WHERE id = ${tenantId}
    `;
    // Masquer après sauvegarde
    if (updated.sendgridApiKey) {
      updated.sendgridApiKey = '••••' + String(updated.sendgridApiKey).slice(-4);
    }
    return updated;
  });

  // ── Envoyer un email de test ──────────────────────────────────
  app.post('/email-settings/test', auth, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const { email } = request.body as { email?: string };
    if (!email) return reply.status(400).send({ error: 'email_required' });

    const [tenant] = await sql<{ owner_email: string; settings: Record<string, unknown>; display_name: string }[]>`
      SELECT owner_email, settings, display_name FROM public.tenants WHERE id = ${tenantId}
    `;
    if (!tenant) return reply.status(404).send({ error: 'not_found' });

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from:    `${tenant.display_name ?? 'AfriFlow'} <noreply@${process.env.EMAIL_DOMAIN ?? 'afriflow.app'}>`,
        to:      email,
        subject: 'Email de test — AfriFlow',
        html:    '<p>Ceci est un email de test envoyé depuis AfriFlow. Votre configuration fonctionne correctement !</p>',
      });
    } catch (err) {
      return reply.status(502).send({ error: 'send_failed', message: String(err) });
    }
    return { sent: true, to: email };
  });

  // ── Domaines email (DNS authentication) ──────────────────────
  app.get('/email-settings/domains', hooks, async () => {
    return sql`
      SELECT * FROM custom_domains
      WHERE type = 'email'
      ORDER BY created_at DESC
    `;
  });

  app.post('/email-settings/domains', hooks, async (request, reply) => {
    const { domain } = request.body as { domain: string };
    if (!domain) return reply.status(400).send({ error: 'domain_required' });

    // Enregistrements DNS à vérifier (DKIM, SPF, DMARC)
    const dnsRecords = [
      { type: 'TXT', host: `@`, value: `v=spf1 include:spf.afriflow.app ~all`, purpose: 'SPF' },
      { type: 'TXT', host: `afriflow._domainkey`, value: `v=DKIM1; k=rsa; p=<public_key>`, purpose: 'DKIM' },
      { type: 'TXT', host: `_dmarc`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@afriflow.app`, purpose: 'DMARC' },
    ];

    const [existing] = await sql`SELECT id FROM custom_domains WHERE domain = ${domain} AND type = 'email'`;
    if (existing) return reply.status(409).send({ error: 'already_exists' });

    const [created] = await sql`
      INSERT INTO custom_domains (domain, type, dns_records)
      VALUES (${domain}, 'email', ${JSON.stringify(dnsRecords)}::jsonb)
      RETURNING *
    `;
    return reply.status(201).send(created);
  });

  app.post('/email-settings/domains/:id/verify', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [domain] = await sql`SELECT * FROM custom_domains WHERE id = ${id} AND type = 'email'`;
    if (!domain) return reply.status(404).send({ error: 'not_found' });

    // En production : vérification DNS réelle via dns.resolve
    // Pour l'instant : simuler comme "actif"
    const [updated] = await sql`
      UPDATE custom_domains
      SET status = 'active', verified_at = now(), updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return updated;
  });

  app.delete('/email-settings/domains/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM custom_domains WHERE id = ${(request.params as { id: string }).id} AND type = 'email'`;
    return reply.status(204).send();
  });
}
