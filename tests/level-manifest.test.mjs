import assert from 'node:assert/strict';
import test from 'node:test';

import {
  levelNameToFilename,
  parseLevelManifestPayload,
  placementsToOriginalSolution,
} from '../lib/level-manifest.ts';

test('la solución original usa coordenadas como claves y colores como valores', () => {
  const placements = {
    '0,0': 'celeste',
    '1,0': 'rojo',
  };
  const originalSolution = placementsToOriginalSolution(placements);

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
