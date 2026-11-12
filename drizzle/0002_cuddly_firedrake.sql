CREATE TABLE "wallet" (
	"balance" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"locked_balance" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "wallet_locked_balance_nonnegative_check" CHECK ("wallet"."locked_balance" >= 0),
	CONSTRAINT "wallet_version_nonnegative_check" CHECK ("wallet"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transaction" (
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text,
	"reference_id" text NOT NULL,
	"reference_type" text NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"wallet_id" text NOT NULL,
	CONSTRAINT "wallet_transaction_type_check" CHECK ("wallet_transaction"."type" in ('debit', 'credit', 'lock', 'unlock', 'settle')),
	CONSTRAINT "wallet_transaction_amount_nonnegative_check" CHECK ("wallet_transaction"."amount" >= 0),
	CONSTRAINT "wallet_transaction_version_nonnegative_check" CHECK ("wallet_transaction"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_wallet_id_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_user_currency_idx" ON "wallet" USING btree ("user_id","currency");--> statement-breakpoint
CREATE INDEX "wallet_currency_idx" ON "wallet" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "wallet_transaction_wallet_created_id_idx" ON "wallet_transaction" USING btree ("wallet_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transaction_idempotency_idx" ON "wallet_transaction" USING btree ("wallet_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_transaction_ref_created_idx" ON "wallet_transaction" USING btree ("reference_type","created_at");