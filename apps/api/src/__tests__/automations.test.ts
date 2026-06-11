import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, TEST_USER, authInject, id } from './helpers.js';

vi.mock('../lib/redis.js', () => ({ redis: { incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn() } }));
vi.mock('../lib/queue.js', () => ({
  emailQueue: { add: vi.fn() },
  automationQueue: { add: vi.fn().mockResolvedValue({ id: 'job-auto-1' }) },
}));
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
import automationsRoutes from '../routes/resources/automations.js';

let app: Awaited<ReturnType<typeof buildTestApp>>;

const makeAutomation = (overrides: Record<string, unknown> = {}) => ({
  id: id(1),
  name: 'Bienvenue nouvel abonné',
  trigger_type: 'tag_added',
  trigger_config: { tagId: id(10) },
  is_active: false,
  steps: [],
  contact_count: 0,
  created_at: new Date().toISOString(),
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildTestApp(automationsRoutes);
});

describe('GET /automations', () => {
  it('returns list of automations', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation(), makeAutomation({ id: id(2), name: 'Suivi achat' })])
      .mockResolvedValueOnce([{ count: '2' }]);

    const res = await authInject(app, { method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });
});

describe('POST /automations', () => {
  it('creates automation as inactive by default', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeAutomation()]);

    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: {
        name: 'Bienvenue',
        triggerType: 'tag_added',
        triggerConfig: { tagId: id(10) },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().is_active).toBe(false);
  });

  it('accepts valid trigger types', async () => {
    const validTriggers = [
      'tag_added', 'tag_removed', 'contact_created', 'form_submitted',
      'purchase_completed', 'subscription_started', 'subscription_cancelled',
    ];

    for (const trigger of validTriggers) {
      vi.mocked(dbModule.sql).mockResolvedValueOnce([makeAutomation({ trigger_type: trigger })]);
      const res = await authInject(app, {
        method: 'POST', url: '/',
        payload: { name: `Auto ${trigger}`, triggerType: trigger, triggerConfig: {} },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('rejects unknown trigger type', async () => {
    const res = await authInject(app, {
      method: 'POST', url: '/',
      payload: { name: 'Bad', triggerType: 'magic_spell', triggerConfig: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /automations/:id', () => {
  it('returns automation with steps', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation()])
      .mockResolvedValueOnce([
        { id: id(100), step_type: 'send_email', position: 1, config: { templateId: id(20) } },
        { id: id(101), step_type: 'wait', position: 2, config: { days: 3 } },
      ]);

    const res = await authInject(app, { method: 'GET', url: `/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps).toHaveLength(2);
    expect(res.json().steps[0].step_type).toBe('send_email');
  });

  it('returns 404 for unknown automation', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([]);
    const res = await authInject(app, { method: 'GET', url: `/${id(99)}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /automations/:id/activate', () => {
  it('activates automation', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation({ is_active: false })])
      .mockResolvedValueOnce([makeAutomation({ is_active: true })]);

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/activate` });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_active).toBe(true);
  });

  it('returns 400 when already active', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeAutomation({ is_active: true })]);

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/activate` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('already_active');
  });
});

describe('POST /automations/:id/deactivate', () => {
  it('deactivates automation', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation({ is_active: true })])
      .mockResolvedValueOnce([makeAutomation({ is_active: false })]);

    const res = await authInject(app, { method: 'POST', url: `/${id(1)}/deactivate` });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_active).toBe(false);
  });
});

describe('PUT /automations/:id/steps', () => {
  it('replaces all steps', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation()]) // find
      .mockResolvedValueOnce([]) // delete old steps
      .mockResolvedValueOnce([]); // insert new steps

    const steps = [
      { stepType: 'send_email', position: 1, config: { templateId: id(20) } },
      { stepType: 'wait', position: 2, config: { days: 2 } },
      { stepType: 'add_tag', position: 3, config: { tagId: id(30) } },
    ];

    const res = await authInject(app, {
      method: 'PUT', url: `/${id(1)}/steps`,
      payload: { steps },
    });
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(dbModule.sql)).toHaveBeenCalled();
  });

  it('rejects unknown step types', async () => {
    vi.mocked(dbModule.sql).mockResolvedValueOnce([makeAutomation()]);

    const res = await authInject(app, {
      method: 'PUT', url: `/${id(1)}/steps`,
      payload: { steps: [{ stepType: 'teleport', position: 1, config: {} }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /automations/:id/trigger-test', () => {
  it('manually triggers automation for a specific contact', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation({ is_active: true })])
      .mockResolvedValueOnce([{ id: id(5), email: 'contact@test.com' }]);

    const automationQueue = (await import('../lib/queue.js')).automationQueue;

    const res = await authInject(app, {
      method: 'POST', url: `/${id(1)}/trigger-test`,
      payload: { contactId: id(5) },
    });
    expect(res.statusCode).toBe(202);
    expect(vi.mocked(automationQueue.add)).toHaveBeenCalled();
  });

  it('returns 404 when contact does not exist', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([makeAutomation({ is_active: true })])
      .mockResolvedValueOnce([]); // contact not found

    const res = await authInject(app, {
      method: 'POST', url: `/${id(1)}/trigger-test`,
      payload: { contactId: id(99) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /automations/:id', () => {
  it('deletes automation and its steps', async () => {
    vi.mocked(dbModule.sql)
      .mockResolvedValueOnce([]) // delete steps
      .mockResolvedValueOnce([]); // delete automation

    const res = await authInject(app, { method: 'DELETE', url: `/${id(1)}` });
    expect(res.statusCode).toBe(204);
  });
});
