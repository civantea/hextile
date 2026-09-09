import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AXIAL_NEIGHBOR_OFFSETS,
  BOARD_TILES,
  LEVELS,
  coordinateKey,
  getRemainingInventory,
  placeTiles,
  requirementIsMet,
  validatePlacements,
} from '../lib/hextile.ts';

test('genera una matriz de 15 por 15 con un único centro axial', () => {
  assert.equal(BOARD_TILES.length, 225);
  assert.equal(new Set(BOARD_TILES.map((tile) => tile.key)).size, 225);
  assert.deepEqual(
    BOARD_TILES.find((tile) => tile.row === 7 && tile.column === 7),
    { row: 7, column: 7, q: 0, r: 0, key: '0,0' },
  );
});

test('usa los seis desplazamientos axiales inmediatos', () => {
  assert.deepEqual(AXIAL_NEIGHBOR_OFFSETS, [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ]);
});

test('aplica las reglas de vecinos de todos los colores', () => {
  assert.equal(requirementIsMet('verde', 2), true);
  assert.equal(requirementIsMet('verde', 3), false);
  assert.equal(requirementIsMet('morado', 3), true);
  assert.equal(requirementIsMet('azul', 4), true);
  assert.equal(requirementIsMet('naranja', 5), true);
  assert.equal(requirementIsMet('rojo', 6), true);
  assert.equal(requirementIsMet('celeste', 3), true);
  assert.equal(requirementIsMet('celeste', 6), true);
  assert.equal(requirementIsMet('celeste', 2), false);
});

test('cuenta vecinos no blancos sin importar su color', () => {
  const placements = {
    '0,0': 'verde',
    '1,0': 'azul',
    '0,1': 'morado',
  };
  const marks = validatePlacements(placements);
  assert.deepEqual(marks['0,0'], { neighborCount: 2, valid: true });
});

test('descuenta inventario y rechaza coordenadas, colores o celdas inválidas', () => {
  const level = LEVELS[0];
  const placed = placeTiles({}, level.inventory, [
    { coordinate: { q: 0, r: 0 }, color: 'azul' },
    { coordinate: { q: 1, r: 0 }, color: 'verde' },
  ]);

  assert.deepEqual(getRemainingInventory(level.inventory, placed), {
    azul: 2,
    verde: 1,
    morado: 1,
  });
  assert.throws(
    () =>
      placeTiles(placed, level.inventory, [
        { coordinate: { q: 0, r: 0 }, color: 'morado' },
      ]),
    /ya tiene color/,
  );
  assert.throws(
    () =>
      placeTiles(placed, level.inventory, [
        { coordinate: { q: 99, r: 99 }, color: 'azul' },
      ]),
    /no existe/,
  );
  assert.throws(
    () =>
      placeTiles(placed, level.inventory, [
        { coordinate: { q: 2, r: 0 }, color: 'rojo' },
      ]),
    /no está disponible/,
  );
  assert.equal(coordinateKey({ q: -3, r: 4 }), '-3,4');
});
