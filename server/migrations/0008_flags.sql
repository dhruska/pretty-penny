CREATE TABLE "flag_names" (
	"color" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_transactions" ADD COLUMN "flag" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "flag" text;