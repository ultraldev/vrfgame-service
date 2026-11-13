CREATE TABLE "case_fairness_seed" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"nonce" integer DEFAULT 0 NOT NULL,
	"revealed_at" timestamp,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "case_fairness_seed_status_check" CHECK ("case_fairness_seed"."status" in ('active', 'revealed'))
);
--> statement-breakpoint
CREATE TABLE "case_open" (
	"amount" bigint NOT NULL,
	"client_seed" text NOT NULL,
	"crate_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"nonce" integer NOT NULL,
	"payout" bigint NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"revision_id" text NOT NULL,
	"seed_id" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	CONSTRAINT "case_open_status_check" CHECK ("case_open"."status" = 'settled'),
	CONSTRAINT "case_open_amount_check" CHECK ("case_open"."amount" > 0),
	CONSTRAINT "case_open_payout_check" CHECK ("case_open"."payout" >= 0)
);
--> statement-breakpoint
ALTER TABLE "case_fairness_seed" ADD CONSTRAINT "case_fairness_seed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_crate_id_crate_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_revision_id_crate_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."crate_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_seed_id_case_fairness_seed_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."case_fairness_seed"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_open" ADD CONSTRAINT "case_open_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_fairness_seed_user_status_idx" ON "case_fairness_seed" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "case_fairness_seed_user_active_idx" ON "case_fairness_seed" USING btree ("user_id") WHERE "case_fairness_seed"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "case_open_user_idempotency_idx" ON "case_open" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "case_open_user_created_id_idx" ON "case_open" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "case_open_crate_created_idx" ON "case_open" USING btree ("crate_id","created_at");--> statement-breakpoint
CREATE INDEX "case_open_wallet_id_idx" ON "case_open" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "case_open_currency_idx" ON "case_open" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "case_open_revision_id_idx" ON "case_open" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "case_open_seed_id_idx" ON "case_open" USING btree ("seed_id");