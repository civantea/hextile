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
  getAvailableLevelPositions,
  getCompactLevelNumberAssignments,
  getInsertedLevelNumberAssignments,
  getNextLevelNumber,
  levelManifestToDefinition,
  sortLevelCatalogEntries,
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
    stage: 1,
    levelNumber: null,
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
        stage: 1,
        levelNumber: null,
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
        stage: 1,
        levelNumber: null,
        originalSolution: { '0,0': 'celeste' },
      }),
    /integer/,
  );
  assert.throws(
    () =>
      assertLevelManifestSchema({
        id: TEST_LEVEL_ID,
        name: 'Posición sin despliegue',
        deployed: false,
        stage: 1,
        levelNumber: 1,
        originalSolution: { '0,0': 'celeste' },
      }),
    /null/,
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
  assert.equal(complete.stage, 1);
  assert.equal(complete.levelNumber, null);
});

test('convierte un manifiesto agregado en el siguiente nivel jugable', () => {
  const manifest = createLevelManifest(
    {
      id: TEST_LEVEL_ID,
      name: 'Nombre interno que no se muestra',
      deployed: true,
      stage: 2,
      levelNumber: 1,
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
  assert.equal(level.id, 1);
  assert.equal(level.stage, 2);
  assert.equal(level.levelNumber, 1);
  assert.equal(level.label, 'Nivel 1');
  assert.deepEqual(level.fixedPlacements, manifest.initialDistribution);
  assert.deepEqual(level.inventory, { celeste: 1, verde: 0 });
  assert.deepEqual(
    level.rules.colors.map((rule) => rule.color),
    ['celeste', 'verde'],
  );
});

test('calcula la siguiente posición solo dentro de la etapa indicada', () => {
  assert.equal(getNextLevelNumber([], 1), 1);
  assert.equal(
    getNextLevelNumber(
      [
        { deployed: true, stage: 1, levelNumber: 3 },
        { deployed: true, stage: 2, levelNumber: 8 },
        { deployed: false, stage: 1, levelNumber: null },
      ],
      1,
    ),
    4,
  );
});

test('ofrece una posición por cada nivel desplegado más la posición final', () => {
  assert.deepEqual(
    getAvailableLevelPositions(
      [
        { deployed: true, stage: 1 },
        { deployed: true, stage: 1 },
        { deployed: false, stage: 1 },
        { deployed: true, stage: 2 },
      ],
      1,
    ),
    [1, 2, 3],
  );
});

test('inserta un nivel y recorre únicamente los posteriores de su etapa', () => {
  const manifests = [
    { id: 'primero', deployed: true, stage: 1, levelNumber: 1 },
    { id: 'segundo', deployed: true, stage: 1, levelNumber: 2 },
    { id: 'tercero', deployed: true, stage: 1, levelNumber: 3 },
    { id: 'otra-etapa', deployed: true, stage: 2, levelNumber: 1 },
  ];

  assert.deepEqual(
    getInsertedLevelNumberAssignments(manifests, 1, 'nuevo', 2),
    [
      { id: 'primero', levelNumber: 1 },
      { id: 'nuevo', levelNumber: 2 },
      { id: 'segundo', levelNumber: 3 },
      { id: 'tercero', levelNumber: 4 },
    ],
  );
  assert.throws(
    () => getInsertedLevelNumberAssignments(manifests, 1, 'nuevo', 5),
    /entre 1 y 4/,
  );
});

test('compacta la numeración sin modificar otras etapas', () => {
  assert.deepEqual(
    getCompactLevelNumberAssignments(
      [
        { id: 'primero', deployed: true, stage: 1, levelNumber: 2 },
        { id: 'retirado', deployed: false, stage: 1, levelNumber: null },
        { id: 'ultimo', deployed: true, stage: 1, levelNumber: 4 },
        { id: 'otra-etapa', deployed: true, stage: 2, levelNumber: 6 },
      ],
      1,
    ),
    [
      { id: 'primero', levelNumber: 1 },
      { id: 'ultimo', levelNumber: 2 },
    ],
  );
});

test('ordena catálogos desplegados por número y pendientes por nombre', () => {
  const entries = [
    {
      stageName: 'etapa-1',
      stage: 1,
      fileName: 'Zeta.json',
      id: 'zeta',
      name: 'Zeta',
      deployed: true,
      levelNumber: 1,
    },
    {
      stageName: 'etapa-1',
      stage: 1,
      fileName: 'Árbol.json',
      id: 'arbol',
      name: 'Árbol',
      deployed: true,
      levelNumber: 2,
    },
  ];

  assert.deepEqual(
    sortLevelCatalogEntries(entries, 'deployed').map((entry) => entry.id),
    ['zeta', 'arbol'],
  );
  assert.deepEqual(
    sortLevelCatalogEntries(entries, 'undeployed').map((entry) => entry.id),
    ['arbol', 'zeta'],
  );
});

test('todos los niveles actuales cumplen el esquema de despliegue', async () => {
  const files = (await readdir(LEVELS_DIRECTORY, { recursive: true })).filter(
    (file) => file.endsWith('.json') && !file.endsWith('.schema.json'),
  );

  assert.ok(files.length > 0);
  const deployedNumbersByStage = new Map();
  for (const file of files) {
    const manifest = JSON.parse(
      await readFile(new URL(file, LEVELS_DIRECTORY), 'utf8'),
    );
    assert.equal(typeof manifest.deployed, 'boolean', file);
    assert.doesNotThrow(
      () => assertLevelManifestSchema(manifest, { requireComplete: true }),
      file,
    );
    const stageFolder = /^etapa-(\d+)\//.exec(file);
    if (stageFolder) {
      assert.equal(manifest.stage, Number(stageFolder[1]), file);
    }
    if (manifest.deployed) {
      const stageNumbers = deployedNumbersByStage.get(manifest.stage) ?? [];
      stageNumbers.push(manifest.levelNumber);
      deployedNumbersByStage.set(manifest.stage, stageNumbers);
    } else {
      assert.equal(manifest.levelNumber, null, file);
    }
  }
  for (const stageNumbers of deployedNumbersByStage.values()) {
    stageNumbers.sort((left, right) => left - right);
    assert.deepEqual(
      stageNumbers,
      Array.from({ length: stageNumbers.length }, (_, index) => index + 1),
    );
  }
});
