ALTER TYPE "public"."session_status" ADD VALUE 'assigned' BEFORE 'paused';--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE 'waiting_on_user' BEFORE 'paused';
