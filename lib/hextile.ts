export const BOARD_SIZE = 15;
export const BOARD_CENTER_INDEX = Math.floor(BOARD_SIZE / 2);

export type ColorId =
  | 'azul'
  | 'verde'
  | 'morado'
  | 'naranja'
  | 'rojo'
  | 'celeste';

export type Coordinate = {
  q: number;
  r: number;
};

export type Tile = Coordinate & {
  row: number;
  column: number;
  key: string;
};

export type Placements = Record<string, ColorId>;

export type ValidationMark = {
  neighborCount: number;
  valid: boolean;
};

export type ValidationMarks = Record<string, ValidationMark>;

export type ColorDefinition = {
  id: ColorId;
  label: string;
  cssColor: string;
  requirement:
    | { kind: 'exact'; count: number }
    | { kind: 'minimum'; count: number };
};

export type LevelDefinition = {
  id: number;
  label: string;
  inventory: Partial<Record<ColorId, number>>;
};

export const COLOR_DEFINITIONS: Record<ColorId, ColorDefinition> = {
  azul: {
    id: 'azul',
    label: 'Azul',
    cssColor: '#2563eb',
    requirement: { kind: 'exact', count: 4 },
  },
  verde: {
    id: 'verde',
    label: 'Verde',
    cssColor: '#16a34a',
    requirement: { kind: 'exact', count: 2 },
  },
  morado: {
    id: 'morado',
    label: 'Morado',
    cssColor: '#7c3aed',
    requirement: { kind: 'exact', count: 3 },
  },
  naranja: {
    id: 'naranja',
    label: 'Naranja',
    cssColor: '#f97316',
    requirement: { kind: 'exact', count: 5 },
  },
  rojo: {
    id: 'rojo',
    label: 'Rojo',
    cssColor: '#dc2626',
    requirement: { kind: 'exact', count: 6 },
  },
  celeste: {
    id: 'celeste',
    label: 'Celeste',
    cssColor: '#06b6d4',
    requirement: { kind: 'minimum', count: 3 },
  },
};

export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    label: 'Nivel 1',
    inventory: {
      azul: 3,
      verde: 2,
      morado: 1,
    },
  },
];

export const AXIAL_NEIGHBOR_OFFSETS: Coordinate[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function coordinateKey({ q, r }: Coordinate) {
  return `${q},${r}`;
}

export function offsetToAxial(row: number, column: number): Coordinate {
  const rawCenterQ = BOARD_CENTER_INDEX - Math.floor(BOARD_CENTER_INDEX / 2);
  return {
    q: column - Math.floor(row / 2) - rawCenterQ,
    r: row - BOARD_CENTER_INDEX,
  };
}

export function generateBoard(): Tile[] {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    const coordinate = offsetToAxial(row, column);
    return {
      row,
      column,
      ...coordinate,
      key: coordinateKey(coordinate),
    };
  });
}

export const BOARD_TILES = generateBoard();
export const BOARD_KEYS = new Set(BOARD_TILES.map((tile) => tile.key));

export function getRemainingInventory(
  inventory: LevelDefinition['inventory'],
  placements: Placements,
) {
  const remaining = { ...inventory };
  Object.values(placements).forEach((color) => {
    remaining[color] = Math.max(0, (remaining[color] ?? 0) - 1);
  });
  return remaining;
}

export function placeTiles(
  current: Placements,
  inventory: LevelDefinition['inventory'],
  requested: Array<{ coordinate: Coordinate; color: ColorId }>,
): Placements {
  const next = { ...current };
  const remaining = getRemainingInventory(inventory, current);
  const seen = new Set<string>();

  requested.forEach(({ coordinate, color }) => {
    const key = coordinateKey(coordinate);
    if (!BOARD_KEYS.has(key)) {
      throw new Error(
        `La coordenada (${coordinate.q},${coordinate.r}) no existe.`,
      );
    }
    if (next[key] || seen.has(key)) {
      throw new Error(
        `El hexágono (${coordinate.q},${coordinate.r}) ya tiene color.`,
      );
    }
    if (!inventory[color]) {
      throw new Error(`El color ${color} no está disponible en este nivel.`);
    }
    if ((remaining[color] ?? 0) <= 0) {
      throw new Error(`No quedan piezas de color ${color}.`);
    }

    next[key] = color;
    seen.add(key);
    remaining[color] = (remaining[color] ?? 0) - 1;
  });

  return next;
}

export function requirementIsMet(color: ColorId, neighborCount: number) {
  const requirement = COLOR_DEFINITIONS[color].requirement;
  return requirement.kind === 'exact'
    ? neighborCount === requirement.count
    : neighborCount >= requirement.count;
}

export function validatePlacements(placements: Placements): ValidationMarks {
  return Object.entries(placements).reduce<ValidationMarks>(
    (marks, [key, color]) => {
      const [q, r] = key.split(',').map(Number);
      const neighborCount = AXIAL_NEIGHBOR_OFFSETS.reduce((total, offset) => {
        const neighborKey = coordinateKey({ q: q + offset.q, r: r + offset.r });
        return total + (placements[neighborKey] ? 1 : 0);
      }, 0);

      marks[key] = {
        neighborCount,
        valid: requirementIsMet(color, neighborCount),
      };
      return marks;
    },
    {},
  );
}

export function isColorId(value: unknown): value is ColorId {
  return typeof value === 'string' && value in COLOR_DEFINITIONS;
}
