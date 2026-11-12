CREATE SEQUENCE "public"."user_uid_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp,
	"account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"id_token" text,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crate" (
	"base_currency" text,
	"cover_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"current_revision_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"published_at" timestamp,
	"rtp_bps" integer,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tag" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crate_status_check" CHECK ("crate"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "crate_tag_check" CHECK ("crate"."tag" is null or "crate"."tag" in ('new', 'hot'))
);
--> statement-breakpoint
CREATE TABLE "crate_price" (
	"crate_id" text NOT NULL,
	"currency" text NOT NULL,
	"price" bigint NOT NULL,
	CONSTRAINT "crate_price_crate_id_currency_pk" PRIMARY KEY("crate_id","currency"),
	CONSTRAINT "crate_price_check" CHECK ("crate_price"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "crate_revision" (
	"crate_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"items" jsonb NOT NULL,
	"rtp_bps" integer NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency" (
	"archived_at" timestamp,
	"betting_enabled" boolean DEFAULT false NOT NULL,
	"code" text PRIMARY KEY NOT NULL,
	"decimals" integer NOT NULL,
	"deposit_enabled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"locale" text NOT NULL,
	"symbol" text NOT NULL,
	"type" text NOT NULL,
	"wallet_enabled" boolean DEFAULT true NOT NULL,
	"withdrawal_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"category" text NOT NULL,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"is_featured" boolean DEFAULT false,
	"is_hot" boolean DEFAULT false,
	"is_new" boolean DEFAULT false,
	"launch_type" text NOT NULL,
	"name" text NOT NULL,
	"provider_game_id" text,
	"provider_id" text,
	"rtp" integer,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"subcategory" text,
	"tags" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"volatility" text,
	CONSTRAINT "game_launch_type_check" CHECK ("game"."launch_type" in ('internal', 'iframe', 'redirect', 'api')),
	CONSTRAINT "game_category_check" CHECK ("game"."category" in ('slots', 'live_casino', 'table', 'inhouse', 'fishing', 'arcade', 'lottery')),
	CONSTRAINT "game_status_check" CHECK ("game"."status" in ('active', 'inactive', 'maintenance'))
);
--> statement-breakpoint
CREATE TABLE "game_asset" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"game_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"sort_order" integer DEFAULT 0,
	"type" text NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "game_asset_type_check" CHECK ("game_asset"."type" in ('icon', 'thumbnail', 'banner', 'background'))
);
--> statement-breakpoint
CREATE TABLE "game_provider" (
	"code" text NOT NULL,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"aaguid" text,
	"backed_up" boolean NOT NULL,
	"counter" integer NOT NULL,
	"created_at" timestamp,
	"credential_id" text NOT NULL,
	"device_type" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"transports" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raffle_round" (
	"bot_shares" integer DEFAULT 0 NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"early_window_sec" integer NOT NULL,
	"ends_at" timestamp NOT NULL,
	"gift_cap_bps" integer NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"payout_amount" bigint NOT NULL,
	"payout_currency" text NOT NULL,
	"round_number" integer NOT NULL,
	"server_seed" text,
	"server_seed_hash" text NOT NULL,
	"settled_at" timestamp,
	"share_price" bigint NOT NULL,
	"sku_id" text NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"sold_gift" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"tau_bps" integer NOT NULL,
	"tau_early_bps" integer NOT NULL,
	"winner_is_platform" boolean DEFAULT false NOT NULL,
	"winner_user_id" text,
	"winning_number" integer,
	CONSTRAINT "raffle_round_status_check" CHECK ("raffle_round"."status" in ('open', 'drawing', 'settled', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "raffle_sku" (
	"category" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"duration_sec" integer NOT NULL,
	"early_window_sec" integer NOT NULL,
	"gift_cap_bps" integer NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image_url" text,
	"name" text NOT NULL,
	"payout_amount" bigint NOT NULL,
	"payout_currency" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tag" text,
	"tau_bps" integer NOT NULL,
	"tau_early_bps" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "raffle_sku_category_check" CHECK ("raffle_sku"."category" in ('cs2', 'dota2', 'digital', 'motorcycle')),
	CONSTRAINT "raffle_sku_tag_check" CHECK ("raffle_sku"."tag" is null or "raffle_sku"."tag" in ('new', 'hot')),
	CONSTRAINT "raffle_sku_status_check" CHECK ("raffle_sku"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"impersonated_by" text,
	"ip_address" text,
	"token" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"account_type" text DEFAULT 'real' NOT NULL,
	"ban_expires" timestamp,
	"ban_reason" text,
	"banned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"currency" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"fund_mode" text DEFAULT 'real' NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"name" text NOT NULL,
	"operator_expires_at" timestamp,
	"operator_note" text,
	"operator_owner" text,
	"referred_by" text,
	"role" text,
	"uid" integer DEFAULT nextval('user_uid_seq') NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_favorite_game" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_favorite_game_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_address" (
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate" ADD CONSTRAINT "crate_base_currency_currency_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_price" ADD CONSTRAINT "crate_price_crate_id_crate_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_price" ADD CONSTRAINT "crate_price_currency_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_revision" ADD CONSTRAINT "crate_revision_crate_id_crate_id_fk" FOREIGN KEY ("crate_id") REFERENCES "public"."crate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_provider_id_game_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."game_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_asset" ADD CONSTRAINT "game_asset_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_payout_currency_currency_code_fk" FOREIGN KEY ("payout_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_sku_id_raffle_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."raffle_sku"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_round" ADD CONSTRAINT "raffle_round_winner_user_id_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_sku" ADD CONSTRAINT "raffle_sku_payout_currency_currency_code_fk" FOREIGN KEY ("payout_currency") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorite_game" ADD CONSTRAINT "user_favorite_game_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorite_game" ADD CONSTRAINT "user_favorite_game_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_address" ADD CONSTRAINT "wallet_address_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crate_slug_idx" ON "crate" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "crate_status_sort_idx" ON "crate" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "crate_price_currency_idx" ON "crate_price" USING btree ("currency");--> statement-breakpoint
CREATE UNIQUE INDEX "crate_revision_crate_version_idx" ON "crate_revision" USING btree ("crate_id","version");--> statement-breakpoint
CREATE INDEX "currency_enabled_idx" ON "currency" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "game_slug_idx" ON "game" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "game_category_status_idx" ON "game" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "game_provider_id_idx" ON "game" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_asset_game_type_locale_idx" ON "game_asset" USING btree ("game_id","type","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "game_provider_code_idx" ON "game_provider" USING btree ("code");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_round_sku_number_idx" ON "raffle_round" USING btree ("sku_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_round_sku_open_idx" ON "raffle_round" USING btree ("sku_id") WHERE "raffle_round"."status" = 'open';--> statement-breakpoint
CREATE INDEX "raffle_round_status_ends_idx" ON "raffle_round" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "raffle_round_payout_currency_idx" ON "raffle_round" USING btree ("payout_currency");--> statement-breakpoint
CREATE INDEX "raffle_round_winner_user_id_idx" ON "raffle_round" USING btree ("winner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raffle_sku_slug_idx" ON "raffle_sku" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "raffle_sku_status_sort_idx" ON "raffle_sku" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "raffle_sku_payout_currency_idx" ON "raffle_sku" USING btree ("payout_currency");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_uid_idx" ON "user" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "user_created_at_idx" ON "user" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_favorite_game_game_id_idx" ON "user_favorite_game" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "walletAddress_userId_idx" ON "wallet_address" USING btree ("user_id");