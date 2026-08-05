#!/usr/bin/env node
import { generateOutfitAssets } from './outfit-generator.mjs';

const result = await generateOutfitAssets();
console.log(
  `Generated ${result.sheets} unique dark-fantasy outfit sheets ` +
    `(${result.sheets / 2} male + ${result.sheets / 2} female), 384x576 with 96x144 frames. ` +
    `Asset version: ${result.assetVersion}.`,
);
