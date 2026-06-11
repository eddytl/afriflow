import type { SMSProvider, SMSProviderName, SMSConfig } from './types.js';
import { createTwilioProvider } from './providers/twilio.js';
import { createAfricasTalkingProvider } from './providers/africas_talking.js';
import { createOrangeProvider } from './providers/orange.js';
import { createInfobipProvider } from './providers/infobip.js';
import { createTermiiProvider } from './providers/termii.js';
import { createHttpWebhookProvider } from './providers/http_webhook.js';

type ProviderFactory = (credentials: Record<string, string>) => SMSProvider;

const REGISTRY: Record<SMSProviderName, ProviderFactory> = {
  twilio:          createTwilioProvider,
  africas_talking: createAfricasTalkingProvider,
  orange:          createOrangeProvider,
  infobip:         createInfobipProvider,
  termii:          createTermiiProvider,
  http_webhook:    createHttpWebhookProvider,
};

export function createSMSProvider(config: SMSConfig): SMSProvider {
  const factory = REGISTRY[config.provider];
  if (!factory) {
    throw new Error(`Fournisseur SMS inconnu : "${config.provider}". Valeurs acceptées : ${Object.keys(REGISTRY).join(', ')}`);
  }
  return factory(config.credentials);
}

export function listProviders(): SMSProviderName[] {
  return Object.keys(REGISTRY) as SMSProviderName[];
}
