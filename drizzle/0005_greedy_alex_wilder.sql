CREATE TABLE "risk_event" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"dedupe_key" text,
	"details" jsonb,
	"detector" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" text,
	"reference_type" text,
	"severity" text DEFAULT 'warning' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	CONSTRAINT "risk_event_type_check" CHECK ("risk_event"."type" in ('bet_rejected')),
	CONSTRAINT "risk_event_severity_check" CHECK ("risk_event"."severity" in ('info', 'warning', 'critical')),
	CONSTRAINT "risk_event_status_check" CHECK ("risk_event"."status" in ('open', 'reviewing', 'dismissed', 'actioned'))
);
--> statement-breakpoint
CREATE TABLE "user_bet_counter" (
	"bucket" text NOT NULL,
	"currency" text NOT NULL,
	"payout" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"wagered" bigint NOT NULL,
	"window" text NOT NULL,
	CONSTRAINT "user_bet_counter_user_id_currency_window_bucket_pk" PRIMARY KEY("user_id","currency","window","bucket"),
	CONSTRAINT "user_bet_counter_window_check" CHECK ("user_bet_counter"."window" in ('day', 'week')),
	CONSTRAINT "user_bet_counter_wagered_check" CHECK ("user_bet_counter"."wagered" >= 0),
	CONSTRAINT "user_bet_counter_payout_check" CHECK ("user_bet_counter"."payout" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_exclusion" (
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_exclusion_type_check" CHECK ("user_exclusion"."type" in ('self_exclusion', 'cooling_off'))
);
--> statement-breakpoint
CREATE TABLE "user_risk_limit" (
	"currency" text NOT NULL,
	"daily_bet_cap" bigint,
	"daily_loss_cap" bigint,
	"single_bet_cap" bigint,
	"source" text DEFAULT 'user' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"weekly_bet_cap" bigint,
	"weekly_loss_cap" bigint,
	CONSTRAINT "user_risk_limit_user_id_currency_source_pk" PRIMARY KEY("user_id","currency","source"),
	CONSTRAINT "user_risk_limit_source_check" CHECK ("user_risk_limit"."source" in ('user', 'admin')),
	CONSTRAINT "user_risk_limit_single_bet_check" CHECK ("user_risk_limit"."single_bet_cap" is null or "user_risk_limit"."single_bet_cap" > 0),
	CONSTRAINT "user_risk_limit_daily_bet_check" CHECK ("user_risk_limit"."daily_bet_cap" is null or "user_risk_limit"."daily_bet_cap" > 0),
	CONSTRAINT "user_risk_limit_weekly_bet_check" CHECK ("user_risk_limit"."weekly_bet_cap" is null or "user_risk_limit"."weekly_bet_cap" > 0),
	CONSTRAINT "user_risk_limit_daily_loss_check" CHECK ("user_risk_limit"."daily_loss_cap" is null or "user_risk_limit"."daily_loss_cap" > 0),
	CONSTRAINT "user_risk_limit_weekly_loss_check" CHECK ("user_risk_limit"."weekly_loss_cap" is null or "user_risk_limit"."weekly_loss_cap" > 0)
);
--> statement-breakpoint
ALTER TABLE "risk_event" ADD CONSTRAINT "risk_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bet_counter" ADD CONSTRAINT "user_bet_counter_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bet_counter" ADD CONSTRAINT "user_bet_counter_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exclusion" ADD CONSTRAINT "user_exclusion_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_risk_limit" ADD CONSTRAINT "user_risk_limit_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_risk_limit" ADD CONSTRAINT "user_risk_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risk_event_user_created_idx" ON "risk_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_event_status_created_idx" ON "risk_event" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_event_dedupe_key_idx" ON "risk_event" USING btree ("dedupe_key") WHERE "risk_event"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "user_exclusion_user_active_idx" ON "user_exclusion" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_exclusion_one_active_per_type_idx" ON "user_exclusion" USING btree ("user_id","type") WHERE "user_exclusion"."active" = true;