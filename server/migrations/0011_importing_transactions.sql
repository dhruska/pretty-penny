CREATE TABLE "bank_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bank_account_id" integer NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"pending" boolean DEFAULT false NOT NULL,
	"state" text NOT NULL,
	"transaction_id" integer,
	"matched_cleared" text,
	"no_match" boolean DEFAULT false NOT NULL,
	CONSTRAINT "bank_transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "sync_cursor" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "sync_status" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "approved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_transactions_account_state_idx" ON "bank_transactions" USING btree ("bank_account_id","state");--> statement-breakpoint
CREATE INDEX "bank_transactions_transaction_idx" ON "bank_transactions" USING btree ("transaction_id");