import { readFile, readdir } from 'node:fs/promises';

import { assertLevelManifestSchema } from '../lib/level-schema.ts';
import {
  closeMongoLevelStore,
  seedLevelDocuments,
} from '../lib/mongodb-level-store.ts';

const levelsDirectory = new URL('../niveles/', import.meta.url);

async function readLevelFixtures() {
  const files = (await readdir(levelsDirectory, { recursive: true }))
    .filter((file) => file.endsWith('.json') && !file.endsWith('.schema.json'))
    .sort((left, right) => left.localeCompare(right, 'es'));

  const manifests = await Promise.all(
    files.map(async (file) => {
      const manifest = JSON.parse(
        await readFile(new URL(file, levelsDirectory), 'utf8'),
      );
      assertLevelManifestSchema(manifest, { requireComplete: true });
      return manifest;
    }),
  );

  const ids = new Set();
  const names = new Set();
  for (const manifest of manifests) {
    const comparableName = manifest.name
      .normalize('NFC')
      .toLocaleLowerCase('es');
    if (ids.has(manifest.id)) {
      throw new Error(`El identificador ${manifest.id} está repetido.`);
    }
    if (names.has(comparableName)) {
      throw new Error(`El nombre ${manifest.name} está repetido.`);
    }
    ids.add(manifest.id);
    names.add(comparableName);
  }

  return manifests;
}

try {
  const manifests = await readLevelFixtures();
  const insertedCount = await seedLevelDocuments(manifests);
  console.log(
    `MongoDB listo: ${insertedCount} niveles importados en hextile.levels.`,
  );
} finally {
  await closeMongoLevelStore();
}
