-- CreateEnum
CREATE TYPE "GuildRole" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "GuildInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Guild" (
    "id" UUID NOT NULL,
    "realmId" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "nameKey" VARCHAR(32) NOT NULL,
    "tag" VARCHAR(5) NOT NULL,
    "description" VARCHAR(280) NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildMember" (
    "id" UUID NOT NULL,
    "guildId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "role" "GuildRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildInvite" (
    "id" UUID NOT NULL,
    "guildId" UUID NOT NULL,
    "inviterCharacterId" UUID NOT NULL,
    "targetCharacterId" UUID NOT NULL,
    "status" "GuildInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "GuildInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guild_realmId_nameKey_key" ON "Guild"("realmId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Guild_realmId_tag_key" ON "Guild"("realmId", "tag");

-- CreateIndex
CREATE INDEX "Guild_realmId_level_idx" ON "Guild"("realmId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "GuildMember_characterId_key" ON "GuildMember"("characterId");

-- CreateIndex
CREATE INDEX "GuildMember_guildId_role_joinedAt_idx" ON "GuildMember"("guildId", "role", "joinedAt");

-- CreateIndex
CREATE INDEX "GuildInvite_targetCharacterId_status_expiresAt_idx" ON "GuildInvite"("targetCharacterId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "GuildInvite_guildId_status_idx" ON "GuildInvite"("guildId", "status");

-- AddForeignKey
ALTER TABLE "Guild" ADD CONSTRAINT "Guild_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "Realm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildInvite" ADD CONSTRAINT "GuildInvite_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildInvite" ADD CONSTRAINT "GuildInvite_inviterCharacterId_fkey" FOREIGN KEY ("inviterCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildInvite" ADD CONSTRAINT "GuildInvite_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain constraints
ALTER TABLE "Guild"
ADD CONSTRAINT "Guild_level_positive" CHECK ("level" >= 1),
ADD CONSTRAINT "Guild_experience_nonnegative" CHECK ("experience" >= 0);

CREATE UNIQUE INDEX "GuildMember_single_leader_per_guild"
ON "GuildMember"("guildId") WHERE "role" = 'LEADER';

CREATE UNIQUE INDEX "GuildInvite_single_pending_per_target"
ON "GuildInvite"("guildId", "targetCharacterId") WHERE "status" = 'PENDING';
