CREATE TABLE "ranking_settlement_clock" (
	"next_bucket_date" date NOT NULL,
	"period_type" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ranking_period" ADD COLUMN "due_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_period" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ranking_period" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "ranking_period" ADD COLUMN "settlement_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_period" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_reward" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_reward" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "ranking_period_due_idx" ON "ranking_period" USING btree ("status","due_at");--> statement-breakpoint
ALTER TABLE "ranking_period" ADD CONSTRAINT "ranking_period_status_check" CHECK ("ranking_period"."status" in ('open', 'settled', 'failed'));--> statement-breakpoint
ALTER TABLE "ranking_period" ADD CONSTRAINT "ranking_period_settlement_attempts_check" CHECK ("ranking_period"."settlement_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "ranking_reward" ADD CONSTRAINT "ranking_reward_attempts_check" CHECK ("ranking_reward"."attempts" >= 0);