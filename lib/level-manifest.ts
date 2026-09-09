import {
  BOARD_KEYS,
  BOARD_TILES,
  isColorId,
  type Placements,
} from './hextile.ts';

export type LevelManifest = {
  id: string;
  name: string;
  originalSolution: Placements;
};

export type LevelManifestPayload = Omit<LevelManifest, 'id'>;

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
  const filename = normalizeLevelName(name)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
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

export function placementsToOriginalSolution(
  placements: Placements,
): Placements {
  return BOARD_TILES.reduce<Placements>((solution, tile) => {
    const color = placements[tile.key];
    if (color) solution[tile.key] = color;
    return solution;
  }, {});
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

  if (
    !rawSolution ||
    typeof rawSolution !== 'object' ||
    Array.isArray(rawSolution)
  ) {
    throw new Error('La solicitud debe incluir la solución original.');
  }

  const entries = Object.entries(rawSolution);
  if (entries.length === 0) {
    throw new Error('La solución original debe contener al menos un hexágono.');
  }
  if (entries.length > BOARD_TILES.length) {
    throw new Error('La solución original contiene demasiados hexágonos.');
  }

  const originalSolution: Placements = {};
  for (const [key, color] of entries) {
    if (!BOARD_KEYS.has(key)) {
      throw new Error(`La coordenada ${key} no existe.`);
    }
    if (!isColorId(color)) {
      throw new Error(`La coordenada ${key} debe tener un color válido.`);
    }
    originalSolution[key] = color;
  }

  return { name, originalSolution };
}
