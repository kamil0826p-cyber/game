-- A user can own up to five characters in one realm. The application enforces the limit transactionally.
DROP INDEX IF EXISTS "Character_userId_realmId_key";
CREATE INDEX IF NOT EXISTS "Character_userId_realmId_idx" ON "Character"("userId", "realmId");
