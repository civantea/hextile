import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';
import {
  initialStateMatchesOriginalSolution,
  levelNameToFilename,
  parseLevelInitialStatePayload,
  parseLevelManifestPayload,
  type LevelInitialStatePayload,
  type LevelManifestPayload,
} from './lib/level-manifest';
import {
  assertLevelManifestSchema,
  createLevelManifest,
} from './lib/level-schema';
import { getNextPlayOrder, type LevelCatalogEntry } from './lib/level-catalog';
import { LEVELS, validatePlacements } from './lib/hextile';
import type { LevelManifest } from './lib/level-manifest';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const SAVE_LEVEL_PATH = '/__hextile/save-level';
const LEVEL_CATALOG_PATH = '/__hextile/levels';
const MAX_REQUEST_SIZE = 128 * 1024;

type StoredLevel = {
  stage: string;
  fileName: string;
  filePath: string;
  manifest: LevelManifest;
};

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

function sendJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_SIZE) {
      throw new Error('La solicitud es demasiado grande.');
    }
  }
  return JSON.parse(body);
}

async function listStageNames() {
  const levelsDirectory = resolve(process.cwd(), 'niveles');
  const entries = await readdir(levelsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'es'));
}

async function readStageLevels(stage: string): Promise<StoredLevel[]> {
  const stages = await listStageNames();
  if (!stages.includes(stage)) {
    throw new Error('La etapa seleccionada no existe.');
  }

  const stageDirectory = resolve(process.cwd(), 'niveles', stage);
  const files = await readdir(stageDirectory, { withFileTypes: true });
  const jsonFiles = files
    .filter(
      (file) =>
        file.isFile() &&
        file.name.endsWith('.json') &&
        !file.name.endsWith('.schema.json'),
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));

  return Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = resolve(stageDirectory, file.name);
      const manifest: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      assertLevelManifestSchema(manifest, { requireComplete: true });
      return {
        stage,
        fileName: file.name,
        filePath,
        manifest,
      };
    }),
  );
}

async function readAllStageLevels() {
  const stages = await listStageNames();
  return (await Promise.all(stages.map(readStageLevels))).flat();
}

function toCatalogEntry({
  stage,
  fileName,
  manifest,
}: StoredLevel): LevelCatalogEntry {
  return {
    stage,
    fileName,
    id: manifest.id,
    name: manifest.name,
    deployed: manifest.deployed,
    ...(manifest.playOrder ? { playOrder: manifest.playOrder } : {}),
  };
}

async function deployStoredLevel(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw new Error('Selecciona un nivel para agregar.');
  }
  const { stage, id } = input as Record<string, unknown>;
  if (typeof stage !== 'string' || typeof id !== 'string') {
    throw new Error('Selecciona un nivel válido para agregar.');
  }

  const allLevels = await readAllStageLevels();
  const target = allLevels.find(
    (level) => level.stage === stage && level.manifest.id === id,
  );
  if (!target) {
    throw new Error('No se encontró el nivel seleccionado.');
  }
  if (target.manifest.deployed) {
    throw new Error('El nivel seleccionado ya fue agregado a Play.');
  }

  const playOrder = getNextPlayOrder(
    allLevels.map((level) => level.manifest),
    LEVELS.length,
  );
  const manifest = createLevelManifest(
    {
      ...target.manifest,
      deployed: true,
      playOrder,
    },
    { requireComplete: true },
  );
  await writeFile(
    target.filePath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return toCatalogEntry({ ...target, manifest });
}

async function writeLevelManifest({
  name,
  originalSolution,
}: LevelManifestPayload) {
  const levelsDirectory = resolve(process.cwd(), 'niveles');
  await mkdir(levelsDirectory, { recursive: true });

  const id = randomUUID();
  const fileName = levelNameToFilename(name);
  const manifest = createLevelManifest({ id, name, originalSolution });
  try {
    await writeFile(
      resolve(levelsDirectory, fileName),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Ya existe un nivel con ese nombre. Elige otro.');
    }
    throw error;
  }

  return { id, fileName };
}

async function completeLevelManifest({
  id,
  initialDistribution,
  initialHand,
}: LevelInitialStatePayload) {
  const levelsDirectory = resolve(process.cwd(), 'niveles');
  const files = await readdir(levelsDirectory, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;

    const filePath = resolve(levelsDirectory, file.name);
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    if (
      !stored ||
      typeof stored !== 'object' ||
      (stored as { id?: unknown }).id !== id
    ) {
      continue;
    }

    assertLevelManifestSchema(stored);
    const original = parseLevelManifestPayload(stored);
    if (
      !initialStateMatchesOriginalSolution(
        original.originalSolution,
        initialDistribution,
        initialHand,
      )
    ) {
      throw new Error(
        'El estado inicial no corresponde con la solución original guardada.',
      );
    }

    const manifest = createLevelManifest(
      {
        id,
        name: original.name,
        originalSolution: original.originalSolution,
        initialDistribution,
        initialHand,
      },
      { requireComplete: true },
    );
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { id, fileName: file.name };
  }

  throw new Error('No se encontró el archivo del nivel guardado.');
}

function levelManifestWriter(): Plugin {
  return {
    name: 'hextile-level-manifest-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(LEVEL_CATALOG_PATH, async (request, response) => {
        try {
          if (request.method === 'GET') {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (url.searchParams.get('deployed') === 'true') {
              const deployedLevels = (await readAllStageLevels())
                .map((level) => level.manifest)
                .filter((manifest) => manifest.deployed)
                .sort(
                  (left, right) =>
                    (left.playOrder ?? 0) - (right.playOrder ?? 0),
                );
              sendJson(response, 200, { levels: deployedLevels });
              return;
            }

            const stage = url.searchParams.get('stage');
            if (stage) {
              const levels = (await readStageLevels(stage)).map(toCatalogEntry);
              sendJson(response, 200, { stage, levels });
              return;
            }

            sendJson(response, 200, { stages: await listStageNames() });
            return;
          }

          if (request.method === 'PATCH') {
            const level = await deployStoredLevel(await readJsonBody(request));
            sendJson(response, 200, { level });
            return;
          }

          sendJson(response, 405, { error: 'Método no permitido.' });
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : 'No se pudo consultar el catálogo de niveles.',
          });
        }
      });

      server.middlewares.use(SAVE_LEVEL_PATH, async (request, response) => {
        if (request.method !== 'POST' && request.method !== 'PATCH') {
          sendJson(response, 405, { error: 'Método no permitido.' });
          return;
        }

        try {
          const input = await readJsonBody(request);
          if (request.method === 'POST') {
            const payload = parseLevelManifestPayload(input);
            const validation = validatePlacements(payload.originalSolution);
            if (Object.values(validation).some((mark) => !mark.valid)) {
              sendJson(response, 422, {
                error:
                  'No se puede guardar: la validación contiene uno o más ❌.',
              });
              return;
            }

            const result = await writeLevelManifest(payload);
            sendJson(response, 201, result);
            return;
          }

          const payload = parseLevelInitialStatePayload(input);
          const result = await completeLevelManifest(payload);
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : 'No se pudo guardar la solución.',
          });
        }
      });
    },
  };
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      levelManifestWriter(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
