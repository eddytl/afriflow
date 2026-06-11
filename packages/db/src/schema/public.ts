import {
  pgTable,
  uuid,
  text,
  jsonb,
  numeric,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  ownerEmail: text('owner_email').notNull(),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  plan: text('plan').notNull(),
  status: text('status').notNull(), // active | past_due | canceled
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const paymentTransactions = pgTable('payment_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  provider: text('provider').notNull(), // wave | orange_money | mtn | paystack | flutterwave
  status: text('status').notNull(), // pending | success | failed | refunded
  providerRef: text('provider_ref'),
  commission: numeric('commission', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;

// ── Programme d'affiliation AfriFlow ─────────────────────────
export const affiliates = pgTable('affiliates', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').references(() => tenants.id),
  refCode:        text('ref_code').unique().notNull(),
  status:         text('status').default('active'), // active | suspended
  payoutEmail:    text('payout_email'),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).default('60.00'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const affiliateReferrals = pgTable('affiliate_referrals', {
  id:               uuid('id').primaryKey().defaultRandom(),
  affiliateId:      uuid('affiliate_id').references(() => affiliates.id),
  referredTenantId: uuid('referred_tenant_id').references(() => tenants.id),
  status:           text('status').default('pending'), // pending | active | churned
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const affiliateCommissions = pgTable('affiliate_commissions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id').references(() => affiliates.id),
  referralId:  uuid('referral_id').references(() => affiliateReferrals.id),
  amount:      numeric('amount', { precision: 10, scale: 2 }).notNull(),
  currency:    text('currency').default('USD'),
  status:      text('status').default('pending'), // pending | paid
  periodStart: date('period_start'),
  periodEnd:   date('period_end'),
  paidAt:      timestamp('paid_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Affiliate = typeof affiliates.$inferSelect;
export type AffiliateReferral = typeof affiliateReferrals.$inferSelect;
export type AffiliateCommission = typeof affiliateCommissions.$inferSelect;
