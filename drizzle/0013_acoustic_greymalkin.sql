CREATE TABLE "crypto_deposit" (
	"actual_amount" bigint,
	"address" text,
	"app_pay_url" text,
	"chain" text NOT NULL,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"expected_amount" bigint NOT NULL,
	"expires_at" timestamp,
	"failure_reason" text,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_check_error" text,
	"last_checked_at" timestamp,
	"ledger_transaction_id" text,
	"platform_fee" bigint DEFAULT 0 NOT NULL,
	"platform_fee_rate_bps" integer,
	"provider_id" text NOT NULL,
	"provider_order_id" text,
	"provider_payload" jsonb,
	"provider_tx_id" text,
	"request_hash" text NOT NULL,
	"request_id" text NOT NULL,
	"route_id" text NOT NULL,
	"status" text NOT NULL,
	"symbol" text NOT NULL,
	"tx_hash" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text,
	CONSTRAINT "crypto_deposit_status_check" CHECK ("crypto_deposit"."status" in ('creating', 'pending', 'processing', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "crypto_deposit_expected_amount_check" CHECK ("crypto_deposit"."expected_amount" > 0),
	CONSTRAINT "crypto_deposit_actual_amount_check" CHECK ("crypto_deposit"."actual_amount" is null or "crypto_deposit"."actual_amount" >= 0),
	CONSTRAINT "crypto_deposit_platform_fee_check" CHECK ("crypto_deposit"."platform_fee" >= 0 and ("crypto_deposit"."platform_fee_rate_bps" is null or ("crypto_deposit"."platform_fee_rate_bps" >= 0 and "crypto_deposit"."platform_fee_rate_bps" <= 10000)))
);
--> statement-breakpoint
ALTER TABLE "crypto_deposit" ADD CONSTRAINT "crypto_deposit_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_deposit" ADD CONSTRAINT "crypto_deposit_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_deposit" ADD CONSTRAINT "crypto_deposit_route_id_crypto_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."crypto_route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_deposit" ADD CONSTRAINT "crypto_deposit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_deposit" ADD CONSTRAINT "crypto_deposit_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_deposit_user_idempotency_idx" ON "crypto_deposit" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_deposit_provider_request_idx" ON "crypto_deposit" USING btree ("provider_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_deposit_provider_order_idx" ON "crypto_deposit" USING btree ("provider_id","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_deposit_provider_tx_idx" ON "crypto_deposit" USING btree ("provider_id","provider_tx_id");--> statement-breakpoint
CREATE INDEX "crypto_deposit_user_created_idx" ON "crypto_deposit" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "crypto_deposit_status_expires_idx" ON "crypto_deposit" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "crypto_deposit_provider_address_idx" ON "crypto_deposit" USING btree ("provider_id","address");--> statement-breakpoint
CREATE INDEX "crypto_deposit_ledger_transaction_idx" ON "crypto_deposit" USING btree ("ledger_transaction_id");