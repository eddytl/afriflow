import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const SUPPORTED_PROVIDERS = [
  'stripe', 'paypal', 'mercadopago', 'razorpay',
  'flutterwave', 'mollie', 'gocardless', 'xendit',
  'securepay', 'cash_on_delivery',
  'orange_money', 'mtn_momo', 'wave', 'airtel_money',  // Mobile Money africain
] as const;

type Provider = typeof SUPPORTED_PROVIDERS[number];

// Champs requis par provider
const PROVIDER_FIELDS: Record<Provider, string[]> = {
  stripe:          ['publishableKey', 'secretKey'],
  paypal:          ['clientId', 'clientSecret'],
  mercadopago:     ['accessToken'],
  razorpay:        ['keyId', 'keySecret'],
  flutterwave:     ['publicKey', 'secretKey', 'encryptionKey'],
  mollie:          ['apiKey'],
  gocardless:      ['accessToken'],
  xendit:          ['secretKey'],
  securepay:       ['merchantId', 'secretKey'],
  cash_on_delivery: [],
  orange_money:    ['merchantCode', 'apiKey', 'notifyUrl'],
  mtn_momo:        ['subscriptionKey', 'userId', 'apiKey', 'environment'],
  wave:            ['apiKey'],
  airtel_money:    ['clientId', 'clientSecret', 'country'],
};

function maskCreds(creds: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(creds).map(([k, v]) => [k, v ? '••••' + v.slice(-4) : ''])
  );
}

export default async function paymentGatewaysRoutes(app: FastifyInstance) {

  // ── Liste des passerelles (avec statut de connexion) ──────────
  app.get('/payment-gateways', hooks, async () => {
    const connected = await sql<{ provider: string; is_active: boolean; connected_at: string }[]>`
      SELECT provider, is_active, connected_at FROM payment_gateways
    `;
    const connectedMap = new Map(connected.map((g) => [g.provider, g]));

    return SUPPORTED_PROVIDERS.map((provider) => {
      const conn = connectedMap.get(provider);
      return {
        provider,
        requiredFields: PROVIDER_FIELDS[provider],
        isConnected: !!conn,
        isActive:    conn?.is_active ?? false,
        connectedAt: conn?.connected_at ?? null,
      };
    });
  });

  // ── Connecter / mettre à jour une passerelle ──────────────────
  app.post('/payment-gateways/:provider/connect', hooks, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
      return reply.status(400).send({ error: 'unsupported_provider' });
    }

    const body = request.body as { credentials: Record<string, string>; testMode?: boolean };
    const required = PROVIDER_FIELDS[provider as Provider];
    const missing  = required.filter((f) => !body.credentials?.[f]);
    if (missing.length > 0) {
      return reply.status(400).send({
        error:   'missing_fields',
        message: `Champs requis : ${missing.join(', ')}`,
        missing,
      });
    }

    await sql`
      INSERT INTO payment_gateways (provider, credentials, is_active, connected_at)
      VALUES (${provider}, ${JSON.stringify(body.credentials ?? {})}::jsonb, true, now())
      ON CONFLICT (provider) DO UPDATE
        SET credentials  = ${JSON.stringify(body.credentials ?? {})}::jsonb,
            is_active    = true,
            connected_at = now(),
            updated_at   = now()
    `;

    return { connected: true, provider, credentials: maskCreds(body.credentials ?? {}) };
  });

  // ── Activer / désactiver ──────────────────────────────────────
  app.post('/payment-gateways/:provider/toggle', hooks, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const [updated] = await sql`
      UPDATE payment_gateways
      SET is_active = NOT is_active, updated_at = now()
      WHERE provider = ${provider}
      RETURNING provider, is_active
    `;
    if (!updated) return reply.status(404).send({ error: 'not_connected' });
    return updated;
  });

  // ── Déconnecter ───────────────────────────────────────────────
  app.delete('/payment-gateways/:provider', hooks, async (request, reply) => {
    await sql`DELETE FROM payment_gateways WHERE provider = ${(request.params as { provider: string }).provider}`;
    return reply.status(204).send();
  });

  // ── Récupérer les credentials (masqués) d'une passerelle ─────
  app.get('/payment-gateways/:provider', hooks, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const [gw] = await sql<{ provider: string; credentials: Record<string, string>; is_active: boolean; connected_at: string }[]>`
      SELECT provider, credentials, is_active, connected_at
      FROM payment_gateways WHERE provider = ${provider}
    `;
    if (!gw) return reply.status(404).send({ error: 'not_connected' });
    return { ...gw, credentials: maskCreds(gw.credentials) };
  });
}
