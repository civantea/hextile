import {
  GENERAL_RULES,
  GENERATOR_TEMPLATE,
  type ColorId,
  type LevelDefinition,
} from './hextile.ts';
import type { LevelDocument, LevelManifest } from './level-manifest.ts';

export type LevelCatalogEntry = {
  stageName: string;
  stage: number;
  _id: string;
  name: string;
  deployed: boolean;
  levelNumber: number | null;
};

export function sortLevelCatalogEntries(
  entries: readonly LevelCatalogEntry[],
  view: 'deployed' | 'undeployed',
) {
  return [...entries].sort((left, right) => {
    if (view === 'deployed') {
      return (
        (left.levelNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.levelNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name, 'es', { sensitivity: 'base' })
      );
    }
    return (
      left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }) ||
      left._id.localeCompare(right._id)
    );
  });
}

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

export function getAvailableLevelPositions(
  manifests: readonly LevelManifest[],
  stage: number,
) {
  const deployedCount = manifests.filter(
    (manifest) => manifest.deployed && manifest.stage === stage,
  ).length;

  return Array.from({ length: deployedCount + 1 }, (_, index) => index + 1);
}

export function getInsertedLevelNumberAssignments(
  manifests: readonly LevelDocument[],
  stage: number,
  insertedObjectId: string,
  insertedLevelNumber: number,
) {
  const deployed = manifests
    .filter((manifest) => manifest.deployed && manifest.stage === stage)
    .sort(
      (left, right) =>
        (left.levelNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.levelNumber ?? Number.MAX_SAFE_INTEGER) ||
        left._id.localeCompare(right._id),
    );
  const maximumPosition = deployed.length + 1;

  if (
    !Number.isInteger(insertedLevelNumber) ||
    insertedLevelNumber < 1 ||
    insertedLevelNumber > maximumPosition
  ) {
    throw new Error(`La posición debe estar entre 1 y ${maximumPosition}.`);
  }

  const orderedIds = deployed.map((manifest) => manifest._id);
  orderedIds.splice(insertedLevelNumber - 1, 0, insertedObjectId);

  return orderedIds.map((_id, index) => ({
    _id,
    levelNumber: index + 1,
  }));
}

export function getCompactLevelNumberAssignments(
  manifests: readonly LevelDocument[],
  stage: number,
) {
  return manifests
    .filter((manifest) => manifest.deployed && manifest.stage === stage)
    .sort(
      (left, right) =>
        (left.levelNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.levelNumber ?? Number.MAX_SAFE_INTEGER) ||
        left._id.localeCompare(right._id),
    )
    .map((manifest, index) => ({
      _id: manifest._id,
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
