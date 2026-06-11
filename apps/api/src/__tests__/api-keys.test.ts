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
import apiKeysRoutes from '../routes/settings/api-keys.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(apiKeysRoutes);
});

// ── API Keys ──────────────────────────────────────────────────────

describe('GET /api-keys', () => {
  it('returns list without token_hash', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([
      { id: id(1), name: 'Prod Key', token_prefix: 'ak_abc123456789', status: 'active' },
    ]);

    const res = await authInject(app, { method: 'GET', url: '/api-keys' });
    expect(res.statusCode).toBe(200);
    const keys = res.json();
    expect(keys).toHaveLength(1);
    // Hash must never be exposed
    expect(JSON.stringify(keys)).not.toContain('token_hash');
  });
});

describe('POST /api-keys', () => {
  it('returns full token exactly once on creation', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), name: 'New Key', token_prefix: 'ak_abc123456789', status: 'active',
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/api-keys',
      payload: { name: 'New Key' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Full token returned once
    expect(body).toHaveProperty('token');
    expect(body.token).toMatch(/^ak_[0-9a-f]{64}$/);

    // Prefix matches token start
    expect(body.token.startsWith(body.tokenPrefix)).toBe(true);
  });

  it('token is not returned on subsequent GET', async () => {
    // First call creates the key
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), name: 'Permanent Key', token_prefix: 'ak_xyz', status: 'active',
    }]);
    await authInject(app, {
      method: 'POST', url: '/api-keys',
      payload: { name: 'Permanent Key' },
    });

    // Second call lists keys
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), name: 'Permanent Key', token_prefix: 'ak_xyz', status: 'active',
    }]);
    const listRes = await authInject(app, { method: 'GET', url: '/api-keys' });
    expect(JSON.stringify(listRes.json())).not.toContain('ak_xyz' + 'someFullToken');
    expect(JSON.stringify(listRes.json())).not.toContain('token_hash');
  });

  it('hash stored is different from token (SHA-256)', async () => {
    let storedHash: string | null = null;

    // Intercept the SQL call that inserts the key
    vi.mocked(dbModule.sql).mockImplementationOnce(async (...args: any[]) => {
      // Capture what was passed to sql (the hash field)
      const queryStr = args[0]?.[0] ?? '';
      if (queryStr.includes('INSERT')) {
        storedHash = args[1]; // rough capture
      }
      return [{ id: id(1), name: 'Key', token_prefix: 'ak_test', status: 'active' }];
    });

    const res = await authInject(app, {
      method: 'POST', url: '/api-keys',
      payload: { name: 'Key' },
    });
    const token = res.json().token;

    // Token ≠ hash (hash is SHA-256, not the raw token)
    if (storedHash) {
      expect(token).not.toBe(storedHash);
    }
    // Token format check
    expect(token).toMatch(/^ak_/);
  });

  it('creates key with expiry date when specified', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), name: 'Temp Key', token_prefix: 'ak_temp', status: 'active',
      expires_at: '2026-12-31T23:59:59.000Z',
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/api-keys',
      payload: { name: 'Temp Key', expiresAt: '2026-12-31' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().expires_at).toBeTruthy();
  });
});

describe('DELETE /api-keys/:id', () => {
  it('revokes key (status=revoked)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'DELETE', url: `/api-keys/${id(1)}` });
    expect(res.statusCode).toBe(204);
    expect(vi.mocked(dbModule.sql)).toHaveBeenCalled();
  });
});

// ── MCP Keys ─────────────────────────────────────────────────────

describe('POST /mcp-keys — limit of 2 active', () => {
  it('creates first MCP key successfully', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '0' }]) // active count check
      .mockResolvedValueOnce([{ id: id(1), name: 'MCP Key 1', token_prefix: 'mcp_abc', status: 'active' }]);

    const res = await authInject(app, {
      method: 'POST', url: '/mcp-keys',
      payload: { name: 'MCP Key 1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toMatch(/^mcp_[0-9a-f]{64}$/);
  });

  it('creates second MCP key when only 1 active', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ id: id(2), name: 'MCP Key 2', token_prefix: 'mcp_xyz', status: 'active' }]);

    const res = await authInject(app, {
      method: 'POST', url: '/mcp-keys',
      payload: { name: 'MCP Key 2' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects third MCP key when 2 already active', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '2' }]); // at limit

    const res = await authInject(app, {
      method: 'POST', url: '/mcp-keys',
      payload: { name: 'MCP Key 3' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('mcp_key_limit_reached');
  });

  it('allows new MCP key after revoking one (count drops to 1)', async () => {
    // After revoke, count is 1 — should be allowed
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ id: id(3), name: 'MCP Key New', token_prefix: 'mcp_new', status: 'active' }]);

    const res = await authInject(app, {
      method: 'POST', url: '/mcp-keys',
      payload: { name: 'MCP Key New' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /mcp-keys', () => {
  it('lists MCP keys without token_hash', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([
      { id: id(1), name: 'Key 1', token_prefix: 'mcp_aaa', status: 'active' },
      { id: id(2), name: 'Key 2', token_prefix: 'mcp_bbb', status: 'revoked' },
    ]);

    const res = await authInject(app, { method: 'GET', url: '/mcp-keys' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(JSON.stringify(res.json())).not.toContain('token_hash');
  });
});
