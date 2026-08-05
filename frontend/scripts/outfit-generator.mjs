import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTFIT_DESIGNS, OUTFIT_GENDERS } from './outfit-designs.mjs';
import { garment, legs, shoulders } from './outfit-generator-body.mjs';
import { detail, offhand, weapon } from './outfit-generator-equipment.mjs';
import { advancedDetailLayer } from './outfit-generator-overlay.mjs';
import { aura, back } from './outfit-generator-safe-parts.mjs';
import { faceAndHead } from './outfit-generator-safe-head.mjs';
import {
  assetVersion,
  componentSignature,
  esc,
  frameHeight,
  frameWidth,
  metrics,
} from './outfit-generator-utils.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'public', 'assets');
const sprites = resolve(assets, 'sprites');
const genderDir = { MALE: 'male', FEMALE: 'female' };
const directions = ['SOUTH', 'WEST', 'EAST', 'NORTH'];
const walk = [0, -2, 0, 2];

const pose = (design, gender, direction) => {
  const variant = design.variants[gender];
  const localDirection = direction === 'EAST' ? 'WEST' : direction;
  const shape = metrics(variant.profile, gender, localDirection);
  const seed = `${design.key}|${gender}|${componentSignature(design, gender)}`;
  const content = [
    aura(variant.aura, design.palette, seed),
    back(variant.back, design.palette, seed),
    `<ellipse cx="48" cy="130" rx="${shape.hem + 4}" ry="7" fill="#050609" opacity=".48"/>`,
    legs(variant.garment, design.palette, shape),
    garment(variant.garment, design.palette, shape, seed),
    shoulders(variant.shoulders, design.palette, shape),
    faceAndHead(variant.head, gender, design.palette, shape, localDirection),
    weapon(variant.weapon, design.characterClass, design.palette),
    offhand(variant.offhand, design.palette),
    detail(variant.detail, design.palette, shape),
    advancedDetailLayer({
      design,
      gender,
      variant,
      shape,
      direction: localDirection,
      seed,
    }),
  ].join('');
  return direction === 'EAST'
    ? `<g transform="translate(96 0) scale(-1 1)">${content}</g>`
    : content;
};

const spriteSvg = (design, gender) => {
  const definitions = directions
    .map((direction) => `<g id="pose-${direction.toLowerCase()}">${pose(design, gender, direction)}</g>`)
    .join('');
  const frames = directions
    .flatMap((direction, row) =>
      Array.from({ length: 4 }, (_, frame) => {
        const bounce = walk[frame] * 0.35;
        const lean = frame === 1 ? 0.8 : frame === 3 ? -0.8 : 0;
        return `<g data-frame="${direction}-${frame}" transform="translate(${frame * frameWidth} ${row * frameHeight})"><g transform="translate(0 ${bounce}) skewX(${lean})"><use href="#pose-${direction.toLowerCase()}"/></g></g>`;
      }),
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="576" viewBox="0 0 384 576" shape-rendering="geometricPrecision" data-outfit="${esc(design.key)}" data-gender="${gender}" data-title="${esc(design.title)}" data-detail-level="advanced-v5-clean" data-random-body-strokes="0" data-clean-occlusion="true" data-horn-count="0" data-component-signature="${esc(componentSignature(design, gender))}"><defs>${definitions}</defs>${frames}</svg>\n`;
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

const validate = () => {
  if (OUTFIT_DESIGNS.length !== 33) {
    throw new Error(`Expected 33 outfits, got ${OUTFIT_DESIGNS.length}.`);
  }
  const signatures = OUTFIT_DESIGNS.flatMap((design) =>
    OUTFIT_GENDERS.map((gender) => componentSignature(design, gender)),
  );
  if (new Set(signatures).size !== 66) {
    throw new Error('All 66 variants must have unique structural component signatures.');
  }
};

export async function generateOutfitAssets() {
  validate();
  await access(resolve(assets, 'tiles', 'tiled-world.svg'));
  for (const gender of OUTFIT_GENDERS) {
    const directory = resolve(sprites, genderDir[gender]);
    await mkdir(directory, { recursive: true });
    for (const file of await readdir(directory)) {
      if (file.endsWith('.png') || file.endsWith('.svg')) await rm(resolve(directory, file));
    }
  }

  const hashes = [];
  for (const design of OUTFIT_DESIGNS) {
    for (const gender of OUTFIT_GENDERS) {
      const svg = spriteSvg(design, gender);
      const primitiveCount = (svg.match(/<(path|circle|ellipse|rect|polygon)\b/g) ?? []).length;
      if (primitiveCount < 120) {
        throw new Error(`${design.key}/${gender} is below the clean detail floor (${primitiveCount} primitives).`);
      }
      if (svg.includes('data-random-strokes="1"') || svg.includes('data-horn-count="1"')) {
        throw new Error(`${design.key}/${gender} contains forbidden line noise or horn geometry.`);
      }
      await writeFile(resolve(sprites, genderDir[gender], `${design.key}.svg`), svg);
      hashes.push(createHash('sha256').update(svg).digest('hex'));
    }
  }
  if (new Set(hashes).size !== 66) throw new Error('Generated SVG contents are not unique.');

  const manifestPath = resolve(assets, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, version: assetVersion, outfits: manifestOutfits() }, null, 2)}\n`,
  );
  return { sheets: 66, uniqueHashes: 66, uniqueStructuralSignatures: 66, assetVersion };
}
