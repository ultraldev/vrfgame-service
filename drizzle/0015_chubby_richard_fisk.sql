CREATE TABLE "fiat_order" (
	"amount" bigint NOT NULL,
	"auth_url" text,
	"confirm_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"failure_reason" text,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"ledger_lock_transaction_id" text,
	"ledger_settle_transaction_id" text,
	"ledger_transaction_id" text,
	"ledger_unlock_transaction_id" text,
	"merchant_order_no" text NOT NULL,
	"need_auth" boolean DEFAULT false NOT NULL,
	"need_user_confirm" boolean DEFAULT false NOT NULL,
	"original_order_id" text,
	"payout_amount" bigint,
	"provider_fee" bigint DEFAULT 0 NOT NULL,
	"provider_id" text NOT NULL,
	"provider_order_no" text,
	"provider_payload" jsonb,
	"request_hash" text NOT NULL,
	"request_payload" jsonb,
	"route_id" text NOT NULL,
	"settled_at" timestamp,
	"status" text NOT NULL,
	"submitted_at" timestamp,
	"type" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_fee" bigint DEFAULT 0 NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text,
	CONSTRAINT "fiat_order_type_check" CHECK ("fiat_order"."type" in ('deposit', 'payout', 'refund')),
	CONSTRAINT "fiat_order_status_check" CHECK ("fiat_order"."status" in ('creating', 'pending', 'pending_review', 'queued', 'submitting', 'submit_unconfirmed', 'processing', 'pending_approval', 'succeeded', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "fiat_order_amount_check" CHECK ("fiat_order"."amount" > 0),
	CONSTRAINT "fiat_order_fee_check" CHECK ("fiat_order"."user_fee" >= 0 and "fiat_order"."user_fee" <= "fiat_order"."amount" and "fiat_order"."provider_fee" >= 0 and ("fiat_order"."payout_amount" is null or ("fiat_order"."payout_amount" >= 0 and "fiat_order"."payout_amount" <= "fiat_order"."amount")))
);
--> statement-breakpoint
CREATE TABLE "fiat_route" (
	"billing_required" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"deposit_enabled" boolean DEFAULT true NOT NULL,
	"deposit_fee_fixed" bigint DEFAULT 0 NOT NULL,
	"deposit_fee_rate_bps" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"max_deposit_amount" bigint,
	"max_withdraw_amount" bigint,
	"min_deposit_amount" bigint,
	"min_withdraw_amount" bigint,
	"payment_method" text NOT NULL,
	"payout_account_type" text,
	"payout_fee_fixed" bigint DEFAULT 0 NOT NULL,
	"payout_fee_rate_bps" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"provider_id" text NOT NULL,
	"provider_payment_code" text NOT NULL,
	"review_withdraw_amount" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"withdrawal_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fiat_route_deposit_fee_check" CHECK ("fiat_route"."deposit_fee_rate_bps" >= 0 and "fiat_route"."deposit_fee_rate_bps" <= 10000 and "fiat_route"."deposit_fee_fixed" >= 0),
	CONSTRAINT "fiat_route_payout_fee_check" CHECK ("fiat_route"."payout_fee_rate_bps" >= 0 and "fiat_route"."payout_fee_rate_bps" <= 10000 and "fiat_route"."payout_fee_fixed" >= 0),
	CONSTRAINT "fiat_route_payout_account_type_check" CHECK ("fiat_route"."payout_account_type" is null or "fiat_route"."payout_account_type" in ('card', 'paypal', 'cash_app'))
);
--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_original_order_id_fiat_order_id_fk" FOREIGN KEY ("original_order_id") REFERENCES "public"."fiat_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_route_id_fiat_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."fiat_route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_order" ADD CONSTRAINT "fiat_order_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_route" ADD CONSTRAINT "fiat_route_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_route" ADD CONSTRAINT "fiat_route_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_order_user_idempotency_idx" ON "fiat_order" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fiat_order_provider_type_merchant_idx" ON "fiat_order" USING btree ("provider_id","type","merchant_order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_order_provider_order_idx" ON "fiat_order" USING btree ("provider_id","provider_order_no");--> statement-breakpoint
CREATE INDEX "fiat_order_user_created_idx" ON "fiat_order" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "fiat_order_status_created_idx" ON "fiat_order" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "fiat_order_original_idx" ON "fiat_order" USING btree ("original_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_route_code_idx" ON "fiat_route" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_route_provider_code_currency_idx" ON "fiat_route" USING btree ("provider_id","provider_payment_code","currency_code");--> statement-breakpoint
CREATE INDEX "fiat_route_currency_enabled_idx" ON "fiat_route" USING btree ("currency_code","enabled","priority");