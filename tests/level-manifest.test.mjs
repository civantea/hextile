import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseSolutionPayload,
  placementsToSolution,
  solutionToPlacements,
} from '../lib/level-manifest.ts';

test('la solución contiene únicamente coordenada y color', () => {
  const placements = {
    '0,0': 'celeste',
    '1,0': 'rojo',
  };
  const solution = placementsToSolution(placements);

  assert.deepEqual(solution, [
    { coordinate: { q: 0, r: 0 }, color: 'celeste' },
    { coordinate: { q: 1, r: 0 }, color: 'rojo' },
  ]);
  solution.forEach((entry) => {
    assert.deepEqual(Object.keys(entry).sort(), ['color', 'coordinate']);
    assert.deepEqual(Object.keys(entry.coordinate).sort(), ['q', 'r']);
  });
  assert.deepEqual(solutionToPlacements(solution), placements);
});

test('rechaza soluciones vacías, repetidas o fuera del tablero', () => {
  assert.throws(() => parseSolutionPayload({ solution: [] }), /al menos/);
  assert.throws(
    () =>
      parseSolutionPayload({
        solution: [
          { coordinate: { q: 0, r: 0 }, color: 'celeste' },
          { coordinate: { q: 0, r: 0 }, color: 'azul' },
        ],
      }),
    /repetida/,
  );
  assert.throws(
    () =>
      parseSolutionPayload({
        solution: [
          { coordinate: { q: 99, r: 99 }, color: 'celeste' },
        ],
      }),
    /no existe/,
  );
});
