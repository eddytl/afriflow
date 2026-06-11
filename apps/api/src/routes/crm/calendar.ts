import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const availabilitySchema = z.array(z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/),
}));

const eventSchema = z.object({
  name:               z.string().min(1),
  slug:               z.string().min(1).regex(/^[a-z0-9-]+$/),
  hostName:           z.string().min(1),
  hostEmail:          z.string().email(),
  type:               z.enum(['individual', 'group']).optional(),
  durationMinutes:    z.number().int().min(5).optional(),
  locationType:       z.enum(['video', 'phone', 'in_person']).optional(),
  locationDetails:    z.string().optional(),
  description:        z.string().optional(),
  maxParticipants:    z.number().int().min(1).optional(),
  minNoticeHours:     z.number().int().min(0).optional(),
  cancelNoticeHours:  z.number().int().min(0).optional(),
  availabilityFrom:   z.string().optional(),
  availabilityTo:     z.string().optional(),
  slotFrequencyMin:   z.number().int().optional(),
  dailyLimit:         z.number().int().optional(),
  bufferBeforeMin:    z.number().int().optional(),
  bufferAfterMin:     z.number().int().optional(),
  detectTimezone:     z.boolean().optional(),
  availability:       availabilitySchema.optional(),
});

const bookingSchema = z.object({
  inviteeName:  z.string().min(1),
  inviteeEmail: z.string().email(),
  startAt:      z.string().datetime(),
  notes:        z.string().optional(),
  timezone:     z.string().optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function calendarRoutes(app: FastifyInstance) {
  // ── Événements ───────────────────────────────────────────
  app.get('/events', hooks, async (request) => {
    const q = request.query as { type?: string; active?: string };
    return sql`
      SELECT e.*,
             COUNT(b.id) as booking_count
      FROM calendar_events e
      LEFT JOIN calendar_bookings b ON b.event_id = e.id AND b.status = 'confirmed'
      WHERE (${q.type ?? null} IS NULL OR e.type = ${q.type ?? null})
        AND (${q.active ?? null} IS NULL OR e.is_active = ${q.active === 'true'})
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `;
  });

  app.post('/events', hooks, async (request, reply) => {
    const body = eventSchema.parse(request.body);
    const { availability, ...eventData } = body;

    const cols: Record<string, unknown> = {
      name:               eventData.name,
      slug:               eventData.slug,
      host_name:          eventData.hostName,
      host_email:         eventData.hostEmail,
      type:               eventData.type ?? 'individual',
      duration_minutes:   eventData.durationMinutes ?? 30,
      location_type:      eventData.locationType ?? 'video',
      location_details:   eventData.locationDetails ?? null,
      description:        eventData.description ?? null,
      max_participants:   eventData.maxParticipants ?? 1,
      min_notice_hours:   eventData.minNoticeHours ?? 2,
      cancel_notice_hours: eventData.cancelNoticeHours ?? 0,
      availability_from:  eventData.availabilityFrom ?? null,
      availability_to:    eventData.availabilityTo ?? null,
      slot_frequency_min: eventData.slotFrequencyMin ?? 30,
      daily_limit:        eventData.dailyLimit ?? null,
      buffer_before_min:  eventData.bufferBeforeMin ?? 0,
      buffer_after_min:   eventData.bufferAfterMin ?? 0,
      detect_timezone:    eventData.detectTimezone ?? true,
    };

    const [event] = await sql`INSERT INTO calendar_events ${sql(cols)} RETURNING *`;

    if (availability?.length) {
      for (const slot of availability) {
        await sql`
          INSERT INTO calendar_availability (event_id, day_of_week, start_time, end_time)
          VALUES (${event.id}, ${slot.dayOfWeek}, ${slot.startTime}, ${slot.endTime})
        `;
      }
    }

    const slots = await sql`SELECT * FROM calendar_availability WHERE event_id = ${event.id} ORDER BY day_of_week`;
    return reply.status(201).send({ ...event, availability: slots });
  });

  app.get('/events/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [event] = await sql`SELECT * FROM calendar_events WHERE id = ${id}`;
    if (!event) return reply.status(404).send({ error: 'not_found' });
    const availability = await sql`SELECT * FROM calendar_availability WHERE event_id = ${id} ORDER BY day_of_week`;
    return { ...event, availability };
  });

  app.patch('/events/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = eventSchema.partial().parse(request.body);
    const { availability, ...rest } = body;

    if (Object.keys(rest).length) {
      const cols: Record<string, unknown> = {};
      if (rest.name !== undefined)              cols.name               = rest.name;
      if (rest.hostName !== undefined)          cols.host_name          = rest.hostName;
      if (rest.hostEmail !== undefined)         cols.host_email         = rest.hostEmail;
      if (rest.durationMinutes !== undefined)   cols.duration_minutes   = rest.durationMinutes;
      if (rest.locationType !== undefined)      cols.location_type      = rest.locationType;
      if (rest.locationDetails !== undefined)   cols.location_details   = rest.locationDetails;
      if (rest.description !== undefined)       cols.description        = rest.description;
      if (rest.maxParticipants !== undefined)   cols.max_participants   = rest.maxParticipants;
      if (rest.minNoticeHours !== undefined)    cols.min_notice_hours   = rest.minNoticeHours;
      if (rest.cancelNoticeHours !== undefined) cols.cancel_notice_hours = rest.cancelNoticeHours;
      if (rest.availabilityFrom !== undefined)  cols.availability_from  = rest.availabilityFrom;
      if (rest.availabilityTo !== undefined)    cols.availability_to    = rest.availabilityTo;
      if (rest.slotFrequencyMin !== undefined)  cols.slot_frequency_min = rest.slotFrequencyMin;
      if (rest.dailyLimit !== undefined)        cols.daily_limit        = rest.dailyLimit;
      if (rest.detectTimezone !== undefined)    cols.detect_timezone    = rest.detectTimezone;

      await sql`UPDATE calendar_events SET ${sql(cols)} WHERE id = ${id}`;
    }

    if (availability) {
      await sql`DELETE FROM calendar_availability WHERE event_id = ${id}`;
      for (const slot of availability) {
        await sql`
          INSERT INTO calendar_availability (event_id, day_of_week, start_time, end_time)
          VALUES (${id}, ${slot.dayOfWeek}, ${slot.startTime}, ${slot.endTime})
        `;
      }
    }

    const [event] = await sql`SELECT * FROM calendar_events WHERE id = ${id}`;
    if (!event) return reply.status(404).send({ error: 'not_found' });
    const slots = await sql`SELECT * FROM calendar_availability WHERE event_id = ${id} ORDER BY day_of_week`;
    return { ...event, availability: slots };
  });

  app.delete('/events/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM calendar_events WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // Toggle actif/inactif
  app.post('/events/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [event] = await sql`
      UPDATE calendar_events SET is_active = NOT is_active WHERE id = ${id} RETURNING is_active
    `;
    if (!event) return reply.status(404).send({ error: 'not_found' });
    return { isActive: event.is_active };
  });

  // ── Créneaux disponibles (pour affichage au visiteur) ────
  app.get('/events/:id/slots', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date: dateStr, timezone = 'Africa/Dakar' } = request.query as { date?: string; timezone?: string };

    const [event] = await sql`SELECT * FROM calendar_events WHERE id = ${id} AND is_active = true`;
    if (!event) return reply.status(404).send({ error: 'not_found' });

    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const dayOfWeek = targetDate.getDay();

    const availability = await sql<{ start_time: string; end_time: string }[]>`
      SELECT start_time, end_time FROM calendar_availability
      WHERE event_id = ${id} AND day_of_week = ${dayOfWeek}
    `;

    if (!availability.length) return { slots: [] };

    // Vérifier réservations existantes
    const dateStart = new Date(targetDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(targetDate);
    dateEnd.setHours(23, 59, 59, 999);

    const booked = await sql<{ start_at: string; end_at: string }[]>`
      SELECT start_at, end_at FROM calendar_bookings
      WHERE event_id = ${id} AND status = 'confirmed'
        AND start_at >= ${dateStart.toISOString()} AND start_at <= ${dateEnd.toISOString()}
    `;

    const slots: Array<{ startAt: string; endAt: string; available: boolean }> = [];
    const freq = Number(event.slot_frequency_min ?? 30);
    const duration = Number(event.duration_minutes);

    for (const avail of availability) {
      const [sh, sm] = avail.start_time.split(':').map(Number);
      const [eh, em] = avail.end_time.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;

      for (let mins = startMins; mins + duration <= endMins; mins += freq) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

        const isBooked = booked.some((b) => {
          const bs = new Date(b.start_at).getTime();
          const be = new Date(b.end_at).getTime();
          return slotStart.getTime() < be && slotEnd.getTime() > bs;
        });

        const isPast = slotStart.getTime() < Date.now() + Number(event.min_notice_hours ?? 2) * 3_600_000;

        slots.push({
          startAt: slotStart.toISOString(),
          endAt:   slotEnd.toISOString(),
          available: !isBooked && !isPast,
        });
      }
    }

    return { slots, timezone };
  });

  // ── Réservations ─────────────────────────────────────────
  app.get('/events/:id/bookings', hooks, async (request) => {
    const { id } = request.params as { id: string };
    const q = request.query as { status?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT b.*, c.first_name, c.last_name
      FROM calendar_bookings b
      LEFT JOIN contacts c ON c.id = b.contact_id
      WHERE b.event_id = ${id}
        AND (${q.status ?? null} IS NULL OR b.status = ${q.status ?? null})
      ORDER BY b.start_at DESC
      LIMIT ${limit}
    `;
  });

  // Réservation publique (pas d'auth requise — page publique du tenant)
  app.post('/events/:id/book', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = bookingSchema.parse(request.body);

    const [event] = await sql`SELECT * FROM calendar_events WHERE id = ${id} AND is_active = true`;
    if (!event) return reply.status(404).send({ error: 'event_not_found' });

    const startAt = new Date(body.startAt);
    const endAt = new Date(startAt.getTime() + Number(event.duration_minutes) * 60_000);

    // Vérifier conflit
    const [conflict] = await sql`
      SELECT id FROM calendar_bookings
      WHERE event_id = ${id} AND status = 'confirmed'
        AND start_at < ${endAt.toISOString()} AND end_at > ${startAt.toISOString()}
    `;
    if (conflict) return reply.status(409).send({ error: 'slot_unavailable', message: 'Ce créneau n\'est plus disponible' });

    // Vérifier limite journalière
    if (event.daily_limit) {
      const dayStart = new Date(startAt); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startAt); dayEnd.setHours(23, 59, 59, 999);
      const [dayCount] = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM calendar_bookings
        WHERE event_id = ${id} AND status = 'confirmed'
          AND start_at >= ${dayStart.toISOString()} AND start_at <= ${dayEnd.toISOString()}
      `;
      if (Number(dayCount?.count ?? 0) >= Number(event.daily_limit)) {
        return reply.status(409).send({ error: 'daily_limit_reached' });
      }
    }

    // Créer ou retrouver le contact
    let contactId: string | null = null;
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM contacts WHERE email = ${body.inviteeEmail} LIMIT 1`;
    if (existing) {
      contactId = existing.id;
    } else {
      const [nc] = await sql<{ id: string }[]>`
        INSERT INTO contacts (email, first_name) VALUES (${body.inviteeEmail}, ${body.inviteeName}) RETURNING id
      `;
      contactId = nc.id;
    }

    const [booking] = await sql`
      INSERT INTO calendar_bookings
        (event_id, contact_id, invitee_name, invitee_email, start_at, end_at, notes, timezone)
      VALUES (${id}, ${contactId}, ${body.inviteeName}, ${body.inviteeEmail},
              ${startAt.toISOString()}, ${endAt.toISOString()},
              ${body.notes ?? null}, ${body.timezone ?? 'Africa/Dakar'})
      RETURNING *
    `;

    return reply.status(201).send({ ...booking, event: { name: event.name, hostEmail: event.host_email } });
  });

  // Toutes les réservations (cross-event)
  app.get('/bookings', hooks, async (request) => {
    const q = request.query as { status?: string; event_id?: string; after?: string; before?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const eventId = q.event_id ?? null;
    const status  = q.status  ?? null;
    const after   = q.after   ?? null;
    const before  = q.before  ?? null;
    return sql`
      SELECT b.*, e.name as event_name, e.duration_minutes
      FROM calendar_bookings b
      JOIN calendar_events e ON e.id = b.event_id
      WHERE (${status}::text  IS NULL OR b.status    = ${status}::text)
        AND (${eventId}::text IS NULL OR b.event_id  = ${eventId}::uuid)
        AND (${after}::text   IS NULL OR b.start_at >= ${after}::timestamptz)
        AND (${before}::text  IS NULL OR b.start_at <= ${before}::timestamptz)
      ORDER BY b.start_at DESC
      LIMIT ${limit}
    `;
  });

  // Annuler / confirmer une réservation
  app.patch('/bookings/:bid', hooks, async (request, reply) => {
    const { bid } = request.params as { bid: string };
    const { status } = request.body as { status: 'confirmed' | 'cancelled' };
    if (!['confirmed', 'cancelled'].includes(status)) return reply.status(400).send({ error: 'invalid_status' });
    const [booking] = await sql`UPDATE calendar_bookings SET status = ${status} WHERE id = ${bid} RETURNING *`;
    if (!booking) return reply.status(404).send({ error: 'not_found' });
    return booking;
  });

  // Stats réservations
  app.get('/bookings/stats', hooks, async () => {
    return sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE start_at >= now()) as upcoming,
        COUNT(*) FILTER (WHERE start_at >= now() - interval '30 days') as last_30d
      FROM calendar_bookings
    `;
  });
}
