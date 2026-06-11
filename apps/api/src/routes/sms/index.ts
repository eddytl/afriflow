import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

// ── Variables de substitution disponibles ─────────────────────
// (correspondance clé → champ contact + description)
const SMS_VARIABLES = [
  { variable: '{{email}}',              label: 'Email',                         field: 'email' },
  { variable: '{{first_name}}',         label: 'Prénom',                        field: 'first_name' },
  { variable: '{{surname}}',            label: 'Nom',                           field: 'last_name' },
  { variable: '{{phone_number}}',       label: 'Numéro de téléphone',           field: 'phone' },
  { variable: '{{street_address}}',     label: 'Adresse',                       field: 'custom_fields.street_address' },
  { variable: '{{street_number}}',      label: 'Numéro de rue',                 field: 'custom_fields.street_number' },
  { variable: '{{neighborhood}}',       label: 'Quartier',                      field: 'custom_fields.neighborhood' },
  { variable: '{{postcode}}',           label: 'Code postal',                   field: 'custom_fields.postcode' },
  { variable: '{{city}}',               label: 'Ville',                         field: 'custom_fields.city' },
  { variable: '{{state}}',              label: 'Région',                        field: 'custom_fields.state' },
  { variable: '{{country}}',            label: 'Pays',                          field: 'country' },
  { variable: '{{company_name}}',       label: 'Nom de l\'entreprise',          field: 'custom_fields.company_name' },
  { variable: '{{tax_number}}',         label: 'Numéro d\'identification fiscale', field: 'custom_fields.tax_number' },
  { variable: '{{affiliate_id}}',       label: 'Identifiant de l\'affilié',     field: 'affiliate_ref_code' },
  { variable: '{{affiliate_dashboard}}',label: 'URL tableau de bord affilié',   field: 'affiliate_dashboard_url' },
];

function interpolateSMS(
  body: string,
  contact: Record<string, unknown>,
  affiliateData?: { refCode?: string; dashboardUrl?: string },
): string {
  const cf = (contact.custom_fields as Record<string, unknown>) ?? {};
  return body
    .replace(/\{\{email\}\}/g,               String(contact.email    ?? ''))
    .replace(/\{\{first_name\}\}/g,           String(contact.first_name ?? ''))
    .replace(/\{\{surname\}\}/g,              String(contact.last_name  ?? ''))
    .replace(/\{\{phone_number\}\}/g,         String(contact.phone   ?? ''))
    .replace(/\{\{street_address\}\}/g,       String(cf.street_address  ?? ''))
    .replace(/\{\{street_number\}\}/g,        String(cf.street_number   ?? ''))
    .replace(/\{\{neighborhood\}\}/g,         String(cf.neighborhood    ?? ''))
    .replace(/\{\{postcode\}\}/g,             String(cf.postcode        ?? ''))
    .replace(/\{\{city\}\}/g,                 String(cf.city            ?? ''))
    .replace(/\{\{state\}\}/g,                String(cf.state           ?? ''))
    .replace(/\{\{country\}\}/g,              String(contact.country    ?? ''))
    .replace(/\{\{company_name\}\}/g,         String(cf.company_name    ?? ''))
    .replace(/\{\{tax_number\}\}/g,           String(cf.tax_number      ?? ''))
    .replace(/\{\{affiliate_id\}\}/g,         affiliateData?.refCode       ?? '')
    .replace(/\{\{affiliate_dashboard\}\}/g,  affiliateData?.dashboardUrl  ?? '');
}

const templateSchema = z.object({
  name:        z.string().min(1),
  body:        z.string().min(1),
  senderId:    z.string().optional(),
  senderType:  z.enum(['phone_number', 'alphanumeric', 'messaging_service']).optional(),
});

export default async function smsRoutes(app: FastifyInstance) {

  // ── Variables de substitution ─────────────────────────────
  app.get('/variables', hooks, async () => ({ variables: SMS_VARIABLES }));

  // ════════════════════════════════════════════════════════════
  // TEMPLATES
  // ════════════════════════════════════════════════════════════

  app.get('/templates', hooks, async (request) => {
    const q = request.query as { search?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT * FROM sms_templates
      WHERE (${q.search ?? null} IS NULL OR name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });

  app.post('/templates', hooks, async (request, reply) => {
    const body = templateSchema.parse(request.body);
    const [tpl] = await sql`
      INSERT INTO sms_templates (name, body, sender_id, sender_type)
      VALUES (
        ${body.name},
        ${body.body},
        ${body.senderId   ?? null},
        ${body.senderType ?? 'phone_number'}
      )
      RETURNING *
    `;
    return reply.status(201).send(tpl);
  });

  app.get('/templates/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [tpl] = await sql`SELECT * FROM sms_templates WHERE id = ${id}`;
    if (!tpl) return reply.status(404).send({ error: 'not_found' });
    return tpl;
  });

  app.patch('/templates/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = templateSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name        !== undefined) cols.name        = body.name;
    if (body.body        !== undefined) cols.body        = body.body;
    if (body.senderId    !== undefined) cols.sender_id   = body.senderId;
    if (body.senderType  !== undefined) cols.sender_type = body.senderType;
    const [updated] = await sql`UPDATE sms_templates SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/templates/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM sms_templates WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // Prévisualiser un template avec un contact réel ou des données fictives
  app.post('/templates/:id/preview', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId?: string };

    const [tpl] = await sql<{ body: string }[]>`SELECT body FROM sms_templates WHERE id = ${id}`;
    if (!tpl) return reply.status(404).send({ error: 'not_found' });

    let contact: Record<string, unknown> = {
      email: 'contact@exemple.com', first_name: 'Fatou', last_name: 'Diallo',
      phone: '+221701234567', country: 'SN',
      custom_fields: { city: 'Dakar', company_name: 'AfriCo SARL' },
    };

    if (contactId) {
      const [real] = await sql<Record<string, unknown>[]>`
        SELECT email, first_name, last_name, phone, country, custom_fields
        FROM contacts WHERE id = ${contactId}
      `;
      if (real) contact = real;
    }

    const preview = interpolateSMS(tpl.body, contact);
    return {
      preview,
      charCount:    preview.length,
      smsCount:     Math.ceil(preview.length / 160),
      variables:    SMS_VARIABLES.map((v) => v.variable),
    };
  });

  // Dupliquer un template
  app.post('/templates/:id/duplicate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [original] = await sql<{ name: string; body: string; sender_id: string | null; sender_type: string }[]>`
      SELECT name, body, sender_id, sender_type FROM sms_templates WHERE id = ${id}
    `;
    if (!original) return reply.status(404).send({ error: 'not_found' });
    const [copy] = await sql`
      INSERT INTO sms_templates (name, body, sender_id, sender_type)
      VALUES (${`${original.name} (copie)`}, ${original.body}, ${original.sender_id}, ${original.sender_type})
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });

  // ════════════════════════════════════════════════════════════
  // STATISTIQUES
  // ════════════════════════════════════════════════════════════

  app.get('/statistics', hooks, async (request) => {
    const q = request.query as { from?: string; to?: string };
    const now = new Date();
    const dateFrom = q.from ? new Date(q.from) : new Date(now.getTime() - 30 * 86_400_000);
    const dateTo   = q.to   ? new Date(q.to)   : now;
    dateFrom.setHours(0, 0, 0, 0);
    dateTo.setHours(23, 59, 59, 999);

    // Agrégats globaux
    const [totals] = await sql`
      SELECT
        COUNT(*)                                           as total_sent,
        COUNT(*) FILTER (WHERE status = 'delivered')      as total_delivered,
        COUNT(*) FILTER (WHERE status = 'failed')         as total_failed,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'delivered') / NULLIF(COUNT(*), 0), 1
        )                                                  as delivery_rate,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*), 0), 1
        )                                                  as failure_rate
      FROM sms_logs
      WHERE sent_at >= ${dateFrom.toISOString()} AND sent_at <= ${dateTo.toISOString()}
    `;

    // Série temporelle — SMS envoyés par jour
    const sentSeries = await sql<{ day: string; sent: string; delivered: string; failed: string }[]>`
      SELECT
        DATE(sent_at)                                           as day,
        COUNT(*)                                                as sent,
        COUNT(*) FILTER (WHERE status = 'delivered')           as delivered,
        COUNT(*) FILTER (WHERE status = 'failed')              as failed
      FROM sms_logs
      WHERE sent_at >= ${dateFrom.toISOString()} AND sent_at <= ${dateTo.toISOString()}
      GROUP BY DATE(sent_at)
      ORDER BY day
    `;

    // Série temporelle — taux de remise par jour
    const rateSeries = await sql<{ day: string; delivery_rate: string; failure_rate: string }[]>`
      SELECT
        DATE(sent_at) as day,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'delivered') / NULLIF(COUNT(*), 0), 1
        ) as delivery_rate,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*), 0), 1
        ) as failure_rate
      FROM sms_logs
      WHERE sent_at >= ${dateFrom.toISOString()} AND sent_at <= ${dateTo.toISOString()}
      GROUP BY DATE(sent_at)
      ORDER BY day
    `;

    // Répartition par fournisseur
    const byProvider = await sql<{ provider: string; count: string }[]>`
      SELECT provider, COUNT(*) as count
      FROM sms_logs
      WHERE sent_at >= ${dateFrom.toISOString()} AND sent_at <= ${dateTo.toISOString()}
        AND provider IS NOT NULL
      GROUP BY provider
    `;

    return {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      totals: {
        sent:         Number(totals?.total_sent      ?? 0),
        delivered:    Number(totals?.total_delivered ?? 0),
        failed:       Number(totals?.total_failed    ?? 0),
        deliveryRate: Number(totals?.delivery_rate   ?? 0),
        failureRate:  Number(totals?.failure_rate    ?? 0),
      },
      sentSeries: sentSeries.map((r) => ({
        day:       r.day,
        sent:      Number(r.sent),
        delivered: Number(r.delivered),
        failed:    Number(r.failed),
      })),
      rateSeries: rateSeries.map((r) => ({
        day:          r.day,
        deliveryRate: Number(r.delivery_rate),
        failureRate:  Number(r.failure_rate),
      })),
      byProvider: byProvider.map((r) => ({ provider: r.provider, count: Number(r.count) })),
    };
  });

  // ── SMS envoyés (liste paginée) ───────────────────────────
  app.get('/sent', hooks, async (request) => {
    const q = request.query as {
      status?: string;
      campaignId?: string;
      templateId?: string;
      from?: string;
      to?: string;
      after?: string;
      limit?: string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const dateFrom = q.from ? new Date(q.from) : null;
    const dateTo   = q.to   ? new Date(q.to)   : null;

    return sql`
      SELECT
        sl.*,
        c.first_name, c.last_name, c.email,
        t.name as template_name,
        ca.name as campaign_name
      FROM sms_logs sl
      LEFT JOIN contacts c ON c.id = sl.contact_id
      LEFT JOIN sms_templates t ON t.id = sl.template_id
      LEFT JOIN campaigns ca ON ca.id = sl.campaign_id
      WHERE
        (${q.status     ?? null} IS NULL OR sl.status      = ${q.status     ?? null})
        AND (${q.campaignId ?? null}::uuid IS NULL OR sl.campaign_id = ${q.campaignId ?? null}::uuid)
        AND (${q.templateId ?? null}::uuid IS NULL OR sl.template_id = ${q.templateId ?? null}::uuid)
        AND (${dateFrom?.toISOString() ?? null} IS NULL OR sl.sent_at >= ${dateFrom?.toISOString() ?? null})
        AND (${dateTo?.toISOString()   ?? null} IS NULL OR sl.sent_at <= ${dateTo?.toISOString()   ?? null})
        AND (${q.after ?? null}::uuid IS NULL OR sl.id > ${q.after ?? null}::uuid)
      ORDER BY sl.sent_at DESC
      LIMIT ${limit}
    `;
  });

  // Export CSV des logs SMS
  app.get('/sent/export', hooks, async (request, reply) => {
    const q = request.query as { from?: string; to?: string; status?: string };
    const dateFrom = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86_400_000);
    const dateTo   = q.to   ? new Date(q.to)   : new Date();

    const rows = await sql<{
      sent_at: string; to_number: string; status: string;
      message: string; provider: string | null; error: string | null;
      first_name: string | null; last_name: string | null; email: string | null;
    }[]>`
      SELECT sl.sent_at, sl.to_number, sl.status, sl.message, sl.provider, sl.error,
             c.first_name, c.last_name, c.email
      FROM sms_logs sl
      LEFT JOIN contacts c ON c.id = sl.contact_id
      WHERE sl.sent_at >= ${dateFrom.toISOString()} AND sl.sent_at <= ${dateTo.toISOString()}
        AND (${q.status ?? null} IS NULL OR sl.status = ${q.status ?? null})
      ORDER BY sl.sent_at DESC
    `;

    const header = 'Date,Téléphone,Email,Prénom,Nom,Statut,Fournisseur,Erreur,Message';
    const csv = [header, ...rows.map((r) =>
      [
        r.sent_at,
        r.to_number,
        r.email    ?? '',
        r.first_name ?? '',
        r.last_name  ?? '',
        r.status,
        r.provider ?? '',
        (r.error ?? '').replace(/,/g, ';'),
        `"${(r.message ?? '').replace(/"/g, '""')}"`,
      ].join(',')
    )].join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="sms-export-${dateFrom.toISOString().slice(0,10)}.csv"`);
    return reply.send(csv);
  });
}

export { interpolateSMS, SMS_VARIABLES };
