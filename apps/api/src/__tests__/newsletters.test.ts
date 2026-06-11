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
import newslettersRoutes from '../routes/resources/newsletters.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(newslettersRoutes);
});

const makeCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  name: 'Newsletter Juin',
  subject: 'Nouveautés juin',
  status: 'draft',
  sent_count: 0,
  open_count: 0,
  click_count: 0,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('GET /newsletters', () => {
  it('returns list of campaigns', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeCampaign(), makeCampaign({ id: id(2), name: 'Promo Été', status: 'sent' })])
      .mockResolvedValueOnce([{ count: '2' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });
});

describe('POST /newsletters', () => {
  it('creates draft campaign', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeCampaign()]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        name: 'Newsletter Juin',
        subject: 'Nouveautés juin',
        htmlBody: '<h1>Bonjour</h1>',
        fromName: 'AfriFlow',
        fromEmail: 'noreply@afriflow.app',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('draft');
  });

  it('returns 400 for missing subject', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Test', htmlBody: '<p>Hi</p>' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /newsletters/:id — immutability of sent campaigns', () => {
  it('allows editing a draft campaign', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeCampaign({ status: 'draft' })])
      .mockResolvedValueOnce([makeCampaign({ subject: 'Nouveau sujet' })]);

    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}`,
      payload: { subject: 'Nouveau sujet' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('prevents editing a sent campaign', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeCampaign({ status: 'sent' })]);

    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}`,
      payload: { subject: 'Tentative de modif' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot_edit_sent_campaign');
  });

  it('prevents editing a campaign being sent (sending status)', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeCampaign({ status: 'sending' })]);

    const res = await authInject(app, {
      method: 'PATCH', url: `/${id(1)}`,
      payload: { subject: 'Tentative' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /newsletters/:id/send', () => {
  it('enqueues send job for draft campaign', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeCampaign()]) // find campaign
      .mockResolvedValueOnce([{ count: '150' }]) // recipient count
      .mockResolvedValueOnce([]); // update status to 'sending'

    const emailQueue = (await import('../lib/queue.js')).emailQueue;

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/send` });
    expect(res.statusCode).toBe(202);
    expect(vi.mocked(emailQueue.add)).toHaveBeenCalled();
    expect(res.json()).toHaveProperty('jobId');
  });

  it('prevents sending an already-sent campaign', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeCampaign({ status: 'sent' })]);

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/send` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('already_sent');
  });
});

describe('POST /newsletters/:id/duplicate', () => {
  it('creates a draft copy of any campaign', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeCampaign({ status: 'sent', name: 'Original' })])
      .mockResolvedValueOnce([makeCampaign({ id: id(2), name: 'Copie de Original', status: 'draft' })]);

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/duplicate` });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('draft');
    expect(res.json().name).toContain('Copie');
  });
});

describe('GET /newsletters/:id/stats', () => {
  it('returns open rate and click rate', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeCampaign({ status: 'sent', sent_count: 100, open_count: 45, click_count: 12 })])
      .mockResolvedValueOnce([{ unsubscribed: '3' }]);

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}/stats` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openRate).toBe(45);
    expect(body.clickRate).toBe(12);
    expect(body.unsubscribedCount).toBe(3);
  });
});
