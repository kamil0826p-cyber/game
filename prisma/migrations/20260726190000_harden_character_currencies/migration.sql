CREATE TYPE "CurrencyType" AS ENUM ('SILVER', 'GOLD');
CREATE TYPE "CurrencyDirection" AS ENUM ('CREDIT', 'DEBIT');

ALTER TABLE "Character"
ADD CONSTRAINT "Character_silver_max" CHECK ("silver" <= 2147483647),
ADD CONSTRAINT "Character_gold_max" CHECK ("gold" <= 2147483647);

CREATE TABLE "CharacterCurrencyLedger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "currency" "CurrencyType" NOT NULL,
  "direction" "CurrencyDirection" NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" VARCHAR(96) NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CharacterCurrencyLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CharacterCurrencyLedger_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "CharacterCurrencyLedger_balance_nonnegative" CHECK ("balanceAfter" >= 0)
);

CREATE UNIQUE INDEX "CharacterCurrencyLedger_characterId_operationId_key"
ON "CharacterCurrencyLedger"("characterId", "operationId");

CREATE INDEX "CharacterCurrencyLedger_characterId_createdAt_idx"
ON "CharacterCurrencyLedger"("characterId", "createdAt");

ALTER TABLE "CharacterCurrencyLedger"
ADD CONSTRAINT "CharacterCurrencyLedger_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
