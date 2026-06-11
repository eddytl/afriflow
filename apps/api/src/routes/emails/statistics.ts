import type { FastifyInstance } from 'fastify';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function emailStatisticsRoutes(app: FastifyInstance) {

  // ── Tableau de bord principal ─────────────────────────────
  // Retourne les 4 séries pour les 4 graphiques :
  //   1. Nombre d'emails envoyés (par jour)
  //   2. % moyen d'ouvertures
  //   3. % emails marqués spam sur emails ouverts
  //   4. % moyen de bounced
  app.get('/overview', hooks, async (request) => {
    const q = request.query as {
      dateFrom?: string;
      dateTo?:   string;
      sourceType?: string;  // newsletter | campaign_step | all
    };
    const from = q.dateFrom ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const to   = q.dateTo   ?? new Date().toISOString();

    // Séries journalières
    const daily = await sql<{
      day:     string;
      sent:    string;
      delivered: string;
      opened:  string;
      clicked: string;
      bounced: string;
      spam:    string;
      unsub:   string;
    }[]>`
      SELECT
        DATE(occurred_at)                                           as day,
        COUNT(*) FILTER (WHERE event_type = 'sent')                as sent,
        COUNT(*) FILTER (WHERE event_type = 'delivered')           as delivered,
        COUNT(*) FILTER (WHERE event_type = 'opened')              as opened,
        COUNT(*) FILTER (WHERE event_type = 'clicked')             as clicked,
        COUNT(*) FILTER (WHERE event_type = 'bounced')             as bounced,
        COUNT(*) FILTER (WHERE event_type = 'spam')                as spam,
        COUNT(*) FILTER (WHERE event_type = 'unsubscribed')        as unsub
      FROM email_events
      WHERE occurred_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${q.sourceType ?? null} IS NULL OR ${q.sourceType ?? null} = 'all'
             OR source_type = ${q.sourceType ?? null})
      GROUP BY DATE(occurred_at)
      ORDER BY day
    `;

    // Totaux globaux pour la période
    const [totals] = await sql<{
      sent: string; opened: string; clicked: string;
      bounced: string; spam: string; unsub: string;
    }[]>`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'sent')         as sent,
        COUNT(*) FILTER (WHERE event_type = 'opened')       as opened,
        COUNT(*) FILTER (WHERE event_type = 'clicked')      as clicked,
        COUNT(*) FILTER (WHERE event_type = 'bounced')      as bounced,
        COUNT(*) FILTER (WHERE event_type = 'spam')         as spam,
        COUNT(*) FILTER (WHERE event_type = 'unsubscribed') as unsub
      FROM email_events
      WHERE occurred_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${q.sourceType ?? null} IS NULL OR ${q.sourceType ?? null} = 'all'
             OR source_type = ${q.sourceType ?? null})
    `;

    const sent   = Number(totals?.sent   ?? 0);
    const opened = Number(totals?.opened ?? 0);
    const bounced = Number(totals?.bounced ?? 0);
    const spam    = Number(totals?.spam   ?? 0);

    // Construire les 4 séries de graphique
    const series = daily.map((d) => {
      const s = Number(d.sent);
      const o = Number(d.opened);
      return {
        day:        d.day,
        sent:       s,
        opened:     o,
        clicked:    Number(d.clicked),
        bounced:    Number(d.bounced),
        spam:       Number(d.spam),
        unsub:      Number(d.unsub),
        openRate:   s > 0 ? Math.round((o / s) * 1000) / 10 : 0,
        clickRate:  s > 0 ? Math.round((Number(d.clicked) / s) * 1000) / 10 : 0,
        bounceRate: s > 0 ? Math.round((Number(d.bounced) / s) * 1000) / 10 : 0,
        spamRate:   o > 0 ? Math.round((Number(d.spam) / o) * 1000) / 10 : 0,
      };
    });

    return {
      dateFrom: from,
      dateTo:   to,
      totals: {
        sent,
        opened,
        clicked:  Number(totals?.clicked ?? 0),
        bounced,
        spam,
        unsub:    Number(totals?.unsub ?? 0),
        openRate:   sent   > 0 ? Math.round((opened  / sent)   * 1000) / 10 : 0,
        clickRate:  sent   > 0 ? Math.round((Number(totals?.clicked ?? 0) / sent)   * 1000) / 10 : 0,
        bounceRate: sent   > 0 ? Math.round((bounced / sent)   * 1000) / 10 : 0,
        spamRate:   opened > 0 ? Math.round((spam    / opened) * 1000) / 10 : 0,
      },
      series,
    };
  });

  // ── Liste des emails envoyés avec leurs stats ─────────────
  // Correspond à la section "Emails" en bas de la page statistiques
  app.get('/emails', hooks, async (request) => {
    const q = request.query as {
      dateFrom?:    string;
      dateTo?:      string;
      sourceType?:  string;
      search?:      string;
      after?:       string;
      limit?:       string;
    };
    const from = q.dateFrom ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const to   = q.dateTo   ?? new Date().toISOString();
    const limit = Math.min(Number(q.limit ?? 50), 200);

    // Single query: newsletters + aggregated email_events via LEFT JOIN (replaces N+1)
    const rows = await sql<{
      id: string; subject: string; from_name: string; from_email: string;
      sent_at: string | null; sent_count: number;
      opened: string; clicked: string; bounced: string; spam: string;
    }[]>`
      SELECT
        nw.id, nw.subject, nw.from_name, nw.from_email, nw.sent_at, nw.sent_count,
        COUNT(*) FILTER (WHERE ee.event_type = 'opened')  AS opened,
        COUNT(*) FILTER (WHERE ee.event_type = 'clicked') AS clicked,
        COUNT(*) FILTER (WHERE ee.event_type = 'bounced') AS bounced,
        COUNT(*) FILTER (WHERE ee.event_type = 'spam')    AS spam
      FROM newsletters nw
      LEFT JOIN email_events ee ON ee.source_id = nw.id AND ee.source_type = 'newsletter'
      WHERE nw.status IN ('sent', 'sending')
        AND (nw.sent_at IS NULL OR nw.sent_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)
        AND (${q.search ?? null} IS NULL OR nw.subject ILIKE ${'%' + (q.search ?? '') + '%'})
      GROUP BY nw.id, nw.subject, nw.from_name, nw.from_email, nw.sent_at, nw.sent_count
      ORDER BY nw.sent_at DESC
      LIMIT ${limit}
    `;

    return rows.map((nw) => {
      const sent   = nw.sent_count;
      const opened = Number(nw.opened ?? 0);
      return {
        id:         nw.id,
        type:       'newsletter',
        subject:    nw.subject,
        fromName:   nw.from_name,
        fromEmail:  nw.from_email,
        sentAt:     nw.sent_at,
        sent,
        opened,
        clicked:    Number(nw.clicked ?? 0),
        bounced:    Number(nw.bounced ?? 0),
        spam:       Number(nw.spam    ?? 0),
        openRate:   sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
        bounceRate: sent > 0 ? Math.round((Number(nw.bounced ?? 0) / sent) * 1000) / 10 : 0,
        spamRate:   opened > 0 ? Math.round((Number(nw.spam ?? 0) / opened) * 1000) / 10 : 0,
      };
    });
  });

  // ── Stats par expéditeur ──────────────────────────────────
  app.get('/by-sender', hooks, async (request) => {
    const q = request.query as { dateFrom?: string; dateTo?: string };
    const from = q.dateFrom ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const to   = q.dateTo   ?? new Date().toISOString();

    return sql`
      SELECT
        COALESCE(
          (SELECT from_email FROM newsletters WHERE id = e.source_id LIMIT 1),
          (SELECT c.from_email FROM campaigns c JOIN campaign_steps cs ON cs.campaign_id = c.id WHERE cs.id = e.source_id LIMIT 1)
        ) as sender_email,
        COUNT(*) FILTER (WHERE event_type = 'sent')    as sent,
        COUNT(*) FILTER (WHERE event_type = 'opened')  as opened,
        COUNT(*) FILTER (WHERE event_type = 'bounced') as bounced,
        COUNT(*) FILTER (WHERE event_type = 'spam')    as spam
      FROM email_events e
      WHERE occurred_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY sender_email
      ORDER BY sent DESC
    `;
  });

  // ── Webhook tracking (pixel ouverture / clic) — PUBLIC ────
  // Un pixel 1x1 transparent inséré dans les emails pour tracker les ouvertures
  app.get('/track/open/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    // Format token: base64(sourceType:sourceId:contactId:tenantSchema)
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [sourceType, sourceId, contactId, tenantSchema] = decoded.split(':');
      await sql.unsafe(`SET search_path = "${tenantSchema}", public`);
      await sql`
        INSERT INTO email_events (source_type, source_id, contact_id, event_type, metadata)
        VALUES (${sourceType}, ${sourceId}, ${contactId ?? null}, 'opened',
                ${JSON.stringify({ ua: request.headers['user-agent'] ?? '' })}::jsonb)
        ON CONFLICT DO NOTHING
      `;
    } catch {
      // silently ignore invalid tokens
    }
    // Retourner un pixel GIF 1x1 transparent
    reply.header('Content-Type', 'image/gif');
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return reply.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  });

  // Clic sur lien
  app.get('/track/click/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    let redirectUrl = '/';
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [sourceType, sourceId, contactId, tenantSchema, ...urlParts] = decoded.split(':');
      redirectUrl = urlParts.join(':');
      await sql.unsafe(`SET search_path = "${tenantSchema}", public`);
      await sql`
        INSERT INTO email_events (source_type, source_id, contact_id, event_type, metadata)
        VALUES (${sourceType}, ${sourceId}, ${contactId ?? null}, 'clicked',
                ${JSON.stringify({ url: redirectUrl })}::jsonb)
      `;
    } catch {
      // silently ignore
    }
    return reply.redirect(redirectUrl);
  });

  // ── Désinscription (unsubscribe) — PUBLIC ─────────────────
  app.get('/unsubscribe/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const [sourceType, sourceId, contactId, tenantSchema] = decoded.split(':');
      await sql.unsafe(`SET search_path = "${tenantSchema}", public`);
      await sql`
        INSERT INTO email_events (source_type, source_id, contact_id, event_type)
        VALUES (${sourceType}, ${sourceId}, ${contactId ?? null}, 'unsubscribed')
      `;
      // Désabonner le contact des campagnes email
      await sql`UPDATE contacts SET email_subscribed = false WHERE id = ${contactId}`;
    } catch {
      // silently ignore
    }
    return reply.send('<html><body><p>Vous avez été désinscrit avec succès.</p></body></html>');
  });
}
