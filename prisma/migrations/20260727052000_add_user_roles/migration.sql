CREATE TYPE "UserRole" AS ENUM ('USER', 'MOD', 'ADMIN');

ALTER TABLE "User"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

CREATE INDEX "User_role_idx" ON "User"("role");
