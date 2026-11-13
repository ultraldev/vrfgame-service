CREATE TABLE "crypto_route" (
	"chain" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"deposit_enabled" boolean DEFAULT true NOT NULL,
	"deposit_fee_rate_bps" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"max_deposit_amount" bigint,
	"max_withdraw_amount" bigint,
	"min_deposit_amount" bigint,
	"min_withdraw_amount" bigint,
	"payout_fee_fixed" bigint DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"provider_id" text NOT NULL,
	"review_withdraw_amount" bigint,
	"symbol" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"withdrawal_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "crypto_route_deposit_fee_check" CHECK ("crypto_route"."deposit_fee_rate_bps" >= 0 and "crypto_route"."deposit_fee_rate_bps" <= 10000),
	CONSTRAINT "crypto_route_payout_fee_check" CHECK ("crypto_route"."payout_fee_fixed" >= 0),
	CONSTRAINT "crypto_route_min_deposit_check" CHECK ("crypto_route"."min_deposit_amount" is null or "crypto_route"."min_deposit_amount" >= 0),
	CONSTRAINT "crypto_route_max_deposit_check" CHECK ("crypto_route"."max_deposit_amount" is null or "crypto_route"."max_deposit_amount" >= 0),
	CONSTRAINT "crypto_route_deposit_range_check" CHECK ("crypto_route"."min_deposit_amount" is null or "crypto_route"."max_deposit_amount" is null or "crypto_route"."min_deposit_amount" <= "crypto_route"."max_deposit_amount"),
	CONSTRAINT "crypto_route_min_withdraw_check" CHECK ("crypto_route"."min_withdraw_amount" is null or "crypto_route"."min_withdraw_amount" >= 0),
	CONSTRAINT "crypto_route_max_withdraw_check" CHECK ("crypto_route"."max_withdraw_amount" is null or "crypto_route"."max_withdraw_amount" >= 0),
	CONSTRAINT "crypto_route_withdraw_range_check" CHECK ("crypto_route"."min_withdraw_amount" is null or "crypto_route"."max_withdraw_amount" is null or "crypto_route"."min_withdraw_amount" <= "crypto_route"."max_withdraw_amount"),
	CONSTRAINT "crypto_route_review_withdraw_check" CHECK ("crypto_route"."review_withdraw_amount" is null or "crypto_route"."review_withdraw_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_provider" (
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deposit_enabled" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"withdrawal_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_event" (
	"dedupe_key" text NOT NULL,
	"event_type" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"processed_at" timestamp,
	"processing_error" text,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"provider_event_id" text,
	"provider_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"signature_valid" boolean NOT NULL,
	CONSTRAINT "payment_webhook_event_type_check" CHECK ("payment_webhook_event"."event_type" in ('deposit', 'withdrawal', 'refund')),
	CONSTRAINT "payment_webhook_event_status_check" CHECK ("payment_webhook_event"."processing_status" in ('received', 'processing', 'processed', 'ignored', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "crypto_route" ADD CONSTRAINT "crypto_route_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_route" ADD CONSTRAINT "crypto_route_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_event" ADD CONSTRAINT "payment_webhook_event_provider_id_payment_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_route_code_idx" ON "crypto_route" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_route_provider_asset_idx" ON "crypto_route" USING btree ("provider_id","chain","symbol","currency_code");--> statement-breakpoint
CREATE INDEX "crypto_route_currency_enabled_idx" ON "crypto_route" USING btree ("currency_code","enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_code_idx" ON "payment_provider" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_event_provider_dedupe_idx" ON "payment_webhook_event" USING btree ("provider_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "payment_webhook_event_status_received_idx" ON "payment_webhook_event" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "payment_webhook_event_provider_received_idx" ON "payment_webhook_event" USING btree ("provider_id","received_at");--> statement-breakpoint
ALTER TABLE "currency" DROP COLUMN "deposit_enabled";--> statement-breakpoint
ALTER TABLE "currency" DROP COLUMN "withdrawal_enabled";