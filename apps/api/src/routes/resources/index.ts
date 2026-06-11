import type { FastifyInstance } from 'fastify';
import productsRoutes    from './products.js';
import couponsRoutes     from './coupons.js';
import communitiesRoutes from './communities.js';
import filesRoutes       from './files.js';

export default async function resourcesRoutes(app: FastifyInstance) {
  await app.register(productsRoutes,    { prefix: '/products' });
  await app.register(couponsRoutes,     { prefix: '/coupons' });
  await app.register(communitiesRoutes, { prefix: '/communities' });
  await app.register(filesRoutes,       { prefix: '/files' });
}
