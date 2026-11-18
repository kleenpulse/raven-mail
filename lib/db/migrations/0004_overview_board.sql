CREATE TABLE "overview_board" (
	"account_key" text NOT NULL,
	"part" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "overview_board_account_key_part_pk" PRIMARY KEY("account_key","part")
);
