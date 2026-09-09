import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import {
  initialStateMatchesOriginalSolution,
  levelNameToFilename,
  parseLevelInitialStatePayload,
  parseLevelManifestPayload,
  placementsToCoordinateMap,
} from '../lib/level-manifest.ts';
import {
  assertLevelManifestSchema,
  createLevelManifest,
} from '../lib/level-schema.ts';
import {
  getNextPlayOrder,
  levelManifestToDefinition,
} from '../lib/level-catalog.ts';

const LEVELS_DIRECTORY = new URL('../niveles/', import.meta.url);
const TEST_LEVEL_ID = 'd94b7242-cf09-49f2-a4fc-334f53661c31';

test('la solución original usa coordenadas como claves y colores como valores', () => {
  const placements = {
    '0,0': 'celeste',
    '1,0': 'rojo',
  };
  const originalSolution = placementsToCoordinateMap(placements);

  assert.deepEqual(originalSolution, {
    '0,0': 'celeste',
    '1,0': 'rojo',
  });
  assert.deepEqual(
    parseLevelManifestPayload({
      name: 'Puente celeste',
      originalSolution,
    }),
    { name: 'Puente celeste', originalSolution: placements },
  );
});

test('conserva el nombre legible en un nombre seguro de archivo', () => {
  assert.equal(
    levelNameToFilename('  Puente Céleste  '),
    'Puente Céleste.json',
  );
  assert.equal(levelNameToFilename('Cruce / azul'), 'Cruce - azul.json');
});

test('rechaza nombres o soluciones originales inválidas', () => {
  assert.throws(
    () =>
      parseLevelManifestPayload({
        name: '   ',
        originalSolution: { '0,0': 'celeste' },
      }),
    /nombre/,
  );
  assert.throws(
    () =>
      parseLevelManifestPayload({
        name: 'Vacío',
        originalSolution: {},
      }),
    /al menos/,
  );
  assert.throws(
    () =>
      parseLevelManifestPayload({
        name: 'Fuera del tablero',
        originalSolution: { '99,99': 'celeste' },
      }),
    /no existe/,
  );
  assert.throws(
    () =>
      parseLevelManifestPayload({
        name: 'Color inválido',
        originalSolution: { '0,0': 'rosa' },
      }),
    /color válido/,
  );
});

test('prepara un estado inicial con distribución y mano por color', () => {
  const payload = parseLevelInitialStatePayload({
    id: 'nivel-uno',
    initialDistribution: {
      '0,0': 'verde',
      '1,0': 'verde',
    },
    initialHand: {
      celeste: 0,
      verde: 1,
      morado: 0,
      azul: 0,
      naranja: 0,
      rojo: 0,
    },
  });

  assert.deepEqual(payload, {
    id: 'nivel-uno',
    initialDistribution: {
      '0,0': 'verde',
      '1,0': 'verde',
    },
    initialHand: {
      celeste: 0,
      verde: 1,
      morado: 0,
      azul: 0,
      naranja: 0,
      rojo: 0,
    },
  });
  assert.equal(
    initialStateMatchesOriginalSolution(
      {
        '0,0': 'verde',
        '1,0': 'verde',
        '0,1': 'verde',
      },
      payload.initialDistribution,
      payload.initialHand,
    ),
    true,
  );
});

test('rechaza una mano vacía o un estado distinto de la solución original', () => {
  assert.throws(
    () =>
      parseLevelInitialStatePayload({
        id: 'nivel-uno',
        initialDistribution: { '0,0': 'verde' },
        initialHand: { verde: 0 },
      }),
    /al menos una pieza/,
  );
  assert.equal(
    initialStateMatchesOriginalSolution(
      { '0,0': 'verde', '1,0': 'verde' },
      { '0,0': 'verde' },
      { verde: 2 },
    ),
    false,
  );
  assert.equal(
    initialStateMatchesOriginalSolution(
      { '0,0': 'verde', '1,0': 'verde' },
      { '0,1': 'verde' },
      { verde: 1 },
    ),
    false,
  );
});

test('genera manifiestos nuevos desde el esquema con deployed en false', () => {
  const manifest = createLevelManifest({
    id: TEST_LEVEL_ID,
    name: 'Nivel de esquema',
    originalSolution: { '0,0': 'celeste' },
  });

  assert.deepEqual(manifest, {
    id: TEST_LEVEL_ID,
    name: 'Nivel de esquema',
    deployed: false,
    originalSolution: { '0,0': 'celeste' },
  });
  assert.doesNotThrow(() => assertLevelManifestSchema(manifest));
});

test('el esquema rechaza manifiestos sin deployed o con tipo incorrecto', () => {
  assert.throws(
    () =>
      assertLevelManifestSchema({
        id: TEST_LEVEL_ID,
        name: 'Sin estado',
        originalSolution: { '0,0': 'celeste' },
      }),
    /deployed/,
  );
  assert.throws(
    () =>
      assertLevelManifestSchema({
        id: TEST_LEVEL_ID,
        name: 'Estado incorrecto',
        deployed: 'false',
        originalSolution: { '0,0': 'celeste' },
      }),
    /boolean/,
  );
  assert.throws(
    () =>
      assertLevelManifestSchema({
        id: TEST_LEVEL_ID,
        name: 'Sin posición',
        deployed: true,
        originalSolution: { '0,0': 'celeste' },
      }),
    /playOrder/,
  );
});

test('el esquema exige el estado inicial antes de entregar un nivel completo', () => {
  const incomplete = createLevelManifest({
    id: TEST_LEVEL_ID,
    name: 'Incompleto',
    originalSolution: { '0,0': 'verde' },
  });

  assert.throws(
    () =>
      assertLevelManifestSchema(incomplete, {
        requireComplete: true,
      }),
    /distribución y la mano inicial/,
  );

  const complete = createLevelManifest(
    {
      id: TEST_LEVEL_ID,
      name: 'Completo',
      originalSolution: { '0,0': 'verde', '1,0': 'verde' },
      initialDistribution: { '0,0': 'verde' },
      initialHand: {
        celeste: 0,
        verde: 1,
        morado: 0,
        azul: 0,
        naranja: 0,
        rojo: 0,
      },
    },
    { requireComplete: true },
  );

  assert.equal(complete.deployed, false);
});

test('convierte un manifiesto agregado en el siguiente nivel jugable', () => {
  const manifest = createLevelManifest(
    {
      id: TEST_LEVEL_ID,
      name: 'Nombre interno que no se muestra',
      deployed: true,
      playOrder: 2,
      originalSolution: {
        '0,0': 'celeste',
        '1,0': 'celeste',
        '0,1': 'verde',
      },
      initialDistribution: {
        '0,0': 'celeste',
        '0,1': 'verde',
      },
      initialHand: {
        celeste: 1,
        verde: 0,
        morado: 0,
        azul: 0,
        naranja: 0,
        rojo: 0,
      },
    },
    { requireComplete: true },
  );

  const level = levelManifestToDefinition(manifest);
  assert.equal(level.id, 2);
  assert.equal(level.label, 'Nivel 2');
  assert.deepEqual(level.fixedPlacements, manifest.initialDistribution);
  assert.deepEqual(level.inventory, { celeste: 1, verde: 0 });
  assert.deepEqual(
    level.rules.colors.map((rule) => rule.color),
    ['celeste', 'verde'],
  );
});

test('calcula una posición nueva después de todos los niveles actuales', () => {
  assert.equal(
    getNextPlayOrder(
      [{ playOrder: 4 }, { playOrder: 2 }, { deployed: false }],
      1,
    ),
    5,
  );
});

test('todos los niveles actuales cumplen el esquema de despliegue', async () => {
  const files = (await readdir(LEVELS_DIRECTORY, { recursive: true })).filter(
    (file) => file.endsWith('.json') && !file.endsWith('.schema.json'),
  );

  assert.ok(files.length > 0);
  for (const file of files) {
    const manifest = JSON.parse(
      await readFile(new URL(file, LEVELS_DIRECTORY), 'utf8'),
    );
    assert.equal(typeof manifest.deployed, 'boolean', file);
    assert.doesNotThrow(
      () => assertLevelManifestSchema(manifest, { requireComplete: true }),
      file,
    );
  }
});
