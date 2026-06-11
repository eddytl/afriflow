export interface InitiateParams {
  amount: number;
  currency: string;
  country: string;
  contactId: string;
  email?: string;
  phone?: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSession {
  reference: string;
  paymentUrl: string;
  provider: string;
  expiresAt?: Date;
}

export interface PaymentStatus {
  reference: string;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookEvent {
  reference: string;
  status: 'success' | 'failed';
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;
  currencies: string[];
  countries: string[];
  initiate(params: InitiateParams): Promise<PaymentSession>;
  verify(reference: string): Promise<PaymentStatus>;
  handleWebhook(body: unknown, signature: string): Promise<WebhookEvent>;
}
