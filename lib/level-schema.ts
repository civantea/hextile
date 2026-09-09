import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';

import levelSchema from '../niveles/level.schema.json' with { type: 'json' };
import {
  parseLevelInitialStatePayload,
  parseLevelManifestPayload,
  type LevelManifest,
} from './level-manifest.ts';

type LevelManifestDraft = Omit<LevelManifest, 'deployed'> & {
  deployed?: boolean;
};

type SchemaValidationOptions = {
  requireComplete?: boolean;
};

const strictAjv = new Ajv2020({ allErrors: true });
const defaultsAjv = new Ajv2020({ allErrors: true, useDefaults: true });
const validateLevelSchema = strictAjv.compile(levelSchema);
const applyLevelSchemaDefaults = defaultsAjv.compile(levelSchema);

function formatSchemaErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || 'raíz'} ${error.message ?? ''}`)
    .join('; ');
}

export function assertLevelManifestSchema(
  input: unknown,
  { requireComplete = false }: SchemaValidationOptions = {},
): asserts input is LevelManifest {
  if (!validateLevelSchema(input)) {
    throw new Error(
      `El manifiesto no cumple el esquema de nivel: ${formatSchemaErrors(validateLevelSchema.errors)}.`,
    );
  }

  parseLevelManifestPayload(input);

  if (requireComplete) {
    const manifest = input as LevelManifest;
    if (!manifest.initialDistribution || !manifest.initialHand) {
      throw new Error(
        'El manifiesto completo debe incluir la distribución y la mano inicial.',
      );
    }
    parseLevelInitialStatePayload({
      id: manifest.id,
      initialDistribution: manifest.initialDistribution,
      initialHand: manifest.initialHand,
    });
  }
}

export function createLevelManifest(
  draft: LevelManifestDraft,
  options: SchemaValidationOptions = {},
): LevelManifest {
  const manifest: unknown = { ...draft };

  if (!applyLevelSchemaDefaults(manifest)) {
    throw new Error(
      `No se pudo generar el manifiesto desde el esquema: ${formatSchemaErrors(applyLevelSchemaDefaults.errors)}.`,
    );
  }

  assertLevelManifestSchema(manifest, options);
  return manifest;
}
