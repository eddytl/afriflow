-- ─────────────────────────────────────────────────────────────
-- Migration 0006 : Règles d'automatisation globales + Workflows
-- ─────────────────────────────────────────────────────────────

-- Règles d'automatisation globales (trigger unique → actions immédiates)
CREATE TABLE IF NOT EXISTS automation_rules (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT    NOT NULL,
  trigger_type TEXT    NOT NULL,          -- tag_added | optin | new_sale | email_opened | ...
  trigger_params JSONB  NOT NULL DEFAULT '{}',
  actions      JSONB   NOT NULL DEFAULT '[]',
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | paused
  run_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_trigger_type ON automation_rules(trigger_type);
CREATE INDEX IF NOT EXISTS idx_ar_status       ON automation_rules(status);

-- Log d'exécution des règles globales
CREATE TABLE IF NOT EXISTS automation_rule_executions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      UUID REFERENCES automation_rules(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'success',   -- success | error | skipped
  result       JSONB NOT NULL DEFAULT '{}',
  error        TEXT,
  executed_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_are_rule    ON automation_rule_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_are_contact ON automation_rule_executions(contact_id);

-- Extension de la table automations pour les Workflows
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS share_token  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS settings     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enrolled_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();
