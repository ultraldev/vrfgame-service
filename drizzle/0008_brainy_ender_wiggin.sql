ALTER TABLE "crash_round" DROP CONSTRAINT "crash_round_phase_check";--> statement-breakpoint
ALTER TABLE "crash_round" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crash_round" ADD CONSTRAINT "crash_round_phase_check" CHECK ("crash_round"."phase" in ('pending', 'betting', 'running', 'crashed'));