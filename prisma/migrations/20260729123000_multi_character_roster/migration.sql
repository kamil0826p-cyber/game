DROP INDEX IF EXISTS "Character_userId_realmId_key";
CREATE INDEX IF NOT EXISTS "Character_userId_realmId_idx" ON "Character"("userId", "realmId");
