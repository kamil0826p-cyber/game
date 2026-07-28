ALTER TABLE "TradeSession"
ADD COLUMN IF NOT EXISTS "initiatorSilver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "recipientSilver" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeSession_initiatorSilver_nonnegative'
  ) THEN
    ALTER TABLE "TradeSession"
      ADD CONSTRAINT "TradeSession_initiatorSilver_nonnegative" CHECK ("initiatorSilver" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TradeSession_recipientSilver_nonnegative'
  ) THEN
    ALTER TABLE "TradeSession"
      ADD CONSTRAINT "TradeSession_recipientSilver_nonnegative" CHECK ("recipientSilver" >= 0);
  END IF;
END $$;
