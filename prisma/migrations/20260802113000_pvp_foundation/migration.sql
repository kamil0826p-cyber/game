CREATE TABLE "PvpProfile" (
  "characterId" UUID NOT NULL,
  "optedIn" BOOLEAN NOT NULL DEFAULT false,
  "notoriety" INTEGER NOT NULL DEFAULT 0,
  "notorietyChangedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "spawnProtectedUntil" TIMESTAMP(3),
  "reconnectProtectedUntil" TIMESTAMP(3),
  "defeatProtectedUntil" TIMESTAMP(3),
  "combatCooldownUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "PvpProfile_pkey" PRIMARY KEY ("characterId"),
  CONSTRAINT "PvpProfile_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpProfile_notoriety_check" CHECK ("notoriety" BETWEEN 0 AND 100)
);

CREATE TABLE "PvpBounty" (
  "id" UUID NOT NULL,
  "targetCharacterId" UUID NOT NULL,
  "creatorCharacterId" UUID,
  "hunterCharacterId" UUID,
  "amountSilver" INTEGER NOT NULL,
  "feeSilver" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "operationId" VARCHAR(96) NOT NULL,
  "claimedCombatId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "PvpBounty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpBounty_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpBounty_creatorCharacterId_fkey" FOREIGN KEY ("creatorCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL,
  CONSTRAINT "PvpBounty_hunterCharacterId_fkey" FOREIGN KEY ("hunterCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL,
  CONSTRAINT "PvpBounty_amount_check" CHECK ("amountSilver" BETWEEN 100 AND 100000),
  CONSTRAINT "PvpBounty_fee_check" CHECK ("feeSilver" >= 0),
  CONSTRAINT "PvpBounty_status_check" CHECK ("status" IN ('OPEN', 'ACCEPTED', 'CLAIMED', 'CANCELLED', 'EXPIRED'))
);
CREATE UNIQUE INDEX "PvpBounty_creator_operation_key"
  ON "PvpBounty"("creatorCharacterId", "operationId");
CREATE INDEX "PvpBounty_board_idx" ON "PvpBounty"("status", "expiresAt", "amountSilver" DESC);
CREATE INDEX "PvpBounty_target_idx" ON "PvpBounty"("targetCharacterId", "status");
CREATE INDEX "PvpBounty_hunter_idx" ON "PvpBounty"("hunterCharacterId", "status");

CREATE TABLE "PvpCombat" (
  "combatId" UUID NOT NULL,
  "mapId" UUID NOT NULL,
  "zoneType" VARCHAR(16) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "modeKey" VARCHAR(64),
  "ratingPool" VARCHAR(96),
  "rulesVersion" INTEGER NOT NULL,
  "attackerTeam" JSONB NOT NULL,
  "defenderTeam" JSONB NOT NULL,
  "legalAggression" BOOLEAN NOT NULL,
  "rewardMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "bountyId" UUID,
  "status" VARCHAR(16) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "PvpCombat_pkey" PRIMARY KEY ("combatId"),
  CONSTRAINT "PvpCombat_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT,
  CONSTRAINT "PvpCombat_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "PvpBounty"("id") ON DELETE SET NULL,
  CONSTRAINT "PvpCombat_zone_check" CHECK ("zoneType" IN ('SAFE', 'OUTLAW', 'PVP')),
  CONSTRAINT "PvpCombat_kind_check" CHECK ("kind" IN ('DUEL', 'OPEN_WORLD', 'BOUNTY', 'RANKED', 'OBJECTIVE')),
  CONSTRAINT "PvpCombat_status_check" CHECK ("status" IN ('ACTIVE', 'SETTLED', 'CANCELLED')),
  CONSTRAINT "PvpCombat_reward_check" CHECK ("rewardMultiplier" BETWEEN 0 AND 1)
);
CREATE INDEX "PvpCombat_started_idx" ON "PvpCombat"("startedAt");
CREATE INDEX "PvpCombat_bounty_idx" ON "PvpCombat"("bountyId");

CREATE TABLE "PvpCombatSettlement" (
  "combatId" UUID NOT NULL,
  "winnerTeamId" VARCHAR(128) NOT NULL,
  "finishReason" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "settledAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "PvpCombatSettlement_pkey" PRIMARY KEY ("combatId"),
  CONSTRAINT "PvpCombatSettlement_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE
);

CREATE TABLE "PvpOpponentHistory" (
  "id" UUID NOT NULL,
  "winnerCharacterId" UUID NOT NULL,
  "loserCharacterId" UUID NOT NULL,
  "combatId" UUID NOT NULL,
  "defeatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PvpOpponentHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpOpponentHistory_winner_fkey" FOREIGN KEY ("winnerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpOpponentHistory_loser_fkey" FOREIGN KEY ("loserCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpOpponentHistory_combat_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PvpOpponentHistory_combat_pair_key"
  ON "PvpOpponentHistory"("combatId", "winnerCharacterId", "loserCharacterId");
CREATE INDEX "PvpOpponentHistory_repeat_idx"
  ON "PvpOpponentHistory"("winnerCharacterId", "loserCharacterId", "defeatedAt" DESC);

CREATE TABLE "PvpRating" (
  "characterId" UUID NOT NULL,
  "poolKey" VARCHAR(96) NOT NULL,
  "seasonKey" VARCHAR(96) NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1000,
  "uncertainty" INTEGER NOT NULL DEFAULT 350,
  "placementMatchesRemaining" INTEGER NOT NULL DEFAULT 5,
  "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "PvpRating_pkey" PRIMARY KEY ("characterId", "poolKey", "seasonKey"),
  CONSTRAINT "PvpRating_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpRating_rating_check" CHECK ("rating" BETWEEN 100 AND 3000),
  CONSTRAINT "PvpRating_uncertainty_check" CHECK ("uncertainty" BETWEEN 60 AND 500),
  CONSTRAINT "PvpRating_placement_check" CHECK ("placementMatchesRemaining" BETWEEN 0 AND 20)
);
CREATE INDEX "PvpRating_leaderboard_idx" ON "PvpRating"("seasonKey", "poolKey", "rating" DESC);

CREATE TABLE "PvpRewardLedger" (
  "id" UUID NOT NULL,
  "combatId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "renown" INTEGER NOT NULL DEFAULT 0,
  "cosmeticTokens" INTEGER NOT NULL DEFAULT 0,
  "eligible" BOOLEAN NOT NULL,
  "contribution" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "PvpRewardLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpRewardLedger_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE,
  CONSTRAINT "PvpRewardLedger_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpRewardLedger_reward_check" CHECK ("renown" >= 0 AND "cosmeticTokens" >= 0)
);
CREATE UNIQUE INDEX "PvpRewardLedger_combat_character_key" ON "PvpRewardLedger"("combatId", "characterId");
CREATE UNIQUE INDEX "PvpRewardLedger_operation_key" ON "PvpRewardLedger"("characterId", "operationId");

CREATE TABLE "PvpReplay" (
  "combatId" UUID NOT NULL,
  "rulesVersion" INTEGER NOT NULL,
  "modeKey" VARCHAR(64),
  "checksum" VARCHAR(64) NOT NULL,
  "eventLog" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PvpReplay_pkey" PRIMARY KEY ("combatId"),
  CONSTRAINT "PvpReplay_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE
);
CREATE INDEX "PvpReplay_expiry_idx" ON "PvpReplay"("expiresAt");

CREATE TABLE "PvpReport" (
  "id" UUID NOT NULL,
  "combatId" UUID NOT NULL,
  "reporterCharacterId" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "operationId" VARCHAR(96) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "PvpReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpReport_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE,
  CONSTRAINT "PvpReport_reporter_fkey" FOREIGN KEY ("reporterCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpReport_category_check" CHECK ("category" IN ('GRIEFING', 'WINTRADING', 'AFK', 'SPAWN_CAMPING', 'OTHER'))
);
CREATE UNIQUE INDEX "PvpReport_operation_key" ON "PvpReport"("reporterCharacterId", "operationId");
CREATE INDEX "PvpReport_review_idx" ON "PvpReport"("reviewedAt", "createdAt");

CREATE TABLE "PvpOutbox" (
  "id" UUID NOT NULL,
  "aggregateId" VARCHAR(128) NOT NULL,
  "eventType" VARCHAR(64) NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "PvpOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PvpOutbox_operation_key" ON "PvpOutbox"("operationId");
CREATE INDEX "PvpOutbox_pending_idx" ON "PvpOutbox"("publishedAt", "createdAt");

CREATE TABLE "PvpRiskSignal" (
  "id" UUID NOT NULL,
  "combatId" UUID,
  "characterId" UUID,
  "signalType" VARCHAR(64) NOT NULL,
  "riskScore" INTEGER NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "PvpRiskSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpRiskSignal_combat_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE,
  CONSTRAINT "PvpRiskSignal_character_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL,
  CONSTRAINT "PvpRiskSignal_score_check" CHECK ("riskScore" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "PvpRiskSignal_operation_key" ON "PvpRiskSignal"("operationId");
CREATE INDEX "PvpRiskSignal_review_idx" ON "PvpRiskSignal"("reviewedAt", "riskScore" DESC, "createdAt");

CREATE TABLE "PvpObjectiveContribution" (
  "id" UUID NOT NULL,
  "combatId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "objectivePoints" INTEGER NOT NULL DEFAULT 0,
  "activeMs" INTEGER NOT NULL DEFAULT 0,
  "lateJoin" BOOLEAN NOT NULL DEFAULT false,
  "disconnected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "PvpObjectiveContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PvpObjectiveContribution_combat_fkey" FOREIGN KEY ("combatId") REFERENCES "PvpCombat"("combatId") ON DELETE CASCADE,
  CONSTRAINT "PvpObjectiveContribution_character_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "PvpObjectiveContribution_points_check" CHECK ("objectivePoints" BETWEEN 0 AND 100000),
  CONSTRAINT "PvpObjectiveContribution_active_check" CHECK ("activeMs" BETWEEN 0 AND 86400000)
);
CREATE UNIQUE INDEX "PvpObjectiveContribution_operation_key"
  ON "PvpObjectiveContribution"("characterId", "operationId");
CREATE INDEX "PvpObjectiveContribution_combat_character_idx"
  ON "PvpObjectiveContribution"("combatId", "characterId");
