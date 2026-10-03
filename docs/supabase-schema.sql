--
-- HelpDesk AI — full PostgreSQL schema for Supabase
-- Generated from the Drizzle schema (migrations 0000–0002).
--
-- How to use
--   1. Supabase → SQL Editor → New query.
--   2. Paste this entire file and run it ONCE on a fresh project.
--   3. Point the API at Supabase: set DATABASE_URL to the Supabase
--      connection string (Session pooler / direct), then restart the API.
--
-- Notes
--   * Requires the pg_trgm and unaccent extensions (installed below).
--   * Target PostgreSQL 15+ (Supabase default).
--   * The `drizzle` bookkeeping schema/table is included and migrations
--     0000–0002 are marked as already applied, so the API will not try to
--     re-create the tables on startup.
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Homebrew)
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS drizzle;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: ai_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_provider AS ENUM (
    'gemini',
    'openai'
);


--
-- Name: ai_provider_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_provider_role AS ENUM (
    'primary',
    'fallback',
    'disabled'
);


--
-- Name: article_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.article_priority AS ENUM (
    'low',
    'normal',
    'high',
    'critical'
);


--
-- Name: document_source_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_source_type AS ENUM (
    'markdown',
    'pdf',
    'image',
    'text'
);


--
-- Name: document_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_status AS ENUM (
    'pending',
    'processing',
    'indexed',
    'failed'
);


--
-- Name: escalation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.escalation_status AS ENUM (
    'open',
    'acknowledged',
    'closed'
);


--
-- Name: log_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.log_level AS ENUM (
    'debug',
    'info',
    'warn',
    'error',
    'fatal'
);


--
-- Name: processed_event_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.processed_event_status AS ENUM (
    'processing',
    'processed',
    'failed',
    'duplicate'
);


--
-- Name: resolution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resolution_status AS ENUM (
    'in_progress',
    'resolved',
    'escalated',
    'abandoned'
);


--
-- Name: session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status AS ENUM (
    'in_progress',
    'assigned',
    'waiting_on_user',
    'paused',
    'resolved',
    'escalated',
    'closed',
    'abandoned'
);


--
-- Name: timeline_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.timeline_kind AS ENUM (
    'trigger',
    'analysis',
    'instruction',
    'agent_reply',
    'screenshot',
    'resolution',
    'escalation',
    'note',
    'error',
    'admin_action',
    'state_change'
);


--
-- Name: timeline_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.timeline_role AS ENUM (
    'agent',
    'bot',
    'admin',
    'system'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'viewer'
);


--
-- Name: helpdesk_array_to_text(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.helpdesk_array_to_text(arr text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT coalesce(array_to_string(arr, ' '), '');
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: ai_instructions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_instructions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    change_note character varying(500),
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.ai_provider NOT NULL,
    label character varying(120) NOT NULL,
    role public.ai_provider_role DEFAULT 'primary'::public.ai_provider_role NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    model character varying(120) NOT NULL,
    api_key_encrypted text,
    api_key_preview character varying(24),
    base_url character varying(400),
    temperature double precision DEFAULT 0.2 NOT NULL,
    max_output_tokens integer DEFAULT 2048 NOT NULL,
    max_retries integer DEFAULT 2 NOT NULL,
    timeout_ms integer DEFAULT 90000 NOT NULL,
    vision_enabled boolean DEFAULT true NOT NULL,
    input_cost_per_million double precision DEFAULT 0 NOT NULL,
    output_cost_per_million double precision DEFAULT 0 NOT NULL,
    last_checked_at timestamp with time zone,
    last_error text,
    last_success_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    correlation_id character varying(80) NOT NULL,
    session_id uuid,
    session_code character varying(32),
    provider public.ai_provider NOT NULL,
    model character varying(120) NOT NULL,
    operation character varying(60) NOT NULL,
    success boolean DEFAULT false NOT NULL,
    is_fallback boolean DEFAULT false NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    error_code character varying(80),
    error_message text,
    error_kind character varying(40),
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    estimated_cost double precision DEFAULT 0 NOT NULL,
    latency_ms integer,
    channel_id character varying(64),
    thread_ts character varying(40),
    slack_user_id character varying(64),
    prompt_chars integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    level public.log_level DEFAULT 'info'::public.log_level NOT NULL,
    category character varying(60) NOT NULL,
    message text NOT NULL,
    correlation_id character varying(80),
    session_id uuid,
    session_code character varying(32),
    provider public.ai_provider,
    error_stack text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    step_id uuid,
    label character varying(200) DEFAULT ''::character varying NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    storage_path text,
    url text NOT NULL,
    mimetype character varying(160),
    width integer,
    height integer,
    sha256 character varying(64),
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title character varying(200) DEFAULT ''::character varying NOT NULL,
    instruction text NOT NULL,
    expected_result text DEFAULT ''::text NOT NULL,
    failure_result text DEFAULT ''::text NOT NULL,
    next_step text DEFAULT ''::text NOT NULL,
    escalation_instructions text DEFAULT ''::text NOT NULL,
    requires_admin_approval boolean DEFAULT false NOT NULL,
    is_destructive boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_email character varying(320),
    action character varying(120) NOT NULL,
    entity_type character varying(80),
    entity_id character varying(120),
    summary text,
    before jsonb,
    after jsonb,
    ip_address character varying(64),
    correlation_id character varying(80),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    user_agent text,
    ip_address character varying(64),
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(400) NOT NULL,
    source_type public.document_source_type NOT NULL,
    filename character varying(400) NOT NULL,
    mimetype character varying(160),
    size integer DEFAULT 0 NOT NULL,
    page_count integer,
    storage_path text,
    extracted_text text DEFAULT ''::text NOT NULL,
    extracted_chars integer DEFAULT 0 NOT NULL,
    status public.document_status DEFAULT 'pending'::public.document_status NOT NULL,
    error text,
    imported_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    required_info text[] DEFAULT ARRAY[]::text[] NOT NULL,
    status public.escalation_status DEFAULT 'open'::public.escalation_status NOT NULL,
    escalated_by character varying(40) DEFAULT 'ai'::character varying NOT NULL,
    slack_message_ts character varying(40),
    escalated_to character varying(200),
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: processed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_event_id character varying(120) NOT NULL,
    event_type character varying(80) NOT NULL,
    team_id character varying(64),
    channel_id character varying(64),
    message_ts character varying(40),
    status public.processed_event_status DEFAULT 'processing'::public.processed_event_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    payload jsonb,
    correlation_id character varying(80),
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: slack_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id character varying(64) NOT NULL,
    name character varying(120) DEFAULT ''::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_private boolean DEFAULT false NOT NULL,
    last_triggered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: slack_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_file_id character varying(64) NOT NULL,
    message_ts character varying(40) NOT NULL,
    channel_id character varying(64) NOT NULL,
    thread_ts character varying(40),
    user_id character varying(64),
    name character varying(400) DEFAULT ''::character varying NOT NULL,
    title character varying(400),
    mimetype character varying(160),
    size integer DEFAULT 0 NOT NULL,
    width integer,
    height integer,
    url_private text,
    permalink text,
    storage_path text,
    sha256 character varying(64),
    analysis jsonb,
    analyzed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: slack_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_message_ts character varying(40) NOT NULL,
    channel_id character varying(64) NOT NULL,
    thread_ts character varying(40),
    user_id character varying(64),
    user_name character varying(120),
    is_bot boolean DEFAULT false NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    subtype character varying(60),
    permalink text,
    session_id uuid,
    has_files boolean DEFAULT false NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: slack_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slack_user_id character varying(64) NOT NULL,
    team_id character varying(64),
    name character varying(120),
    real_name character varying(120),
    display_name character varying(120),
    email character varying(320),
    is_bot boolean DEFAULT false NOT NULL,
    timezone character varying(80),
    raw jsonb,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key character varying(120) NOT NULL,
    value jsonb NOT NULL,
    is_secret boolean DEFAULT false NOT NULL,
    description text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: troubleshooting_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.troubleshooting_articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(300) NOT NULL,
    slug character varying(320) NOT NULL,
    category character varying(120) DEFAULT 'Other'::character varying NOT NULL,
    issue_description text DEFAULT ''::text NOT NULL,
    symptoms text[] DEFAULT ARRAY[]::text[] NOT NULL,
    troubleshooting_steps text DEFAULT ''::text NOT NULL,
    expected_result text DEFAULT ''::text NOT NULL,
    failure_result text DEFAULT ''::text NOT NULL,
    next_step text DEFAULT ''::text NOT NULL,
    escalation_instructions text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    keywords text[] DEFAULT ARRAY[]::text[] NOT NULL,
    priority public.article_priority DEFAULT 'normal'::public.article_priority NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    source_document_id uuid,
    created_by uuid,
    updated_by uuid,
    search_vector tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('english'::regconfig, (COALESCE(title, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(public.helpdesk_array_to_text(symptoms), ''::text)), 'A'::"char")) || setweight(to_tsvector('english'::regconfig, ((COALESCE(public.helpdesk_array_to_text(keywords), ' '::text) || ' '::text) || COALESCE(public.helpdesk_array_to_text(tags), ''::text))), 'A'::"char")) || setweight(to_tsvector('english'::regconfig, ((((COALESCE(issue_description, ''::text) || ' '::text) || COALESCE(troubleshooting_steps, ''::text)) || ' '::text) || COALESCE(notes, ''::text))), 'B'::"char"))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: troubleshooting_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.troubleshooting_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_code character varying(32) NOT NULL,
    status public.session_status DEFAULT 'in_progress'::public.session_status NOT NULL,
    resolution_status public.resolution_status DEFAULT 'in_progress'::public.resolution_status NOT NULL,
    escalation_required boolean DEFAULT false NOT NULL,
    channel_id character varying(64) NOT NULL,
    channel_name character varying(120),
    thread_ts character varying(40) NOT NULL,
    trigger_message_ts character varying(40) NOT NULL,
    trigger_event_id character varying(120),
    permalink text,
    slack_user_id character varying(64) NOT NULL,
    agent_name character varying(120),
    agent_display_name character varying(120),
    issue_title character varying(300) DEFAULT 'Pending analysis'::character varying NOT NULL,
    issue_summary text DEFAULT ''::text NOT NULL,
    diagnosis text DEFAULT ''::text NOT NULL,
    original_message text DEFAULT ''::text NOT NULL,
    state jsonb DEFAULT '{"issue": "", "diagnosis": "", "currentStep": "", "stepsFailed": [], "observations": [], "possibleCauses": [], "stepsCompleted": [], "resolutionStatus": "in_progress", "escalationRequired": false}'::jsonb NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    article_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    pinned_article_id uuid,
    ai_provider public.ai_provider,
    ai_model character varying(120),
    last_operation character varying(60),
    admin_paused boolean DEFAULT false NOT NULL,
    admin_pause_reason text,
    admin_notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_input_tokens integer DEFAULT 0 NOT NULL,
    total_output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    estimated_cost double precision DEFAULT 0 NOT NULL,
    first_response_at timestamp with time zone,
    last_agent_reply_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    escalated_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: troubleshooting_timeline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.troubleshooting_timeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    seq integer NOT NULL,
    role public.timeline_role NOT NULL,
    kind public.timeline_kind NOT NULL,
    summary character varying(500) DEFAULT ''::character varying NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    slack_message_ts character varying(40),
    slack_user_name character varying(120),
    article_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    metadata jsonb,
    provider public.ai_provider,
    model character varying(120),
    input_tokens integer,
    output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(320) NOT NULL,
    name character varying(120) NOT NULL,
    password_hash text NOT NULL,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: ai_instructions ai_instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_instructions
    ADD CONSTRAINT ai_instructions_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: ai_requests ai_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_requests
    ADD CONSTRAINT ai_requests_pkey PRIMARY KEY (id);


--
-- Name: app_logs app_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_logs
    ADD CONSTRAINT app_logs_pkey PRIMARY KEY (id);


--
-- Name: article_images article_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_images
    ADD CONSTRAINT article_images_pkey PRIMARY KEY (id);


--
-- Name: article_steps article_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_steps
    ADD CONSTRAINT article_steps_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: escalations escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_pkey PRIMARY KEY (id);


--
-- Name: processed_events processed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (id);


--
-- Name: slack_channels slack_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_channels
    ADD CONSTRAINT slack_channels_pkey PRIMARY KEY (id);


--
-- Name: slack_files slack_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_files
    ADD CONSTRAINT slack_files_pkey PRIMARY KEY (id);


--
-- Name: slack_messages slack_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_messages
    ADD CONSTRAINT slack_messages_pkey PRIMARY KEY (id);


--
-- Name: slack_users slack_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_users
    ADD CONSTRAINT slack_users_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: troubleshooting_articles troubleshooting_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_articles
    ADD CONSTRAINT troubleshooting_articles_pkey PRIMARY KEY (id);


--
-- Name: troubleshooting_sessions troubleshooting_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_sessions
    ADD CONSTRAINT troubleshooting_sessions_pkey PRIMARY KEY (id);


--
-- Name: troubleshooting_timeline troubleshooting_timeline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_timeline
    ADD CONSTRAINT troubleshooting_timeline_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ai_instructions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_instructions_active_idx ON public.ai_instructions USING btree (is_active);


--
-- Name: ai_providers_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_providers_provider_key ON public.ai_providers USING btree (provider);


--
-- Name: ai_requests_correlation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_requests_correlation_id_idx ON public.ai_requests USING btree (correlation_id);


--
-- Name: ai_requests_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_requests_created_at_idx ON public.ai_requests USING btree (created_at);


--
-- Name: ai_requests_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_requests_provider_idx ON public.ai_requests USING btree (provider);


--
-- Name: ai_requests_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_requests_session_id_idx ON public.ai_requests USING btree (session_id);


--
-- Name: ai_requests_success_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_requests_success_idx ON public.ai_requests USING btree (success);


--
-- Name: app_logs_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_logs_category_idx ON public.app_logs USING btree (category);


--
-- Name: app_logs_correlation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_logs_correlation_id_idx ON public.app_logs USING btree (correlation_id);


--
-- Name: app_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_logs_created_at_idx ON public.app_logs USING btree (created_at);


--
-- Name: app_logs_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_logs_level_idx ON public.app_logs USING btree (level);


--
-- Name: app_logs_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_logs_session_id_idx ON public.app_logs USING btree (session_id);


--
-- Name: article_images_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_images_article_id_idx ON public.article_images USING btree (article_id);


--
-- Name: article_images_step_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_images_step_id_idx ON public.article_images USING btree (step_id);


--
-- Name: article_steps_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_steps_article_id_idx ON public.article_steps USING btree (article_id);


--
-- Name: article_steps_article_position_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX article_steps_article_position_key ON public.article_steps USING btree (article_id, "position");


--
-- Name: audit_logs_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_user_id_idx ON public.audit_logs USING btree (user_id);


--
-- Name: auth_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_expires_at_idx ON public.auth_sessions USING btree (expires_at);


--
-- Name: auth_sessions_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_sessions_token_hash_key ON public.auth_sessions USING btree (token_hash);


--
-- Name: auth_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_user_id_idx ON public.auth_sessions USING btree (user_id);


--
-- Name: documents_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_created_at_idx ON public.documents USING btree (created_at);


--
-- Name: documents_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_status_idx ON public.documents USING btree (status);


--
-- Name: escalations_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalations_created_at_idx ON public.escalations USING btree (created_at);


--
-- Name: escalations_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalations_session_id_idx ON public.escalations USING btree (session_id);


--
-- Name: escalations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalations_status_idx ON public.escalations USING btree (status);


--
-- Name: processed_events_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX processed_events_event_id_key ON public.processed_events USING btree (slack_event_id);


--
-- Name: processed_events_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processed_events_received_at_idx ON public.processed_events USING btree (received_at);


--
-- Name: processed_events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX processed_events_status_idx ON public.processed_events USING btree (status);


--
-- Name: slack_channels_channel_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slack_channels_channel_id_key ON public.slack_channels USING btree (channel_id);


--
-- Name: slack_files_file_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slack_files_file_id_key ON public.slack_files USING btree (slack_file_id);


--
-- Name: slack_files_message_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slack_files_message_ts_idx ON public.slack_files USING btree (channel_id, message_ts);


--
-- Name: slack_messages_channel_ts_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slack_messages_channel_ts_key ON public.slack_messages USING btree (channel_id, slack_message_ts);


--
-- Name: slack_messages_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slack_messages_session_id_idx ON public.slack_messages USING btree (session_id);


--
-- Name: slack_messages_thread_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slack_messages_thread_ts_idx ON public.slack_messages USING btree (channel_id, thread_ts);


--
-- Name: slack_users_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slack_users_name_idx ON public.slack_users USING btree (name);


--
-- Name: slack_users_slack_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slack_users_slack_user_id_key ON public.slack_users USING btree (slack_user_id);


--
-- Name: troubleshooting_articles_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_active_idx ON public.troubleshooting_articles USING btree (is_active);


--
-- Name: troubleshooting_articles_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_category_idx ON public.troubleshooting_articles USING btree (category);


--
-- Name: troubleshooting_articles_description_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_description_trgm_idx ON public.troubleshooting_articles USING gin (issue_description public.gin_trgm_ops);


--
-- Name: troubleshooting_articles_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_priority_idx ON public.troubleshooting_articles USING btree (priority);


--
-- Name: troubleshooting_articles_search_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_search_vector_idx ON public.troubleshooting_articles USING gin (search_vector);


--
-- Name: troubleshooting_articles_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX troubleshooting_articles_slug_key ON public.troubleshooting_articles USING btree (slug);


--
-- Name: troubleshooting_articles_tags_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_tags_idx ON public.troubleshooting_articles USING btree (tags);


--
-- Name: troubleshooting_articles_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_articles_title_trgm_idx ON public.troubleshooting_articles USING gin (title public.gin_trgm_ops);


--
-- Name: troubleshooting_sessions_channel_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_channel_thread_idx ON public.troubleshooting_sessions USING btree (channel_id, thread_ts);


--
-- Name: troubleshooting_sessions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_created_at_idx ON public.troubleshooting_sessions USING btree (created_at);


--
-- Name: troubleshooting_sessions_last_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_last_activity_idx ON public.troubleshooting_sessions USING btree (last_activity_at);


--
-- Name: troubleshooting_sessions_resolution_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_resolution_status_idx ON public.troubleshooting_sessions USING btree (resolution_status);


--
-- Name: troubleshooting_sessions_session_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX troubleshooting_sessions_session_code_key ON public.troubleshooting_sessions USING btree (session_code);


--
-- Name: troubleshooting_sessions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_status_idx ON public.troubleshooting_sessions USING btree (status);


--
-- Name: troubleshooting_sessions_thread_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX troubleshooting_sessions_thread_key ON public.troubleshooting_sessions USING btree (channel_id, thread_ts);


--
-- Name: troubleshooting_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_sessions_user_idx ON public.troubleshooting_sessions USING btree (slack_user_id);


--
-- Name: troubleshooting_timeline_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_timeline_created_at_idx ON public.troubleshooting_timeline USING btree (created_at);


--
-- Name: troubleshooting_timeline_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX troubleshooting_timeline_session_idx ON public.troubleshooting_timeline USING btree (session_id);


--
-- Name: troubleshooting_timeline_session_seq_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX troubleshooting_timeline_session_seq_key ON public.troubleshooting_timeline USING btree (session_id, seq);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (lower((email)::text));


--
-- Name: ai_instructions ai_instructions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_instructions_set_updated_at BEFORE UPDATE ON public.ai_instructions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_providers ai_providers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_providers_set_updated_at BEFORE UPDATE ON public.ai_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: article_steps article_steps_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER article_steps_set_updated_at BEFORE UPDATE ON public.article_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: documents documents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: escalations escalations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER escalations_set_updated_at BEFORE UPDATE ON public.escalations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: slack_channels slack_channels_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER slack_channels_set_updated_at BEFORE UPDATE ON public.slack_channels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: slack_users slack_users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER slack_users_set_updated_at BEFORE UPDATE ON public.slack_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: system_settings system_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER system_settings_set_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: troubleshooting_articles troubleshooting_articles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER troubleshooting_articles_set_updated_at BEFORE UPDATE ON public.troubleshooting_articles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: troubleshooting_sessions troubleshooting_sessions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER troubleshooting_sessions_set_updated_at BEFORE UPDATE ON public.troubleshooting_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_instructions ai_instructions_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_instructions
    ADD CONSTRAINT ai_instructions_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_requests ai_requests_session_id_troubleshooting_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_requests
    ADD CONSTRAINT ai_requests_session_id_troubleshooting_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.troubleshooting_sessions(id) ON DELETE SET NULL;


--
-- Name: article_images article_images_article_id_troubleshooting_articles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_images
    ADD CONSTRAINT article_images_article_id_troubleshooting_articles_id_fk FOREIGN KEY (article_id) REFERENCES public.troubleshooting_articles(id) ON DELETE CASCADE;


--
-- Name: article_images article_images_step_id_article_steps_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_images
    ADD CONSTRAINT article_images_step_id_article_steps_id_fk FOREIGN KEY (step_id) REFERENCES public.article_steps(id) ON DELETE CASCADE;


--
-- Name: article_steps article_steps_article_id_troubleshooting_articles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_steps
    ADD CONSTRAINT article_steps_article_id_troubleshooting_articles_id_fk FOREIGN KEY (article_id) REFERENCES public.troubleshooting_articles(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: auth_sessions auth_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: documents documents_imported_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_imported_by_users_id_fk FOREIGN KEY (imported_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: escalations escalations_acknowledged_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_acknowledged_by_users_id_fk FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: escalations escalations_session_id_troubleshooting_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_session_id_troubleshooting_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.troubleshooting_sessions(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: troubleshooting_articles troubleshooting_articles_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_articles
    ADD CONSTRAINT troubleshooting_articles_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: troubleshooting_articles troubleshooting_articles_source_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_articles
    ADD CONSTRAINT troubleshooting_articles_source_document_id_documents_id_fk FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: troubleshooting_articles troubleshooting_articles_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_articles
    ADD CONSTRAINT troubleshooting_articles_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: troubleshooting_sessions troubleshooting_sessions_pinned_article_id_troubleshooting_arti; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_sessions
    ADD CONSTRAINT troubleshooting_sessions_pinned_article_id_troubleshooting_arti FOREIGN KEY (pinned_article_id) REFERENCES public.troubleshooting_articles(id) ON DELETE SET NULL;


--
-- Name: troubleshooting_timeline troubleshooting_timeline_session_id_troubleshooting_sessions_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.troubleshooting_timeline
    ADD CONSTRAINT troubleshooting_timeline_session_id_troubleshooting_sessions_id FOREIGN KEY (session_id) REFERENCES public.troubleshooting_sessions(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



--
-- Drizzle migration bookkeeping
-- Marks migrations 0000–0002 as applied so the API's automatic migrator
-- skips them (the objects already exist above).
--

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('d374e1505202fc05eb8ace7f5ca792af4fd491c19366e18ce4283c58eae1aa3c', 1790884697777),
  ('2793b559ceefd25e470f35ba1806cfa9d81f9d5cc1f1c3bff7a0aca118173d63', 1790884698777),
  ('fd8ae8c813551a5970286105d33a702cd8ae7df28afcf6dc1a7cd2b2cc5b6221', 1791014113222)
ON CONFLICT DO NOTHING;

SELECT setval('drizzle.__drizzle_migrations_id_seq', (SELECT COALESCE(MAX(id), 1) FROM drizzle.__drizzle_migrations));


--
-- Initial administrator account
-- Email:    admin@example.com
-- Password: ChangeMe_Admin_2026!
-- Change this password immediately after the first login (Users tab).
-- The password hash below is scrypt in the same format the API expects
-- (scrypt$N$r$p$salt$hash) and only inserted when no admin exists yet.
--

INSERT INTO public.users (email, name, password_hash, role)
SELECT 'admin@example.com', 'Administrator',
       'scrypt$32768$8$1$fKplFVsPUClNO8FG9VeQ+Q==$uBQnko+HE+RWEAPsMOLFhimJlTdhhiTUfbU2VlqvizHOWyj/64RzjqeJVDN6ft6aT3j6seOnuW0d1vc4DYCvnw==',
       'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.users WHERE lower(email) = lower('admin@example.com')
);

