import type { FastifyInstance } from 'fastify';
import ordersRoutes           from './orders.js';
import transactionsRoutes     from './transactions.js';
import subscriptionsRoutes    from './subscriptions.js';
import affiliateInvoicesRoutes from './affiliate-invoices.js';
import affiliateProgramRoutes  from './affiliate-program.js';

export default async function salesRoutes(app: FastifyInstance) {
  await app.register(ordersRoutes,           { prefix: '/orders' });
  await app.register(transactionsRoutes,     { prefix: '/transactions' });
  await app.register(subscriptionsRoutes,    { prefix: '/subscriptions' });
  await app.register(affiliateInvoicesRoutes, { prefix: '/affiliate-invoices' });
  await app.register(affiliateProgramRoutes,  { prefix: '/affiliate-program' });
}
