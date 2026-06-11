import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

// ── Mocks ──────────────────────────────────────────────────────
vi.mock('../lib/redis.js', () => ({
  redis: {
    set:     vi.fn().mockResolvedValue('OK'),
    get:     vi.fn().mockResolvedValue(null),
    del:     vi.fn().mockResolvedValue(1),
    incr:    vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
  },
}));
vi.mock('../lib/queue.js', () => ({ emailQueue: { add: vi.fn() } }));
vi.mock('@afriflow/db', async () => {
  const actual = await vi.importActual('@afriflow/db') as Record<string, unknown>;
  return { ...actual, createTenantSchema: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../middleware/rateLimit.js', () => ({
  authRateLimit:       vi.fn().mockImplementation(async () => {}),
  rateLimitMiddleware: vi.fn(() => vi.fn()),
  defaultRateLimit:    vi.fn().mockImplementation(async () => {}),
}));
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: any) => { req.user = TEST_USER; }),
}));
vi.mock('../middleware/tenant.js', () => ({
  tenantMiddleware: vi.fn().mockImplementation(async () => {}),
}));

const dbResolver = vi.fn().mockResolvedValue([]);
vi.mock('../lib/db.js', () => {
  const sqlFn = vi.fn().mockResolvedValue([]);
  (sqlFn as any).unsafe = vi.fn().mockResolvedValue([]);
  return {
    sql: sqlFn,
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: () => dbResolver() }) }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: () => dbResolver() }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: () => dbResolver() }) }) }),
    },
  };
});

import * as dbModule from '../lib/db.js';
import * as redisModule from '../lib/redis.js';
import { TOTP, Secret } from 'otpauth';
import { hashBackupCode } from '../routes/settings/profile.js';
import authRoutes from '../routes/auth/index.js';
import profileRoutes from '../routes/settings/profile.js';

// ── Helpers ────────────────────────────────────────────────────

function makeTotpSecret(): { secret: Secret; b32: string; totp: TOTP } {
  const secret = new Secret();
  const totp   = new TOTP({ issuer: 'AfriFlow', label: 'test@test.com', secret });
  return { secret, b32: secret.base32, totp };
}

function validCode(totp: TOTP): string {
  return totp.generate();
}

/**
 * Clears call history for all mocks (preserving implementations like authMiddleware),
 * then resets only the spies that can accumulate mockResolvedValueOnce queues.
 * vi.resetAllMocks() must NOT be used — it destroys authMiddleware's implementation,
 * making req.user undefined and causing all route tests to fail with 500.
 */
function resetMocks() {
  vi.clearAllMocks();
  // Clear mockOnce queues + restore defaults for the spies used with mockResolvedValueOnce
  vi.mocked(dbModule.sql).mockReset().mockResolvedValue([]);
  dbResolver.mockReset().mockResolvedValue([]);
  vi.mocked(redisModule.redis.get).mockReset().mockResolvedValue(null);
}

// ── Tests : hashBackupCode ─────────────────────────────────────

describe('hashBackupCode utility', () => {
  it('normalises case before hashing', () => {
    expect(hashBackupCode('ABCDEF-123456')).toBe(hashBackupCode('abcdef-123456'));
  });

  it('normalises dash before hashing', () => {
    expect(hashBackupCode('ABCDEF-123456')).toBe(hashBackupCode('ABCDEF123456'));
  });

  it('two different codes produce different hashes', () => {
    expect(hashBackupCode('AAAAAA-111111')).not.toBe(hashBackupCode('BBBBBB-222222'));
  });
});

// ── Tests : POST /security/2fa/setup ──────────────────────────

describe('POST /security/2fa/setup', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    app = await buildTestApp(profileRoutes);
  });

  it('returns uri, secret and 10 backup codes', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      totp_enabled: false, email: 'owner@test.com',
    }]);

    const res = await authInject(app, { method: 'POST', url: '/security/2fa/setup' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.secret).toBeTruthy();
    expect(body.backupCodes).toHaveLength(10);
    expect(body.backupCodes[0]).toMatch(/^[0-9A-F]{6}-[0-9A-F]{6}$/i);
  });

  it('saves pending secret in Redis with 600s TTL', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ totp_enabled: false, email: 'owner@test.com' }]);

    await authInject(app, { method: 'POST', url: '/security/2fa/setup' });

    expect(vi.mocked(redisModule.redis.set)).toHaveBeenCalledWith(
      expect.stringContaining('2fa:setup:'),
      expect.any(String),
      'EX',
      600,
    );
  });

  it('returns 400 when 2FA is already enabled', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ totp_enabled: true, email: 'owner@test.com' }]);

    const res = await authInject(app, { method: 'POST', url: '/security/2fa/setup' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('2fa_already_enabled');
  });

  it('backup codes returned only once — not stored as plaintext', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ totp_enabled: false, email: 'owner@test.com' }]);

    const res = await authInject(app, { method: 'POST', url: '/security/2fa/setup' });
    const body = res.json();

    const redisCall = vi.mocked(redisModule.redis.set).mock.calls[0];
    const stored    = JSON.parse(redisCall[1] as string) as { backupCodes: string[] };

    // Hashes are SHA-256 hex (64 chars), not the 13-char XXXXXX-XXXXXX format
    expect(stored.backupCodes[0]).toHaveLength(64);
    expect(stored.backupCodes[0]).not.toBe(body.backupCodes[0]);
  });
});

// ── Tests : POST /security/2fa/confirm ────────────────────────

describe('POST /security/2fa/confirm', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    app = await buildTestApp(profileRoutes);
  });

  it('activates 2FA with a valid TOTP code', async () => {
    const { b32, totp } = makeTotpSecret();
    const code = validCode(totp);

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ secret: b32, backupCodes: ['hash1', 'hash2'] })
    );
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // UPDATE

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/confirm',
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(vi.mocked(redisModule.redis.del)).toHaveBeenCalledWith(
      expect.stringContaining('2fa:setup:')
    );
  });

  it('returns 400 with an invalid TOTP code', async () => {
    const { b32 } = makeTotpSecret();

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ secret: b32, backupCodes: [] })
    );

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/confirm',
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_totp_code');
  });

  it('returns 400 when setup session expired', async () => {
    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(null);

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/confirm',
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('setup_expired');
  });

  it('returns 400 for non-numeric code', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/confirm',
      payload: { code: 'abcdef' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_code_format');
  });
});

// ── Tests : POST /security/2fa/disable ────────────────────────

describe('POST /security/2fa/disable', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    app = await buildTestApp(profileRoutes);
  });

  it('disables 2FA with valid password + TOTP code', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash; compare: typeof import('bcrypt').compare };
    const { b32, totp } = makeTotpSecret();
    const hash = await bcrypt.hash('correct-password', 1);
    const code = validCode(totp);

    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), password: hash, totp_enabled: true, totp_secret: b32 }])
      .mockResolvedValueOnce([]); // UPDATE

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/disable',
      payload: { password: 'correct-password', code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  it('returns 400 for wrong password', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash };
    const { b32, totp } = makeTotpSecret();
    const hash = await bcrypt.hash('real-password', 1);

    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), password: hash, totp_enabled: true, totp_secret: b32,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/disable',
      payload: { password: 'wrong-password', code: validCode(totp) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('wrong_password');
  });

  it('returns 400 for invalid TOTP code', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash };
    const { b32 } = makeTotpSecret();
    const hash = await bcrypt.hash('password', 1);

    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), password: hash, totp_enabled: true, totp_secret: b32,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/disable',
      payload: { password: 'password', code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_totp_code');
  });

  it('returns 400 when 2FA is not enabled', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), password: 'hash', totp_enabled: false, totp_secret: null,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/disable',
      payload: { password: 'password', code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('2fa_not_enabled');
  });
});

// ── Tests : Login avec 2FA ─────────────────────────────────────

describe('POST /login — 2FA challenge', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    dbResolver.mockResolvedValue([]);
    app = await buildTestApp(authRoutes);
  });

  it('returns challengeToken instead of tokens when 2FA enabled', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash };
    const hash = await bcrypt.hash('my-password', 1);

    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), password: hash, tenant_id: id(2), role: 'owner', totp_enabled: true,
    }]);

    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'user@test.com', password: 'my-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requires2fa).toBe(true);
    expect(body.challengeToken).toBeTruthy();
    expect(body).not.toHaveProperty('accessToken');
    expect(vi.mocked(redisModule.redis.set)).toHaveBeenCalledWith(
      expect.stringContaining('2fa:challenge:'),
      expect.any(String),
      'EX', 600,
    );
  });

  it('returns tokens directly when 2FA is NOT enabled', async () => {
    const bcrypt = await import('bcrypt') as unknown as { hash: typeof import('bcrypt').hash };
    const hash = await bcrypt.hash('my-password', 1);

    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), password: hash, tenant_id: id(2), role: 'owner', totp_enabled: false,
    }]);

    const res = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'user@test.com', password: 'my-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).not.toHaveProperty('requires2fa');
  });
});

// ── Tests : POST /2fa/verify ───────────────────────────────────

describe('POST /2fa/verify', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    dbResolver.mockResolvedValue([]);
    app = await buildTestApp(authRoutes);
  });

  it('returns accessToken + refreshToken with valid TOTP code', async () => {
    const { b32, totp } = makeTotpSecret();
    const code = validCode(totp);

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ userId: id(1), tenantId: id(2), role: 'owner' })
    );
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      totp_secret: b32, totp_backup_codes: [],
    }]);

    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'valid-challenge-token', code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(vi.mocked(redisModule.redis.del)).toHaveBeenCalledWith('2fa:challenge:valid-challenge-token');
  });

  it('returns 401 with an expired challenge token', async () => {
    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'expired-token', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('challenge_expired');
  });

  it('returns 401 with a wrong TOTP code', async () => {
    const { b32 } = makeTotpSecret();

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ userId: id(1), tenantId: id(2), role: 'owner' })
    );
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      totp_secret: b32, totp_backup_codes: [],
    }]);

    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'ch', code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_totp_code');
  });

  it('accepts a valid backup code and removes it (single-use)', async () => {
    const plain   = 'ABCDEF-123456';
    const hashed  = hashBackupCode(plain);
    const { b32 } = makeTotpSecret();

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ userId: id(1), tenantId: id(2), role: 'owner' })
    );
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ totp_secret: b32, totp_backup_codes: [hashed, 'other-hash'] }])
      .mockResolvedValueOnce([{ id: id(1) }]); // atomic UPDATE RETURNING id

    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'ch', backupCode: plain },
    });
    expect(res.statusCode).toBe(200);

    // The atomic UPDATE is the second sql call (single-use enforced at DB level)
    const sqlCalls = vi.mocked(dbModule.sql).mock.calls;
    expect(sqlCalls.length).toBe(2); // SELECT user + atomic UPDATE RETURNING id
  });

  it('returns 401 for an invalid backup code', async () => {
    const hashed = hashBackupCode('VALID1-CODE12');
    const { b32 } = makeTotpSecret();

    vi.mocked(redisModule.redis.get).mockResolvedValueOnce(
      JSON.stringify({ userId: id(1), tenantId: id(2), role: 'owner' })
    );
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      totp_secret: b32, totp_backup_codes: [hashed],
    }]);

    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'ch', backupCode: 'WRONG1-CODE99' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_backup_code');
  });

  it('returns 400 when neither code nor backupCode provided', async () => {
    const res = await app.inject({
      method: 'POST', url: '/2fa/verify',
      payload: { challengeToken: 'ch' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('code_or_backup_required');
  });
});

// ── Tests : POST /security/2fa/backup-codes/regenerate ─────────

describe('POST /security/2fa/backup-codes/regenerate', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    resetMocks();
    app = await buildTestApp(profileRoutes);
  });

  it('returns 10 new backup codes on valid TOTP', async () => {
    const { b32, totp } = makeTotpSecret();

    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), totp_enabled: true, totp_secret: b32 }])
      .mockResolvedValueOnce([]); // UPDATE

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/backup-codes/regenerate',
      payload: { code: validCode(totp) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().backupCodes).toHaveLength(10);
  });

  it('returns 400 for invalid TOTP code', async () => {
    const { b32 } = makeTotpSecret();

    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), totp_enabled: true, totp_secret: b32,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/security/2fa/backup-codes/regenerate',
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
  });
});
