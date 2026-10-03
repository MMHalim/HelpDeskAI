-- IMMUTABLE wrapper around array_to_string (which is only STABLE) so it can be
-- used inside a GENERATED ALWAYS AS expression.
CREATE OR REPLACE FUNCTION helpdesk_array_to_text(arr text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_to_string(arr, ' '), '');
$$;
--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('gemini', 'openai');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_role" AS ENUM('primary', 'fallback', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."article_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."document_source_type" AS ENUM('markdown', 'pdf', 'image', 'text');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'acknowledged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error', 'fatal');--> statement-breakpoint
CREATE TYPE "public"."processed_event_status" AS ENUM('processing', 'processed', 'failed', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('in_progress', 'resolved', 'escalated', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('in_progress', 'paused', 'resolved', 'escalated', 'closed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."timeline_kind" AS ENUM('trigger', 'analysis', 'instruction', 'agent_reply', 'screenshot', 'resolution', 'escalation', 'note', 'error', 'admin_action', 'state_change');--> statement-breakpoint
CREATE TYPE "public"."timeline_role" AS ENUM('agent', 'bot', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TABLE "ai_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"change_note" varchar(500),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"label" varchar(120) NOT NULL,
	"role" "ai_provider_role" DEFAULT 'primary' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"model" varchar(120) NOT NULL,
	"api_key_encrypted" text,
	"api_key_preview" varchar(24),
	"base_url" varchar(400),
	"temperature" double precision DEFAULT 0.2 NOT NULL,
	"max_output_tokens" integer DEFAULT 2048 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"timeout_ms" integer DEFAULT 90000 NOT NULL,
	"vision_enabled" boolean DEFAULT true NOT NULL,
	"input_cost_per_million" double precision DEFAULT 0 NOT NULL,
	"output_cost_per_million" double precision DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" varchar(80) NOT NULL,
	"session_id" uuid,
	"session_code" varchar(32),
	"provider" "ai_provider" NOT NULL,
	"model" varchar(120) NOT NULL,
	"operation" varchar(60) NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_code" varchar(80),
	"error_message" text,
	"error_kind" varchar(40),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"channel_id" varchar(64),
	"thread_ts" varchar(40),
	"slack_user_id" varchar(64),
	"prompt_chars" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"category" varchar(60) NOT NULL,
	"message" text NOT NULL,
	"correlation_id" varchar(80),
	"session_id" uuid,
	"session_code" varchar(32),
	"provider" "ai_provider",
	"error_stack" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"step_id" uuid,
	"label" varchar(200) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"storage_path" text,
	"url" text NOT NULL,
	"mimetype" varchar(160),
	"width" integer,
	"height" integer,
	"sha256" varchar(64),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"instruction" text NOT NULL,
	"expected_result" text DEFAULT '' NOT NULL,
	"failure_result" text DEFAULT '' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"escalation_instructions" text DEFAULT '' NOT NULL,
	"requires_admin_approval" boolean DEFAULT false NOT NULL,
	"is_destructive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" varchar(320),
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80),
	"entity_id" varchar(120),
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" varchar(64),
	"correlation_id" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(400) NOT NULL,
	"source_type" "document_source_type" NOT NULL,
	"filename" varchar(400) NOT NULL,
	"mimetype" varchar(160),
	"size" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"storage_path" text,
	"extracted_text" text DEFAULT '' NOT NULL,
	"extracted_chars" integer DEFAULT 0 NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"required_info" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"escalated_by" varchar(40) DEFAULT 'ai' NOT NULL,
	"slack_message_ts" varchar(40),
	"escalated_to" varchar(200),
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_event_id" varchar(120) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"team_id" varchar(64),
	"channel_id" varchar(64),
	"message_ts" varchar(40),
	"status" "processed_event_status" DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb,
	"correlation_id" varchar(80),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "slack_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"name" varchar(120) DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_file_id" varchar(64) NOT NULL,
	"message_ts" varchar(40) NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"thread_ts" varchar(40),
	"user_id" varchar(64),
	"name" varchar(400) DEFAULT '' NOT NULL,
	"title" varchar(400),
	"mimetype" varchar(160),
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"url_private" text,
	"permalink" text,
	"storage_path" text,
	"sha256" varchar(64),
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_ts" varchar(40) NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"thread_ts" varchar(40),
	"user_id" varchar(64),
	"user_name" varchar(120),
	"is_bot" boolean DEFAULT false NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"subtype" varchar(60),
	"permalink" text,
	"session_id" uuid,
	"has_files" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_user_id" varchar(64) NOT NULL,
	"team_id" varchar(64),
	"name" varchar(120),
	"real_name" varchar(120),
	"display_name" varchar(120),
	"email" varchar(320),
	"is_bot" boolean DEFAULT false NOT NULL,
	"timezone" varchar(80),
	"raw" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"description" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "troubleshooting_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(300) NOT NULL,
	"slug" varchar(320) NOT NULL,
	"category" varchar(120) DEFAULT 'Other' NOT NULL,
	"issue_description" text DEFAULT '' NOT NULL,
	"symptoms" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"troubleshooting_steps" text DEFAULT '' NOT NULL,
	"expected_result" text DEFAULT '' NOT NULL,
	"failure_result" text DEFAULT '' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"escalation_instructions" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"priority" "article_priority" DEFAULT 'normal' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_document_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(helpdesk_array_to_text(symptoms), '')), 'A') ||
          setweight(to_tsvector('english', coalesce(helpdesk_array_to_text(keywords), ' ') || ' ' || coalesce(helpdesk_array_to_text(tags), '')), 'A') ||
          setweight(to_tsvector('english', coalesce(issue_description, '') || ' ' || coalesce(troubleshooting_steps, '') || ' ' || coalesce(notes, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "troubleshooting_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_code" varchar(32) NOT NULL,
	"status" "session_status" DEFAULT 'in_progress' NOT NULL,
	"resolution_status" "resolution_status" DEFAULT 'in_progress' NOT NULL,
	"escalation_required" boolean DEFAULT false NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"channel_name" varchar(120),
	"thread_ts" varchar(40) NOT NULL,
	"trigger_message_ts" varchar(40) NOT NULL,
	"trigger_event_id" varchar(120),
	"permalink" text,
	"slack_user_id" varchar(64) NOT NULL,
	"agent_name" varchar(120),
	"agent_display_name" varchar(120),
	"issue_title" varchar(300) DEFAULT 'Pending analysis' NOT NULL,
	"issue_summary" text DEFAULT '' NOT NULL,
	"diagnosis" text DEFAULT '' NOT NULL,
	"original_message" text DEFAULT '' NOT NULL,
	"state" jsonb DEFAULT '{"issue":"","diagnosis":"","stepsCompleted":[],"stepsFailed":[],"currentStep":"","observations":[],"possibleCauses":[],"resolutionStatus":"in_progress","escalationRequired":false}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"article_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"pinned_article_id" uuid,
	"ai_provider" "ai_provider",
	"ai_model" varchar(120),
	"last_operation" varchar(60),
	"admin_paused" boolean DEFAULT false NOT NULL,
	"admin_pause_reason" text,
	"admin_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" double precision DEFAULT 0 NOT NULL,
	"first_response_at" timestamp with time zone,
	"last_agent_reply_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "troubleshooting_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" timeline_role NOT NULL,
	"kind" timeline_kind NOT NULL,
	"summary" varchar(500) DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"slack_message_ts" varchar(40),
	"slack_user_name" varchar(120),
	"article_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"metadata" jsonb,
	"provider" "ai_provider",
	"model" varchar(120),
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_instructions" ADD CONSTRAINT "ai_instructions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_session_id_troubleshooting_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."troubleshooting_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_article_id_troubleshooting_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."troubleshooting_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_step_id_article_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."article_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_steps" ADD CONSTRAINT "article_steps_article_id_troubleshooting_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."troubleshooting_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_session_id_troubleshooting_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."troubleshooting_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_articles" ADD CONSTRAINT "troubleshooting_articles_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_articles" ADD CONSTRAINT "troubleshooting_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_articles" ADD CONSTRAINT "troubleshooting_articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_pinned_article_id_troubleshooting_articles_id_fk" FOREIGN KEY ("pinned_article_id") REFERENCES "public"."troubleshooting_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_timeline" ADD CONSTRAINT "troubleshooting_timeline_session_id_troubleshooting_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."troubleshooting_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_instructions_active_idx" ON "ai_instructions" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_provider_key" ON "ai_providers" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_provider_idx" ON "ai_requests" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_requests_session_id_idx" ON "ai_requests" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_requests_success_idx" ON "ai_requests" USING btree ("success");--> statement-breakpoint
CREATE INDEX "ai_requests_correlation_id_idx" ON "ai_requests" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "app_logs_created_at_idx" ON "app_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_logs_level_idx" ON "app_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "app_logs_category_idx" ON "app_logs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "app_logs_correlation_id_idx" ON "app_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "app_logs_session_id_idx" ON "app_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "article_images_article_id_idx" ON "article_images" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_images_step_id_idx" ON "article_images" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "article_steps_article_id_idx" ON "article_steps" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_steps_article_position_key" ON "article_steps" USING btree ("article_id","position");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_created_at_idx" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "escalations_session_id_idx" ON "escalations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "escalations_status_idx" ON "escalations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "escalations_created_at_idx" ON "escalations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_event_id_key" ON "processed_events" USING btree ("slack_event_id");--> statement-breakpoint
CREATE INDEX "processed_events_status_idx" ON "processed_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "processed_events_received_at_idx" ON "processed_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channels_channel_id_key" ON "slack_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_files_file_id_key" ON "slack_files" USING btree ("slack_file_id");--> statement-breakpoint
CREATE INDEX "slack_files_message_ts_idx" ON "slack_files" USING btree ("channel_id","message_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_messages_channel_ts_key" ON "slack_messages" USING btree ("channel_id","slack_message_ts");--> statement-breakpoint
CREATE INDEX "slack_messages_thread_ts_idx" ON "slack_messages" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "slack_messages_session_id_idx" ON "slack_messages" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_users_slack_user_id_key" ON "slack_users" USING btree ("slack_user_id");--> statement-breakpoint
CREATE INDEX "slack_users_name_idx" ON "slack_users" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "troubleshooting_articles_slug_key" ON "troubleshooting_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "troubleshooting_articles_category_idx" ON "troubleshooting_articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "troubleshooting_articles_active_idx" ON "troubleshooting_articles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "troubleshooting_articles_priority_idx" ON "troubleshooting_articles" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "troubleshooting_articles_tags_idx" ON "troubleshooting_articles" USING btree ("tags");--> statement-breakpoint
CREATE INDEX "troubleshooting_articles_search_vector_idx" ON "troubleshooting_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "troubleshooting_sessions_session_code_key" ON "troubleshooting_sessions" USING btree ("session_code");--> statement-breakpoint
CREATE UNIQUE INDEX "troubleshooting_sessions_thread_key" ON "troubleshooting_sessions" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_status_idx" ON "troubleshooting_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_resolution_status_idx" ON "troubleshooting_sessions" USING btree ("resolution_status");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_channel_thread_idx" ON "troubleshooting_sessions" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_user_idx" ON "troubleshooting_sessions" USING btree ("slack_user_id");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_created_at_idx" ON "troubleshooting_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "troubleshooting_sessions_last_activity_idx" ON "troubleshooting_sessions" USING btree ("last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "troubleshooting_timeline_session_seq_key" ON "troubleshooting_timeline" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "troubleshooting_timeline_session_idx" ON "troubleshooting_timeline" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "troubleshooting_timeline_created_at_idx" ON "troubleshooting_timeline" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));