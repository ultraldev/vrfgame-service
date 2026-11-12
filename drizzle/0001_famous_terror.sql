CREATE TABLE "ranking_entry" (
	"bet_count" integer NOT NULL,
	"bucket_date" date NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"period_type" text DEFAULT 'daily' NOT NULL,
	"user_id" text NOT NULL,
	"wagered" bigint NOT NULL,
	CONSTRAINT "ranking_entry_period_type_bucket_date_user_id_pk" PRIMARY KEY("period_type","bucket_date","user_id"),
	CONSTRAINT "ranking_entry_wagered_check" CHECK ("ranking_entry"."wagered" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ranking_period" (
	"bucket_date" date NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"period_type" text DEFAULT 'daily' NOT NULL,
	"wagered" bigint NOT NULL,
	CONSTRAINT "ranking_period_period_type_bucket_date_pk" PRIMARY KEY("period_type","bucket_date"),
	CONSTRAINT "ranking_period_wagered_check" CHECK ("ranking_period"."wagered" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ranking_reward" (
	"amount" bigint NOT NULL,
	"bucket_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"held_reason" text,
	"percentage_bps" integer NOT NULL,
	"period_type" text DEFAULT 'daily' NOT NULL,
	"pool_amount" bigint NOT NULL,
	"rank" integer NOT NULL,
	"resolved_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text NOT NULL,
	"wagered" bigint NOT NULL,
	"wallet_transaction_id" text,
	CONSTRAINT "ranking_reward_period_type_bucket_date_rank_pk" PRIMARY KEY("period_type","bucket_date","rank"),
	CONSTRAINT "ranking_reward_status_check" CHECK ("ranking_reward"."status" in ('pending', 'held', 'paid', 'skipped')),
	CONSTRAINT "ranking_reward_amount_check" CHECK ("ranking_reward"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ranking_entry" ADD CONSTRAINT "ranking_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_reward" ADD CONSTRAINT "ranking_reward_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_reward" ADD CONSTRAINT "ranking_reward_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ranking_entry_user_id_idx" ON "ranking_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ranking_entry_bucket_wagered_idx" ON "ranking_entry" USING btree ("period_type","bucket_date","wagered");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_reward_bucket_user_idx" ON "ranking_reward" USING btree ("period_type","bucket_date","user_id");--> statement-breakpoint
CREATE INDEX "ranking_reward_status_idx" ON "ranking_reward" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ranking_reward_user_id_idx" ON "ranking_reward" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ranking_reward_currency_idx" ON "ranking_reward" USING btree ("currency");