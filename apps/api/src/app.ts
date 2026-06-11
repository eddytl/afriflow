import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { redis } from './lib/redis.js';

import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth/index.js';
import contactRoutes from './routes/contacts/index.js';
import funnelRoutes from './routes/funnels/index.js';
import funnelRulesRoutes from './routes/funnels/automation-rules.js';
import campaignRoutes from './routes/campaigns/index.js';
import automationRoutes from './routes/automations/index.js';
import paymentRoutes from './routes/payments/index.js';
import aiRoutes from './routes/ai/index.js';
import analyticsRoutes from './routes/analytics/index.js';
import settingsRoutes from './routes/settings/index.js';
import crmRoutes from './routes/crm/index.js';
import affiliateRoutes from './routes/affiliate/index.js';
import sitesRoutes from './routes/sites/index.js';
import smsRoutes from './routes/sms/index.js';
import automationRulesRoutes from './routes/automation-rules/index.js';
import workflowsRoutes from './routes/workflows/index.js';
import resourcesRoutes from './routes/resources/index.js';
import salesRoutes from './routes/sales/index.js';
import emailsRoutes from './routes/emails/index.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
      },
    },
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: [
      process.env.WEB_URL ?? 'http://localhost:3000',
    ],
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: '24h' },
  });

  app.decorate('authenticate', authMiddleware);

  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => {
      const user = req.user as { tenantId?: string } | undefined;
      return user?.tenantId ?? req.ip;
    },
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  // Routes — nginx strips /api/ prefix, so routes start at /v1/
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(contactRoutes, { prefix: '/v1/contacts' });
  await app.register(funnelRoutes,      { prefix: '/v1/funnels' });
  await app.register(funnelRulesRoutes, { prefix: '/v1/funnels' });
  await app.register(campaignRoutes, { prefix: '/v1/campaigns' });
  await app.register(automationRoutes, { prefix: '/v1/automations' });
  await app.register(paymentRoutes, { prefix: '/v1/payments' });
  await app.register(aiRoutes, { prefix: '/v1/ai' });
  await app.register(analyticsRoutes, { prefix: '/v1/analytics' });
  await app.register(settingsRoutes,  { prefix: '/v1/settings' });
  await app.register(crmRoutes,       { prefix: '/v1/crm' });
  await app.register(affiliateRoutes, { prefix: '/v1/affiliate' });
  await app.register(sitesRoutes,           { prefix: '/v1/sites' });
  await app.register(smsRoutes,             { prefix: '/v1/sms' });
  await app.register(automationRulesRoutes, { prefix: '/v1/automation-rules' });
  await app.register(workflowsRoutes,       { prefix: '/v1/workflows' });
  await app.register(resourcesRoutes,       { prefix: '/v1/resources' });
  await app.register(salesRoutes,           { prefix: '/v1/sales' });
  await app.register(emailsRoutes,          { prefix: '/v1/emails' });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
  }));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({ err: error, url: request.url }, 'Request error');
    reply.status(statusCode).send({
      error: error.code ?? 'internal_error',
      message: statusCode < 500 ? error.message : 'Erreur interne du serveur',
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
    });
  });

  return app;
}
