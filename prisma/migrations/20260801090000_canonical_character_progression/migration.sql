ALTER TABLE "Character"
ADD COLUMN "progressionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "progressionData" JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN "freeRespecAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "progressionMigratedAt" TIMESTAMP(3);
