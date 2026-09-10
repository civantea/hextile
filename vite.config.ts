import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';
import {
  initialStateMatchesOriginalSolution,
  parseLevelInitialStatePayload,
  parseLevelManifestPayload,
  type LevelInitialStatePayload,
  type LevelManifestPayload,
} from './lib/level-manifest';
import { createLevelManifest } from './lib/level-schema';
import {
  getAvailableLevelPositions,
  getCompactLevelNumberAssignments,
  getInsertedLevelNumberAssignments,
  sortLevelCatalogEntries,
  type LevelCatalogEntry,
} from './lib/level-catalog';
import {
  closeMongoLevelStore,
  insertLevelDocument,
  isDuplicateLevelKeyError,
  listLevelStageNumbers,
  readLevelDocumentByObjectId,
  readLevelDocuments,
  replaceLevelDocuments,
} from './lib/mongodb-level-store';
import { validatePlacements } from './lib/hextile';
import type { LevelDocument, LevelManifest } from './lib/level-manifest';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const isDockerDevelopment = process.env.HEXTILE_DOCKER === 'true';
const SAVE_LEVEL_PATH = '/__hextile/save-level';
const LEVEL_CATALOG_PATH = '/__hextile/levels';
const MAX_REQUEST_SIZE = 128 * 1024;

type StoredLevel = {
  stageName: string;
  manifest: LevelDocument;
};

function updateLevelDocument(
  document: LevelDocument,
  updates: Partial<LevelManifest>,
) {
  const { _id, ...manifest } = document;
  return {
    _id,
    ...createLevelManifest(
      { ...manifest, ...updates },
      { requireComplete: true },
    ),
  };
}

function stageNameToNumber(stageName: string) {
  const match = /^etapa-(\d+)$/i.exec(stageName);
  const stage = match ? Number(match[1]) : 0;
  if (!Number.isInteger(stage) || stage < 1) {
    throw new Error(
      `La etapa ${stageName} debe usar el formato etapa-{número}.`,
    );
  }
  return stage;
}

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
  return (await listLevelStageNumbers()).map((stage) => `etapa-${stage}`);
}

async function readStageLevels(stageName: string): Promise<StoredLevel[]> {
  const stage = stageNameToNumber(stageName);
  const levels = await readLevelDocuments(stage);
  if (levels.length === 0) {
    throw new Error('La etapa seleccionada no existe.');
  }

  return levels.map((manifest) => ({ stageName, manifest }));
}

async function readAllStageLevels() {
  return (await readLevelDocuments()).map((manifest) => ({
    stageName: `etapa-${manifest.stage}`,
    manifest,
  }));
}

function toCatalogEntry({
  stageName,
  manifest,
}: StoredLevel): LevelCatalogEntry {
  return {
    stageName,
    stage: manifest.stage,
    _id: manifest._id,
    name: manifest.name,
    deployed: manifest.deployed,
    levelNumber: manifest.levelNumber,
  };
}

async function deployStoredLevel(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw new Error('Selecciona un nivel para agregar.');
  }
  const { stage, _id, levelNumber } = input as Record<string, unknown>;
  if (
    typeof stage !== 'string' ||
    typeof _id !== 'string' ||
    typeof levelNumber !== 'number'
  ) {
    throw new Error('Selecciona un nivel válido para agregar.');
  }

  const allLevels = await readAllStageLevels();
  const target = allLevels.find(
    (level) => level.stageName === stage && level.manifest._id === _id,
  );
  if (!target) {
    throw new Error('No se encontró el nivel seleccionado.');
  }
  if (target.manifest.deployed) {
    throw new Error('El nivel seleccionado ya fue agregado a Play.');
  }

  const stageNumber = stageNameToNumber(stage);
  const assignments = new Map(
    getInsertedLevelNumberAssignments(
      allLevels.map((level) => level.manifest),
      stageNumber,
      target.manifest._id,
      levelNumber,
    ).map(({ _id: manifestObjectId, levelNumber: assignedLevelNumber }) => [
      manifestObjectId,
      assignedLevelNumber,
    ]),
  );
  const targetLevelNumber = assignments.get(target.manifest._id);
  if (!targetLevelNumber) {
    throw new Error('No se pudo calcular la posición del nivel.');
  }
  const manifest = updateLevelDocument(target.manifest, {
    deployed: true,
    stage: stageNumber,
    levelNumber: targetLevelNumber,
  });
  const shiftedManifests = allLevels
    .filter(
      (level) =>
        level.manifest._id !== target.manifest._id &&
        level.manifest.deployed &&
        level.manifest.stage === stageNumber,
    )
    .map((level) => {
      const assignedLevelNumber = assignments.get(level.manifest._id);
      if (!assignedLevelNumber) {
        throw new Error('No se pudo recalcular el orden de Play.');
      }
      return updateLevelDocument(level.manifest, {
        levelNumber: assignedLevelNumber,
      });
    });
  await replaceLevelDocuments([manifest, ...shiftedManifests]);

  return toCatalogEntry({ ...target, manifest });
}

async function undeployStoredLevel(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw new Error('Selecciona un nivel para quitar.');
  }
  const { stage, _id } = input as Record<string, unknown>;
  if (typeof stage !== 'string' || typeof _id !== 'string') {
    throw new Error('Selecciona un nivel válido para quitar.');
  }

  const allLevels = await readAllStageLevels();
  const target = allLevels.find(
    (level) => level.stageName === stage && level.manifest._id === _id,
  );
  if (!target) {
    throw new Error('No se encontró el nivel seleccionado.');
  }
  if (!target.manifest.deployed) {
    throw new Error('El nivel seleccionado ya no está en Play.');
  }

  const stageNumber = stageNameToNumber(stage);
  const removedManifest = updateLevelDocument(target.manifest, {
    deployed: false,
    stage: stageNumber,
    levelNumber: null,
  });
  const remainingManifests = allLevels
    .filter((level) => level.manifest._id !== target.manifest._id)
    .map((level) => level.manifest);
  const assignments = new Map(
    getCompactLevelNumberAssignments(remainingManifests, stageNumber).map(
      ({ _id: manifestObjectId, levelNumber }) => [
        manifestObjectId,
        levelNumber,
      ],
    ),
  );

  const compactedManifests = allLevels
    .filter(
      (level) =>
        level.manifest._id !== target.manifest._id &&
        level.manifest.deployed &&
        level.manifest.stage === stageNumber,
    )
    .map((level) => {
      const levelNumber = assignments.get(level.manifest._id);
      if (!levelNumber) {
        throw new Error('No se pudo recalcular el orden de Play.');
      }
      return updateLevelDocument(level.manifest, { levelNumber });
    });
  await replaceLevelDocuments([removedManifest, ...compactedManifests]);

  return toCatalogEntry({ ...target, manifest: removedManifest });
}

async function writeLevelManifest({
  name,
  originalSolution,
}: LevelManifestPayload) {
  const manifest = createLevelManifest({ name, originalSolution });
  let _id: string;
  try {
    _id = await insertLevelDocument(manifest);
  } catch (error) {
    if (isDuplicateLevelKeyError(error)) {
      throw new Error('Ya existe un nivel con ese nombre. Elige otro.');
    }
    throw error;
  }

  return { _id };
}

async function completeLevelManifest({
  _id,
  initialDistribution,
  initialHand,
}: LevelInitialStatePayload) {
  const stored = await readLevelDocumentByObjectId(_id);
  if (!stored) {
    throw new Error('No se encontró el nivel guardado en MongoDB.');
  }

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

  const manifest: LevelDocument = {
    _id,
    ...createLevelManifest(
      {
        name: original.name,
        originalSolution: original.originalSolution,
        initialDistribution,
        initialHand,
      },
      { requireComplete: true },
    ),
  };
  await replaceLevelDocuments([manifest]);
  return { _id };
}

function levelManifestWriter(): Plugin {
  return {
    name: 'hextile-level-manifest-writer',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('close', () => {
        void closeMongoLevelStore();
      });

      server.middlewares.use(LEVEL_CATALOG_PATH, async (request, response) => {
        try {
          if (request.method === 'GET') {
            const url = new URL(request.url ?? '/', 'http://localhost');
            const view = url.searchParams.get('view');
            const stage = url.searchParams.get('stage');
            if (stage) {
              const stageLevels = await readStageLevels(stage);
              const catalogView =
                view === 'deployed' ? 'deployed' : 'undeployed';
              const levels = sortLevelCatalogEntries(
                stageLevels
                  .filter((level) =>
                    catalogView === 'deployed'
                      ? level.manifest.deployed
                      : !level.manifest.deployed,
                  )
                  .map(toCatalogEntry),
                catalogView,
              );
              const availablePositions =
                catalogView === 'undeployed'
                  ? getAvailableLevelPositions(
                      stageLevels.map((level) => level.manifest),
                      stageNameToNumber(stage),
                    )
                  : undefined;
              sendJson(response, 200, {
                stage,
                levels,
                ...(availablePositions ? { availablePositions } : {}),
              });
              return;
            }

            if (view === 'deployed-stages' || view === 'undeployed-stages') {
              const shouldBeDeployed = view === 'deployed-stages';
              const stages = Array.from(
                new Set(
                  (await readAllStageLevels())
                    .filter(
                      (level) => level.manifest.deployed === shouldBeDeployed,
                    )
                    .map((level) => level.stageName),
                ),
              ).sort(
                (left, right) =>
                  stageNameToNumber(left) - stageNameToNumber(right),
              );
              sendJson(response, 200, { stages });
              return;
            }

            if (url.searchParams.get('deployed') === 'true') {
              const deployedLevels = (await readAllStageLevels())
                .map((level) => level.manifest)
                .filter((manifest) => manifest.deployed)
                .sort(
                  (left, right) =>
                    left.stage - right.stage ||
                    (left.levelNumber ?? 0) - (right.levelNumber ?? 0),
                );
              sendJson(response, 200, { levels: deployedLevels });
              return;
            }

            sendJson(response, 200, { stages: await listStageNames() });
            return;
          }

          if (request.method === 'PATCH') {
            const input = await readJsonBody(request);
            const action =
              input && typeof input === 'object'
                ? (input as { action?: unknown }).action
                : undefined;
            const level =
              action === 'undeploy'
                ? await undeployStoredLevel(input)
                : await deployStoredLevel(input);
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
    server:
      isCodexSeatbeltSandbox || isDockerDevelopment
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
