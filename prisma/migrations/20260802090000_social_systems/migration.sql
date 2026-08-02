CREATE TABLE "SocialRealmState" (
  "realmId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialRealmState_pkey" PRIMARY KEY ("realmId")
);

CREATE TABLE "GuildSocialState" (
  "guildId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildSocialState_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "SocialBlock" (
  "blockerCharacterId" UUID NOT NULL,
  "blockedCharacterId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialBlock_pkey" PRIMARY KEY ("blockerCharacterId", "blockedCharacterId"),
  CONSTRAINT "SocialBlock_not_self" CHECK ("blockerCharacterId" <> "blockedCharacterId")
);

CREATE TABLE "GuildRolePermission" (
  "guildId" UUID NOT NULL,
  "role" "GuildRole" NOT NULL,
  "permission" VARCHAR(48) NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "updatedBy" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildRolePermission_pkey" PRIMARY KEY ("guildId", "role", "permission")
);

CREATE TABLE "GuildBankItem" (
  "id" UUID NOT NULL,
  "guildId" UUID NOT NULL,
  "tabKey" VARCHAR(32) NOT NULL,
  "itemDefinitionId" UUID NOT NULL,
  "itemDefinitionKey" VARCHAR(96) NOT NULL,
  "itemName" VARCHAR(120) NOT NULL,
  "instanceHash" VARCHAR(64) NOT NULL,
  "instanceData" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lockedProjectKey" VARCHAR(96) NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildBankItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuildBankItem_positive_quantity" CHECK ("quantity" > 0)
);

CREATE TABLE "GuildBankOperation" (
  "guildId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "actorCharacterId" UUID NOT NULL,
  "operationType" VARCHAR(32) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "GuildBankOperation_pkey" PRIMARY KEY ("guildId", "operationId")
);

CREATE TABLE "GuildBankAudit" (
  "id" UUID NOT NULL,
  "guildId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "actorCharacterId" UUID NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "itemDefinitionId" UUID,
  "itemDefinitionKey" VARCHAR(96),
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuildBankAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildBankDailyUsage" (
  "guildId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "dayKey" VARCHAR(10) NOT NULL,
  "withdrawnQuantity" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildBankDailyUsage_pkey" PRIMARY KEY ("guildId", "characterId", "dayKey"),
  CONSTRAINT "GuildBankDailyUsage_non_negative" CHECK ("withdrawnQuantity" >= 0)
);

CREATE INDEX "SocialRealmState_updatedAt_idx" ON "SocialRealmState"("updatedAt");
CREATE INDEX "GuildSocialState_updatedAt_idx" ON "GuildSocialState"("updatedAt");
CREATE INDEX "SocialBlock_blockedCharacterId_createdAt_idx" ON "SocialBlock"("blockedCharacterId", "createdAt");
CREATE INDEX "GuildRolePermission_guildId_role_idx" ON "GuildRolePermission"("guildId", "role");
CREATE UNIQUE INDEX "GuildBankItem_stack_key" ON "GuildBankItem"("guildId", "tabKey", "itemDefinitionId", "instanceHash", "lockedProjectKey");
CREATE INDEX "GuildBankItem_guildId_tabKey_updatedAt_idx" ON "GuildBankItem"("guildId", "tabKey", "updatedAt");
CREATE INDEX "GuildBankItem_itemDefinitionId_idx" ON "GuildBankItem"("itemDefinitionId");
CREATE INDEX "GuildBankOperation_actorCharacterId_createdAt_idx" ON "GuildBankOperation"("actorCharacterId", "createdAt");
CREATE INDEX "GuildBankOperation_status_createdAt_idx" ON "GuildBankOperation"("status", "createdAt");
CREATE UNIQUE INDEX "GuildBankAudit_operation_action_key" ON "GuildBankAudit"("guildId", "operationId", "action");
CREATE INDEX "GuildBankAudit_guildId_createdAt_idx" ON "GuildBankAudit"("guildId", "createdAt");
CREATE INDEX "GuildBankAudit_actorCharacterId_createdAt_idx" ON "GuildBankAudit"("actorCharacterId", "createdAt");
CREATE INDEX "GuildBankDailyUsage_guildId_dayKey_idx" ON "GuildBankDailyUsage"("guildId", "dayKey");

ALTER TABLE "SocialRealmState" ADD CONSTRAINT "SocialRealmState_realmId_fkey"
  FOREIGN KEY ("realmId") REFERENCES "Realm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildSocialState" ADD CONSTRAINT "GuildSocialState_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialBlock" ADD CONSTRAINT "SocialBlock_blockerCharacterId_fkey"
  FOREIGN KEY ("blockerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialBlock" ADD CONSTRAINT "SocialBlock_blockedCharacterId_fkey"
  FOREIGN KEY ("blockedCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildRolePermission" ADD CONSTRAINT "GuildRolePermission_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildRolePermission" ADD CONSTRAINT "GuildRolePermission_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildBankItem" ADD CONSTRAINT "GuildBankItem_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildBankItem" ADD CONSTRAINT "GuildBankItem_itemDefinitionId_fkey"
  FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildBankOperation" ADD CONSTRAINT "GuildBankOperation_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildBankOperation" ADD CONSTRAINT "GuildBankOperation_actorCharacterId_fkey"
  FOREIGN KEY ("actorCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildBankAudit" ADD CONSTRAINT "GuildBankAudit_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildBankAudit" ADD CONSTRAINT "GuildBankAudit_actorCharacterId_fkey"
  FOREIGN KEY ("actorCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildBankDailyUsage" ADD CONSTRAINT "GuildBankDailyUsage_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildBankDailyUsage" ADD CONSTRAINT "GuildBankDailyUsage_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
