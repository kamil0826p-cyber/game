ALTER INDEX "DomainOutbox_claim_idx"
RENAME TO "DomainOutbox_status_availableAt_id_idx";

DROP INDEX "DomainOutbox_lockedAt_idx";
CREATE INDEX "DomainOutbox_lockedAt_idx" ON "DomainOutbox"("lockedAt");

ALTER INDEX "FeatureFlag_key_enabled_idx"
RENAME TO "FeatureFlag_key_enabled_version_idx";

ALTER TABLE "FeatureFlagAssignment"
RENAME CONSTRAINT "FeatureFlagAssignment_identity_key"
TO "FeatureFlagAssignment_flagKey_flagVersion_scope_subjectId_key";

ALTER TABLE "FeatureFlagAssignment"
RENAME CONSTRAINT "FeatureFlagAssignment_flag_fkey"
TO "FeatureFlagAssignment_flagKey_flagVersion_fkey";
