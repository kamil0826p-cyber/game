-- CreateEnum
CREATE TYPE "CharacterClass" AS ENUM ('MAGE', 'WARRIOR', 'ARCHER');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('NORTH', 'EAST', 'SOUTH', 'WEST');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('SAFE', 'OUTLAW', 'PVP');

-- CreateEnum
CREATE TYPE "CombatState" AS ENUM ('IDLE', 'IN_BATTLE');

-- CreateEnum
CREATE TYPE "EquipmentSlot" AS ENUM ('HEAD', 'CHEST', 'LEGS', 'FEET', 'MAIN_HAND', 'OFF_HAND', 'AMULET', 'RING');

-- CreateEnum
CREATE TYPE "QuestProgressStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'COMPLETED', 'REWARDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatChannelType" AS ENUM ('GLOBAL', 'REALM', 'MAP', 'PARTY', 'GUILD', 'PRIVATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('REQUESTED', 'OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Realm" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultMapId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Realm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "firebaseUid" VARCHAR(128) NOT NULL,
    "email" VARCHAR(320),
    "displayName" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "realmId" UUID NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "class" "CharacterClass" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "outfitKey" VARCHAR(64) NOT NULL,
    "mapId" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "direction" "Direction" NOT NULL DEFAULT 'SOUTH',
    "combatState" "CombatState" NOT NULL DEFAULT 'IDLE',
    "hp" INTEGER NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "energy" INTEGER NOT NULL,
    "maxEnergy" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "agility" INTEGER NOT NULL,
    "intelligence" INTEGER NOT NULL,
    "armor" INTEGER NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Map" (
    "id" UUID NOT NULL,
    "realmId" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "zoneType" "ZoneType" NOT NULL DEFAULT 'SAFE',
    "spawnX" INTEGER NOT NULL,
    "spawnY" INTEGER NOT NULL,
    "tiledData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portal" (
    "id" UUID NOT NULL,
    "sourceMapId" UUID NOT NULL,
    "sourceX" INTEGER NOT NULL,
    "sourceY" INTEGER NOT NULL,
    "destinationMapId" UUID NOT NULL,
    "targetX" INTEGER NOT NULL,
    "targetY" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "requiredClass" "CharacterClass",
    "minimumLevel" INTEGER NOT NULL DEFAULT 1,
    "energyCost" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSkill" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "skillDefinitionId" UUID NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "cooldownEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "stackLimit" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "itemDefinitionId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "slotIndex" INTEGER NOT NULL,
    "equippedSlot" "EquipmentSlot",
    "instanceData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "minimumLevel" INTEGER NOT NULL DEFAULT 1,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "rewards" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterQuest" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "questDefinitionId" UUID NOT NULL,
    "status" "QuestProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcDefinition" (
    "id" UUID NOT NULL,
    "mapId" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "outfitKey" VARCHAR(64) NOT NULL,
    "dialogue" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobDefinition" (
    "id" UUID NOT NULL,
    "mapId" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "outfitKey" VARCHAR(64) NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "lootTable" JSONB NOT NULL DEFAULT '[]',
    "respawnMs" INTEGER NOT NULL DEFAULT 30000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "realmId" UUID NOT NULL,
    "senderCharacterId" UUID,
    "targetCharacterId" UUID,
    "channel" "ChatChannelType" NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSession" (
    "id" UUID NOT NULL,
    "initiatorCharacterId" UUID NOT NULL,
    "recipientCharacterId" UUID NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'REQUESTED',
    "initiatorAccepted" BOOLEAN NOT NULL DEFAULT false,
    "recipientAccepted" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOfferItem" (
    "id" UUID NOT NULL,
    "tradeSessionId" UUID NOT NULL,
    "offeredByCharacterId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeOfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Realm_slug_key" ON "Realm"("slug");

-- CreateIndex
CREATE INDEX "Realm_isActive_idx" ON "Realm"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Character_realmId_mapId_idx" ON "Character"("realmId", "mapId");

-- CreateIndex
CREATE INDEX "Character_mapId_x_y_idx" ON "Character"("mapId", "x", "y");

-- CreateIndex
CREATE UNIQUE INDEX "Character_userId_realmId_key" ON "Character"("userId", "realmId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_realmId_name_key" ON "Character"("realmId", "name");

-- CreateIndex
CREATE INDEX "Map_realmId_zoneType_idx" ON "Map"("realmId", "zoneType");

-- CreateIndex
CREATE UNIQUE INDEX "Map_realmId_key_key" ON "Map"("realmId", "key");

-- CreateIndex
CREATE INDEX "Portal_destinationMapId_idx" ON "Portal"("destinationMapId");

-- CreateIndex
CREATE UNIQUE INDEX "Portal_sourceMapId_sourceX_sourceY_key" ON "Portal"("sourceMapId", "sourceX", "sourceY");

-- CreateIndex
CREATE UNIQUE INDEX "SkillDefinition_key_key" ON "SkillDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSkill_characterId_skillDefinitionId_key" ON "CharacterSkill"("characterId", "skillDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_key_key" ON "ItemDefinition"("key");

-- CreateIndex
CREATE INDEX "InventoryItem_characterId_equippedSlot_idx" ON "InventoryItem"("characterId", "equippedSlot");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_characterId_slotIndex_key" ON "InventoryItem"("characterId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "QuestDefinition_key_key" ON "QuestDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterQuest_characterId_questDefinitionId_key" ON "CharacterQuest"("characterId", "questDefinitionId");

-- CreateIndex
CREATE INDEX "NpcDefinition_mapId_x_y_idx" ON "NpcDefinition"("mapId", "x", "y");

-- CreateIndex
CREATE UNIQUE INDEX "NpcDefinition_mapId_key_key" ON "NpcDefinition"("mapId", "key");

-- CreateIndex
CREATE INDEX "MobDefinition_mapId_x_y_idx" ON "MobDefinition"("mapId", "x", "y");

-- CreateIndex
CREATE UNIQUE INDEX "MobDefinition_mapId_key_key" ON "MobDefinition"("mapId", "key");

-- CreateIndex
CREATE INDEX "ChatMessage_realmId_channel_createdAt_idx" ON "ChatMessage"("realmId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_targetCharacterId_createdAt_idx" ON "ChatMessage"("targetCharacterId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeSession_initiatorCharacterId_status_idx" ON "TradeSession"("initiatorCharacterId", "status");

-- CreateIndex
CREATE INDEX "TradeSession_recipientCharacterId_status_idx" ON "TradeSession"("recipientCharacterId", "status");

-- CreateIndex
CREATE INDEX "TradeOfferItem_offeredByCharacterId_idx" ON "TradeOfferItem"("offeredByCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOfferItem_tradeSessionId_inventoryItemId_key" ON "TradeOfferItem"("tradeSessionId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "Realm" ADD CONSTRAINT "Realm_defaultMapId_fkey" FOREIGN KEY ("defaultMapId") REFERENCES "Map"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "Realm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Map" ADD CONSTRAINT "Map_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "Realm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portal" ADD CONSTRAINT "Portal_sourceMapId_fkey" FOREIGN KEY ("sourceMapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portal" ADD CONSTRAINT "Portal_destinationMapId_fkey" FOREIGN KEY ("destinationMapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_skillDefinitionId_fkey" FOREIGN KEY ("skillDefinitionId") REFERENCES "SkillDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterQuest" ADD CONSTRAINT "CharacterQuest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterQuest" ADD CONSTRAINT "CharacterQuest_questDefinitionId_fkey" FOREIGN KEY ("questDefinitionId") REFERENCES "QuestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcDefinition" ADD CONSTRAINT "NpcDefinition_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobDefinition" ADD CONSTRAINT "MobDefinition_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "Realm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderCharacterId_fkey" FOREIGN KEY ("senderCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSession" ADD CONSTRAINT "TradeSession_initiatorCharacterId_fkey" FOREIGN KEY ("initiatorCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSession" ADD CONSTRAINT "TradeSession_recipientCharacterId_fkey" FOREIGN KEY ("recipientCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_tradeSessionId_fkey" FOREIGN KEY ("tradeSessionId") REFERENCES "TradeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_offeredByCharacterId_fkey" FOREIGN KEY ("offeredByCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
