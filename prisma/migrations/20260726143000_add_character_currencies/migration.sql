ALTER TABLE "Character"
ADD COLUMN "silver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "gold" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Character"
ADD CONSTRAINT "Character_silver_nonnegative" CHECK ("silver" >= 0),
ADD CONSTRAINT "Character_gold_nonnegative" CHECK ("gold" >= 0);