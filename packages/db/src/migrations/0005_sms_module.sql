-- ─────────────────────────────────────────────────────────────
-- Migration 0005 : Module SMS — templates + logs d'envoi
-- ─────────────────────────────────────────────────────────────

-- Templates SMS
CREATE TABLE IF NOT EXISTS sms_templates (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  body        TEXT    NOT NULL,             -- corps avec variables {{first_name}}, etc.
  sender_id   TEXT,                          -- expéditeur alphanumérique ou numéro
  sender_type TEXT    DEFAULT 'phone_number', -- phone_number | alphanumeric | messaging_service
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_templates_name ON sms_templates(name);

-- Logs d'envoi SMS (1 ligne par SMS envoyé)
CREATE TABLE IF NOT EXISTS sms_logs (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID    REFERENCES contacts(id) ON DELETE SET NULL,
  template_id  UUID    REFERENCES sms_templates(id) ON DELETE SET NULL,
  campaign_id  UUID    REFERENCES campaigns(id) ON DELETE SET NULL,
  to_number    TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'sent', -- sent | delivered | failed
  provider     TEXT,                             -- twilio | orange | termii | ...
  provider_id  TEXT,                             -- ID message chez le fournisseur
  error        TEXT,
  sent_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_contact    ON sms_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_campaign   ON sms_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status     ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at    ON sms_logs(sent_at);
