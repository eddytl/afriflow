import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({ redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() } }));
vi.mock('../lib/queue.js', () => ({ emailQueue: { add: vi.fn() }, paymentQueue: { add: vi.fn() } }));
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
import ordersRoutes from '../routes/resources/orders.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(ordersRoutes);
});

describe('GET /orders', () => {
  it('returns list with pagination', async () => {
    const orders = [
      { id: id(1), order_number: 'AF-001', total: 15000, status: 'paid', created_at: new Date().toISOString() },
    ];
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce(orders)
      .mockResolvedValueOnce([{ count: '1' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().total).toBe(1);
  });

  it('filters by status', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    const res = await authInject(app, { method: 'GET', url: '/?status=pending' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /orders — business logic', () => {
  it('generates sequential order number AF-{N:03d}', async () => {
    // last order count query → 0
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '0' }]);
    // coupon check → none
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    // product lookup → product
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(10), name: 'Cours Digital', price: 10000 }]);
    // contact lookup/create → contact
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(5) }]);
    // insert order → order
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), order_number: 'AF-001', total: 10000, status: 'pending',
    }]);
    // insert order items → ok
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactEmail: 'buyer@test.com',
        items: [{ productId: id(10), quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().order_number).toMatch(/^AF-\d{3}$/);
  });

  it('calculates subtotal from items × quantity', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '5' }]) // last order
      .mockResolvedValueOnce([])               // no coupon
      .mockResolvedValueOnce([{ id: id(10), price: 5000 }]) // product
      .mockResolvedValueOnce([{ id: id(5) }])  // contact
      .mockResolvedValueOnce([{
        id: id(6), order_number: 'AF-006', total: 15000, status: 'pending',
      }])
      .mockResolvedValueOnce([]); // items insert

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactEmail: 'buyer@test.com',
        items: [{ productId: id(10), quantity: 3 }],
      },
    });
    expect(res.statusCode).toBe(201);
    // total = 5000 × 3 = 15000
    expect(res.json().total).toBe(15000);
  });

  it('applies percentage coupon discount to total', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: id(20), code: 'PROMO20', discount_type: 'percentage', discount_amount: 20, expires_at: null, max_uses: null, use_count: 0 }])
      .mockResolvedValueOnce([{ id: id(10), price: 10000 }])
      .mockResolvedValueOnce([{ id: id(5) }])
      .mockResolvedValueOnce([{ id: id(1), order_number: 'AF-001', total: 8000, status: 'pending' }])
      .mockResolvedValueOnce([])   // items insert
      .mockResolvedValueOnce([]);  // coupon use_count update

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactEmail: 'buyer@test.com',
        items: [{ productId: id(10), quantity: 1 }],
        couponCode: 'PROMO20',
      },
    });
    expect(res.statusCode).toBe(201);
    // 10000 - 20% = 8000
    expect(res.json().total).toBe(8000);
  });

  it('applies fixed coupon discount', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: id(20), discount_type: 'fixed', discount_amount: 2000, expires_at: null, max_uses: null, use_count: 0 }])
      .mockResolvedValueOnce([{ id: id(10), price: 10000 }])
      .mockResolvedValueOnce([{ id: id(5) }])
      .mockResolvedValueOnce([{ id: id(1), order_number: 'AF-001', total: 8000, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactEmail: 'buyer@test.com',
        items: [{ productId: id(10), quantity: 1 }],
        couponCode: 'FIXED2K',
      },
    });
    expect(res.statusCode).toBe(201);
    // 10000 - 2000 = 8000
    expect(res.json().total).toBe(8000);
  });

  it('clamps discount so total cannot go below 0', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: id(20), discount_type: 'fixed', discount_amount: 99999, expires_at: null, max_uses: null, use_count: 0 }])
      .mockResolvedValueOnce([{ id: id(10), price: 1000 }])
      .mockResolvedValueOnce([{ id: id(5) }])
      .mockResolvedValueOnce([{ id: id(1), order_number: 'AF-001', total: 0, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        contactEmail: 'buyer@test.com',
        items: [{ productId: id(10), quantity: 1 }],
        couponCode: 'HUGE',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().total).toBeGreaterThanOrEqual(0);
  });

  it('returns 400 for empty items array', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { contactEmail: 'buyer@test.com', items: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /orders/:id', () => {
  it('returns order with items', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), order_number: 'AF-001', total: 10000, status: 'paid' }])
      .mockResolvedValueOnce([{ id: id(11), product_name: 'Cours', quantity: 1, price: 10000 }]);

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it('returns 404 for unknown order', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /orders/:id/status', () => {
  it('transitions to refunded and triggers email', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), status: 'paid', contact_email: 'b@t.com' }])
      .mockResolvedValueOnce([{ id: id(1), status: 'refunded' }]);

    const emailQueue = (await import('../lib/queue.js')).emailQueue;

    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}/status`,
      payload: { status: 'refunded' },
    });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(emailQueue.add)).toHaveBeenCalled();
  });

  it('returns 400 for invalid status transition', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), status: 'refunded' }]);
    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}/status`,
      payload: { status: 'paid' }, // cannot go back to paid from refunded
    });
    expect(res.statusCode).toBe(400);
  });
});
