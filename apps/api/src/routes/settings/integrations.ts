import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

interface IntegrationDef {
  provider:    string;
  name:        string;
  description: string;
  category:    string;
  fields:      string[];
  oauthFlow?:  boolean;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    provider:    'zoom',
    name:        'Zoom',
    description: 'Ajoutez Zoom à votre calendrier',
    category:    'calendar',
    fields:      ['apiKey', 'apiSecret'],
    oauthFlow:   true,
  },
  {
    provider:    'google_meet',
    name:        'Google Meet',
    description: 'Ajoutez Google Meet aux événements de votre calendrier',
    category:    'calendar',
    fields:      [],
    oauthFlow:   true,
  },
  {
    provider:    'google_sheets',
    name:        'Google Sheets',
    description: 'Ajoutez automatiquement des lignes dans Google Sheets',
    category:    'automation',
    fields:      [],
    oauthFlow:   true,
  },
  {
    provider:    'activecampaign',
    name:        'ActiveCampaign',
    description: 'Synchronisez les contacts et les tags vers ActiveCampaign',
    category:    'crm',
    fields:      ['apiUrl', 'apiKey'],
  },
  {
    provider:    'google_calendar',
    name:        'Google Agenda',
    description: 'Ajouter Google Agenda pour synchroniser les événements',
    category:    'calendar',
    fields:      [],
    oauthFlow:   true,
  },
  {
    provider:    'twilio',
    name:        'Twilio',
    description: 'Créez votre compte Twilio pour les SMS automatisés',
    category:    'messaging',
    fields:      ['accountSid', 'authToken', 'fromNumber'],
  },
];

function maskCreds(creds: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(creds).map(([k, v]) => [k, v ? '••••' + v.slice(-4) : ''])
  );
}

export default async function integrationsRoutes(app: FastifyInstance) {

  // ── Liste des intégrations disponibles + statut connexion ─────
  app.get('/integrations', hooks, async () => {
    const connected = await sql<{ provider: string; is_active: boolean; connected_at: string }[]>`
      SELECT provider, is_active, connected_at FROM integrations
    `;
    const connectedMap = new Map(connected.map((i) => [i.provider, i]));

    return INTEGRATIONS.map((def) => {
      const conn = connectedMap.get(def.provider);
      return {
        ...def,
        isConnected: !!conn,
        isActive:    conn?.is_active ?? false,
        connectedAt: conn?.connected_at ?? null,
      };
    });
  });

  // ── Connexion / configuration d'une intégration ───────────────
  app.post('/integrations/:provider/connect', hooks, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const def = INTEGRATIONS.find((i) => i.provider === provider);
    if (!def) return reply.status(400).send({ error: 'unsupported_provider' });

    const body = request.body as { credentials?: Record<string, string>; oauthCode?: string; metadata?: Record<string, unknown> };

    // Vérifier les champs requis (intégrations non-OAuth)
    if (!def.oauthFlow && def.fields.length > 0) {
      const missing = def.fields.filter((f) => !body.credentials?.[f]);
      if (missing.length > 0) {
        return reply.status(400).send({
          error:   'missing_fields',
          message: `Champs requis : ${missing.join(', ')}`,
          missing,
        });
      }
    }

    await sql`
      INSERT INTO integrations (provider, credentials, is_active, metadata, connected_at)
      VALUES (
        ${provider},
        ${JSON.stringify(body.credentials ?? {})}::jsonb,
        true,
        ${JSON.stringify(body.metadata ?? {})}::jsonb,
        now()
      )
      ON CONFLICT (provider) DO UPDATE
        SET credentials  = ${JSON.stringify(body.credentials ?? {})}::jsonb,
            metadata     = ${JSON.stringify(body.metadata ?? {})}::jsonb,
            is_active    = true,
            connected_at = now(),
            updated_at   = now()
    `;

    return { connected: true, provider };
  });

  // ── Déconnecter une intégration ───────────────────────────────
  app.delete('/integrations/:provider', hooks, async (request, reply) => {
    await sql`DELETE FROM integrations WHERE provider = ${(request.params as { provider: string }).provider}`;
    return reply.status(204).send();
  });

  // ── Détail d'une intégration (credentials masqués) ────────────
  app.get('/integrations/:provider', hooks, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const [integration] = await sql<{
      provider: string; credentials: Record<string, string>;
      is_active: boolean; connected_at: string; metadata: Record<string, unknown>;
    }[]>`SELECT * FROM integrations WHERE provider = ${provider}`;
    if (!integration) return reply.status(404).send({ error: 'not_connected' });
    return { ...integration, credentials: maskCreds(integration.credentials) };
  });

  // ── OAuth callback (générique) ────────────────────────────────
  // Le frontend redirige ici après autorisation OAuth
  app.get('/integrations/oauth/callback', async (request, reply) => {
    const q = request.query as { provider?: string; code?: string; state?: string; error?: string };
    if (q.error) {
      return reply.redirect(`${process.env.WEB_URL ?? 'http://localhost:3000'}/settings/integrations?error=${q.error}`);
    }
    // En production : échanger le code contre des tokens et les stocker
    return reply.redirect(
      `${process.env.WEB_URL ?? 'http://localhost:3000'}/settings/integrations?connected=${q.provider ?? 'unknown'}`
    );
  });
}
