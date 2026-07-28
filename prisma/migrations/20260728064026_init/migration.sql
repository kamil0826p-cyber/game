/*
  Warnings:

  - You are about to drop the column `initiatorSilver` on the `TradeSession` table. All the data in the column will be lost.
  - You are about to drop the column `recipientSilver` on the `TradeSession` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CharacterCurrencyLedger" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TradeSession" DROP COLUMN "initiatorSilver",
DROP COLUMN "recipientSilver";
