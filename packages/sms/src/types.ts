export type SMSProviderName =
  | 'twilio'
  | 'africas_talking'
  | 'orange'
  | 'infobip'
  | 'termii'
  | 'http_webhook';

export interface SMSResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface SMSProvider {
  name: string;
  send(to: string, message: string, senderId?: string): Promise<SMSResult>;
}

// Config stockée dans tenant.settings.sms
export interface SMSConfig {
  provider: SMSProviderName;
  senderId?: string;          // Nom affiché (ex: "MonBusiness")
  credentials: Record<string, string>;
}

// Schémas de credentials par provider (pour la validation côté API)
export const SMS_PROVIDER_CREDENTIAL_FIELDS: Record<SMSProviderName, string[]> = {
  twilio:          ['accountSid', 'authToken', 'phoneNumber'],
  africas_talking: ['apiKey', 'username'],
  orange:          ['clientId', 'clientSecret', 'senderAddress'],
  infobip:         ['apiKey', 'baseUrl'],
  termii:          ['apiKey'],
  http_webhook:    ['url', 'method', 'toField', 'messageField', 'authHeader'],
};
