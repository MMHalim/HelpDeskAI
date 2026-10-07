CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"feature_key" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "troubleshooting_sessions" ALTER COLUMN "state" SET DEFAULT '{"issue":"","diagnosis":"","stepsCompleted":[],"stepsFailed":[],"currentStep":"","observations":[],"possibleCauses":[],"resolutionStatus":"in_progress","escalationRequired":false,"kbTotalSteps":0,"kbStepsCompleted":0,"kbLastArticleTitle":""}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE varchar(64) USING "role"::text;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_key" ON "roles" USING btree ("key");--> statement-breakpoint
DROP TYPE "public"."user_role";