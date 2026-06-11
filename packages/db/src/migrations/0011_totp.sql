-- 2FA TOTP pour public.users
-- Colonnes ajoutées au moment de la migration (la table est créée par l'app au démarrage)

CREATE TABLE IF NOT EXISTS public.users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES public.tenants(id),
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS totp_secret          TEXT,
  ADD COLUMN IF NOT EXISTS totp_pending_secret  TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_backup_codes    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS totp_verified_at     TIMESTAMPTZ;
