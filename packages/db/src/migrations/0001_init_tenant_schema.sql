-- Crée le schema d'un tenant (exécuter avec : SET search_path = tenant_{uuid})
-- Appelé automatiquement à la création d'un compte

CREATE TABLE IF NOT EXISTS contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  country       TEXT,
  tags          TEXT[] DEFAULT '{}',
  score         INT DEFAULT 0,
  unsubscribed  BOOLEAN DEFAULT false,
  bounced       BOOLEAN DEFAULT false,
  custom_fields JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING GIN (tags);

CREATE TABLE IF NOT EXISTS funnels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  status     TEXT DEFAULT 'draft',
  settings   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnel_pages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id  UUID REFERENCES funnels(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  title      TEXT NOT NULL,
  blocks     JSONB NOT NULL DEFAULT '[]',
  seo        JSONB DEFAULT '{}',
  position   INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_pages_position ON funnel_pages (funnel_id, position);

CREATE TABLE IF NOT EXISTS automations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  trigger    JSONB NOT NULL,
  steps      JSONB NOT NULL DEFAULT '[]',
  status     TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_enrollments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID REFERENCES automations(id),
  contact_id    UUID REFERENCES contacts(id),
  status        TEXT DEFAULT 'active',
  current_step  INT DEFAULT 0,
  context       JSONB DEFAULT '{}',
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_enrollments_next_run ON automation_enrollments (next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_automation_enrollments_contact ON automation_enrollments (contact_id, status);

CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT DEFAULT 'draft',
  subject         TEXT,
  body            TEXT NOT NULL,
  segment_filter  JSONB DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  stats           JSONB DEFAULT '{"sent":0,"opened":0,"clicked":0}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'events') THEN
    CREATE TABLE events (
      id         UUID DEFAULT gen_random_uuid(),
      contact_id UUID REFERENCES contacts(id),
      type       TEXT NOT NULL,
      payload    JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    ) PARTITION BY RANGE (created_at);

    CREATE TABLE events_default PARTITION OF events DEFAULT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_contact ON events (contact_id, type, created_at DESC);
