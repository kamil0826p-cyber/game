#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTFIT_DESIGNS, OUTFIT_GENDERS } from './outfit-designs.mjs';
import { resolveOutfitDesign } from './outfit-female-designs.mjs';
import { auditOne } from './outfit-audit-parser.mjs';
import { renderAuditMarkdown } from './outfit-audit-report.mjs';
import {
  detailLevel,
  maximumStrokeOnlyRatio,
  minimumFemaleReadabilityScore,
  minimumFrameParts,
  minimumFramePrimitives,
  minimumSheetPrimitives,
} from './outfit-generator-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const projectRoot = resolve(frontendRoot, '..');
const jsonPath = resolve(frontendRoot, 'public', 'assets', 'outfit-audit.json');
const markdownPath = resolve(projectRoot, 'docs', 'CHARACTER_OUTFIT_SVG_AUDIT.md');
const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const round = (value, digits = 1) => Number(value.toFixed(digits));

export async function auditOutfitAssets() {
  const records = [];
  for (const design of OUTFIT_DESIGNS) {
    for (const gender of OUTFIT_GENDERS) {
      records.push(await auditOne(resolveOutfitDesign(design, gender), gender));
    }
  }
  const failures = records.flatMap((record) => record.failures.map((failure) => `${record.key}/${record.gender}: ${failure}`));
  const hashes = records.map((record) => record.sha256);
  const signatures = records.map((record) => record.structuralSignature);
  if (new Set(hashes).size !== 66) failures.push('all 66 generated hashes are not unique');
  if (new Set(signatures).size !== 66) failures.push('all 66 structural signatures are not unique');
  const report = {
    schemaVersion: 2,
    thresholds: {
      minimumSheetPrimitives,
      minimumFramePrimitives,
      minimumFrameParts,
      minimumFemaleReadabilityScore,
      detailLevel,
      maximumStrokeOnlyRatio,
    },
    summary: {
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      sheets: records.length,
      uniqueHashes: new Set(hashes).size,
      uniqueStructuralSignatures: new Set(signatures).size,
      minimumSheetPrimitives: Math.min(...records.map((record) => record.sheetPrimitives)),
      minimumFramePrimitives: Math.min(...records.map((record) => record.minimumFramePrimitives)),
      minimumFrameParts: Math.min(...records.map((record) => record.minimumFrameParts)),
      minimumFemaleReadability: Math.min(...records.filter((record) => record.gender === 'FEMALE').map((record) => record.femaleReadability)),
      maximumStrokeOnlyRatio: Math.max(...records.map((record) => record.strokeOnlyRatio)),
      occlusionFailureCount: failures.filter((failure) => /hair geometry|horn|occlusion/.test(failure)).length,
      averageQualityScore: round(average(records.map((record) => record.qualityScore))),
      failureCount: failures.length,
      warningCount: records.reduce((sum, record) => sum + record.warnings.length, 0),
    },
    failures,
    records,
  };
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderAuditMarkdown(report));
  if (failures.length > 0) throw new Error(`Outfit audit failed:\n${failures.join('\n')}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditOutfitAssets();
  console.log(
    `Outfit SVG audit ${report.summary.status}: ${report.summary.sheets} sheets, ` +
      `minimum female readability ${report.summary.minimumFemaleReadability}, ` +
      `minimum frame detail ${report.summary.minimumFramePrimitives} primitives / ` +
      `${report.summary.minimumFrameParts} semantic layers.`,
  );
}
