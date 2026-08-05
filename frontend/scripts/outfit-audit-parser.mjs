import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detailLevel,
  headgearAllowsHair,
  headgearHornCount,
  headgearMode,
  maximumStrokeOnlyRatio,
  minimumFemaleReadabilityScore,
  minimumFrameParts,
  minimumFramePrimitives,
  minimumSheetPrimitives,
} from './outfit-generator-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const spriteRoot = resolve(here, '..', 'public', 'assets', 'sprites');
const genderDirectory = { MALE: 'male', FEMALE: 'female' };

const attribute = (source, name) => source.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? null;
const numbers = (source, name) => [...source.matchAll(new RegExp(`${name}="([0-9.]+)"`, 'g'))].map((match) => Number(match[1]));
const sha256 = (source) => createHash('sha256').update(source).digest('hex');
const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const round = (value, digits = 1) => Number(value.toFixed(digits));

const scoreRecord = (record) => {
  const detail = Math.min(100, (record.minimumFramePrimitives / 80) * 100);
  const layers = Math.min(100, (record.minimumFrameParts / 16) * 100);
  const sheet = Math.min(100, (record.sheetPrimitives / 1280) * 100);
  const readability = record.gender === 'FEMALE' ? record.femaleReadability : 100;
  const cleanliness = Math.max(0, Math.min(100, (maximumStrokeOnlyRatio - record.strokeOnlyRatio + .25) * 200));
  return round(detail * .25 + layers * .2 + sheet * .2 + readability * .2 + cleanliness * .15);
};

export const auditOne = async (design, gender) => {
  const variant = design.variants[gender];
  const path = resolve(spriteRoot, genderDirectory[gender], `${design.key}.svg`);
  const svg = await readFile(path, 'utf8');
  const framePrimitives = numbers(svg, 'data-frame-primitives');
  const frameParts = numbers(svg, 'data-frame-parts');
  const frameNames = [...svg.matchAll(/data-frame="([A-Z]+-[0-3])"/g)].map((match) => match[1]);
  const directions = [...new Set(frameNames.map((name) => name.split('-')[0]))];
  const semanticParts = [...new Set([...svg.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1]))].sort();
  const materialFamilies = (attribute(svg, 'data-material-families') ?? '').split(',').filter(Boolean);
  const femaleReadability = Number(attribute(svg, 'data-female-readability') ?? 0);
  const shoulderHipRatio = Number(attribute(svg, 'data-shoulder-hip-ratio') ?? 0);
  const waistHipRatio = Number(attribute(svg, 'data-waist-hip-ratio') ?? 0);
  const handSize = Number(attribute(svg, 'data-hand-size') ?? 0);
  const footSize = Number(attribute(svg, 'data-foot-size') ?? 0);
  const visibleHair = Number(attribute(svg, 'data-visible-hair') ?? -1);
  const hornCount = Number(attribute(svg, 'data-horn-count') ?? -1);
  const headOcclusion = attribute(svg, 'data-head-occlusion');
  const genderDesign = attribute(svg, 'data-gender-design');
  const shoulderArrows = attribute(svg, 'data-shoulder-arrows');
  const northSouthDistinct = attribute(svg, 'data-north-south-distinct');
  const southDigest = attribute(svg, 'data-south-digest');
  const northDigest = attribute(svg, 'data-north-digest');
  const northFrameTags = [...svg.matchAll(/<g data-frame="NORTH-[0-3]"[^>]*>/g)].map((match) => match[0]);
  const southFrameTags = [...svg.matchAll(/<g data-frame="SOUTH-[0-3]"[^>]*>/g)].map((match) => match[0]);
  const primitiveElements = [...svg.matchAll(/<(path|circle|ellipse|rect|polygon|line|polyline)\b[^>]*>/g)].map((match) => match[0]);
  const sheetPrimitives = primitiveElements.length;
  const strokeOnlyRatio = round(primitiveElements.filter((element) => element.includes('fill="none"')).length / Math.max(1, primitiveElements.length), 3);
  const expectedHair = headgearAllowsHair(variant.head);
  const expectedHorns = headgearHornCount(variant.head);
  const expectedOcclusion = headgearMode(variant.head);
  const hasVisibleHairParts = semanticParts.includes('hair-back') || semanticParts.includes('hair-front');
  const hasHornPart = semanticParts.includes('headgear-horns');
  const warnings = [];
  const failures = [];

  if (attribute(svg, 'data-detail-level') !== detailLevel) failures.push(`detail level is not ${detailLevel}`);
  if (attribute(svg, 'data-random-body-strokes') !== '0') failures.push('random body strokes are enabled');
  if (attribute(svg, 'data-clean-occlusion') !== 'true') failures.push('clean occlusion flag is missing');
  if (shoulderArrows !== '0' || svg.includes('data-shoulder-arrows="1"')) failures.push('forbidden shoulder-arrow geometry is present');
  if (northSouthDistinct !== 'true' || !southDigest || !northDigest || southDigest === northDigest) failures.push('north and south views are not structurally distinct');
  if (northFrameTags.length !== 4 || !northFrameTags.every((tag) => tag.includes('data-facing="back"') && tag.includes('data-face-elements="0"'))) failures.push('NORTH frames are not explicit faceless back views');
  if (southFrameTags.length !== 4 || !southFrameTags.every((tag) => tag.includes('data-facing="front"'))) failures.push('SOUTH frames are not explicit front views');
  if (gender === 'FEMALE' && genderDesign !== 'independent') failures.push('female design is not marked independent');
  if (frameNames.length !== 16) failures.push(`expected 16 frames, found ${frameNames.length}`);
  if (directions.length !== 4) failures.push(`expected 4 directions, found ${directions.length}`);
  if (framePrimitives.length !== 16) failures.push('missing per-frame primitive metadata');
  if (frameParts.length !== 16) failures.push('missing per-frame semantic-layer metadata');
  if (sheetPrimitives < minimumSheetPrimitives) failures.push(`sheet primitives ${sheetPrimitives} < ${minimumSheetPrimitives}`);
  if (Math.min(...framePrimitives) < minimumFramePrimitives) failures.push(`weakest frame primitives ${Math.min(...framePrimitives)} < ${minimumFramePrimitives}`);
  if (Math.min(...frameParts) < minimumFrameParts) failures.push(`weakest frame layers ${Math.min(...frameParts)} < ${minimumFrameParts}`);
  if (strokeOnlyRatio > maximumStrokeOnlyRatio) failures.push(`stroke-only ratio ${strokeOnlyRatio} > ${maximumStrokeOnlyRatio}`);
  if (headOcclusion !== expectedOcclusion) failures.push(`head occlusion ${headOcclusion} does not match ${expectedOcclusion}`);
  if (visibleHair !== (expectedHair ? 1 : 0)) failures.push(`visible hair metadata ${visibleHair} does not match headgear`);
  if (!expectedHair && hasVisibleHairParts) failures.push('hair geometry is rendered over full headgear');
  if (expectedHair && !hasVisibleHairParts) failures.push('visible hairstyle is missing hair geometry');
  if (hornCount !== expectedHorns) failures.push(`horn count ${hornCount} does not match explicit head style`);
  if (expectedHorns === 0 && hasHornPart) failures.push('unrequested horn geometry is present');
  if (expectedHorns > 0 && !hasHornPart) failures.push('explicit horned head style is missing horns');
  if (gender === 'FEMALE' && femaleReadability < minimumFemaleReadabilityScore) failures.push(`female readability ${femaleReadability} < ${minimumFemaleReadabilityScore}`);
  if (gender === 'FEMALE' && !semanticParts.includes('female-readability-layer')) failures.push('missing dedicated female readability layer');
  if (gender === 'FEMALE' && !semanticParts.includes('female-portrait')) failures.push('missing female portrait metadata');
  if (gender === 'FEMALE' && !semanticParts.includes('female-hair')) failures.push('missing female hair metadata');
  if (svg.includes('NaN') || svg.includes('Infinity')) failures.push('invalid numeric coordinate');

  if (materialFamilies.length < 2) warnings.push('only one material family is represented');
  if (Math.min(...framePrimitives) < 70) warnings.push('weakest frame is below the preferred 70-primitive target');
  if (Math.min(...frameParts) < 14) warnings.push('weakest frame is below the preferred 14-layer target');
  if (gender === 'FEMALE' && femaleReadability < 90) warnings.push('female readability is below the preferred score of 90');
  if (gender === 'FEMALE' && shoulderHipRatio > .95) warnings.push('shoulder-to-hip ratio remains visually broad');
  if (gender === 'FEMALE' && waistHipRatio > .58) warnings.push('waist-to-hip ratio remains visually straight');
  if (strokeOnlyRatio > .55) warnings.push('stroke-only ratio is close to the cleanliness limit');

  const record = {
    key: design.key,
    title: design.title,
    characterClass: design.characterClass,
    unlockLevel: design.unlockLevel,
    gender,
    file: `frontend/public/assets/sprites/${genderDirectory[gender]}/${design.key}.svg`,
    sha256: sha256(svg),
    structuralSignature: attribute(svg, 'data-component-signature'),
    detailLevel: attribute(svg, 'data-detail-level'),
    sheetPrimitives,
    minimumFramePrimitives: Math.min(...framePrimitives),
    averageFramePrimitives: round(average(framePrimitives)),
    maximumFramePrimitives: Math.max(...framePrimitives),
    minimumFrameParts: Math.min(...frameParts),
    averageFrameParts: round(average(frameParts)),
    semanticPartCount: semanticParts.length,
    semanticParts,
    materialFamilies,
    strokeOnlyRatio,
    directions,
    femaleReadability,
    head: { style: variant.head, occlusion: headOcclusion, visibleHair, hornCount },
    directionAudit: { northSouthDistinct, southDigest, northDigest, northFrames: northFrameTags.length, southFrames: southFrameTags.length },
    genderDesign,
    shoulderArrows,
    silhouette: { shoulderHipRatio, waistHipRatio, handSize, footSize },
    warnings,
    failures,
  };
  record.qualityScore = scoreRecord(record);
  return record;
};
