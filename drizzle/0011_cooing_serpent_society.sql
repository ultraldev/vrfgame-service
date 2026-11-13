CREATE TABLE "raffle_entry" (
	"amount" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"first_number" integer NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_number" integer NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"request_hash" text NOT NULL,
	"round_id" text NOT NULL,
	"share_count" integer NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	CONSTRAINT "raffle_entry_amount_check" CHECK ("raffle_entry"."amount" > 0),
	CONSTRAINT "raffle_entry_shares_check" CHECK ("raffle_entry"."share_count" > 0),
	CONSTRAINT "raffle_entry_range_check" CHECK ("raffle_entry"."first_number" >= 1 and "raffle_entry"."last_number" >= "raffle_entry"."first_number")
);
--> statement-breakpoint
ALTER TABLE "raffle_entry" ADD CONSTRAINT "raffle_entry_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_entry" ADD CONSTRAINT "raffle_entry_round_id_raffle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."raffle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_entry" ADD CONSTRAINT "raffle_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_entry" ADD CONSTRAINT "raffle_entry_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_entry_user_idempotency_idx" ON "raffle_entry" USING btree ("round_id","user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "raffle_entry_round_numbers_idx" ON "raffle_entry" USING btree ("round_id","first_number","last_number");--> statement-breakpoint
CREATE INDEX "raffle_entry_user_created_idx" ON "raffle_entry" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "raffle_entry_round_user_idx" ON "raffle_entry" USING btree ("round_id","user_id");--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_capacity_check" CHECK ("raffle_round"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_counts_check" CHECK ("raffle_round"."sold" >= 0 and "raffle_round"."sold_gift" >= 0 and "raffle_round"."sold_gift" <= "raffle_round"."sold" and "raffle_round"."bot_shares" >= 0 and "raffle_round"."sold" <= "raffle_round"."capacity");--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_price_check" CHECK ("raffle_round"."share_price" > 0);--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_payout_check" CHECK ("raffle_round"."payout_amount" > 0);