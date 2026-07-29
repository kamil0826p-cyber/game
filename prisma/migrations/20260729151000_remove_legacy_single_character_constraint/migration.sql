-- Some databases may still have the original one-character-per-realm constraint.
-- Drop both the expected index and any matching table constraint defensively.
DROP INDEX IF EXISTS "Character_userId_realmId_key";
ALTER TABLE "Character" DROP CONSTRAINT IF EXISTS "Character_userId_realmId_key";
CREATE INDEX IF NOT EXISTS "Character_userId_realmId_idx" ON "Character"("userId", "realmId");
