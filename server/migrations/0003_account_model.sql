ALTER TABLE "accounts" ADD COLUMN "type" text DEFAULT 'checking' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "on_budget" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_starting_balance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_transaction_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_transaction_id_transactions_id_fk" FOREIGN KEY ("transfer_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_unique" UNIQUE("transfer_transaction_id");--> statement-breakpoint
UPDATE "transactions" SET "is_starting_balance" = true WHERE "payee" = 'Starting Balance';
