import {
  GENERAL_RULES,
  GENERATOR_TEMPLATE,
  type ColorId,
  type LevelDefinition,
} from './hextile.ts';
import type { LevelManifest } from './level-manifest.ts';

export type LevelCatalogEntry = {
  stageName: string;
  stage: number;
  fileName: string;
  id: string;
  name: string;
  deployed: boolean;
  levelNumber: number | null;
};

export function getNextLevelNumber(
  manifests: readonly LevelManifest[],
  stage: number,
) {
  return (
    Math.max(
      0,
      ...manifests
        .filter((manifest) => manifest.deployed && manifest.stage === stage)
        .map((manifest) => manifest.levelNumber ?? 0),
    ) + 1
  );
}

export function getCompactLevelNumberAssignments(
  manifests: readonly LevelManifest[],
  stage: number,
) {
  return manifests
    .filter((manifest) => manifest.deployed && manifest.stage === stage)
    .sort(
      (left, right) =>
        (left.levelNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.levelNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    )
    .map((manifest, index) => ({
      id: manifest.id,
      levelNumber: index + 1,
    }));
}

export function levelManifestToDefinition(
  manifest: LevelManifest,
): LevelDefinition {
  if (
    !manifest.deployed ||
    manifest.levelNumber === null ||
    !manifest.initialDistribution ||
    !manifest.initialHand
  ) {
    throw new Error('El nivel debe estar completo y agregado a Play.');
  }

  const solutionColors = new Set(Object.values(manifest.originalSolution));
  const colorRules = GENERATOR_TEMPLATE.rules.colors.filter((rule) =>
    solutionColors.has(rule.color),
  );
  const inventory: Partial<Record<ColorId, number>> = {};
  colorRules.forEach(({ color }) => {
    inventory[color] = manifest.initialHand?.[color] ?? 0;
  });

  return {
    id: manifest.levelNumber,
    stage: manifest.stage,
    levelNumber: manifest.levelNumber,
    label: `Nivel ${manifest.levelNumber}`,
    inventory,
    fixedPlacements: manifest.initialDistribution,
    rules: {
      general: GENERAL_RULES,
      colors: colorRules,
    },
  };
}
