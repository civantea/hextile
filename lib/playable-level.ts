import {
  COLOR_RULES,
  GENERAL_RULES,
  type ColorId,
  type LevelDefinition,
  type Placements,
} from './hextile.ts';

export type PlayableLevelManifest = {
  id: string;
  name: string;
  deployed: boolean;
  stage: number;
  levelNumber: number | null;
  originalSolution: Placements;
  initialDistribution: Placements;
  initialHand: Record<ColorId, number>;
};

export function levelManifestToDefinition(
  manifest: PlayableLevelManifest,
): LevelDefinition {
  if (!manifest.deployed || manifest.levelNumber === null) {
    throw new Error('El nivel debe estar agregado a Play.');
  }

  const solutionColors = new Set(Object.values(manifest.originalSolution));
  const colorRules = COLOR_RULES.filter((rule) =>
    solutionColors.has(rule.color),
  );
  const inventory: Partial<Record<ColorId, number>> = {};
  colorRules.forEach(({ color }) => {
    inventory[color] = manifest.initialHand[color] ?? 0;
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
