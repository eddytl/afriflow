-- ================================================================
-- Migration 0010 : Settings Module
-- Extend public.tenants with profile/account fields
-- Add per-tenant tables: api_keys, mcp_keys, webhooks,
-- payment_gateways, custom_domains, workspace_members,
-- shipping_zones, integrations
-- ================================================================

-- ── Extend public.tenants ────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS display_name  TEXT,
  ADD COLUMN IF NOT EXISTS first_name    TEXT,
  ADD COLUMN IF NOT EXISTS last_name     TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS address       TEXT,
  ADD COLUMN IF NOT EXISTS postal_code   TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS phone         TEXT,
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'individual'
                             CHECK (customer_type IN ('individual', 'company')),
  ADD COLUMN IF NOT EXISTS avatar_url    TEXT,
  ADD COLUMN IF NOT EXISTS timezone      TEXT NOT NULL DEFAULT 'Africa/Douala',
  ADD COLUMN IF NOT EXISTS date_format   TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  ADD COLUMN IF NOT EXISTS time_format   TEXT NOT NULL DEFAULT 'HH:mm',
  ADD COLUMN IF NOT EXISTS locale        TEXT NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- ── API Keys (tenant schema) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── MCP Keys (max 2 per tenant) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Webhooks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT,
  url               TEXT NOT NULL,
  secret            TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  events            JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_count    INT NOT NULL DEFAULT 0,
  failure_count     INT NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed')),
  response_code INT,
  response_body TEXT,
  attempt_count INT NOT NULL DEFAULT 1,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Payment Gateways ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_gateways (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL UNIQUE,
  credentials  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT false,
  metadata     JSONB DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Custom Domains ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_domains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'site'
                CHECK (type IN ('site', 'email', 'funnel')),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'failed')),
  dns_records JSONB DEFAULT '[]'::jsonb,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Workspace Members (assistants) ───────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL UNIQUE,
  name             TEXT,
  role             TEXT NOT NULL DEFAULT 'assistant'
                     CHECK (role IN ('assistant', 'admin')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'revoked')),
  invitation_token TEXT UNIQUE,
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Shipping Zones ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipping_zones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  countries JSONB NOT NULL DEFAULT '[]'::jsonb,
  rates     JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position  INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Integrations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL UNIQUE,
  credentials  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT false,
  metadata     JSONB DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
