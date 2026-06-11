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
import productsRoutes from '../routes/resources/products.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(productsRoutes);
});

const makeProduct = (overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  name: 'Formation Python',
  price: 25000,
  type: 'digital',
  status: 'active',
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('GET /products', () => {
  it('returns paginated products', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeProduct(), makeProduct({ id: id(2), name: 'Cours Marketing' })])
      .mockResolvedValueOnce([{ count: '2' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it('filters by type', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeProduct()])
      .mockResolvedValueOnce([{ count: '1' }]);

    const res = await authInject(app, { method: 'GET', url: '/?type=digital' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /products', () => {
  it('creates physical product with required fields', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeProduct({ type: 'physical' })]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        name: 'T-Shirt AfriFlow',
        price: 5000,
        type: 'physical',
        stock: 100,
        weight: 0.2,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('creates digital product without stock', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeProduct()]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Formation Python', price: 25000, type: 'digital' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('creates subscription product with billingInterval', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeProduct({
      type: 'subscription', billing_interval: 'monthly',
    })]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Accès Pro', price: 10000, type: 'subscription', billingInterval: 'monthly' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 for price < 0', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Gratuit', price: -1, type: 'digital' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'X', price: 0, type: 'nft' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 if subscription product missing billingInterval', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Abonnement', price: 5000, type: 'subscription' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /products/:id', () => {
  it('returns product with variants', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeProduct()])
      .mockResolvedValueOnce([]); // variants

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('variants');
  });

  it('returns 404 for missing product', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /products/:id', () => {
  it('updates price', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeProduct({ price: 30000 })]);
    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}`,
      payload: { price: 30000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().price).toBe(30000);
  });
});

describe('DELETE /products/:id', () => {
  it('archives product (soft delete)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'DELETE', url: `/${id(1)}` });
    expect(res.statusCode).toBe(204);
  });
});
