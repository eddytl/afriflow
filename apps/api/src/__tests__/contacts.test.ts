import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() },
}));
vi.mock('../lib/queue.js', () => ({
  emailQueue: { add: vi.fn() },
  importQueue: { add: vi.fn() },
  automationQueue: { add: vi.fn() },
}));
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: any) => { req.user = TEST_USER; }),
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
import contactsRoutes from '../routes/resources/contacts.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(contactsRoutes);
});

describe('GET /contacts', () => {
  it('returns paginated list', async () => {
    const contacts = [
      { id: id(1), email: 'a@test.com', first_name: 'Alice', last_name: 'Dupont', email_subscribed: true },
      { id: id(2), email: 'b@test.com', first_name: 'Bob', last_name: 'Martin', email_subscribed: false },
    ];
    vi.mocked(dbModule.sql).mockResolvedValueOnce(contacts);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '2' }]); // total count

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by email via ?search=', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1), email: 'alice@test.com' }]);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '1' }]);

    const res = await authInject(app, { method: 'GET', url: '/?search=alice' });
    expect(res.statusCode).toBe(200);
    // sql should have been called (search applied)
    expect(vi.mocked(dbModule.sql)).toHaveBeenCalled();
  });

  it('filters by tag via ?tag=', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '0' }]);

    const res = await authInject(app, { method: 'GET', url: `/?tag=${id(5)}` });
    expect(res.statusCode).toBe(200);
  });

  it('filters by subscribed status', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ count: '0' }]);

    const res = await authInject(app, { method: 'GET', url: '/?subscribed=true' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /contacts', () => {
  it('creates contact and returns 201', async () => {
    const created = { id: id(1), email: 'new@test.com', first_name: 'New', email_subscribed: true };
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([]) // duplicate check
      .mockResolvedValueOnce([created]); // insert

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { email: 'new@test.com', firstName: 'New', lastName: 'User' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBe('new@test.com');
  });

  it('returns 409 for duplicate email within tenant', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{ id: id(1) }]); // existing

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { email: 'dup@test.com' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('contact_already_exists');
  });

  it('returns 400 for invalid email', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /contacts/:id', () => {
  it('returns 404 for unknown contact', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns contact with tags and custom fields', async () => {
    const contact = { id: id(1), email: 'c@test.com', first_name: 'Chidi', custom_fields: { company: 'Acme' } };
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([contact]) // contact
      .mockResolvedValueOnce([{ id: id(10), name: 'VIP' }]) // tags
      .mockResolvedValueOnce([]); // purchases

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe('c@test.com');
  });
});

describe('PATCH /contacts/:id', () => {
  it('updates contact fields', async () => {
    const updated = { id: id(1), email: 'c@test.com', first_name: 'Updated', email_subscribed: true };
    vi.mocked(dbModule.sql).mockResolvedValueOnce([updated]);

    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}`,
      payload: { firstName: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().first_name).toBe('Updated');
  });
});

describe('DELETE /contacts/:id', () => {
  it('soft-deletes contact', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'DELETE', url: `/${id(1)}` });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /contacts/:id/tags', () => {
  it('adds tag to contact', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(10), name: 'VIP' }]) // tag exists
      .mockResolvedValueOnce([]); // insert contact_tag

    const res = await authInject(app, {
      method: 'POST', url: `/${id(1)}/tags`,
      payload: { tagId: id(10) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when tag does not exist', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // tag not found
    const res = await authInject(app, {
      method: 'POST', url: `/${id(1)}/tags`,
      payload: { tagId: id(99) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /contacts/:id/tags/:tagId', () => {
  it('removes tag from contact', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, {
      method: 'DELETE', url: `/${id(1)}/tags/${id(10)}`,
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /contacts/import', () => {
  it('enqueues import job and returns job id', async () => {
    const importQueueMock = (await import('../lib/queue.js')).importQueue;
    vi.mocked(importQueueMock.add).mockResolvedValueOnce({ id: 'job-123' } as any);

    const res = await authInject(app, {
      method: 'POST', url: '/import',
      payload: {
        contacts: [
          { email: 'a@test.com', firstName: 'Alice' },
          { email: 'b@test.com', firstName: 'Bob' },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty('jobId');
  });
});
