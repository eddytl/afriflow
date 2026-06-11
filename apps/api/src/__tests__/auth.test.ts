import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, JWT_SECRET } from './helpers.js';

// ── Mocks (hoisted) ────────────────────────────────────────────
vi.mock('../lib/redis.js', () => ({
  redis: {
    set:    vi.fn().mockResolvedValue('OK'),
    get:    vi.fn().mockResolvedValue(null),
    del:    vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../lib/queue.js', () => ({
  emailQueue: { add: vi.fn().mockResolvedValue({ id: 'j1' }) },
  smsQueue:   { add: vi.fn() },
  importQueue: { add: vi.fn() },
  automationQueue: { add: vi.fn() },
  paymentQueue: { add: vi.fn() },
  whatsappQueue: { add: vi.fn() },
}));

vi.mock('@afriflow/db', async () => {
  const actual = await vi.importActual('@afriflow/db') as Record<string, unknown>;
  return { ...actual, createTenantSchema: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../middleware/rateLimit.js', () => ({
  authRateLimit:    vi.fn().mockImplementation(async () => {}),
  rateLimitMiddleware: vi.fn(() => vi.fn()),
  defaultRateLimit: vi.fn().mockImplementation(async () => {}),
}));

const dbResolver = vi.fn().mockResolvedValue([]);
vi.mock('../lib/db.js', () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  (sqlFn as any).unsafe = vi.fn().mockResolvedValue([]);
  return {
    sql: sqlFn,
    db: {
      select:  vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: () => dbResolver() }),
      }),
      insert:  vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: () => dbResolver() }),
      }),
      update:  vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: () => dbResolver() }) }),
      }),
    },
  };
});

// ── Import après mock ──────────────────────────────────────────
import * as dbModule from '../lib/db.js';
import * as redisModule from '../lib/redis.js';
import authRoutes from '../routes/auth/index.js';

// ── Tests ──────────────────────────────────────────────────────
describe('POST /register', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbResolver.mockResolvedValue([]);
    app = await buildTestApp(authRoutes);
  });

  it('returns 201 and tokens on valid registration', async () => {
    // slug check → [] (not taken)
    dbResolver.mockResolvedValueOnce([]);
    // insert tenant → [tenant]
    dbResolver.mockResolvedValueOnce([{ id: 'tenant-1', slug: 'myshop', owner_email: 'a@b.com', plan: 'free' }]);
    // sql insert user → [user]
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: 'user-1' }]);

    const res = await app.inject({
      method: 'POST', url: '/register',
      payload: { email: 'a@b.com', password: 'password123', slug: 'myshop', name: 'Mon Shop' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body.tenant.slug).toBe('myshop');
  });

  it('returns 400 if slug is already taken', async () => {
    // slug check → existing tenant
    dbResolver.mockResolvedValueOnce([{ id: 'existing' }]);

    const res = await app.inject({
      method: 'POST', url: '/register',
      payload: { email: 'a@b.com', password: 'password123', slug: 'taken', name: 'Shop' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('slug_taken');
  });

  it('returns 400 for invalid email', async () => {
    const res = await app.inject({
      method: 'POST', url: '/register',
      payload: { email: 'not-an-email', password: 'password123', slug: 'ok-slug', name: 'Shop' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const res = await app.inject({
      method: 'POST', url: '/register',
      payload: { email: 'a@b.com', password: 'short', slug: 'ok-slug', name: 'Shop' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid slug (spaces)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/register',
      payload: { email: 'a@b.com', password: 'password123', slug: 'my shop', name: 'Shop' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /login', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbResolver.mockResolvedValue([]);
    app = await buildTestApp(authRoutes);
  });

  it('returns 401 when user not found', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // user not found

    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'nouser@test.com', password: 'pass123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('returns 401 when password is wrong', async () => {
    // Bcrypt hash of 'correct-password'
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash; compare: typeof import('bcrypt').compare };
    const hash = await bcrypt.hash('correct-password', 1); // rounds=1 for speed
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: 'u1', password: hash, tenant_id: 't1', role: 'owner',
    }]);

    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'user@test.com', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns tokens on successful login', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash };
    const hash = await bcrypt.hash('my-password', 1);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: 'u1', password: hash, tenant_id: 't1', role: 'owner',
    }]);

    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'user@test.com', password: 'my-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
  });
});

describe('POST /refresh', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(authRoutes);
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/refresh', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 for invalid refresh token', async () => {
    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST', url: '/refresh',
      payload: { refreshToken: 'invalid-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns new tokens when refresh token is valid', async () => {
    const stored = JSON.stringify({ userId: 'u1', tenantId: 't1', role: 'owner' });
    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(stored);

    const res = await app.inject({
      method: 'POST', url: '/refresh',
      payload: { refreshToken: 'valid-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    // Rotation: old token deleted
    expect(vi.mocked(redisModule.redis.del)).toHaveBeenCalledWith('refresh:valid-token');
  });
});
