CREATE TABLE "crypto_withdrawal" (
	"amount" bigint NOT NULL,
	"chain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"external_ref_id" text,
	"failure_reason" text,
	"fee" bigint DEFAULT 0 NOT NULL,
	"fee_quoted_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_check_error" text,
	"last_checked_at" timestamp,
	"ledger_lock_transaction_id" text,
	"ledger_settle_transaction_id" text,
	"ledger_unlock_transaction_id" text,
	"platform_fee" bigint DEFAULT 0 NOT NULL,
	"provider_fee" bigint DEFAULT 0 NOT NULL,
	"provider_id" text NOT NULL,
	"provider_payload" jsonb,
	"quoted_fee" bigint DEFAULT 0 NOT NULL,
	"request_hash" text NOT NULL,
	"route_id" text NOT NULL,
	"settled_at" timestamp,
	"status" text NOT NULL,
	"submitted_at" timestamp,
	"symbol" text NOT NULL,
	"to_address" text NOT NULL,
	"tx_hash" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	CONSTRAINT "crypto_withdrawal_status_check" CHECK ("crypto_withdrawal"."status" in ('pending_review', 'queued', 'submitting', 'submit_unconfirmed', 'processing', 'pending_approval', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "crypto_withdrawal_amount_check" CHECK ("crypto_withdrawal"."amount" > 0),
	CONSTRAINT "crypto_withdrawal_fee_check" CHECK ("crypto_withdrawal"."fee" >= 0 and "crypto_withdrawal"."fee" <= "crypto_withdrawal"."amount" and "crypto_withdrawal"."quoted_fee" >= 0 and "crypto_withdrawal"."quoted_fee" <= "crypto_withdrawal"."amount" and "crypto_withdrawal"."platform_fee" >= 0 and "crypto_withdrawal"."provider_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "crypto_withdrawal" ADD CONSTRAINT "crypto_withdrawal_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_withdrawal" ADD CONSTRAINT "crypto_withdrawal_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_withdrawal" ADD CONSTRAINT "crypto_withdrawal_route_id_crypto_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."crypto_route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_withdrawal" ADD CONSTRAINT "crypto_withdrawal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_withdrawal" ADD CONSTRAINT "crypto_withdrawal_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_withdrawal_user_idempotency_idx" ON "crypto_withdrawal" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_withdrawal_provider_ref_idx" ON "crypto_withdrawal" USING btree ("provider_id","external_ref_id");--> statement-breakpoint
CREATE INDEX "crypto_withdrawal_user_created_idx" ON "crypto_withdrawal" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "crypto_withdrawal_status_created_idx" ON "crypto_withdrawal" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "crypto_withdrawal_currency_idx" ON "crypto_withdrawal" USING btree ("currency_code");--> statement-breakpoint
CREATE INDEX "crypto_withdrawal_wallet_idx" ON "crypto_withdrawal" USING btree ("wallet_id");