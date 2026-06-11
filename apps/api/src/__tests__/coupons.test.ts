import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, id } from './helpers.js';

// ── Mocks ──────────────────────────────────────────────────────
vi.mock('../lib/redis.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() },
}));
vi.mock('../lib/queue.js', () => ({ emailQueue: { add: vi.fn() } }));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: any) => {
    req.user = TEST_USER;
  }),
}));
vi.mock('../middleware/tenant.js', () => ({
  tenantMiddleware: vi.fn().mockImplementation(async () => {}),
}));

const sqlMock = vi.fn().mockResolvedValue([]);
vi.mock('../lib/db.js', () => {
  const fn = vi.fn().mockResolvedValue([]);
  (fn as any).unsafe = vi.fn().mockResolvedValue([]);
  return { sql: fn, db: {} };
});

import * as dbModule from '../lib/db.js';
import couponsRoutes from '../routes/resources/coupons.js';

// ── Setup ──────────────────────────────────────────────────────
let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(couponsRoutes);
});

// ── Tests ──────────────────────────────────────────────────────
describe('GET /coupons', () => {
  it('returns empty list', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns coupons with default limit of 50', async () => {
    const coupons = Array.from({ length: 3 }, (_, i) => ({
      id: id(i + 1), code: `CODE${i + 1}`, discount_type: 'percentage', discount_amount: 10,
    }));
    vi.mocked(dbModule.sql).mockResolvedValueOnce(coupons);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });
});

describe('POST /coupons — validation', () => {
  it('auto-uppercases code', async () => {
    // uniqueness check → []
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    // insert → coupon
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'SUMMER20', discount_type: 'percentage', discount_amount: 20,
    }]);

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Promo Été', code: 'summer20', discountType: 'percentage', discountAmount: 20 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe('SUMMER20');
  });

  it('trims whitespace from code', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'PROMO', discount_type: 'fixed', discount_amount: 5000,
    }]);

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Promo', code: '  promo  ', discountType: 'fixed', discountAmount: 5000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe('PROMO');
  });

  it('rejects percentage discount > 100', async () => {
    // uniqueness check → [] (code is unique)
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Too Much', code: 'BIG', discountType: 'percentage', discountAmount: 101 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_percentage');
  });

  it('allows percentage discount of exactly 100', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'FREE100', discount_type: 'percentage', discount_amount: 100,
    }]);

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Gratuit', code: 'FREE100', discountType: 'percentage', discountAmount: 100 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects duplicate code', async () => {
    // uniqueness check → existing coupon
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: 'existing' }]);

    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Promo', code: 'EXISTING', discountType: 'fixed', discountAmount: 1000 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('code_already_exists');
  });

  it('rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Promo' }, // missing code, discountType, discountAmount
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative discount amount', async () => {
    const res = await app.inject({
      method: 'POST', url: '/',
      payload: { name: 'Bad', code: 'BAD', discountType: 'fixed', discountAmount: -100 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /coupons/:id', () => {
  it('returns 404 when coupon not found', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns coupon when found', async () => {
    const coupon = { id: id(1), code: 'PROMO', discount_type: 'percentage', discount_amount: 10 };
    vi.mocked(dbModule.sql).mockResolvedValueOnce([coupon]);
    const res = await app.inject({ method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe('PROMO');
  });
});

describe('GET /coupons/validate/:code (public)', () => {
  it('returns 404 for unknown code', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // not found
    const res = await app.inject({
      method: 'GET',
      url: '/validate/UNKNOWN?tenantSchema=tenant_test',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for expired coupon', async () => {
    const pastDate = new Date(Date.now() - 86400_000).toISOString();
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'EXPIRED', status: 'active', expires_at: pastDate,
      discount_type: 'percentage', discount_amount: 10,
    }]);
    const res = await app.inject({
      method: 'GET',
      url: '/validate/EXPIRED?tenantSchema=tenant_test',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('expired');
  });

  it('returns 400 when max uses reached', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'MAXED', status: 'active', expires_at: null,
      max_uses: 10, use_count: 10,
      discount_type: 'percentage', discount_amount: 10,
    }]);
    const res = await app.inject({
      method: 'GET',
      url: '/validate/MAXED?tenantSchema=tenant_test',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('max_uses_reached');
  });

  it('returns valid coupon with discount info', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), code: 'VALID20', status: 'active', expires_at: null,
      max_uses: null, use_count: 5,
      discount_type: 'percentage', discount_amount: 20,
    }]);
    const res = await app.inject({
      method: 'GET',
      url: '/validate/VALID20?tenantSchema=tenant_test',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.discountType).toBe('percentage');
    expect(body.discountAmount).toBe(20);
  });
});

describe('DELETE /coupons/:id', () => {
  it('returns 204 on delete', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'DELETE', url: `/${id(1)}` });
    expect(res.statusCode).toBe(204);
  });
});
