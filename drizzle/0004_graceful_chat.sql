CREATE TABLE "game_fairness_seed" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"game_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"nonce" integer DEFAULT 0 NOT NULL,
	"revealed_at" timestamp,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "game_fairness_seed_status_check" CHECK ("game_fairness_seed"."status" in ('active', 'revealed'))
);
--> statement-breakpoint
CREATE TABLE "game_bet" (
	"amount" bigint NOT NULL,
	"client_seed" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"game_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"nonce" integer NOT NULL,
	"payout" bigint NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"seed_id" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	CONSTRAINT "game_bet_status_check" CHECK ("game_bet"."status" in ('active', 'settled', 'cashed_out', 'lost', 'cancelled')),
	CONSTRAINT "game_bet_amount_check" CHECK ("game_bet"."amount" > 0),
	CONSTRAINT "game_bet_payout_check" CHECK ("game_bet"."payout" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_risk_limit" (
	"currency" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"game_id" text NOT NULL,
	"max_bet" bigint NOT NULL,
	"max_payout" bigint,
	"min_bet" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_risk_limit_game_id_currency_pk" PRIMARY KEY("game_id","currency"),
	CONSTRAINT "game_risk_limit_min_check" CHECK ("game_risk_limit"."min_bet" > 0),
	CONSTRAINT "game_risk_limit_range_check" CHECK ("game_risk_limit"."max_bet" >= "game_risk_limit"."min_bet"),
	CONSTRAINT "game_risk_limit_payout_check" CHECK ("game_risk_limit"."max_payout" is null or "game_risk_limit"."max_payout" > 0)
);
--> statement-breakpoint
ALTER TABLE "game_fairness_seed" ADD CONSTRAINT "game_fairness_seed_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_fairness_seed" ADD CONSTRAINT "game_fairness_seed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_bet" ADD CONSTRAINT "game_bet_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_bet" ADD CONSTRAINT "game_bet_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_bet" ADD CONSTRAINT "game_bet_seed_id_game_fairness_seed_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."game_fairness_seed"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_bet" ADD CONSTRAINT "game_bet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_bet" ADD CONSTRAINT "game_bet_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_risk_limit" ADD CONSTRAINT "game_risk_limit_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_risk_limit" ADD CONSTRAINT "game_risk_limit_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_fairness_seed_user_status_idx" ON "game_fairness_seed" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "game_fairness_seed_game_id_idx" ON "game_fairness_seed" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_fairness_seed_user_game_status_idx" ON "game_fairness_seed" USING btree ("user_id","game_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "game_fairness_seed_user_game_active_idx" ON "game_fairness_seed" USING btree ("user_id","game_id") WHERE "game_fairness_seed"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "game_bet_user_idempotency_idx" ON "game_bet" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "game_bet_user_game_created_id_idx" ON "game_bet" USING btree ("user_id","game_id","created_at","id");--> statement-breakpoint
CREATE INDEX "game_bet_game_created_id_idx" ON "game_bet" USING btree ("game_id","created_at","id");--> statement-breakpoint
CREATE INDEX "game_bet_seed_id_idx" ON "game_bet" USING btree ("seed_id");--> statement-breakpoint
CREATE INDEX "game_bet_wallet_id_idx" ON "game_bet" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "game_bet_currency_idx" ON "game_bet" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "game_risk_limit_currency_idx" ON "game_risk_limit" USING btree ("currency");