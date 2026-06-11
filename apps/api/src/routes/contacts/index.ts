import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, withTenant } from '../../lib/db.js';
import { importQueue } from '../../lib/queue.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const createContactSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  country: z.string().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function contactRoutes(app: FastifyInstance) {
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      page?: string; limit?: string;
      search?: string;
      email?: string; email_op?: string;
      first_name?: string; first_name_op?: string;
      last_name?: string; last_name_op?: string;
      country?: string; country_op?: string;
      tag?: string; tag_op?: string;
      status?: string;
    };

    const limit  = Math.min(Number(q.limit ?? 50), 200);
    const page   = Math.max(1, Number(q.page ?? 1));
    const offset = (page - 1) * limit;

    const search    = q.search?.trim()     || null;
    const email     = q.email?.trim()      || null;
    const emailOp   = q.email_op           || 'contains';
    const firstName = q.first_name?.trim() || null;
    const fnOp      = q.first_name_op      || 'contains';
    const lastName  = q.last_name?.trim()  || null;
    const lnOp      = q.last_name_op       || 'contains';
    const country   = q.country?.trim()    || null;
    const countryOp = q.country_op         || 'contains';
    const tag       = q.tag?.trim()        || null;
    const tagOp     = q.tag_op             || 'in';
    const status    = q.status?.trim()     || null;

    const rows = await sql`
      SELECT *, COUNT(*) OVER() AS _total FROM contacts
      WHERE
        (${search}::text IS NULL OR (
          email      ILIKE ${'%' + (search ?? '') + '%'}
          OR first_name ILIKE ${'%' + (search ?? '') + '%'}
          OR last_name  ILIKE ${'%' + (search ?? '') + '%'}
        ))
        AND (${email}::text IS NULL OR (
          (${emailOp} = 'contains'     AND email ILIKE ${'%' + (email ?? '') + '%'})
          OR (${emailOp} = 'not_contains' AND email NOT ILIKE ${'%' + (email ?? '') + '%'})
          OR (${emailOp} = 'exact'        AND email = ${email ?? ''})
          OR (${emailOp} = 'not_exact'    AND (email != ${email ?? ''} OR email IS NULL))
          OR (${emailOp} = 'starts_with'  AND email ILIKE ${(email ?? '') + '%'})
          OR (${emailOp} = 'ends_with'    AND email ILIKE ${'%' + (email ?? '')})
        ))
        AND (${firstName}::text IS NULL OR (
          (${fnOp} = 'contains'     AND first_name ILIKE ${'%' + (firstName ?? '') + '%'})
          OR (${fnOp} = 'not_contains' AND first_name NOT ILIKE ${'%' + (firstName ?? '') + '%'})
          OR (${fnOp} = 'exact'        AND first_name = ${firstName ?? ''})
          OR (${fnOp} = 'not_exact'    AND (first_name != ${firstName ?? ''} OR first_name IS NULL))
          OR (${fnOp} = 'starts_with'  AND first_name ILIKE ${(firstName ?? '') + '%'})
          OR (${fnOp} = 'ends_with'    AND first_name ILIKE ${'%' + (firstName ?? '')})
        ))
        AND (${lastName}::text IS NULL OR (
          (${lnOp} = 'contains'     AND last_name ILIKE ${'%' + (lastName ?? '') + '%'})
          OR (${lnOp} = 'not_contains' AND last_name NOT ILIKE ${'%' + (lastName ?? '') + '%'})
          OR (${lnOp} = 'exact'        AND last_name = ${lastName ?? ''})
          OR (${lnOp} = 'not_exact'    AND (last_name != ${lastName ?? ''} OR last_name IS NULL))
          OR (${lnOp} = 'starts_with'  AND last_name ILIKE ${(lastName ?? '') + '%'})
          OR (${lnOp} = 'ends_with'    AND last_name ILIKE ${'%' + (lastName ?? '')})
        ))
        AND (${country}::text IS NULL OR (
          (${countryOp} = 'contains'     AND country ILIKE ${'%' + (country ?? '') + '%'})
          OR (${countryOp} = 'not_contains' AND country NOT ILIKE ${'%' + (country ?? '') + '%'})
          OR (${countryOp} = 'exact'        AND country = ${country ?? ''})
          OR (${countryOp} = 'not_exact'    AND (country != ${country ?? ''} OR country IS NULL))
          OR (${countryOp} = 'starts_with'  AND country ILIKE ${(country ?? '') + '%'})
          OR (${countryOp} = 'ends_with'    AND country ILIKE ${'%' + (country ?? '')})
        ))
        AND (${tag}::text IS NULL OR (
          (${tagOp} != 'not_in' AND ${tag ?? ''} = ANY(tags))
          OR (${tagOp} = 'not_in' AND NOT (${tag ?? ''} = ANY(tags)))
        ))
        AND (${status}::text IS NULL OR (
          (${status} = 'active'       AND unsubscribed = false AND bounced = false)
          OR (${status} = 'unsubscribed' AND unsubscribed = true)
          OR (${status} = 'bounced'      AND bounced = true)
        ))
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = Number((rows[0] as Record<string, unknown>)?._total ?? 0);
    const data  = rows.map(({ _total: _t, ...r }: Record<string, unknown>) => r);
    return { data, total, page, limit };
  });

  app.post('/', hooks, async (request, reply) => {
    const { tenantId } = request.user as { tenantId: string };
    const body = createContactSchema.parse(request.body);
    const row = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== ''));
    if (!Object.keys(row).length) return reply.status(400).send({ error: 'empty_contact' });
    const contact = await withTenant(tenantId, (tx) => tx`INSERT INTO contacts ${tx(row)} RETURNING *`
      .then(([c]) => c));
    return reply.status(201).send(contact);
  });

  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [contact] = await sql`SELECT * FROM contacts WHERE id = ${id}`;
    if (!contact) return reply.status(404).send({ error: 'not_found' });

    const recentEvents = await sql`
      SELECT type, payload, created_at FROM events
      WHERE contact_id = ${id}
      ORDER BY created_at DESC
      LIMIT 20
    `;
    return { ...contact, recentEvents };
  });

  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user as { tenantId: string };
    const body = createContactSchema.partial().parse(request.body);
    const cols = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (!Object.keys(cols).length) return reply.status(400).send({ error: 'no_fields' });
    const updated = await withTenant(tenantId, (tx) =>
      tx`UPDATE contacts SET ${tx(cols)} WHERE id = ${id} RETURNING *`.then(([r]) => r));
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user as { tenantId: string };
    await withTenant(tenantId, (tx) => tx`DELETE FROM contacts WHERE id = ${id}`);
    return reply.status(204).send();
  });

  app.post('/import', hooks, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'no_file' });

    const buffer = await file.toBuffer();
    const tenantId = (request.user as { tenantId: string }).tenantId;

    const job = await importQueue.add('csv-import', {
      csv: buffer.toString('utf8'),
      tenantId,
    });

    return reply.status(202).send({ jobId: job.id, message: 'Import en cours...' });
  });

  app.post('/:id/tags', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tags } = request.body as { tags: string[] };

    const [updated] = await sql`
      UPDATE contacts
      SET tags = array(SELECT DISTINCT unnest(array_cat(tags, ${tags}::text[])))
      WHERE id = ${id}
      RETURNING *
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });
}
