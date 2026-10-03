-- Extensions and indexes that support knowledge-base retrieval (§17).
-- pg_trgm enables fuzzy keyword matching (typos, partial words) on top of the
-- generated tsvector column, so retrieval stays useful for short agent messages.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "troubleshooting_articles_title_trgm_idx"
  ON "troubleshooting_articles" USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "troubleshooting_articles_description_trgm_idx"
  ON "troubleshooting_articles" USING gin (issue_description gin_trgm_ops);
--> statement-breakpoint
-- Keeps `updated_at` honest when rows are changed outside the application.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'slack_users', 'slack_channels', 'documents',
    'troubleshooting_articles', 'article_steps', 'troubleshooting_sessions',
    'ai_providers', 'ai_instructions', 'escalations', 'system_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END $$;
