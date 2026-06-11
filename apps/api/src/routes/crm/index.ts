import type { FastifyInstance } from 'fastify';
import tagsRoutes from './tags.js';
import pipelineRoutes from './pipelines.js';
import calendarRoutes from './calendar.js';

export default async function crmRoutes(app: FastifyInstance) {
  await app.register(tagsRoutes,     { prefix: '/tags' });
  await app.register(pipelineRoutes, { prefix: '/pipelines' });
  await app.register(calendarRoutes, { prefix: '/calendar' });
}
