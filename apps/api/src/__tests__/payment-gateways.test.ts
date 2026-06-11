import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({ redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() } }));
vi.mock('../lib/queue.js', () => ({ emailQueue: { add: vi.fn() } }));
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: any) => { req.user = TEST_USER; }),
}));
vi.mock('../middleware/tenant.js', () => ({
  tenantMiddleware: vi.fn().mockImplementation(async () => {}),
}));
vi.mock('../lib/db.js', () => {
  const fn = vi.fn().mockResolvedValue([]);
  (fn as any).unsafe = vi.fn().mockResolvedValue([]);
  return { sql: fn, db: {} };
});

import * as dbModule from '../lib/db.js';
import paymentGatewaysRoutes from '../routes/settings/payment-gateways.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(paymentGatewaysRoutes);
});

describe('GET /payment-gateways', () => {
  it('returns list of supported providers', async () => {
    const res = await authInject(app, { method: 'GET', url: '/payment-gateways' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should include mobile money providers
    const providers = body.map((p: any) => p.provider ?? p.name);
    expect(providers).toContain('stripe');
    expect(providers).toContain('orange_money');
    expect(providers).toContain('mtn_momo');
    expect(providers).toContain('wave');
  });

  it('shows masked credentials for connected gateways', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), provider: 'stripe', is_active: true,
      credentials: { secretKey: '••••sk_test', publishableKey: '••••pk_test' },
    }]);

    const res = await authInject(app, { method: 'GET', url: '/payment-gateways' });
    expect(res.statusCode).toBe(200);
    // Credentials should be masked — no raw keys
    const body = JSON.stringify(res.json());
    expect(body).not.toContain('sk_test_real_key');
  });
});

describe('POST /payment-gateways/:provider/connect — required fields validation', () => {
  it('connects Stripe with publishableKey + secretKey', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), provider: 'stripe', is_active: true,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/stripe/connect',
      payload: { publishableKey: 'pk_test_xxx', secretKey: 'sk_test_xxx' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects Stripe without secretKey', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/stripe/connect',
      payload: { publishableKey: 'pk_test_xxx' }, // missing secretKey
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_credentials');
    expect(res.json().missing).toContain('secretKey');
  });

  it('connects PayPal with clientId + clientSecret', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), provider: 'paypal', is_active: true }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/paypal/connect',
      payload: { clientId: 'AXxx', clientSecret: 'EAxx' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('connects MTN MoMo with all 4 required fields', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), provider: 'mtn_momo', is_active: true }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/mtn_momo/connect',
      payload: {
        subscriptionKey: 'sub_xxx',
        userId: 'user_uuid',
        apiKey: 'api_xxx',
        environment: 'sandbox',
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects MTN MoMo with missing environment', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/mtn_momo/connect',
      payload: { subscriptionKey: 'sub_xxx', userId: 'user_uuid', apiKey: 'api_xxx' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().missing).toContain('environment');
  });

  it('connects Orange Money with merchantId + apiKey', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), provider: 'orange_money', is_active: true }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/orange_money/connect',
      payload: { merchantId: 'OMER_xxx', apiKey: 'om_api_xxx' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('connects Wave with apiKey', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), provider: 'wave', is_active: true }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/wave/connect',
      payload: { apiKey: 'wave_sk_xxx' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for unknown provider', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/bitcoin/connect',
      payload: { walletAddress: '1A2B3C' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unsupported_provider');
  });
});

describe('POST /payment-gateways/:provider/toggle', () => {
  it('activates a connected gateway', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), provider: 'stripe', is_active: false }])
      .mockResolvedValueOnce([{ id: id(1), provider: 'stripe', is_active: true }]);

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/stripe/toggle',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_active).toBe(true);
  });

  it('returns 404 when gateway not connected', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // not connected

    const res = await authInject(app, {
      method: 'POST', url: '/payment-gateways/stripe/toggle',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_connected');
  });
});
