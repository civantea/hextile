import {
  GENERAL_RULES,
  GENERATOR_TEMPLATE,
  type ColorId,
  type LevelDefinition,
} from './hextile.ts';
import type { LevelManifest } from './level-manifest.ts';

export type LevelCatalogEntry = {
  stage: string;
  fileName: string;
  id: string;
  name: string;
  deployed: boolean;
  playOrder?: number;
};

export function getNextPlayOrder(manifests: readonly LevelManifest[]) {
  return (
    Math.max(0, ...manifests.map((manifest) => manifest.playOrder ?? 0)) + 1
  );
}

export function getCompactPlayOrderAssignments(
  manifests: readonly LevelManifest[],
) {
  return manifests
    .filter((manifest) => manifest.deployed)
    .sort(
      (left, right) =>
        (left.playOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.playOrder ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    )
    .map((manifest, index) => ({
      id: manifest.id,
      playOrder: index + 1,
    }));
}

export function levelManifestToDefinition(
  manifest: LevelManifest,
): LevelDefinition {
  if (
    !manifest.deployed ||
    !manifest.playOrder ||
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
    id: manifest.playOrder,
    label: `Nivel ${manifest.playOrder}`,
    inventory,
    fixedPlacements: manifest.initialDistribution,
    rules: {
      general: GENERAL_RULES,
      colors: colorRules,
    },
  };
}
