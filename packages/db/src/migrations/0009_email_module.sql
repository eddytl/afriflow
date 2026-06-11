-- ─────────────────────────────────────────────────────────────────
-- Migration 0009 : Menu Emails — Newsletters, Campagnes enrichies, Statistiques
-- ─────────────────────────────────────────────────────────────────

-- ── Adresses email expéditeur vérifiées ──────────────────────────
CREATE TABLE IF NOT EXISTS sender_emails (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  name         TEXT,
  is_verified  BOOLEAN     NOT NULL DEFAULT false,
  verified_at  TIMESTAMPTZ,
  is_default   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (email)
);

-- ── Newsletters (envois one-shot à un segment) ────────────────────
CREATE TABLE IF NOT EXISTS newsletters (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         TEXT        NOT NULL,
  from_name       TEXT        NOT NULL,
  from_email      TEXT        NOT NULL,
  editor_type     TEXT        NOT NULL DEFAULT 'visual',   -- visual | classic
  template_id     UUID,                                    -- soft FK optionnel
  body_html       TEXT,
  body_text       TEXT,
  segment_filter  JSONB       NOT NULL DEFAULT '{}',
  preview_text    TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft',    -- draft | scheduled | sending | sent | cancelled
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  sent_count      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nw_status     ON newsletters(status);
CREATE INDEX IF NOT EXISTS idx_nw_created    ON newsletters(created_at);
CREATE INDEX IF NOT EXISTS idx_nw_scheduled  ON newsletters(scheduled_at) WHERE status = 'scheduled';

-- ── Enrichissement de la table campaigns ─────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS from_name    TEXT,
  ADD COLUMN IF NOT EXISTS from_email   TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS editor_type  TEXT DEFAULT 'visual',
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();

-- ── Étapes d'une campagne séquence (drip) ─────────────────────────
CREATE TABLE IF NOT EXISTS campaign_steps (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number  INTEGER     NOT NULL DEFAULT 1,
  subject      TEXT        NOT NULL,
  from_name    TEXT,
  body_html    TEXT,
  body_text    TEXT,
  preview_text TEXT,
  delay_days   INTEGER     NOT NULL DEFAULT 0,   -- délai depuis l'étape précédente
  delay_hours  INTEGER     NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'active',  -- active | paused
  sent_count   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_order ON campaign_steps(campaign_id, step_number);
CREATE INDEX       IF NOT EXISTS idx_cs_campaign ON campaign_steps(campaign_id);

-- ── Événements email (tracking ouvertures, clics, bounces…) ───────
CREATE TABLE IF NOT EXISTS email_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT        NOT NULL,   -- newsletter | campaign_step
  source_id   UUID        NOT NULL,   -- id de la newsletter ou campaign_step
  contact_id  UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  event_type  TEXT        NOT NULL,   -- sent | delivered | opened | clicked | bounced | spam | unsubscribed
  metadata    JSONB       NOT NULL DEFAULT '{}',  -- url cliquée, user_agent, ip, etc.
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ee_source  ON email_events(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ee_contact ON email_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_ee_type    ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ee_at      ON email_events(occurred_at);

-- ── Templates email ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  thumbnail   TEXT,                   -- URL de l'aperçu
  body_html   TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT false,  -- template fourni par AfriFlow
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
