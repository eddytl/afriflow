-- ============================================================
-- 0002 — CRM (tags, pipelines, deals) + Calendar + Affiliates
-- ============================================================

-- ── Tenant schema additions ─────────────────────────────────

-- Tags dédiés (nom + couleur)
CREATE TABLE IF NOT EXISTS tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6c63ff',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name)
);

-- Pipelines CRM
CREATE TABLE IF NOT EXISTS pipelines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT DEFAULT 0,
  color       TEXT DEFAULT '#e2e8f0',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pos ON pipeline_stages (pipeline_id, position);

CREATE TABLE IF NOT EXISTS pipeline_deals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id        UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id           UUID REFERENCES pipeline_stages(id),
  contact_id         UUID REFERENCES contacts(id),
  title              TEXT NOT NULL,
  value              NUMERIC(12,2) DEFAULT 0,
  currency           TEXT DEFAULT 'XOF',
  status             TEXT DEFAULT 'open',
  notes              TEXT,
  expected_close_date DATE,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_deals_stage ON pipeline_deals (pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_contact ON pipeline_deals (contact_id);

-- Calendrier / Réservations
CREATE TABLE IF NOT EXISTS calendar_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  host_name            TEXT NOT NULL,
  host_email           TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'individual',
  duration_minutes     INT NOT NULL DEFAULT 30,
  location_type        TEXT DEFAULT 'video',
  location_details     TEXT,
  description          TEXT,
  max_participants     INT DEFAULT 1,
  min_notice_hours     INT DEFAULT 2,
  cancel_notice_hours  INT DEFAULT 0,
  availability_from    DATE,
  availability_to      DATE,
  slot_frequency_min   INT DEFAULT 30,
  daily_limit          INT,
  buffer_before_min    INT DEFAULT 0,
  buffer_after_min     INT DEFAULT 0,
  detect_timezone      BOOLEAN DEFAULT true,
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_availability (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_avail ON calendar_availability (event_id, day_of_week);

CREATE TABLE IF NOT EXISTS calendar_bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID REFERENCES calendar_events(id),
  contact_id     UUID REFERENCES contacts(id),
  invitee_name   TEXT NOT NULL,
  invitee_email  TEXT NOT NULL,
  start_at       TIMESTAMPTZ NOT NULL,
  end_at         TIMESTAMPTZ NOT NULL,
  status         TEXT DEFAULT 'confirmed',
  notes          TEXT,
  timezone       TEXT DEFAULT 'Africa/Dakar',
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_event ON calendar_bookings (event_id, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_contact ON calendar_bookings (contact_id);

-- ── Public schema additions (affiliés — programme AfriFlow) ─

CREATE TABLE IF NOT EXISTS public.affiliates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES public.tenants(id),
  ref_code     TEXT UNIQUE NOT NULL,
  status       TEXT DEFAULT 'active',     -- active | suspended
  payout_email TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 60.00,  -- 60% comme systeme.io
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id        UUID REFERENCES public.affiliates(id),
  referred_tenant_id  UUID REFERENCES public.tenants(id),
  status              TEXT DEFAULT 'pending',  -- pending | active | churned
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_affiliate ON public.affiliate_referrals (affiliate_id);

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID REFERENCES public.affiliates(id),
  referral_id  UUID REFERENCES public.affiliate_referrals(id),
  amount       NUMERIC(10,2) NOT NULL,
  currency     TEXT DEFAULT 'USD',
  status       TEXT DEFAULT 'pending',   -- pending | paid
  period_start DATE,
  period_end   DATE,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON public.affiliate_commissions (affiliate_id, status);
