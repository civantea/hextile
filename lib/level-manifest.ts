import {
  BOARD_KEYS,
  BOARD_TILES,
  COLOR_IDS,
  hasInitialHandPieces,
  isColorId,
  type ColorId,
  type Placements,
} from './hextile.ts';

export type InitialHand = Partial<Record<ColorId, number>>;

export type LevelManifest = {
  id: string;
  name: string;
  deployed: boolean;
  playOrder?: number;
  originalSolution: Placements;
  initialDistribution?: Placements;
  initialHand?: InitialHand;
};

export type LevelManifestPayload = Pick<
  LevelManifest,
  'name' | 'originalSolution'
>;

export type LevelInitialStatePayload = {
  id: string;
  initialDistribution: Placements;
  initialHand: InitialHand;
};

export const MAX_LEVEL_NAME_LENGTH = 80;

export function normalizeLevelName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Escribe un nombre para identificar el nivel.');
  }

  const name = input.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new Error('Escribe un nombre para identificar el nivel.');
  }
  if (name.length > MAX_LEVEL_NAME_LENGTH) {
    throw new Error(
      `El nombre no puede tener más de ${MAX_LEVEL_NAME_LENGTH} caracteres.`,
    );
  }

  return name;
}

export function levelNameToFilename(name: string): string {
  const safeName = Array.from(
    normalizeLevelName(name).normalize('NFC'),
    (character) => (character.charCodeAt(0) < 32 ? '-' : character),
  ).join('');
  const filename = safeName
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, MAX_LEVEL_NAME_LENGTH)
    .trim();

  if (!filename) {
    throw new Error(
      'El nombre debe incluir caracteres válidos para un archivo.',
    );
  }

  return `${filename}.json`;
}

export function placementsToCoordinateMap(placements: Placements): Placements {
  return BOARD_TILES.reduce<Placements>((solution, tile) => {
    const color = placements[tile.key];
    if (color) solution[tile.key] = color;
    return solution;
  }, {});
}

function parseCoordinateMap(
  input: unknown,
  label: string,
  allowEmpty: boolean,
): Placements {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`La solicitud debe incluir ${label}.`);
  }

  const entries = Object.entries(input);
  if (!allowEmpty && entries.length === 0) {
    throw new Error(`${label} debe contener al menos un hexágono.`);
  }
  if (entries.length > BOARD_TILES.length) {
    throw new Error(`${label} contiene demasiados hexágonos.`);
  }

  const placements: Placements = {};
  for (const [key, color] of entries) {
    if (!BOARD_KEYS.has(key)) {
      throw new Error(`La coordenada ${key} no existe.`);
    }
    if (!isColorId(color)) {
      throw new Error(`La coordenada ${key} debe tener un color válido.`);
    }
    placements[key] = color;
  }

  return placements;
}

export function parseLevelManifestPayload(
  input: unknown,
): LevelManifestPayload {
  if (!input || typeof input !== 'object') {
    throw new Error(
      'La solicitud debe incluir el nombre y la solución original.',
    );
  }

  const { name: rawName, originalSolution: rawSolution } = input as Record<
    string,
    unknown
  >;
  const name = normalizeLevelName(rawName);

  const originalSolution = parseCoordinateMap(
    rawSolution,
    'la solución original',
    false,
  );

  return { name, originalSolution };
}

export function parseLevelInitialStatePayload(
  input: unknown,
): LevelInitialStatePayload {
  if (!input || typeof input !== 'object') {
    throw new Error(
      'La solicitud debe incluir el nivel, la distribución y la mano inicial.',
    );
  }

  const {
    id,
    initialDistribution: rawDistribution,
    initialHand: rawHand,
  } = input as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('La solicitud debe incluir un identificador de nivel.');
  }

  const initialDistribution = parseCoordinateMap(
    rawDistribution,
    'la distribución inicial',
    true,
  );
  if (!rawHand || typeof rawHand !== 'object' || Array.isArray(rawHand)) {
    throw new Error('La solicitud debe incluir la mano inicial.');
  }

  const initialHand: InitialHand = {};
  for (const [color, count] of Object.entries(rawHand)) {
    if (!isColorId(color)) {
      throw new Error(`El color ${color} no es válido para la mano inicial.`);
    }
    if (
      !Number.isInteger(count) ||
      (count as number) < 0 ||
      (count as number) > BOARD_TILES.length
    ) {
      throw new Error(
        `La cantidad de ${color} en la mano inicial no es válida.`,
      );
    }
    initialHand[color] = count as number;
  }

  if (!hasInitialHandPieces(initialHand)) {
    throw new Error('La mano inicial debe contener al menos una pieza.');
  }

  return { id: id.trim(), initialDistribution, initialHand };
}

function countColors(placements: Placements): InitialHand {
  const counts: InitialHand = {};
  for (const color of Object.values(placements)) {
    counts[color] = (counts[color] ?? 0) + 1;
  }
  return counts;
}

export function initialStateMatchesOriginalSolution(
  originalSolution: Placements,
  initialDistribution: Placements,
  initialHand: InitialHand,
): boolean {
  if (
    Object.entries(initialDistribution).some(
      ([coordinate, color]) => originalSolution[coordinate] !== color,
    )
  ) {
    return false;
  }

  const originalCounts = countColors(originalSolution);
  const distributionCounts = countColors(initialDistribution);
  return COLOR_IDS.every(
    (color) =>
      (originalCounts[color] ?? 0) ===
      (distributionCounts[color] ?? 0) + (initialHand[color] ?? 0),
  );
}
