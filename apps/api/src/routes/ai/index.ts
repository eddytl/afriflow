import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import {
  callClaudeJSON,
  PAGE_GENERATION_SYSTEM,
  EMAIL_OPTIMIZATION_SYSTEM,
  WHATSAPP_REPLY_SYSTEM,
  buildPageGenerationPrompt,
} from '@afriflow/ai';

const generatePageSchema = z.object({
  offer: z.string().min(10),
  country: z.string().length(2),
  pageType: z.enum(['optin', 'sales', 'checkout', 'thanks']),
  tone: z.enum(['professionnel', 'casual', 'urgent', 'inspirant']).optional(),
});

const optimizeEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
  country: z.string().length(2).optional(),
});

const whatsappReplySchema = z.object({
  message: z.string(),
  contactName: z.string().optional(),
  funnelContext: z.string().optional(),
});

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

export default async function aiRoutes(app: FastifyInstance) {
  app.post('/generate-page', hooks, async (request, reply) => {
    const body = generatePageSchema.parse(request.body);
    const userPrompt = buildPageGenerationPrompt({
      offer: body.offer,
      country: body.country,
      pageType: body.pageType,
      tone: body.tone ?? 'professionnel',
    });

    const result = await callClaudeJSON<{ blocks: unknown[] }>(
      userPrompt,
      PAGE_GENERATION_SYSTEM,
      3000
    );
    return result;
  });

  app.post('/optimize-email', hooks, async (request, reply) => {
    const body = optimizeEmailSchema.parse(request.body);
    const userPrompt = `
Sujet actuel : ${body.subject}
Corps de l'email : ${body.body}
${body.country ? `Pays cible : ${body.country}` : ''}
    `.trim();

    const result = await callClaudeJSON<{
      variants: Array<{ subject: string; preheader: string; body: string; cta: string }>;
      bestSendTime: { hour: number; timezone: string; rationale: string };
    }>(userPrompt, EMAIL_OPTIMIZATION_SYSTEM, 2500);
    return result;
  });

  app.post('/whatsapp-reply', hooks, async (request, reply) => {
    const body = whatsappReplySchema.parse(request.body);
    const userPrompt = `
Message reçu : ${body.message}
${body.contactName ? `Nom du contact : ${body.contactName}` : ''}
${body.funnelContext ? `Contexte de l'offre : ${body.funnelContext}` : ''}
    `.trim();

    const result = await callClaudeJSON<{
      text: string;
      funnelUrl: string | null;
      action: 'reply' | 'transfer_to_agent' | 'send_funnel';
    }>(userPrompt, WHATSAPP_REPLY_SYSTEM, 1000);
    return result;
  });
}
