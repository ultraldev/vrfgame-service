CREATE TABLE "crash_round" (
	"client_seed" text NOT NULL,
	"crash_point_centi" integer,
	"crashed_at" timestamp,
	"house_edge_bps" integer NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"nonce" integer NOT NULL,
	"phase" text NOT NULL,
	"round_number" integer NOT NULL,
	"running_at" timestamp,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"started_at" timestamp NOT NULL,
	CONSTRAINT "crash_round_phase_check" CHECK ("crash_round"."phase" in ('betting', 'running', 'crashed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crash_round_number_idx" ON "crash_round" USING btree ("round_number");--> statement-breakpoint
CREATE INDEX "crash_round_phase_started_idx" ON "crash_round" USING btree ("phase","started_at");