import {
  BOARD_KEYS,
  BOARD_TILES,
  coordinateKey,
  isColorId,
  type ColorId,
  type Coordinate,
  type Placements,
} from './hextile.ts';

export type LevelSolutionEntry = {
  coordinate: Coordinate;
  color: ColorId;
};

export type LevelManifest = {
  id: string;
  solution: LevelSolutionEntry[];
};

export function placementsToSolution(
  placements: Placements,
): LevelSolutionEntry[] {
  return BOARD_TILES.flatMap((tile) => {
    const color = placements[tile.key];
    return color
      ? [{ coordinate: { q: tile.q, r: tile.r }, color }]
      : [];
  });
}

export function solutionToPlacements(
  solution: LevelSolutionEntry[],
): Placements {
  return solution.reduce<Placements>((placements, entry) => {
    placements[coordinateKey(entry.coordinate)] = entry.color;
    return placements;
  }, {});
}

export function parseSolutionPayload(input: unknown): LevelSolutionEntry[] {
  if (!input || typeof input !== 'object' || !('solution' in input)) {
    throw new Error('La solicitud debe incluir una solución.');
  }

  const rawSolution = (input as { solution: unknown }).solution;
  if (!Array.isArray(rawSolution) || rawSolution.length === 0) {
    throw new Error('La solución debe contener al menos un hexágono.');
  }
  if (rawSolution.length > BOARD_TILES.length) {
    throw new Error('La solución contiene demasiados hexágonos.');
  }

  const coordinates = new Set<string>();
  return rawSolution.map((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error('Cada pieza debe incluir una coordenada y un color.');
    }

    const { coordinate, color } = rawEntry as Record<string, unknown>;
    if (!coordinate || typeof coordinate !== 'object') {
      throw new Error('Cada pieza debe incluir una coordenada válida.');
    }

    const { q, r } = coordinate as Record<string, unknown>;
    if (!Number.isInteger(q) || !Number.isInteger(r) || !isColorId(color)) {
      throw new Error('Cada pieza debe incluir q, r y un color válidos.');
    }

    const normalizedCoordinate = { q: q as number, r: r as number };
    const key = coordinateKey(normalizedCoordinate);
    if (!BOARD_KEYS.has(key)) {
      throw new Error(
        `La coordenada (${normalizedCoordinate.q},${normalizedCoordinate.r}) no existe.`,
      );
    }
    if (coordinates.has(key)) {
      throw new Error(
        `La coordenada (${normalizedCoordinate.q},${normalizedCoordinate.r}) está repetida.`,
      );
    }
    coordinates.add(key);

    return { coordinate: normalizedCoordinate, color };
  });
}
