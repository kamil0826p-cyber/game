#!/usr/bin/env node
import { generateOutfitAssets } from './outfit-generator.mjs';

const result = await generateOutfitAssets();
console.log(
  `Generated game assets: ${result.sheets} unique character outfit sheets and refreshed manifest v${result.assetVersion}.`,
);
