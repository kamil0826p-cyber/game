ALTER TABLE "TradeSession"
ADD COLUMN "initiatorSilver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "recipientSilver" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TradeSession"
ADD CONSTRAINT "TradeSession_initiatorSilver_nonnegative" CHECK ("initiatorSilver" >= 0),
ADD CONSTRAINT "TradeSession_recipientSilver_nonnegative" CHECK ("recipientSilver" >= 0);
