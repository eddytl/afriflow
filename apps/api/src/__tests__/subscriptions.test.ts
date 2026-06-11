import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({ redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() } }));
vi.mock('../lib/queue.js', () => ({
  emailQueue: { add: vi.fn() },
  paymentQueue: { add: vi.fn() },
}));
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
import subscriptionsRoutes from '../routes/resources/subscriptions.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(subscriptionsRoutes);
});

// Helper: build a subscription object
const makeSub = (overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  contact_id: id(5),
  product_id: id(10),
  status: 'active',
  billing_interval: 'monthly',
  amount: 10000,
  next_billing_date: new Date(Date.now() + 86400_000 * 30).toISOString(),
  started_at: new Date().toISOString(),
  cancelled_at: null,
  ...overrides,
});

describe('GET /subscriptions', () => {
  it('returns empty list', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);
    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('returns MRR summary alongside list', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub()])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ mrr: '10000' }]); // aggregated MRR

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('mrr');
  });
});

describe('MRR normalization', () => {
  it('normalizes weekly billing to monthly (×4.333)', async () => {
    // weekly amount 2000 → MRR = 2000 × (52/12) ≈ 8666
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub({ billing_interval: 'weekly', amount: 2000 })])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ mrr: '8666' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    // Raw number from API — must be close to 2000 * 52/12
    expect(res.json().mrr).toBeGreaterThan(8000);
    expect(res.json().mrr).toBeLessThan(9000);
  });

  it('normalizes annual billing to monthly (÷12)', async () => {
    // annual 120000 → MRR = 10000
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub({ billing_interval: 'yearly', amount: 120000 })])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ mrr: '10000' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mrr).toBe(10000);
  });

  it('normalizes quarterly billing to monthly (÷3)', async () => {
    // quarterly 30000 → MRR = 10000
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub({ billing_interval: 'quarterly', amount: 30000 })])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ mrr: '10000' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mrr).toBe(10000);
  });
});

describe('GET /subscriptions/:id', () => {
  it('returns 404 for unknown subscription', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns subscription detail with history', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub()])
      .mockResolvedValueOnce([{ id: id(50), amount: 10000, status: 'paid', created_at: new Date().toISOString() }]);

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('history');
  });
});

describe('POST /subscriptions', () => {
  it('creates subscription with next_billing_date 30 days out for monthly', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(5) }]) // contact
      .mockResolvedValueOnce([{ id: id(10), price: 10000 }]) // product
      .mockResolvedValueOnce([makeSub()]); // insert

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactId: id(5),
        productId: id(10),
        billingInterval: 'monthly',
        amount: 10000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // next_billing_date should be ~30 days from now
    const nextDate = new Date(body.next_billing_date);
    const diffDays = (nextDate.getTime() - Date.now()) / 86400_000;
    expect(diffDays).toBeGreaterThan(25);
    expect(diffDays).toBeLessThan(35);
  });
});

describe('POST /subscriptions/:id/cancel', () => {
  it('cancels active subscription', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeSub()]) // find
      .mockResolvedValueOnce([makeSub({ status: 'cancelled', cancelled_at: new Date().toISOString() })]); // update

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });

  it('returns 400 when subscription is already cancelled', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeSub({ status: 'cancelled' })]);
    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/cancel` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('already_cancelled');
  });
});
