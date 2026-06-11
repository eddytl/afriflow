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
import trackingRoutes from '../routes/tracking/index.js';
import emailStatsRoutes from '../routes/analytics/email-statistics.js';

// ── Tracking pixel + link tracking ───────────────────────────────

describe('Email tracking — pixel', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(trackingRoutes);
  });

  it('GET /t/open/:token returns 1×1 transparent GIF', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), contact_id: id(5), campaign_id: id(10) }]) // token lookup
      .mockResolvedValueOnce([]); // insert open event

    const res = await app.inject({ method: 'GET', url: `/open/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    // 1×1 transparent GIF is 35 bytes
    expect(res.rawPayload.length).toBe(35);
    // Must set cache-control to prevent caching (each open = unique event)
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('GET /t/open/:token still returns GIF even for unknown token', async () => {
    // Should never 404 — would break email display
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // token not found

    const res = await app.inject({ method: 'GET', url: `/open/unknown-token` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
  });

  it('GET /t/click/:token redirects to target URL', async () => {
    const targetUrl = 'https://afriflow.app/cours-python';
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(1), url: targetUrl, contact_id: id(5), campaign_id: id(10) }])
      .mockResolvedValueOnce([]); // insert click event

    const res = await app.inject({ method: 'GET', url: `/click/${id(1)}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(targetUrl);
  });

  it('GET /t/click/:token returns 404 for unknown token', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // not found

    const res = await app.inject({ method: 'GET', url: `/click/bad-token` });
    expect(res.statusCode).toBe(404);
  });
});

describe('Email tracking — unsubscribe', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(trackingRoutes);
  });

  it('GET /t/unsubscribe/:token sets email_subscribed=false', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ id: id(5), email: 'user@test.com', campaign_id: id(10) }]) // token lookup
      .mockResolvedValueOnce([]); // UPDATE contacts SET email_subscribed=false

    const res = await app.inject({ method: 'GET', url: `/unsubscribe/${id(1)}` });
    expect(res.statusCode).toBe(200);
    // Should confirm unsubscription — HTML page or JSON
    expect(res.statusCode).not.toBe(500);
    // Verify UPDATE was called
    const sqlCalls = vi.mocked(dbModule.sql).mock.calls;
    const updateCall = sqlCalls.find(call =>
      call.some(arg => typeof arg === 'string' && arg.includes('email_subscribed'))
    );
    expect(updateCall).toBeDefined();
  });

  it('GET /t/unsubscribe/:token with unknown token returns 404', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]); // token not found

    const res = await app.inject({ method: 'GET', url: '/unsubscribe/bad-token' });
    expect(res.statusCode).toBe(404);
  });
});

// ── Email statistics dashboard ────────────────────────────────────

describe('GET /email-statistics', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(emailStatsRoutes);
  });

  it('returns aggregate open rate and click rate', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      total_sent: '500',
      total_opens: '200',
      total_clicks: '75',
      total_unsubscribes: '10',
      bounces: '5',
    }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalSent).toBe(500);
    expect(body.openRate).toBeCloseTo(40, 0);    // 200/500 * 100 = 40%
    expect(body.clickRate).toBeCloseTo(15, 0);   // 75/500 * 100 = 15%
  });

  it('handles zero sent (no division by zero)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([{
      total_sent: '0', total_opens: '0', total_clicks: '0',
      total_unsubscribes: '0', bounces: '0',
    }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openRate).toBe(0);
    expect(body.clickRate).toBe(0);
  });

  it('returns per-campaign breakdown', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([{ total_sent: '100', total_opens: '40', total_clicks: '10', total_unsubscribes: '2', bounces: '1' }])
      .mockResolvedValueOnce([
        { campaign_id: id(1), name: 'Campagne A', sent_count: 60, open_count: 24, click_count: 6 },
        { campaign_id: id(2), name: 'Campagne B', sent_count: 40, open_count: 16, click_count: 4 },
      ]);

    const res = await authInject(app, { method: 'GET', url: '/?breakdown=true' });
    expect(res.statusCode).toBe(200);
    expect(res.json().campaigns).toHaveLength(2);
  });
});
