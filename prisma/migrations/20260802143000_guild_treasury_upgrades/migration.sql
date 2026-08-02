CREATE TYPE "GuildTreasuryTransactionType" AS ENUM (
  'DEPOSIT',
  'WITHDRAWAL',
  'UPGRADE_PURCHASE'
);

ALTER TABLE "Guild"
  ADD COLUMN "treasurySilver" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "experienceUpgradeLevel" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalSilverDeposited" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalSilverWithdrawn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalSilverSpentOnUpgrades" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mobKills" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusExperienceGranted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GuildMember"
  ADD COLUMN "contributedSilver" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mobKills" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusExperienceEarned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastContributionAt" TIMESTAMP(3);

CREATE TABLE "GuildTreasuryTransaction" (
  "id" UUID NOT NULL,
  "guildId" UUID NOT NULL,
  "operationId" VARCHAR(96) NOT NULL,
  "actorCharacterId" UUID NOT NULL,
  "actorName" VARCHAR(24) NOT NULL,
  "type" "GuildTreasuryTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "upgradeLevel" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GuildTreasuryTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildTreasuryTransaction_guildId_operationId_key"
  ON "GuildTreasuryTransaction"("guildId", "operationId");
CREATE INDEX "GuildTreasuryTransaction_guildId_createdAt_idx"
  ON "GuildTreasuryTransaction"("guildId", "createdAt");
CREATE INDEX "GuildTreasuryTransaction_actorCharacterId_createdAt_idx"
  ON "GuildTreasuryTransaction"("actorCharacterId", "createdAt");
CREATE INDEX "GuildMember_guildId_contributedSilver_idx"
  ON "GuildMember"("guildId", "contributedSilver");

ALTER TABLE "GuildTreasuryTransaction"
  ADD CONSTRAINT "GuildTreasuryTransaction_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Guild"
  ADD CONSTRAINT "Guild_treasurySilver_nonnegative" CHECK ("treasurySilver" >= 0),
  ADD CONSTRAINT "Guild_experienceUpgradeLevel_range" CHECK ("experienceUpgradeLevel" BETWEEN 0 AND 10),
  ADD CONSTRAINT "Guild_totalSilverDeposited_nonnegative" CHECK ("totalSilverDeposited" >= 0),
  ADD CONSTRAINT "Guild_totalSilverWithdrawn_nonnegative" CHECK ("totalSilverWithdrawn" >= 0),
  ADD CONSTRAINT "Guild_totalSilverSpentOnUpgrades_nonnegative" CHECK ("totalSilverSpentOnUpgrades" >= 0),
  ADD CONSTRAINT "Guild_mobKills_nonnegative" CHECK ("mobKills" >= 0),
  ADD CONSTRAINT "Guild_bonusExperienceGranted_nonnegative" CHECK ("bonusExperienceGranted" >= 0);

ALTER TABLE "GuildMember"
  ADD CONSTRAINT "GuildMember_contributedSilver_nonnegative" CHECK ("contributedSilver" >= 0),
  ADD CONSTRAINT "GuildMember_mobKills_nonnegative" CHECK ("mobKills" >= 0),
  ADD CONSTRAINT "GuildMember_bonusExperienceEarned_nonnegative" CHECK ("bonusExperienceEarned" >= 0);

ALTER TABLE "GuildTreasuryTransaction"
  ADD CONSTRAINT "GuildTreasuryTransaction_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "GuildTreasuryTransaction_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0),
  ADD CONSTRAINT "GuildTreasuryTransaction_upgradeLevel_range" CHECK (
    "upgradeLevel" IS NULL OR "upgradeLevel" BETWEEN 1 AND 10
  ),
  ADD CONSTRAINT "GuildTreasuryTransaction_upgradeLevel_type" CHECK (
    ("type" = 'UPGRADE_PURCHASE' AND "upgradeLevel" IS NOT NULL)
    OR ("type" <> 'UPGRADE_PURCHASE' AND "upgradeLevel" IS NULL)
  );
