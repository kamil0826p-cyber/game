CREATE TYPE "ItemClaimStatus" AS ENUM ('OPEN', 'CLAIMED', 'EXPIRED');
CREATE TYPE "ItemCraftOrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "ItemMarketListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED', 'EXPIRED');

CREATE TABLE "ItemEconomyEvent" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "operationId" VARCHAR(128) NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "itemDefinitionKey" VARCHAR(96),
    "inventoryItemId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "silverDelta" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemEconomyEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemClaim" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "itemDefinitionId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instanceData" JSONB NOT NULL DEFAULT '{}',
    "status" "ItemClaimStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(96) NOT NULL,
    "operationId" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "ItemClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemPityState" (
    "characterId" UUID NOT NULL,
    "ruleKey" VARCHAR(128) NOT NULL,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ItemPityState_pkey" PRIMARY KEY ("characterId", "ruleKey")
);

CREATE TABLE "ItemCraftOrder" (
    "id" UUID NOT NULL,
    "ownerCharacterId" UUID NOT NULL,
    "crafterCharacterId" UUID,
    "recipeKey" VARCHAR(96) NOT NULL,
    "recipeVersion" INTEGER NOT NULL,
    "status" "ItemCraftOrderStatus" NOT NULL DEFAULT 'OPEN',
    "silverEscrow" INTEGER NOT NULL,
    "inputEscrow" JSONB NOT NULL,
    "outputItemDefinitionId" UUID NOT NULL,
    "outputQuantity" INTEGER NOT NULL,
    "operationId" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "ItemCraftOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemMarketListing" (
    "id" UUID NOT NULL,
    "sellerCharacterId" UUID NOT NULL,
    "buyerCharacterId" UUID,
    "itemDefinitionId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instanceData" JSONB NOT NULL DEFAULT '{}',
    "priceSilver" INTEGER NOT NULL,
    "listingFeeSilver" INTEGER NOT NULL,
    "status" "ItemMarketListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "operationId" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "ItemMarketListing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ItemMarketPriceSample" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "itemDefinitionKey" VARCHAR(96) NOT NULL,
    "unitPriceSilver" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemMarketPriceSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemEconomyEvent_characterId_operationId_eventType_key"
ON "ItemEconomyEvent"("characterId", "operationId", "eventType");
CREATE INDEX "ItemEconomyEvent_characterId_createdAt_idx"
ON "ItemEconomyEvent"("characterId", "createdAt");
CREATE INDEX "ItemEconomyEvent_itemDefinitionKey_createdAt_idx"
ON "ItemEconomyEvent"("itemDefinitionKey", "createdAt");

CREATE UNIQUE INDEX "ItemClaim_characterId_operationId_key"
ON "ItemClaim"("characterId", "operationId");
CREATE INDEX "ItemClaim_characterId_status_expiresAt_idx"
ON "ItemClaim"("characterId", "status", "expiresAt");

CREATE UNIQUE INDEX "ItemCraftOrder_ownerCharacterId_operationId_key"
ON "ItemCraftOrder"("ownerCharacterId", "operationId");
CREATE INDEX "ItemCraftOrder_status_expiresAt_idx"
ON "ItemCraftOrder"("status", "expiresAt");
CREATE INDEX "ItemCraftOrder_ownerCharacterId_status_idx"
ON "ItemCraftOrder"("ownerCharacterId", "status");
CREATE INDEX "ItemCraftOrder_crafterCharacterId_status_idx"
ON "ItemCraftOrder"("crafterCharacterId", "status");

CREATE UNIQUE INDEX "ItemMarketListing_sellerCharacterId_operationId_key"
ON "ItemMarketListing"("sellerCharacterId", "operationId");
CREATE INDEX "ItemMarketListing_status_expiresAt_idx"
ON "ItemMarketListing"("status", "expiresAt");
CREATE INDEX "ItemMarketListing_itemDefinitionId_status_priceSilver_idx"
ON "ItemMarketListing"("itemDefinitionId", "status", "priceSilver");
CREATE INDEX "ItemMarketListing_sellerCharacterId_status_idx"
ON "ItemMarketListing"("sellerCharacterId", "status");

CREATE UNIQUE INDEX "ItemMarketPriceSample_listingId_key"
ON "ItemMarketPriceSample"("listingId");
CREATE INDEX "ItemMarketPriceSample_itemDefinitionKey_soldAt_idx"
ON "ItemMarketPriceSample"("itemDefinitionKey", "soldAt");
