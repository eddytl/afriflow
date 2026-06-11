-- ─────────────────────────────────────────────────────────────────
-- Migration 0007 : Menu Ressources — Produits, Coupons, Communautés, Fichiers
-- ─────────────────────────────────────────────────────────────────

-- ── Produits physiques ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT         NOT NULL,
  description      TEXT,
  sku              TEXT,                              -- UGS
  tax_rate         NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_mode         TEXT         NOT NULL DEFAULT 'exclusive',  -- exclusive | inclusive
  currency         TEXT         NOT NULL DEFAULT 'EUR',
  price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  weight_grams     INTEGER,
  has_stock_limit  BOOLEAN      NOT NULL DEFAULT false,
  stock_limit      INTEGER,
  disable_shipping BOOLEAN      NOT NULL DEFAULT false,
  image_url        TEXT,
  has_options      BOOLEAN      NOT NULL DEFAULT false,
  options          JSONB        NOT NULL DEFAULT '[]',  -- [{name, values: string[]}]
  status           TEXT         NOT NULL DEFAULT 'active',  -- active | archived
  created_at       TIMESTAMPTZ  DEFAULT now(),
  updated_at       TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_sku    ON products(sku);

-- ── Codes promo ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT          NOT NULL,
  code            TEXT          NOT NULL,               -- code unique (sensible à la casse)
  discount_type   TEXT          NOT NULL,               -- percentage | fixed
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  max_uses        INTEGER,
  use_count       INTEGER       NOT NULL DEFAULT 0,
  status          TEXT          NOT NULL DEFAULT 'active',  -- active | paused | expired
  created_at      TIMESTAMPTZ   DEFAULT now(),
  updated_at      TIMESTAMPTZ   DEFAULT now(),
  UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code   ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);

-- ── Communautés ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL,
  domain                TEXT,                           -- sous-domaine tenant
  path                  TEXT        NOT NULL,           -- chemin d'accès URL
  auto_approve_messages BOOLEAN     NOT NULL DEFAULT true,
  member_count          INTEGER     NOT NULL DEFAULT 0,
  post_count            INTEGER     NOT NULL DEFAULT 0,
  status                TEXT        NOT NULL DEFAULT 'active',  -- active | archived
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communities_status ON communities(status);
CREATE INDEX IF NOT EXISTS idx_communities_path   ON communities(path);

-- Membres des communautés
CREATE TABLE IF NOT EXISTS community_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID        NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  contact_id   UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  role         TEXT        NOT NULL DEFAULT 'member',   -- member | moderator | admin
  status       TEXT        NOT NULL DEFAULT 'active',   -- active | banned
  joined_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_unique  ON community_members(community_id, contact_id);
CREATE INDEX       IF NOT EXISTS idx_cm_community ON community_members(community_id);

-- ── Fichiers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  file_key   TEXT        NOT NULL,               -- clé S3 / storage path
  file_url   TEXT        NOT NULL,
  mime_type  TEXT        NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT      NOT NULL DEFAULT 0,
  source     TEXT,                               -- blog_post | product_asset | funnel_page | manual | ...
  source_id  UUID,                               -- id de l'entité source (nullable)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_source    ON files(source);
CREATE INDEX IF NOT EXISTS idx_files_source_id ON files(source_id);
CREATE INDEX IF NOT EXISTS idx_files_mime      ON files(mime_type);
