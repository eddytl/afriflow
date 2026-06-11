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

// Mock global fetch for delivery tests
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import * as dbModule from '../lib/db.js';
import webhooksRoutes from '../routes/settings/webhooks.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

const VALID_EVENTS = [
  'contact_created', 'tag_added', 'tag_removed', 'opt_in',
  'new_sale', 'sale_cancelled', 'subscription_created',
  'subscription_cancelled', 'order_paid', 'order_refunded',
];

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  app = await buildTestApp(webhooksRoutes);
});

describe('GET /webhooks', () => {
  it('returns list of webhooks', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([
      { id: id(1), name: 'Slack notif', url: 'https://hooks.slack.com/x', is_active: true, events: ['new_sale'] },
    ]);

    const res = await authInject(app, { method: 'GET', url: '/webhooks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('POST /webhooks — event validation', () => {
  it('accepts all valid event types', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(1), name: 'All Events', url: 'https://my-app.com/webhook',
      is_active: true, events: VALID_EVENTS,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: '/webhooks',
      payload: { name: 'All Events', url: 'https://my-app.com/webhook', events: VALID_EVENTS },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects unknown event type', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/webhooks',
      payload: { name: 'Bad', url: 'https://my-app.com/webhook', events: ['invalid_event'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_events');
  });

  it('rejects empty events array', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/webhooks',
      payload: { name: 'Empty', url: 'https://my-app.com/webhook', events: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires HTTPS url', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/webhooks',
      payload: { name: 'Insecure', url: 'http://my-app.com/webhook', events: ['new_sale'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('https_required');
  });

  it('rejects invalid URL format', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/webhooks',
      payload: { name: 'Bad URL', url: 'not-a-url', events: ['new_sale'] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /webhooks/:id/test', () => {
  it('sends test payload and records delivery', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{
        id: id(1), url: 'https://my-app.com/webhook', secret: 'mysecret',
        is_active: true, events: ['new_sale'],
      }])
      .mockResolvedValueOnce([{ id: id(50) }]) // insert delivery log
      .mockResolvedValueOnce([]); // update webhook delivery count

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'OK',
    });

    const res = await authInject(app, { method: 'POST', url: `/webhooks/${id(1)}/test` });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-app.com/webhook',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('records failed delivery when endpoint returns 5xx', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), url: 'https://my-app.com/webhook', secret: null, is_active: true, events: ['new_sale'] }])
      .mockResolvedValueOnce([{ id: id(50) }])
      .mockResolvedValueOnce([]);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const res = await authInject(app, { method: 'POST', url: `/webhooks/${id(1)}/test` });
    // Should return 502 or similar to indicate the remote endpoint failed
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /webhooks/deliveries/:deliveryId/retry', () => {
  it('retries a failed delivery', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{
        id: id(50), webhook_id: id(1), payload: { event: 'new_sale' },
        status: 'failed', attempt_count: 1,
      }]) // find delivery
      .mockResolvedValueOnce([{
        id: id(1), url: 'https://my-app.com/webhook', secret: null, is_active: true,
      }]) // find webhook
      .mockResolvedValueOnce([]); // update delivery status

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'OK' });

    const res = await authInject(app, {
      method: 'POST', url: `/webhooks/deliveries/${id(50)}/retry`,
    });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns 400 when retrying a delivered delivery', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      id: id(50), status: 'delivered', attempt_count: 1,
    }]);

    const res = await authInject(app, {
      method: 'POST', url: `/webhooks/deliveries/${id(50)}/retry`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('already_delivered');
  });
});

describe('PATCH /webhooks/:id', () => {
  it('toggles is_active', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), is_active: true }])
      .mockResolvedValueOnce([{ id: id(1), is_active: false }]);

    const res = await authInject(app, {
      method: 'PATCH', url: `/webhooks/${id(1)}`,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_active).toBe(false);
  });
});

describe('DELETE /webhooks/:id', () => {
  it('deletes webhook and delivery logs', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([]) // delete deliveries
      .mockResolvedValueOnce([]); // delete webhook

    const res = await authInject(app, { method: 'DELETE', url: `/webhooks/${id(1)}` });
    expect(res.statusCode).toBe(204);
  });
});
