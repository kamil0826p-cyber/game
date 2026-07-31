CREATE TYPE "CharacterGender" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "Character"
ADD COLUMN "gender" "CharacterGender" NOT NULL DEFAULT 'MALE';
