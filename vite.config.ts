import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';
import {
  parseSolutionPayload,
  solutionToPlacements,
  type LevelManifest,
  type LevelSolutionEntry,
} from './lib/level-manifest';
import { validatePlacements } from './lib/hextile';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const SAVE_LEVEL_PATH = '/__hextile/save-level';
const MAX_REQUEST_SIZE = 128 * 1024;

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
  response.end(JSON.stringify(payload));
}

async function writeLevelManifest(solution: LevelSolutionEntry[]) {
  const levelsDirectory = resolve(process.cwd(), 'niveles');
  await mkdir(levelsDirectory, { recursive: true });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const manifest: LevelManifest = { id, solution };
    try {
      await writeFile(
        resolve(levelsDirectory, `${id}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  throw new Error('No se pudo generar un identificador único.');
}

function levelManifestWriter(): Plugin {
  return {
    name: 'hextile-level-manifest-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(SAVE_LEVEL_PATH, async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Método no permitido.' });
          return;
        }

        try {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_SIZE) {
              sendJson(response, 413, { error: 'La solución es demasiado grande.' });
              return;
            }
          }

          const solution = parseSolutionPayload(JSON.parse(body));
          const placements = solutionToPlacements(solution);
          const validation = validatePlacements(placements);
          if (Object.values(validation).some((mark) => !mark.valid)) {
            sendJson(response, 422, {
              error:
                'No se puede guardar: la validación contiene uno o más ❌.',
            });
            return;
          }

          const id = await writeLevelManifest(solution);
          sendJson(response, 201, { id });
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
