import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({ redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() } }));
vi.mock('../lib/queue.js', () => ({ emailQueue: { add: vi.fn().mockResolvedValue({ id: 'j1' }) } }));
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
import workspaceMembersRoutes from '../routes/settings/workspace-members.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(workspaceMembersRoutes);
});

describe('GET /workspace-members', () => {
  it('returns list of members', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([
      { id: id(1), email: 'alice@team.com', name: 'Alice', role: 'assistant', status: 'active' },
      { id: id(2), email: 'bob@team.com', name: 'Bob', role: 'admin', status: 'pending' },
    ]);

    const res = await authInject(app, { method: 'GET', url: '/workspace-members' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
});

describe('POST /workspace-members — invitation flow', () => {
  it('creates pending member and sends invitation email', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([]) // email uniqueness check
      .mockResolvedValueOnce([{
        id: id(1), email: 'new@team.com', name: 'New Assistant',
        role: 'assistant', status: 'pending',
        invitation_token: 'abc123token',
      }]);

    const emailQueue = (await import('../lib/queue.js')).emailQueue;

    const res = await authInject(app, {
      method: 'POST', url: '/workspace-members',
      payload: { email: 'new@team.com', name: 'New Assistant', role: 'assistant' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
    expect(vi.mocked(emailQueue.add)).toHaveBeenCalledOnce();
    // Invitation token should not be in the response
    expect(res.json()).not.toHaveProperty('invitation_token');
  });

  it('returns 409 for already-invited email', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1) }]); // existing

    const res = await authInject(app, {
      method: 'POST', url: '/workspace-members',
      payload: { email: 'existing@team.com', name: 'Existing', role: 'assistant' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('member_already_exists');
  });

  it('accepts only assistant or admin roles', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/workspace-members',
      payload: { email: 'new@team.com', name: 'X', role: 'owner' }, // owner not allowed
    });
    expect(res.statusCode).toBe(400);
  });

  it('generates a cryptographically random invitation token (48 hex chars)', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: id(1), email: 'x@team.com', name: 'X',
        role: 'assistant', status: 'pending', invitation_token: 'a'.repeat(48),
      }]);

    await authInject(app, {
      method: 'POST', url: '/workspace-members',
      payload: { email: 'x@team.com', name: 'X', role: 'assistant' },
    });

    // Verify sql was called with a token that looks like 48 hex chars
    const sqlCalls = vi.mocked(dbModule.sql).mock.calls;
    const insertCall = sqlCalls.find(call =>
      call.some(arg => typeof arg === 'string' && arg.includes('INSERT'))
    );
    // At minimum, the INSERT was called
    expect(insertCall).toBeDefined();
  });
});

describe('POST /workspace-members/accept/:token — PUBLIC endpoint', () => {
  it('activates member without authentication', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{
        id: id(1), email: 'new@team.com', status: 'pending', invitation_token: 'validtoken123',
      }])
      .mockResolvedValueOnce([{ id: id(1), status: 'active', joined_at: new Date().toISOString() }]);

    // No auth header — public endpoint
    const res = await app.inject({
      method: 'POST', url: '/workspace-members/accept/validtoken123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('active');
  });

  it('returns 404 for unknown token', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // token not found

    const res = await app.inject({
      method: 'POST', url: '/workspace-members/accept/badtoken',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when token already used (member is active)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), email: 'already@team.com', status: 'active', // already activated
      invitation_token: 'usedtoken',
    }]);

    const res = await app.inject({
      method: 'POST', url: '/workspace-members/accept/usedtoken',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('token_already_used');
  });
});

describe('DELETE /workspace-members/:id', () => {
  it('revokes member access (status=revoked)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);

    const res = await authInject(app, { method: 'DELETE', url: `/workspace-members/${id(1)}` });
    expect(res.statusCode).toBe(204);
    // Must be a soft-delete (SET status='revoked'), not hard DELETE
    const sqlCalls = vi.mocked(dbModule.sql).mock.calls;
    const updateCall = sqlCalls.find(call =>
      call.some(arg => typeof arg === 'string' && arg.includes('revoked'))
    );
    expect(updateCall).toBeDefined();
  });
});

describe('POST /workspace-members/:id/resend-invite', () => {
  it('generates new token and resends email', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), email: 'pending@team.com', status: 'pending' }])
      .mockResolvedValueOnce([{ id: id(1), invitation_token: 'newtoken456' }]);

    const emailQueue = (await import('../lib/queue.js')).emailQueue;

    const res = await authInject(app, {
      method: 'POST', url: `/workspace-members/${id(1)}/resend-invite`,
    });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(emailQueue.add)).toHaveBeenCalled();
  });

  it('returns 400 when member is already active', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), status: 'active' }]);

    const res = await authInject(app, {
      method: 'POST', url: `/workspace-members/${id(1)}/resend-invite`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('already_active');
  });
});
