import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialStateMatchesOriginalSolution,
  levelNameToFilename,
  parseLevelInitialStatePayload,
  parseLevelManifestPayload,
  placementsToCoordinateMap,
} from '../lib/level-manifest.ts';

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
