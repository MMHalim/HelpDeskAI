CREATE TYPE "public"."categorization_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."incident_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "issue_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(140) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_categorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	"source" "categorization_source" DEFAULT 'ai' NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"categorized_by" uuid,
	"categorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority_level" "incident_priority" DEFAULT 'medium' NOT NULL,
	"operational_impact" text DEFAULT '' NOT NULL,
	"baseline_incident_count" integer DEFAULT 0 NOT NULL,
	"baseline_percentage" double precision DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "troubleshooting_articles" ADD COLUMN "subcategory_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_categorizations" ADD CONSTRAINT "issue_categorizations_session_id_troubleshooting_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."troubleshooting_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_categorizations" ADD CONSTRAINT "issue_categorizations_category_id_issue_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."issue_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_categorizations" ADD CONSTRAINT "issue_categorizations_subcategory_id_issue_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."issue_subcategories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_categorizations" ADD CONSTRAINT "issue_categorizations_categorized_by_users_id_fk" FOREIGN KEY ("categorized_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subcategories" ADD CONSTRAINT "issue_subcategories_category_id_issue_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."issue_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_categories_slug_key" ON "issue_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_categories_name_key" ON "issue_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "issue_categories_sort_order_idx" ON "issue_categories" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_categorizations_session_key" ON "issue_categorizations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "issue_categorizations_category_idx" ON "issue_categorizations" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "issue_categorizations_subcategory_idx" ON "issue_categorizations" USING btree ("subcategory_id");--> statement-breakpoint
CREATE INDEX "issue_categorizations_categorized_at_idx" ON "issue_categorizations" USING btree ("categorized_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_subcategories_slug_key" ON "issue_subcategories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_subcategories_category_name_key" ON "issue_subcategories" USING btree ("category_id","name");--> statement-breakpoint
CREATE INDEX "issue_subcategories_category_idx" ON "issue_subcategories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "issue_subcategories_priority_idx" ON "issue_subcategories" USING btree ("priority_level");--> statement-breakpoint
ALTER TABLE "troubleshooting_articles" ADD CONSTRAINT "troubleshooting_articles_subcategory_id_issue_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."issue_subcategories"("id") ON DELETE set null ON UPDATE no action;