import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTFIT_DESIGNS, OUTFIT_GENDERS } from './outfit-designs.mjs';
import { resolveOutfitDesign } from './outfit-female-designs.mjs';
import { arms, aura, back, faceAndHead, garment, legs } from './outfit-generator-body.mjs';
import { renderBackView } from './outfit-generator-back-view.mjs';
import { detail, offhand, weapon } from './outfit-generator-equipment.mjs';
import { femaleDetailLayer } from './outfit-generator-female.mjs';
import { collectMaterialFamilies, materialDetailLayer } from './outfit-generator-materials.mjs';
import { ornamentDetailLayer } from './outfit-generator-ornaments.mjs';
import { safeShoulders } from './outfit-generator-safe-shoulders.mjs';
import {
  assetVersion,
  componentSignature,
  detailLevel,
  esc,
  femaleReadabilityScore,
  frameHeight,
  frameWidth,
  headgearAllowsHair,
  headgearHornCount,
  headgearMode,
  metrics,
  minimumFemaleReadabilityScore,
  minimumFrameParts,
  minimumFramePrimitives,
  minimumSheetPrimitives,
  poseMetrics,
} from './outfit-generator-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'public', 'assets');
const sprites = resolve(assets, 'sprites');
const genderDir = { MALE: 'male', FEMALE: 'female' };
const directions = ['SOUTH', 'WEST', 'EAST', 'NORTH'];
const primitivePattern = /<(path|circle|ellipse|rect|polygon|line|polyline)\b/g;
const partPattern = /data-part="([^"]+)"/g;
const designFields = ['profile', 'garment', 'head', 'shoulders', 'weapon', 'offhand', 'back', 'aura', 'detail'];

const countPrimitives = (source) => (source.match(primitivePattern) ?? []).length;
const countParts = (source) => new Set([...source.matchAll(partPattern)].map((match) => match[1])).size;
const digest = (source) => createHash('sha256').update(source).digest('hex');

const validateArtwork = (design, gender, direction, frame, artwork, primitives, parts) => {
  if (primitives < minimumFramePrimitives) {
    throw new Error(
      `${design.key}/${gender}/${direction}-${frame} has ${primitives} primitives; minimum is ${minimumFramePrimitives}.`,
    );
  }
  if (parts < minimumFrameParts) {
    throw new Error(
      `${design.key}/${gender}/${direction}-${frame} has ${parts} semantic layers; minimum is ${minimumFrameParts}.`,
    );
  }
  if (artwork.includes('NaN') || artwork.includes('Infinity')) {
    throw new Error(`${design.key}/${gender}/${direction}-${frame} contains an invalid coordinate.`);
  }
  if (artwork.includes('data-shoulder-arrows="1"')) {
    throw new Error(`${design.key}/${gender}/${direction}-${frame} contains forbidden shoulder arrows.`);
  }
  if (direction === 'NORTH') {
    if (!artwork.includes('data-facing="back"') || !artwork.includes('data-face-elements="0"')) {
      throw new Error(`${design.key}/${gender}/NORTH-${frame} is not an explicit back view.`);
    }
    if (artwork.includes('data-part="portrait"') || artwork.includes('data-part="female-portrait"')) {
      throw new Error(`${design.key}/${gender}/NORTH-${frame} contains front-facing portrait geometry.`);
    }
  }
};

const renderPose = (design, gender, direction, frame) => {
  const variant = design.activeVariant;
  const shape = metrics(variant.profile, gender, direction);
  const movement = poseMetrics(frame, direction);
  const seed = `${design.key}|${gender}|${direction}|${frame}|${componentSignature(design, gender)}`;

  let artwork;
  let facing;
  let faceElements;
  if (direction === 'NORTH') {
    artwork = renderBackView({
      design,
      gender,
      variant,
      shape,
      pose: movement,
      seed,
      frame,
    });
    facing = 'back';
    faceElements = 0;
  } else {
    const shadowWidth = Math.round(shape.hem + shape.shoulder * 0.35);
    const layers = [
      aura(variant.aura, design.palette, seed, frame),
      back(variant.back, design.palette, seed, shape, direction, movement),
      `<g data-part="ground-shadow"><ellipse cx="48" cy="131" rx="${shadowWidth}" ry="7" fill="#020306" opacity=".52"/><ellipse cx="48" cy="129" rx="${Math.max(13, shadowWidth - 8)}" ry="3" fill="#111622" opacity=".38"/></g>`,
      legs(variant.garment, design.palette, shape, direction, movement),
      garment(variant.garment, design.palette, shape, seed, direction),
      materialDetailLayer({ variant, palette: design.palette, shape, seed }),
      gender === 'FEMALE'
        ? femaleDetailLayer({
            variant,
            palette: design.palette,
            shape,
            direction,
            pose: movement,
            seed,
          })
        : '',
      arms(variant.garment, design.palette, shape, direction, movement),
      safeShoulders(variant.shoulders, design.palette, shape, direction),
      faceAndHead(variant.head, gender, design.palette, shape, direction, movement),
      weapon(variant.weapon, design.characterClass, design.palette, shape, direction, movement),
      offhand(variant.offhand, design.palette, shape, direction, movement),
      detail(variant.detail, design.palette, shape, direction),
      ornamentDetailLayer({
        design,
        variant,
        palette: design.palette,
        shape,
        direction,
        seed,
        pose: movement,
      }),
    ];
    artwork = `<g data-part="front-or-side-view" data-facing="${direction === 'SOUTH' ? 'front' : 'side'}" data-shoulder-arrows="0">${layers.join('')}</g>`;
    facing = direction === 'SOUTH' ? 'front' : 'side';
    faceElements = 1;
  }

  const primitives = countPrimitives(artwork);
  const parts = countParts(artwork);
  validateArtwork(design, gender, direction, frame, artwork, primitives, parts);
  return { artwork, movement, primitives, parts, facing, faceElements };
};

const spriteSvg = (sourceDesign, gender) => {
  const design = resolveOutfitDesign(sourceDesign, gender);
  const variant = design.activeVariant;
  const southShape = metrics(variant.profile, gender, 'SOUTH');
  const readability = femaleReadabilityScore(southShape);
  const materials = collectMaterialFamilies(variant);
  const hairVisible = headgearAllowsHair(variant.head);
  const hornCount = headgearHornCount(variant.head);
  const occlusion = headgearMode(variant.head);
  if (gender === 'FEMALE' && readability < minimumFemaleReadabilityScore) {
    throw new Error(
      `${design.key}/FEMALE readability score ${readability} is below ${minimumFemaleReadabilityScore}.`,
    );
  }

  const frameStats = [];
  const directionArtwork = new Map(directions.map((direction) => [direction, []]));
  const frames = directions
    .flatMap((direction, row) =>
      Array.from({ length: 4 }, (_, frame) => {
        const rendered = renderPose(design, gender, direction, frame);
        frameStats.push({ direction, frame, primitives: rendered.primitives, parts: rendered.parts });
        directionArtwork.get(direction).push(rendered.artwork);
        return `<g data-frame="${direction}-${frame}" data-facing="${rendered.facing}" data-face-elements="${rendered.faceElements}" data-shoulder-arrows="0" data-frame-primitives="${rendered.primitives}" data-frame-parts="${rendered.parts}" data-frame-visible-hair="${direction === 'NORTH' ? 0 : hairVisible ? 1 : 0}" data-frame-horn-count="${hornCount}" transform="translate(${frame * frameWidth} ${row * frameHeight})"><g transform="translate(0 ${rendered.movement.bob}) rotate(${rendered.movement.tilt} 48 86)">${rendered.artwork}</g></g>`;
      }),
    )
    .join('');

  const southDigest = digest(directionArtwork.get('SOUTH').join(''));
  const northDigest = digest(directionArtwork.get('NORTH').join(''));
  if (southDigest === northDigest) {
    throw new Error(`${design.key}/${gender} NORTH and SOUTH views are identical.`);
  }

  const metadata = [
    `data-outfit="${esc(design.key)}"`,
    `data-class="${design.characterClass}"`,
    `data-gender="${gender}"`,
    `data-title="${esc(design.title)}"`,
    `data-detail-level="${detailLevel}"`,
    `data-component-signature="${esc(componentSignature(design, gender))}"`,
    `data-gender-design="${gender === 'FEMALE' ? 'independent' : 'male-original'}"`,
    `data-design-identity="${esc(design.genderDesignIdentity)}"`,
    `data-material-families="${esc(materials.join(','))}"`,
    `data-female-readability="${readability}"`,
    `data-shoulder-hip-ratio="${southShape.shoulderHipRatio}"`,
    `data-waist-hip-ratio="${southShape.waistHipRatio}"`,
    `data-hand-size="${southShape.hand}"`,
    `data-foot-size="${southShape.foot}"`,
    `data-head-occlusion="${occlusion}"`,
    `data-visible-hair="${hairVisible ? 1 : 0}"`,
    `data-horn-count="${hornCount}"`,
    'data-random-body-strokes="0"',
    'data-clean-occlusion="true"',
    'data-shoulder-arrows="0"',
    'data-north-south-distinct="true"',
    `data-south-digest="${southDigest}"`,
    `data-north-digest="${northDigest}"`,
  ].join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="576" viewBox="0 0 384 576" shape-rendering="geometricPrecision" ${metadata}>${frames}</svg>\n`;
  const sheetPrimitives = countPrimitives(svg);
  if (sheetPrimitives < minimumSheetPrimitives) {
    throw new Error(
      `${design.key}/${gender} has ${sheetPrimitives} primitives; minimum is ${minimumSheetPrimitives}.`,
    );
  }
  return {
    svg,
    stats: {
      readability,
      materials,
      sheetPrimitives,
      minimumFramePrimitives: Math.min(...frameStats.map((entry) => entry.primitives)),
      minimumFrameParts: Math.min(...frameStats.map((entry) => entry.parts)),
    },
  };
};

const manifestOutfits = () =>
  Object.fromEntries(
    OUTFIT_DESIGNS.map((design) => [
      design.key,
      {
        image: `/assets/sprites/male/${design.key}.svg?v=${assetVersion}`,
        images: {
          MALE: `/assets/sprites/male/${design.key}.svg?v=${assetVersion}`,
          FEMALE: `/assets/sprites/female/${design.key}.svg?v=${assetVersion}`,
        },
        frameWidth,
        frameHeight,
        columns: 4,
        rows: 4,
        framesPerDirection: 4,
        frameDurationMs: 120,
        directionRows: { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 },
        characterClass: design.characterClass,
        unlockLevel: design.unlockLevel,
      },
    ]),
  );

const validateDesignCatalog = () => {
  if (OUTFIT_DESIGNS.length !== 33) {
    throw new Error(`Expected 33 outfits, got ${OUTFIT_DESIGNS.length}.`);
  }

  const signatures = [];
  for (const sourceDesign of OUTFIT_DESIGNS) {
    const male = resolveOutfitDesign(sourceDesign, 'MALE');
    const female = resolveOutfitDesign(sourceDesign, 'FEMALE');
    const differingFields = designFields.filter(
      (field) => male.activeVariant[field] !== female.activeVariant[field],
    );
    if (differingFields.length !== designFields.length) {
      throw new Error(
        `${sourceDesign.key} female design is still a counterpart; ${differingFields.length}/${designFields.length} structural fields differ.`,
      );
    }
    if (JSON.stringify(male.palette) === JSON.stringify(female.palette)) {
      throw new Error(`${sourceDesign.key} female design must have an independent palette.`);
    }
    signatures.push(componentSignature(male, 'MALE'), componentSignature(female, 'FEMALE'));
  }
  if (new Set(signatures).size !== 66) {
    throw new Error('All 66 variants must have unique structural component signatures.');
  }
};

export async function generateOutfitAssets() {
  validateDesignCatalog();
  await access(resolve(assets, 'tiles', 'tiled-world.svg'));
  for (const gender of OUTFIT_GENDERS) {
    const directory = resolve(sprites, genderDir[gender]);
    await mkdir(directory, { recursive: true });
    for (const file of await readdir(directory)) {
      if (file.endsWith('.png') || file.endsWith('.svg')) await rm(resolve(directory, file));
    }
  }

  const hashes = [];
  const generatedStats = [];
  for (const design of OUTFIT_DESIGNS) {
    for (const gender of OUTFIT_GENDERS) {
      const generated = spriteSvg(design, gender);
      await writeFile(resolve(sprites, genderDir[gender], `${design.key}.svg`), generated.svg);
      hashes.push(digest(generated.svg));
      generatedStats.push({ key: design.key, gender, ...generated.stats });
    }
  }
  if (new Set(hashes).size !== 66) throw new Error('Generated SVG contents are not unique.');

  const manifestPath = resolve(assets, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, version: assetVersion, outfits: manifestOutfits() }, null, 2)}\n`,
  );
  return {
    sheets: 66,
    uniqueHashes: 66,
    uniqueStructuralSignatures: 66,
    assetVersion,
    minimumSheetPrimitives: Math.min(...generatedStats.map((entry) => entry.sheetPrimitives)),
    minimumFramePrimitives: Math.min(...generatedStats.map((entry) => entry.minimumFramePrimitives)),
    minimumFrameParts: Math.min(...generatedStats.map((entry) => entry.minimumFrameParts)),
    minimumFemaleReadability: Math.min(
      ...generatedStats.filter((entry) => entry.gender === 'FEMALE').map((entry) => entry.readability),
    ),
  };
}
