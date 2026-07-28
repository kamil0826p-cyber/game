ALTER TABLE "TradeSession"
ADD COLUMN "initiatorSilver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "recipientSilver" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "TradeSession_initiatorSilver_nonnegative" CHECK ("initiatorSilver" >= 0),
ADD CONSTRAINT "TradeSession_recipientSilver_nonnegative" CHECK ("recipientSilver" >= 0),
ADD CONSTRAINT "TradeSession_distinct_participants" CHECK ("initiatorCharacterId" <> "recipientCharacterId");

ALTER TABLE "TradeOfferItem"
ADD CONSTRAINT "TradeOfferItem_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <= 9999);

CREATE INDEX "TradeSession_status_expiresAt_idx" ON "TradeSession"("status", "expiresAt");
