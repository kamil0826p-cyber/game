import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

const configuredSources = [
  'prisma/seed.ts',
  'prisma/seed-quests.ts',
  'prisma/maps',
  'src/modules/skills/skill.catalog.ts',
] as const;

const collectFiles = async (path: string): Promise<string[]> => {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const children = await readdir(path);
  const nested = await Promise.all(children.sort().map((child) => collectFiles(resolve(path, child))));
  return nested.flat();
};

export const calculateLegacyContentHash = async (): Promise<string> => {
  const files = (
    await Promise.all(configuredSources.map((source) => collectFiles(resolve(repositoryRoot, source))))
  )
    .flat()
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(repositoryRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const CONTENT_PATCH_ID = 'content-0001-legacy-bootstrap';
