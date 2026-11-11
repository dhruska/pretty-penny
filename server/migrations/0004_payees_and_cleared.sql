CREATE TABLE "payees" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payee_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "cleared" text DEFAULT 'uncleared' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payees_name_lower_unique" ON "payees" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "payees" ("name")
SELECT DISTINCT ON (lower(trim("payee"))) trim("payee")
FROM "transactions"
WHERE trim("payee") <> ''
ORDER BY lower(trim("payee")), "id";--> statement-breakpoint
UPDATE "transactions" t SET "payee_id" = p."id"
FROM "payees" p
WHERE lower(trim(t."payee")) = lower(p."name");--> statement-breakpoint
UPDATE "transactions" SET "cleared" = 'cleared'
WHERE "is_starting_balance" OR "payee" = 'Balance Adjustment';
