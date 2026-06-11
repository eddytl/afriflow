import type { FastifyInstance } from 'fastify';
import websiteRoutes from './websites.js';
import storeRoutes   from './stores.js';
import blogRoutes    from './blogs.js';

export default async function sitesRoutes(app: FastifyInstance) {
  await app.register(websiteRoutes, { prefix: '/websites' });
  await app.register(storeRoutes,   { prefix: '/stores' });
  await app.register(blogRoutes,    { prefix: '/blogs' });
}
