#!/usr/bin/env node
import { auditOutfitAssets } from './audit-outfits.mjs';
import { generateOutfitAssets } from './outfit-generator.mjs';

const result = await generateOutfitAssets();
const audit = await auditOutfitAssets();
console.log(
  `Generated ${result.sheets} unique dark-fantasy outfit sheets ` +
    `(${result.sheets / 2} male + ${result.sheets / 2} female), 384x576 with 96x144 frames. ` +
    `Asset version: ${result.assetVersion}. Minimum sheet/frame detail: ` +
    `${audit.summary.minimumSheetPrimitives}/${audit.summary.minimumFramePrimitives} primitives; ` +
    `female readability: ${audit.summary.minimumFemaleReadability}/100.`,
);
