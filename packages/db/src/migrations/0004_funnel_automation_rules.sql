-- ─────────────────────────────────────────────────────────────
-- Migration 0004 : Règles d'automatisation des tunnels de vente
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funnel_automation_rules (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id   UUID    NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  page_id     UUID    NOT NULL REFERENCES funnel_pages(id) ON DELETE CASCADE,
  name        TEXT,                          -- label optionnel pour le dashboard
  trigger     JSONB   NOT NULL,              -- {type, params}
  actions     JSONB   NOT NULL DEFAULT '[]', -- [{type, params}]
  is_active   BOOLEAN NOT NULL DEFAULT true,
  run_count   INTEGER NOT NULL DEFAULT 0,    -- nombre d'exécutions
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_far_page      ON funnel_automation_rules(page_id);
CREATE INDEX IF NOT EXISTS idx_far_funnel    ON funnel_automation_rules(funnel_id);
CREATE INDEX IF NOT EXISTS idx_far_active    ON funnel_automation_rules(is_active) WHERE is_active = true;

-- Log d'exécution des règles (pour audit / débogage)
CREATE TABLE IF NOT EXISTS funnel_rule_executions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     UUID REFERENCES funnel_automation_rules(id) ON DELETE CASCADE,
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'success', -- success | error | skipped
  result      JSONB NOT NULL DEFAULT '{}',      -- résultats des actions
  error       TEXT,
  executed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fre_rule    ON funnel_rule_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_fre_contact ON funnel_rule_executions(contact_id);
