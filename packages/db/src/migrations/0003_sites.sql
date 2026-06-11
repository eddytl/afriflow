-- ─────────────────────────────────────────────────────────────
-- Migration 0003 : Sites web, Stores, Blogs + extension Funnels
-- ─────────────────────────────────────────────────────────────

-- Extension de la table funnels
ALTER TABLE funnels
  ADD COLUMN IF NOT EXISTS objective  TEXT DEFAULT 'custom',   -- audience | sell | custom | webinar
  ADD COLUMN IF NOT EXISTS domain     TEXT,
  ADD COLUMN IF NOT EXISTS currency   TEXT DEFAULT 'XOF';

-- Extension de funnel_pages (A/B test, automation rules, deadline)
ALTER TABLE funnel_pages
  ADD COLUMN IF NOT EXISTS ab_test           JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS automation_rules  JSONB    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS deadline          JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leads_count       INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue           NUMERIC(12,2) DEFAULT 0;

-- ── Sites web ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS websites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  domain      TEXT,
  url_path    TEXT,
  language    TEXT    NOT NULL DEFAULT 'fr',
  status      TEXT    NOT NULL DEFAULT 'active',   -- active | inactive
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS website_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id  UUID REFERENCES websites(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  blocks      JSONB   NOT NULL DEFAULT '[]',
  seo         JSONB   NOT NULL DEFAULT '{}',
  is_home     BOOLEAN NOT NULL DEFAULT false,
  status      TEXT    NOT NULL DEFAULT 'draft',    -- draft | published
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_website_pages_website ON website_pages(website_id);

-- ── Stores (pages créateurs) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT    NOT NULL,
  domain              TEXT,
  url_path            TEXT    NOT NULL,
  language            TEXT    NOT NULL DEFAULT 'fr',
  currency            TEXT    NOT NULL DEFAULT 'XOF',
  display_name        TEXT,
  bio                 TEXT,
  avatar_url          TEXT,
  social_links        JSONB   NOT NULL DEFAULT '{}',
  show_affiliate_badge BOOLEAN NOT NULL DEFAULT true,
  seo                 JSONB   NOT NULL DEFAULT '{}',
  tracking_code       TEXT,
  status              TEXT    NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ── Blogs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blogs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  domain      TEXT,
  url_path    TEXT    NOT NULL,
  language    TEXT    NOT NULL DEFAULT 'fr',
  template    TEXT    NOT NULL DEFAULT 'default',
  status      TEXT    NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id     UUID REFERENCES blogs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(blog_id, slug)
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id         UUID REFERENCES blogs(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES blog_categories(id) ON DELETE SET NULL,
  title           TEXT    NOT NULL,
  slug            TEXT    NOT NULL,
  content         TEXT    NOT NULL DEFAULT '',
  excerpt         TEXT,
  featured_image  TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft',  -- draft | published
  seo             JSONB   NOT NULL DEFAULT '{}',
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(blog_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_blog     ON blog_posts(blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status   ON blog_posts(status);
