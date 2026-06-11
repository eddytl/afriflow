-- ─────────────────────────────────────────────────────────────────
-- Migration 0008 : Menu Ventes — Commandes, Abonnements, Factures affiliés
-- ─────────────────────────────────────────────────────────────────

-- Extension de public.payment_transactions (colonnes manquantes)
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS contact_id    UUID,
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'new',    -- new | returning
  ADD COLUMN IF NOT EXISTS type          TEXT DEFAULT 'payment', -- payment | refund | subscription_renewal | chargeback
  ADD COLUMN IF NOT EXISTS metadata      JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pt_contact ON public.payment_transactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_pt_type    ON public.payment_transactions(type);
CREATE INDEX IF NOT EXISTS idx_pt_country ON public.payment_transactions(country);

-- ── Commandes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number           TEXT          NOT NULL,                           -- ORD-2024-00001
  contact_id             UUID          REFERENCES contacts(id) ON DELETE SET NULL,
  status                 TEXT          NOT NULL DEFAULT 'pending',          -- pending | paid | refunded | cancelled | partially_refunded
  subtotal               NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency               TEXT          NOT NULL DEFAULT 'XAF',
  coupon_id              UUID,                                              -- soft FK vers coupons
  source                 TEXT          NOT NULL DEFAULT 'funnel',           -- funnel | store | manual | api
  source_id              UUID,                                              -- id du tunnel / store
  payment_transaction_id UUID,                                              -- soft FK vers public.payment_transactions
  notes                  TEXT,
  created_at             TIMESTAMPTZ   DEFAULT now(),
  updated_at             TIMESTAMPTZ   DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX       IF NOT EXISTS idx_orders_contact ON orders(contact_id);
CREATE INDEX       IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX       IF NOT EXISTS idx_orders_created ON orders(created_at);

-- Lignes de commande
CREATE TABLE IF NOT EXISTS order_items (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_type TEXT          NOT NULL DEFAULT 'product',   -- product | funnel_offer | subscription_plan
  offer_id   UUID,                                        -- id de l'entité (produit, page tunnel…)
  name       TEXT          NOT NULL,
  quantity   INTEGER       NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items(order_id);

-- Séquence pour les numéros de commande
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1;

-- ── Abonnements ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id              UUID          REFERENCES contacts(id) ON DELETE SET NULL,
  plan_name               TEXT          NOT NULL,
  plan_id                 UUID,                                              -- soft FK (funnel page, offer…)
  status                  TEXT          NOT NULL DEFAULT 'active',           -- active | cancelled | past_due | paused | trial | expired
  currency                TEXT          NOT NULL DEFAULT 'XAF',
  amount                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  billing_interval        TEXT          NOT NULL DEFAULT 'monthly',          -- weekly | monthly | quarterly | yearly
  billing_day             INTEGER,                                           -- jour du mois
  trial_ends_at           TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  pause_starts_at         TIMESTAMPTZ,
  pause_ends_at           TIMESTAMPTZ,
  provider                TEXT,                                              -- wave | orange_money | stripe | ...
  provider_subscription_id TEXT,
  created_at              TIMESTAMPTZ   DEFAULT now(),
  updated_at              TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_contact  ON subscriptions(contact_id);
CREATE INDEX IF NOT EXISTS idx_sub_status   ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_plan     ON subscriptions(plan_id);

-- ── Factures affiliés ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_invoices (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID          REFERENCES contacts(id) ON DELETE SET NULL,
  period_start     TIMESTAMPTZ   NOT NULL,
  period_end       TIMESTAMPTZ   NOT NULL,
  amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT          NOT NULL DEFAULT 'XAF',
  status           TEXT          NOT NULL DEFAULT 'pending',   -- pending | paid | rejected | processing
  payment_method   TEXT,                                        -- bank_transfer | mobile_money | paypal | crypto
  payment_reference TEXT,
  notes            TEXT,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_affiliate ON affiliate_invoices(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_ai_status    ON affiliate_invoices(status);
CREATE INDEX IF NOT EXISTS idx_ai_created   ON affiliate_invoices(created_at);

-- ── Structures de commission du programme d'affiliation ───────────
CREATE TABLE IF NOT EXISTS affiliate_commission_structures (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_name          TEXT          NOT NULL,
  offer_id            UUID,                              -- FK vers funnel_pages ou produits
  offer_type          TEXT          NOT NULL DEFAULT 'funnel_page',  -- funnel_page | product
  payment_delay_days  INTEGER       NOT NULL DEFAULT 30,
  commission_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,  -- pourcentage
  status              TEXT          NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ   DEFAULT now(),
  updated_at          TIMESTAMPTZ   DEFAULT now()
);
