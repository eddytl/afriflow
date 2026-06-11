import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  numeric,
  time,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email'),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  country: text('country'),
  tags: text('tags').array().default([]),
  score: integer('score').default(0),
  unsubscribed: boolean('unsubscribed').default(false),
  bounced: boolean('bounced').default(false),
  customFields: jsonb('custom_fields').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const funnels = pgTable('funnels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').default('draft'), // draft | published
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const funnelPages = pgTable('funnel_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  funnelId: uuid('funnel_id').references(() => funnels.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // optin | sales | checkout | thanks | upsell
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  blocks: jsonb('blocks').notNull().default([]),
  seo: jsonb('seo').default({}),
  position: integer('position').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  trigger: jsonb('trigger').notNull(), // {type, conditions}
  steps: jsonb('steps').notNull(), // [{type, params, nextStep, trueStep, falseStep}]
  status: text('status').default('active'), // active | paused
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const automationEnrollments = pgTable('automation_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id').references(() => automations.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  status: text('status').default('active'), // active | waiting_event | completed | exited
  currentStep: integer('current_step').default(0),
  context: jsonb('context').default({}),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(), // email | sms | whatsapp
  status: text('status').default('draft'), // draft | scheduled | sending | sent
  subject: text('subject'),
  body: text('body').notNull(),
  segmentFilter: jsonb('segment_filter').default({}),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  stats: jsonb('stats').default({ sent: 0, opened: 0, clicked: 0 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').defaultRandom(),
  contactId: uuid('contact_id').references(() => contacts.id),
  type: text('type').notNull(), // page_view | form_submit | email_open | purchase | ...
  payload: jsonb('payload').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Funnel = typeof funnels.$inferSelect;
export type NewFunnel = typeof funnels.$inferInsert;
export type FunnelPage = typeof funnelPages.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationEnrollment = typeof automationEnrollments.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Event = typeof events.$inferSelect;

// ── CRM : Tags ───────────────────────────────────────────────
export const tags = pgTable('tags', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  color:     text('color').notNull().default('#6c63ff'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Tag = typeof tags.$inferSelect;

// ── CRM : Pipelines ──────────────────────────────────────────
export const pipelines = pgTable('pipelines', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const pipelineStages = pgTable('pipeline_stages', {
  id:         uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  position:   integer('position').default(0),
  color:      text('color').default('#e2e8f0'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const pipelineDeals = pgTable('pipeline_deals', {
  id:                uuid('id').primaryKey().defaultRandom(),
  pipelineId:        uuid('pipeline_id').references(() => pipelines.id, { onDelete: 'cascade' }),
  stageId:           uuid('stage_id').references(() => pipelineStages.id),
  contactId:         uuid('contact_id').references(() => contacts.id),
  title:             text('title').notNull(),
  value:             numeric('value', { precision: 12, scale: 2 }).default('0'),
  currency:          text('currency').default('XOF'),
  status:            text('status').default('open'), // open | won | lost
  notes:             text('notes'),
  expectedCloseDate: date('expected_close_date'),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type PipelineDeal = typeof pipelineDeals.$inferSelect;

// ── Calendrier ───────────────────────────────────────────────
export const calendarEvents = pgTable('calendar_events', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  name:               text('name').notNull(),
  slug:               text('slug').notNull(),
  hostName:           text('host_name').notNull(),
  hostEmail:          text('host_email').notNull(),
  type:               text('type').notNull().default('individual'), // individual | group
  durationMinutes:    integer('duration_minutes').notNull().default(30),
  locationType:       text('location_type').default('video'),      // video | phone | in_person
  locationDetails:    text('location_details'),
  description:        text('description'),
  maxParticipants:    integer('max_participants').default(1),
  minNoticeHours:     integer('min_notice_hours').default(2),
  cancelNoticeHours:  integer('cancel_notice_hours').default(0),
  availabilityFrom:   date('availability_from'),
  availabilityTo:     date('availability_to'),
  slotFrequencyMin:   integer('slot_frequency_min').default(30),
  dailyLimit:         integer('daily_limit'),
  bufferBeforeMin:    integer('buffer_before_min').default(0),
  bufferAfterMin:     integer('buffer_after_min').default(0),
  detectTimezone:     boolean('detect_timezone').default(true),
  isActive:           boolean('is_active').default(true),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const calendarAvailability = pgTable('calendar_availability', {
  id:         uuid('id').primaryKey().defaultRandom(),
  eventId:    uuid('event_id').references(() => calendarEvents.id, { onDelete: 'cascade' }),
  dayOfWeek:  integer('day_of_week').notNull(), // 0=Dim … 6=Sam
  startTime:  time('start_time').notNull(),
  endTime:    time('end_time').notNull(),
});

export const calendarBookings = pgTable('calendar_bookings', {
  id:            uuid('id').primaryKey().defaultRandom(),
  eventId:       uuid('event_id').references(() => calendarEvents.id),
  contactId:     uuid('contact_id').references(() => contacts.id),
  inviteeName:   text('invitee_name').notNull(),
  inviteeEmail:  text('invitee_email').notNull(),
  startAt:       timestamp('start_at', { withTimezone: true }).notNull(),
  endAt:         timestamp('end_at', { withTimezone: true }).notNull(),
  status:        text('status').default('confirmed'), // confirmed | cancelled | pending
  notes:         text('notes'),
  timezone:      text('timezone').default('Africa/Dakar'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type CalendarAvailability = typeof calendarAvailability.$inferSelect;
export type CalendarBooking = typeof calendarBookings.$inferSelect;

// ── Sites web ────────────────────────────────────────────────
export const websites = pgTable('websites', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  domain:    text('domain'),
  urlPath:   text('url_path'),
  language:  text('language').notNull().default('fr'),
  status:    text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const websitePages = pgTable('website_pages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  websiteId: uuid('website_id').references(() => websites.id, { onDelete: 'cascade' }),
  title:     text('title').notNull(),
  path:      text('path').notNull(),
  blocks:    jsonb('blocks').notNull().default([]),
  seo:       jsonb('seo').notNull().default({}),
  isHome:    boolean('is_home').notNull().default(false),
  status:    text('status').notNull().default('draft'),
  position:  integer('position').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type Website = typeof websites.$inferSelect;
export type WebsitePage = typeof websitePages.$inferSelect;

// ── Stores (pages créateurs) ─────────────────────────────────
export const stores = pgTable('stores', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  name:               text('name').notNull(),
  domain:             text('domain'),
  urlPath:            text('url_path').notNull(),
  language:           text('language').notNull().default('fr'),
  currency:           text('currency').notNull().default('XOF'),
  displayName:        text('display_name'),
  bio:                text('bio'),
  avatarUrl:          text('avatar_url'),
  socialLinks:        jsonb('social_links').notNull().default({}),
  showAffiliateBadge: boolean('show_affiliate_badge').notNull().default(true),
  seo:                jsonb('seo').notNull().default({}),
  trackingCode:       text('tracking_code'),
  status:             text('status').notNull().default('active'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Store = typeof stores.$inferSelect;

// ── Blogs ────────────────────────────────────────────────────
export const blogs = pgTable('blogs', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  domain:    text('domain'),
  urlPath:   text('url_path').notNull(),
  language:  text('language').notNull().default('fr'),
  template:  text('template').notNull().default('default'),
  status:    text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const blogCategories = pgTable('blog_categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  blogId:    uuid('blog_id').references(() => blogs.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  slug:      text('slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const blogPosts = pgTable('blog_posts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  blogId:        uuid('blog_id').references(() => blogs.id, { onDelete: 'cascade' }),
  categoryId:    uuid('category_id').references(() => blogCategories.id, { onDelete: 'set null' }),
  title:         text('title').notNull(),
  slug:          text('slug').notNull(),
  content:       text('content').notNull().default(''),
  excerpt:       text('excerpt'),
  featuredImage: text('featured_image'),
  status:        text('status').notNull().default('draft'),
  seo:           jsonb('seo').notNull().default({}),
  publishedAt:   timestamp('published_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type Blog = typeof blogs.$inferSelect;
export type BlogCategory = typeof blogCategories.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;

// ── SMS : templates + logs ───────────────────────────────────
export const smsTemplates = pgTable('sms_templates', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  body:       text('body').notNull(),
  senderId:   text('sender_id'),
  senderType: text('sender_type').notNull().default('phone_number'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const smsLogs = pgTable('sms_logs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  contactId:  uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  templateId: uuid('template_id').references(() => smsTemplates.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id,    { onDelete: 'set null' }),
  toNumber:   text('to_number').notNull(),
  message:    text('message').notNull(),
  status:     text('status').notNull().default('sent'),
  provider:   text('provider'),
  providerId: text('provider_id'),
  error:      text('error'),
  sentAt:     timestamp('sent_at', { withTimezone: true }).defaultNow(),
});

export type SmsTemplate = typeof smsTemplates.$inferSelect;
export type SmsLog = typeof smsLogs.$inferSelect;
