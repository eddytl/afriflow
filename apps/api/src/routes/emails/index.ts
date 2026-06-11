import type { FastifyInstance } from 'fastify';
import newslettersRoutes    from './newsletters.js';
import emailCampaignsRoutes from './campaigns.js';
import emailStatsRoutes     from './statistics.js';
import sendersRoutes        from './senders.js';

export default async function emailsRoutes(app: FastifyInstance) {
  await app.register(newslettersRoutes,    { prefix: '/newsletters' });
  await app.register(emailCampaignsRoutes, { prefix: '/campaigns' });
  await app.register(emailStatsRoutes,     { prefix: '/statistics' });
  await app.register(sendersRoutes,        { prefix: '/senders' });
}
