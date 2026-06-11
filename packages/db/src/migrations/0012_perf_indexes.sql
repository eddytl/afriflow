-- Indexes de performance (migration 0012)
-- Note: CONCURRENTLY retiré — ces migrations tournent dans une transaction (sql.begin)

CREATE INDEX IF NOT EXISTS idx_events_type_created ON events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN (payload jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_active_email ON contacts (id) WHERE unsubscribed = false AND bounced = false AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automations_status ON automations (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_status_created ON campaigns (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrollments_automation_status ON automation_enrollments (automation_id, status);

CREATE INDEX IF NOT EXISTS idx_email_events_source ON email_events (source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_email_events_occurred ON email_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_pos ON pipeline_stages (pipeline_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_stage_status ON pipeline_deals (stage_id, status);
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_pipeline_contact ON pipeline_deals (pipeline_id, contact_id, status);
