CREATE TABLE "user_recent_game" (
	"game_id" text NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_recent_game_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "user_recent_game" ADD CONSTRAINT "user_recent_game_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recent_game" ADD CONSTRAINT "user_recent_game_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_recent_game_user_played_idx" ON "user_recent_game" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "user_recent_game_game_id_idx" ON "user_recent_game" USING btree ("game_id");