CREATE TABLE "scheduled_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheduled_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"frequency" text NOT NULL,
	"first_date" date NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"next_date" date NOT NULL,
	"payee_id" integer,
	"memo" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"category_id" integer,
	"lines" jsonb,
	"transfer_account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "scheduled_transaction_id" integer;--> statement-breakpoint
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_transactions_next_date_idx" ON "scheduled_transactions" USING btree ("next_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_scheduled_transaction_id_scheduled_transactions_id_fk" FOREIGN KEY ("scheduled_transaction_id") REFERENCES "public"."scheduled_transactions"("id") ON DELETE set null ON UPDATE no action;