import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AXIAL_NEIGHBOR_OFFSETS,
  BOARD_TILES,
  GENERAL_RULES,
  GENERATOR_GENERAL_RULES,
  GENERATOR_TEMPLATE,
  LEVELS,
  coordinateKey,
  getPlacementCounts,
  getRemainingInventory,
  hasColoredNeighbor,
  placeTiles,
  placeUnrestrictedTiles,
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

test('reconoce únicamente vecinos coloreados que comparten un lado', () => {
  const placements = { '0,0': 'celeste' };

  AXIAL_NEIGHBOR_OFFSETS.forEach((coordinate) => {
    assert.equal(hasColoredNeighbor(coordinate, placements), true);
  });
  assert.equal(hasColoredNeighbor({ q: 2, r: 0 }, placements), false);
  assert.equal(hasColoredNeighbor({ q: 0, r: 2 }, placements), false);
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
  const placed = placeTiles(
    {},
    level.inventory,
    [
      { coordinate: { q: 1, r: 0 }, color: 'celeste' },
      { coordinate: { q: 1, r: -1 }, color: 'celeste' },
    ],
    level.fixedPlacements,
  );

  assert.deepEqual(getRemainingInventory(level.inventory, placed), {
    celeste: 2,
  });
  assert.throws(
    () =>
      placeTiles(
        placed,
        level.inventory,
        [{ coordinate: { q: 0, r: 0 }, color: 'celeste' }],
        level.fixedPlacements,
      ),
    /ya tiene color/,
  );
  assert.throws(
    () =>
      placeTiles(
        placed,
        level.inventory,
        [{ coordinate: { q: 99, r: 99 }, color: 'celeste' }],
        level.fixedPlacements,
      ),
    /no existe/,
  );
  assert.throws(
    () =>
      placeTiles(
        placed,
        level.inventory,
        [{ coordinate: { q: 2, r: 0 }, color: 'rojo' }],
        level.fixedPlacements,
      ),
    /no está disponible/,
  );
  assert.equal(coordinateKey({ q: -3, r: 4 }), '-3,4');
});

test('define tres celestes fijos y cuatro celestes colocables en el Nivel 1', () => {
  const level = LEVELS[0];
  assert.deepEqual(level.fixedPlacements, {
    '0,1': 'celeste',
    '0,0': 'celeste',
    '0,-1': 'celeste',
  });
  assert.deepEqual(level.inventory, { celeste: 4 });
  assert.deepEqual(getRemainingInventory(level.inventory, {}), { celeste: 4 });
});

test('cada nivel describe exactamente sus colores disponibles', () => {
  [...LEVELS, GENERATOR_TEMPLATE].forEach((level) => {
    const availableColors = Object.keys(level.inventory).sort();
    const describedColors = level.rules.colors
      .map((rule) => rule.color)
      .sort();

    assert.equal(
      new Set(describedColors).size,
      describedColors.length,
      `${level.label} no debe repetir colores en su reglamento`,
    );
    assert.deepEqual(
      describedColors,
      availableColors,
      `${level.label} debe describir todos y solo sus colores disponibles`,
    );
  });
});

test('la solución de un nivel exige marcas verdes e inventario agotado', () => {
  assert.match(GENERAL_RULES[6].text, /✅/);
  assert.match(GENERAL_RULES[6].text, /no quedan colores disponibles/);
  assert.equal(
    GENERATOR_GENERAL_RULES[6].text,
    'Solo puedes guardar una solución cuando todos los hexágonos muestran ✅.',
  );
});

test('el generador permite piezas aisladas y cuenta colores sin límite', () => {
  const placed = placeUnrestrictedTiles(
    {},
    [
      { coordinate: { q: 5, r: 0 }, color: 'rojo' },
      { coordinate: { q: -4, r: 4 }, color: 'azul' },
      { coordinate: { q: 4, r: -4 }, color: 'rojo' },
    ],
  );

  assert.deepEqual(placed, {
    '5,0': 'rojo',
    '-4,4': 'azul',
    '4,-4': 'rojo',
  });
  assert.deepEqual(
    getPlacementCounts(Object.keys(GENERATOR_TEMPLATE.inventory), placed),
    {
      azul: 1,
      verde: 0,
      morado: 0,
      naranja: 0,
      rojo: 2,
      celeste: 0,
    },
  );
});

test('solo permite colocar junto a un color y admite una cadena secuencial', () => {
  const level = LEVELS[0];

  assert.throws(
    () =>
      placeTiles(
        {},
        level.inventory,
        [{ coordinate: { q: 5, r: 0 }, color: 'celeste' }],
        level.fixedPlacements,
      ),
    /no está disponible; revisa el reglamento/,
  );

  assert.deepEqual(
    placeTiles(
      {},
      level.inventory,
      [
        { coordinate: { q: 1, r: 0 }, color: 'celeste' },
        { coordinate: { q: 2, r: 0 }, color: 'celeste' },
      ],
      level.fixedPlacements,
    ),
    {
      '1,0': 'celeste',
      '2,0': 'celeste',
    },
  );
});
