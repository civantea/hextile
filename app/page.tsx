'use client';

export const dynamic = 'force-static';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  BOARD_CENTER_INDEX,
  BOARD_TILES,
  COLOR_DEFINITIONS,
  GENERATOR_TEMPLATE,
  getPlacementCounts,
  getRemainingInventory,
  hasColoredNeighbor,
  hasInitialHandPieces,
  isColorId,
  placeTiles,
  placeUnrestrictedTiles,
  removeUnrestrictedTile,
  retireUnrestrictedTile,
  validatePlacements,
  validationIsSuccessful,
  type ColorId,
  type LevelDefinition,
  type Placements,
  type RequestedPlacement,
  type ValidationMarks,
} from '@/lib/hextile';
import {
  MAX_LEVEL_NAME_LENGTH,
  normalizeLevelName,
  placementsToCoordinateMap,
  type LevelManifest,
} from '@/lib/level-manifest';
import {
  levelManifestToDefinition,
  type LevelCatalogEntry,
} from '@/lib/level-catalog';

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => unknown;
};

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: ToolDefinition,
        options?: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

type ScreenMode = 'level' | 'generator';
type BuildSessionState =
  | 'new'
  | 'solution-validated'
  | 'solution-saved'
  | 'initial-state-editing'
  | 'initial-state-ready';
type RulesTab = 'general' | 'colors' | 'validate';

type SavedLevelReference = {
  id: string;
  name: string;
  fileName: string;
};

type SaveStatus = {
  tone: 'success' | 'error';
  message: string;
};

const LEVEL_CATALOG_PATH = '/__hextile/levels';
const LEVEL_CATALOG_CHANGED_EVENT = 'hextile-level-catalog-changed';
const BUNDLED_LEVEL_MANIFESTS = Object.values(
  import.meta.glob<LevelManifest>('../niveles/**/*.json', {
    eager: true,
    import: 'default',
  }),
);

function getBundledPlayableLevels() {
  return BUNDLED_LEVEL_MANIFESTS.filter((manifest) => manifest.deployed)
    .map(levelManifestToDefinition)
    .sort((left, right) => left.id - right.id);
}

function useHashRoute() {
  const [hash, setHash] = useState('#/');

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || '#/');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  return hash;
}

function usePlayableLevels() {
  const [levels, setLevels] = useState<LevelDefinition[]>(
    getBundledPlayableLevels,
  );

  const refreshLevels = useCallback(async () => {
    try {
      const response = await fetch(`${LEVEL_CATALOG_PATH}?deployed=true`, {
        cache: 'no-store',
      });
      const result = (await response.json()) as {
        levels?: LevelManifest[];
      };
      if (!response.ok || !Array.isArray(result.levels)) return;

      const storedLevels = result.levels
        .map(levelManifestToDefinition)
        .sort((left, right) => left.id - right.id);
      setLevels(storedLevels);
    } catch {
      setLevels(getBundledPlayableLevels());
    }
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refreshLevels(), 0);
    window.addEventListener(LEVEL_CATALOG_CHANGED_EVENT, refreshLevels);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(LEVEL_CATALOG_CHANGED_EVENT, refreshLevels);
    };
  }, [refreshLevels]);

  return levels;
}

function WelcomeScreen() {
  return (
    <main className="home-screen">
      <div className="home-panel welcome-panel">
        <h1 className="home-title">HEXTILE</h1>
        <nav aria-label="Modos de HEXTILE" className="home-actions">
          <a className="home-action" href="#/play">
            Play
          </a>
          <a className="home-action home-action-dark" href="#/build">
            Build
          </a>
        </nav>
      </div>
    </main>
  );
}

function PlayScreen({ levels }: { levels: LevelDefinition[] }) {
  return (
    <main className="home-screen play-screen">
      <a className="section-back-link" href="#/">
        <span aria-hidden="true">←</span> Inicio
      </a>
      <div className="home-panel">
        <h1 className="home-title">HEXTILE</h1>
        <nav aria-label="Niveles disponibles" className="level-list">
          {levels.map((level) => (
            <a
              className="level-link"
              href={`#/nivel/${level.id}`}
              key={level.id}
            >
              <span>{level.label}</span>
              <span aria-hidden="true">&#8594;</span>
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}

function BuildScreen() {
  return (
    <main className="home-screen">
      <a className="section-back-link" href="#/">
        <span aria-hidden="true">←</span> Inicio
      </a>
      <div className="home-panel build-panel">
        <h1 className="home-title">HEXTILE</h1>
        <nav aria-label="Herramientas de construcción" className="home-actions">
          <a className="home-action home-action-dark" href="#/generar">
            Generar nivel
          </a>
          <a className="home-action" href="#/agregar">
            Agregar nivel
          </a>
          <a className="home-action" href="#/quitar">
            Quitar nivel
          </a>
        </nav>
      </div>
    </main>
  );
}

function LevelCatalogScreen({ action }: { action: 'deploy' | 'undeploy' }) {
  const isRemoving = action === 'undeploy';
  const [stages, setStages] = useState<string[]>([]);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [levels, setLevels] = useState<LevelCatalogEntry[]>([]);
  const [pendingLevel, setPendingLevel] = useState<LevelCatalogEntry | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const lifecycle = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          isRemoving
            ? `${LEVEL_CATALOG_PATH}?view=deployed-stages`
            : LEVEL_CATALOG_PATH,
          {
            cache: 'no-store',
            signal: lifecycle.signal,
          },
        );
        const result = (await response.json()) as {
          stages?: string[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(result.stages)) {
          throw new Error(result.error ?? 'No se pudieron cargar las etapas.');
        }
        setStages(result.stages);
      } catch (requestError) {
        if (!lifecycle.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'No se pudieron cargar las etapas.',
          );
        }
      } finally {
        if (!lifecycle.signal.aborted) setIsLoading(false);
      }
    })();
    return () => lifecycle.abort();
  }, [isRemoving]);

  useEffect(() => {
    if (pendingLevel && !confirmationDialogRef.current?.open) {
      confirmationDialogRef.current?.showModal();
    }
  }, [pendingLevel]);

  const openStage = useCallback(
    async (stage: string) => {
      setSelectedStage(stage);
      setLevels([]);
      setIsLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ stage });
        if (isRemoving) query.set('view', 'deployed');
        const response = await fetch(`${LEVEL_CATALOG_PATH}?${query}`, {
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          levels?: LevelCatalogEntry[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(result.levels)) {
          throw new Error(result.error ?? 'No se pudieron cargar los niveles.');
        }
        setLevels(result.levels);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'No se pudieron cargar los niveles.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isRemoving],
  );

  const closeConfirmation = useCallback(() => {
    confirmationDialogRef.current?.close();
    setPendingLevel(null);
    setError(null);
  }, []);

  const updatePendingLevel = useCallback(async () => {
    if (!pendingLevel || pendingLevel.deployed !== isRemoving) return;
    setIsUpdating(true);
    setError(null);
    try {
      const response = await fetch(LEVEL_CATALOG_PATH, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          stage: pendingLevel.stage,
          id: pendingLevel.id,
        }),
      });
      const result = (await response.json()) as {
        level?: LevelCatalogEntry;
        error?: string;
      };
      if (!response.ok || !result.level) {
        throw new Error(
          result.error ??
            (isRemoving
              ? 'No se pudo quitar el nivel.'
              : 'No se pudo agregar el nivel.'),
        );
      }

      if (isRemoving) {
        const remaining = levels.filter(
          (level) => level.id !== result.level?.id,
        );
        setLevels(remaining);
        if (remaining.length === 0) {
          setStages((currentStages) =>
            currentStages.filter((stage) => stage !== selectedStage),
          );
        }
      } else {
        setLevels((current) =>
          current.map((level) =>
            level.id === result.level?.id ? result.level : level,
          ),
        );
      }
      confirmationDialogRef.current?.close();
      setPendingLevel(null);
      window.dispatchEvent(new Event(LEVEL_CATALOG_CHANGED_EVENT));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : isRemoving
            ? 'No se pudo quitar el nivel.'
            : 'No se pudo agregar el nivel.',
      );
    } finally {
      setIsUpdating(false);
    }
  }, [action, isRemoving, levels, pendingLevel, selectedStage]);

  return (
    <main className="home-screen catalog-screen">
      <a className="section-back-link" href="#/build">
        <span aria-hidden="true">←</span> Build
      </a>
      <section className="catalog-panel" aria-labelledby="catalog-title">
        <p className="catalog-brand">HEXTILE</p>
        <div className="catalog-heading">
          {selectedStage ? (
            <button
              className="catalog-stage-back"
              type="button"
              onClick={() => {
                setSelectedStage(null);
                setLevels([]);
                setError(null);
              }}
            >
              ← Etapas
            </button>
          ) : null}
          <h1 id="catalog-title">{selectedStage ?? 'Selecciona una etapa'}</h1>
        </div>

        <div className="catalog-list" aria-live="polite">
          {isLoading ? <p className="catalog-message">Cargando…</p> : null}
          {!isLoading && error ? (
            <p className="catalog-message catalog-error" role="alert">
              {error}
            </p>
          ) : null}
          {!isLoading && !error && !selectedStage && stages.length === 0 ? (
            <p className="catalog-message">No hay etapas disponibles.</p>
          ) : null}
          {!isLoading && !error && !selectedStage
            ? stages.map((stage) => (
                <button
                  className="catalog-entry catalog-stage-entry"
                  type="button"
                  key={stage}
                  onClick={() => void openStage(stage)}
                >
                  <span>{stage}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))
            : null}
          {!isLoading && !error && selectedStage && levels.length === 0 ? (
            <p className="catalog-message">
              {isRemoving
                ? 'Esta etapa no contiene niveles desplegados.'
                : 'Esta etapa no contiene niveles.'}
            </p>
          ) : null}
          {!isLoading && !error && selectedStage
            ? levels.map((level) => (
                <button
                  className="catalog-entry catalog-level-entry"
                  type="button"
                  key={level.id}
                  data-deployed={level.deployed ? 'true' : 'false'}
                  data-selectable={isRemoving ? 'true' : undefined}
                  disabled={isRemoving ? !level.deployed : level.deployed}
                  onClick={() => setPendingLevel(level)}
                >
                  <span>{level.name}</span>
                  <span>
                    {isRemoving
                      ? 'Desplegado'
                      : level.deployed
                        ? 'Agregado'
                        : 'Disponible'}
                  </span>
                </button>
              ))
            : null}
        </div>
      </section>

      <dialog
        className="add-level-dialog"
        ref={confirmationDialogRef}
        aria-labelledby="level-catalog-dialog-title"
        onClose={() => setPendingLevel(null)}
      >
        <div className="add-level-dialog-content">
          <h2 id="level-catalog-dialog-title">
            {isRemoving
              ? '¿Seguro que quieres quitar el nivel?'
              : '¿Quieres agregar el nivel?'}
          </h2>
          <p>{pendingLevel?.name}</p>
          {error ? (
            <p className="catalog-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="add-level-dialog-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={isUpdating}
              onClick={closeConfirmation}
            >
              Cancelar
            </button>
            <button
              className="primary-action"
              type="button"
              disabled={isUpdating}
              onClick={() => void updatePendingLevel()}
            >
              {isUpdating
                ? isRemoving
                  ? 'Quitando…'
                  : 'Agregando…'
                : isRemoving
                  ? 'Quitar'
                  : 'Agregar'}
            </button>
          </div>
        </div>
      </dialog>
    </main>
  );
}

function parsePlacementInput(input: unknown) {
  if (!input || typeof input !== 'object' || !('placements' in input)) {
    throw new Error('Se requiere una lista placements.');
  }

  const requested = (input as { placements: unknown }).placements;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error('placements debe contener al menos una pieza.');
  }

  return requested.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Cada pieza debe incluir q, r y color.');
    }
    const { q, r, color } = item as Record<string, unknown>;
    if (!Number.isInteger(q) || !Number.isInteger(r) || !isColorId(color)) {
      throw new Error(
        'Cada pieza debe incluir q y r enteros y un color válido.',
      );
    }
    return { coordinate: { q: q as number, r: r as number }, color };
  });
}

function ColorCountList({
  colors,
  counts,
}: {
  colors: ColorId[];
  counts: Partial<Record<ColorId, number>>;
}) {
  return (
    <div className="inventory-list">
      {colors.map((color) => {
        const definition = COLOR_DEFINITIONS[color];
        return (
          <div className="inventory-item" key={color}>
            <span
              className="color-swatch"
              style={{ backgroundColor: definition.cssColor }}
              aria-hidden="true"
            />
            <span aria-label={`${definition.label}: ${counts[color] ?? 0}`}>
              {counts[color] ?? 0}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BoardScreen({
  level,
  mode = 'level',
}: {
  level: LevelDefinition;
  mode?: ScreenMode;
}) {
  const isGenerator = mode === 'generator';
  const generalRules = level.rules.general;
  const levelColors = useMemo(
    () => Object.keys(level.inventory) as ColorId[],
    [level],
  );
  const [playerPlacements, setPlayerPlacements] = useState<Placements>({});
  const [marks, setMarks] = useState<ValidationMarks>({});
  const [openTileKey, setOpenTileKey] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingLevel, setIsSavingLevel] = useState(false);
  const [levelName, setLevelName] = useState('');
  const [levelNameError, setLevelNameError] = useState<string | null>(null);
  const [savedLevel, setSavedLevel] = useState<SavedLevelReference | null>(
    null,
  );
  const [isInitialStateMode, setIsInitialStateMode] = useState(false);
  const [activeRulesTab, setActiveRulesTab] = useState<RulesTab>('general');
  const [buildSessionState, setBuildSessionState] =
    useState<BuildSessionState>('new');
  const [initialHandCounts, setInitialHandCounts] = useState<
    Partial<Record<ColorId, number>>
  >(() => getPlacementCounts(levelColors, {}));
  const playerPlacementsRef = useRef<Placements>({});
  const levelNameDialogRef = useRef<HTMLDialogElement>(null);
  const inventoryCounts = useMemo(
    () =>
      isGenerator
        ? getPlacementCounts(levelColors, playerPlacements)
        : getRemainingInventory(level.inventory, playerPlacements),
    [isGenerator, level.inventory, levelColors, playerPlacements],
  );
  const placements = useMemo(
    () => ({ ...level.fixedPlacements, ...playerPlacements }),
    [level.fixedPlacements, playerPlacements],
  );
  const availableColors = useMemo(
    () =>
      isGenerator
        ? levelColors
        : levelColors.filter((color) => (inventoryCounts[color] ?? 0) > 0),
    [inventoryCounts, isGenerator, levelColors],
  );

  const applyTiles = useCallback(
    (requested: RequestedPlacement[]) => {
      let next: Placements = playerPlacementsRef.current;
      flushSync(() => {
        next = isGenerator
          ? placeUnrestrictedTiles(playerPlacementsRef.current, requested)
          : placeTiles(
              playerPlacementsRef.current,
              level.inventory,
              requested,
              level.fixedPlacements,
            );
        playerPlacementsRef.current = next;
        setPlayerPlacements(next);
        setMarks({});
        setOpenTileKey(null);
        setSaveStatus(null);
        if (isGenerator) setBuildSessionState('new');
      });
      return next;
    },
    [isGenerator, level.fixedPlacements, level.inventory],
  );

  const validateLevel = useCallback(() => {
    const nextMarks = validatePlacements({
      ...level.fixedPlacements,
      ...playerPlacementsRef.current,
    });
    flushSync(() => {
      setMarks(nextMarks);
      if (isGenerator) {
        setBuildSessionState((current) =>
          validationIsSuccessful(nextMarks)
            ? current === 'solution-saved' ||
              current === 'initial-state-editing' ||
              current === 'initial-state-ready'
              ? current
              : 'solution-validated'
            : 'new',
        );
      }
    });
    return nextMarks;
  }, [isGenerator, level.fixedPlacements]);

  const removeGeneratorTile = useCallback(
    (coordinate: RequestedPlacement['coordinate']) => {
      flushSync(() => {
        const next = removeUnrestrictedTile(
          playerPlacementsRef.current,
          coordinate,
        );
        playerPlacementsRef.current = next;
        setPlayerPlacements(next);
        setMarks({});
        setOpenTileKey(null);
        setSaveStatus(null);
        setBuildSessionState('new');
      });
    },
    [],
  );

  const retireGeneratorTile = useCallback(
    (coordinate: RequestedPlacement['coordinate']) => {
      const next = retireUnrestrictedTile(
        playerPlacementsRef.current,
        initialHandCounts,
        coordinate,
      );
      flushSync(() => {
        playerPlacementsRef.current = next.placements;
        setPlayerPlacements(next.placements);
        setInitialHandCounts(next.hand);
        setMarks({});
        setOpenTileKey(null);
        setSaveStatus(null);
      });
    },
    [initialHandCounts],
  );

  const toggleInitialStateMode = useCallback(() => {
    flushSync(() => {
      if (isInitialStateMode) {
        if (hasInitialHandPieces(initialHandCounts)) {
          setBuildSessionState('initial-state-ready');
        }
      } else {
        setBuildSessionState((current) =>
          current === 'initial-state-ready' ? 'initial-state-editing' : current,
        );
      }
      setIsInitialStateMode(!isInitialStateMode);
      setOpenTileKey(null);
    });
  }, [initialHandCounts, isInitialStateMode]);

  const resetLevel = useCallback(() => {
    flushSync(() => {
      playerPlacementsRef.current = {};
      setPlayerPlacements({});
      setInitialHandCounts(getPlacementCounts(levelColors, {}));
      setIsInitialStateMode(false);
      setBuildSessionState('new');
      setMarks({});
      setOpenTileKey(null);
      setSaveStatus(null);
      setLevelName('');
      setLevelNameError(null);
      setSavedLevel(null);
      levelNameDialogRef.current?.close();
    });
  }, [levelColors]);

  const isSolutionValidated = buildSessionState !== 'new';
  const isSolutionSaved =
    buildSessionState === 'solution-saved' ||
    buildSessionState === 'initial-state-editing' ||
    buildSessionState === 'initial-state-ready';
  const isInitialStateReady = buildSessionState === 'initial-state-ready';
  const areSessionControlsLocked =
    buildSessionState === 'initial-state-editing' || isInitialStateReady;

  const requestSolutionName = useCallback(() => {
    const currentPlacements = playerPlacementsRef.current;
    const nextMarks = validatePlacements(currentPlacements);
    const validationSucceeded = validationIsSuccessful(nextMarks);
    flushSync(() => {
      setMarks(nextMarks);
      setBuildSessionState(validationSucceeded ? 'solution-validated' : 'new');
    });

    if (Object.keys(currentPlacements).length === 0) {
      setSaveStatus({
        tone: 'error',
        message: 'No se puede guardar: pinta y valida al menos un hexágono.',
      });
      return;
    }

    if (!validationSucceeded) {
      setSaveStatus({
        tone: 'error',
        message: 'No se puede guardar: la validación contiene uno o más ❌.',
      });
      return;
    }

    setLevelName('');
    setLevelNameError(null);
    setSaveStatus(null);
    if (!levelNameDialogRef.current?.open) {
      levelNameDialogRef.current?.showModal();
    }
  }, []);

  const saveSolution = useCallback(async () => {
    let normalizedName: string;
    try {
      normalizedName = normalizeLevelName(levelName);
    } catch (error) {
      setLevelNameError(
        error instanceof Error
          ? error.message
          : 'Escribe un nombre para identificar el nivel.',
      );
      return;
    }

    const currentPlacements = playerPlacementsRef.current;
    const nextMarks = validatePlacements(currentPlacements);
    if (!validationIsSuccessful(nextMarks)) {
      flushSync(() => {
        setMarks(nextMarks);
        setBuildSessionState('new');
      });
      setLevelNameError(
        'La solución cambió o contiene uno o más ❌. Valídala de nuevo.',
      );
      return;
    }

    setIsSaving(true);
    setLevelNameError(null);
    setSaveStatus(null);
    try {
      const response = await fetch('/__hextile/save-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: normalizedName,
          originalSolution: placementsToCoordinateMap(currentPlacements),
        }),
      });
      const result = (await response.json()) as {
        id?: string;
        fileName?: string;
        error?: string;
      };
      if (!response.ok || !result.id || !result.fileName) {
        throw new Error(result.error ?? 'No se pudo guardar la solución.');
      }

      setSavedLevel({
        id: result.id,
        name: normalizedName,
        fileName: result.fileName,
      });
      setBuildSessionState('solution-saved');
      levelNameDialogRef.current?.close();
      setSaveStatus({
        tone: 'success',
        message: `Solución original guardada en niveles/${result.fileName}.`,
      });
    } catch (error) {
      setLevelNameError(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar la solución.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [levelName]);

  const saveGeneratedLevel = useCallback(async () => {
    if (!savedLevel || !isInitialStateReady) return;

    setIsSavingLevel(true);
    setSaveStatus(null);
    try {
      const response = await fetch('/__hextile/save-level', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: savedLevel.id,
          initialDistribution: placementsToCoordinateMap(
            playerPlacementsRef.current,
          ),
          initialHand: initialHandCounts,
        }),
      });
      const result = (await response.json()) as {
        id?: string;
        error?: string;
      };
      if (!response.ok || result.id !== savedLevel.id) {
        throw new Error(result.error ?? 'No se pudo guardar el nivel.');
      }

      resetLevel();
    } catch (error) {
      setSaveStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el nivel.',
      });
    } finally {
      setIsSavingLevel(false);
    }
  }, [initialHandCounts, isInitialStateReady, resetLevel, savedLevel]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const register = (tool: ToolDefinition) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        // WebMCP is an optional enhancement; the visible game remains available.
      }
    };

    register({
      name: 'place_level_tiles',
      title: isGenerator
        ? 'Colocar piezas del generador'
        : 'Colocar piezas del nivel',
      description: `Coloca una o varias piezas en hexágonos blancos de ${level.label} y actualiza el tablero visible.`,
      inputSchema: {
        type: 'object',
        properties: {
          placements: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                q: { type: 'integer' },
                r: { type: 'integer' },
                color: { type: 'string', enum: levelColors },
              },
              required: ['q', 'r', 'color'],
              additionalProperties: false,
            },
          },
        },
        required: ['placements'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const requested = parsePlacementInput(input);
        const next = applyTiles(requested);
        return isGenerator
          ? {
              placed: requested.length,
              counts: getPlacementCounts(levelColors, next),
            }
          : {
              placed: requested.length,
              remaining: getRemainingInventory(level.inventory, next),
            };
      },
    });

    register({
      name: 'validate_level',
      title: 'Validar nivel',
      description:
        'Cuenta los vecinos de cada pieza colocada y muestra sus marcas de validación.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        const results = validateLevel();
        return {
          results: Object.entries(results).map(([coordinate, result]) => ({
            coordinate,
            neighbors: result.neighborCount,
            valid: result.valid,
          })),
        };
      },
    });

    register({
      name: 'reset_level',
      title: 'Reiniciar nivel',
      description: `Quita las piezas y marcas y restaura ${level.label}.`,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        resetLevel();
        return isGenerator
          ? { reset: true, counts: getPlacementCounts(levelColors, {}) }
          : { reset: true, remaining: level.inventory };
      },
    });

    return () => lifecycle.abort();
  }, [
    applyTiles,
    isGenerator,
    level.inventory,
    level.label,
    levelColors,
    resetLevel,
    validateLevel,
  ]);

  return (
    <main className="game-screen" data-mode={mode}>
      <header className="game-heading">
        <a
          href={isGenerator ? '#/build' : '#/play'}
          className="brand-link"
          aria-label={
            isGenerator
              ? 'Volver a las herramientas de construcción'
              : 'Volver a los niveles'
          }
        >
          HEXTILE
        </a>
        <h1>{level.label}</h1>
      </header>

      {isGenerator ? (
        <aside className="rules-panel sidebar-card" aria-label="Reglamento">
          <div
            className="rules-tabs"
            role="tablist"
            aria-label="Secciones del reglamento"
          >
            <button
              className="rules-tab"
              type="button"
              role="tab"
              id="general-rules-tab"
              aria-selected={activeRulesTab === 'general'}
              aria-controls="general-rules-panel"
              data-active={activeRulesTab === 'general' ? 'true' : 'false'}
              onClick={() => setActiveRulesTab('general')}
            >
              Uso general
            </button>
            <button
              className="rules-tab"
              type="button"
              role="tab"
              id="color-rules-tab"
              aria-selected={activeRulesTab === 'colors'}
              aria-controls="color-rules-panel"
              data-active={activeRulesTab === 'colors' ? 'true' : 'false'}
              onClick={() => setActiveRulesTab('colors')}
            >
              Reglas de colores
            </button>
            <button
              className="rules-tab"
              type="button"
              role="tab"
              id="validate-rules-tab"
              aria-selected={activeRulesTab === 'validate'}
              aria-controls="validate-rules-panel"
              data-active={activeRulesTab === 'validate' ? 'true' : 'false'}
              onClick={() => setActiveRulesTab('validate')}
            >
              Validar
            </button>
          </div>

          {activeRulesTab === 'general' ? (
            <section
              className="rules-tab-panel"
              id="general-rules-panel"
              role="tabpanel"
              aria-labelledby="general-rules-tab"
            >
              <h2>Uso general</h2>
              <ol className="rules-list">
                {generalRules.map((rule) => (
                  <li key={rule.text}>
                    {rule.text}
                    {rule.details ? (
                      <ul className="rule-details">
                        {rule.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {activeRulesTab === 'colors' ? (
            <section
              className="rules-tab-panel"
              id="color-rules-panel"
              role="tabpanel"
              aria-labelledby="color-rules-tab"
            >
              <h2>Reglas de colores</h2>
              <ul className="color-rules-list">
                {level.rules.colors.map((rule) => {
                  const definition = COLOR_DEFINITIONS[rule.color];
                  return (
                    <li key={rule.color}>
                      <span
                        className="rule-color-swatch"
                        style={{ backgroundColor: definition.cssColor }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{definition.label}:</strong> {rule.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {activeRulesTab === 'validate' ? (
            <section
              className="rules-tab-panel validate-rules-panel"
              id="validate-rules-panel"
              role="tabpanel"
              aria-labelledby="validate-rules-tab"
            >
              <h2>Primer paso: validar</h2>
              <ol className="validation-flow-list">
                <li>Arma una solución en el tablero.</li>
                <li>
                  Presiona Validar para revisar todos los hexágonos coloreados.
                </li>
                <li>
                  Cada hexágono debe mostrar ✅. Si alguno muestra ❌, corrige
                  la distribución y valida de nuevo.
                </li>
                <li>
                  Cuando todos muestran ✅, se completa este paso, aparece el
                  siguiente requisito y se habilita Guardar solución.
                </li>
              </ol>
            </section>
          ) : null}
        </aside>
      ) : (
        <aside
          className="general-rules-panel sidebar-card"
          aria-labelledby="general-rules-title"
        >
          <h2 id="general-rules-title">Reglamento general</h2>
          <ol className="rules-list">
            {generalRules.map((rule) => (
              <li key={rule.text}>
                {rule.text}
                {rule.details ? (
                  <ul className="rule-details">
                    {rule.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </aside>
      )}

      <aside
        className="level-sidebar"
        aria-label={
          isGenerator ? 'Contadores del generador' : 'Colores disponibles'
        }
      >
        {!isGenerator ? (
          <section
            className="color-rules-panel sidebar-card"
            aria-labelledby="color-rules-title"
          >
            <h2 id="color-rules-title">Reglamento de colores</h2>
            <ul className="color-rules-list">
              {level.rules.colors.map((rule) => {
                const definition = COLOR_DEFINITIONS[rule.color];
                return (
                  <li key={rule.color}>
                    <span
                      className="rule-color-swatch"
                      style={{ backgroundColor: definition.cssColor }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{definition.label}:</strong> {rule.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section
          className="inventory-panel sidebar-card"
          aria-labelledby={
            isGenerator ? 'control-count-title' : 'inventory-title'
          }
        >
          {isGenerator ? (
            <div className="generator-inventory-columns">
              <div className="generator-inventory-column">
                <h2 id="control-count-title">Cantidad de control</h2>
                <ColorCountList colors={levelColors} counts={inventoryCounts} />
              </div>
              <div className="generator-inventory-column">
                <h2>Mano inicial</h2>
                <ColorCountList
                  colors={levelColors}
                  counts={initialHandCounts}
                />
              </div>
            </div>
          ) : (
            <>
              <h2 id="inventory-title">Colores disponibles</h2>
              <ColorCountList colors={levelColors} counts={inventoryCounts} />
            </>
          )}
        </section>

        {isGenerator ? (
          <>
            <button
              className="save-level-action"
              type="button"
              disabled={!isInitialStateReady || !savedLevel || isSavingLevel}
              onClick={() => void saveGeneratedLevel()}
            >
              {isSavingLevel ? 'Guardando…' : 'Guardar nivel'}
            </button>
            {saveStatus ? (
              <p
                className="save-status"
                data-tone={saveStatus.tone}
                role={saveStatus.tone === 'error' ? 'alert' : 'status'}
              >
                {saveStatus.message}
              </p>
            ) : null}
          </>
        ) : null}
      </aside>

      <div className="board-shell" aria-label="Tablero hexagonal de 15 por 15">
        {BOARD_TILES.map((tile) => {
          const color = placements[tile.key];
          const isFixed = Boolean(level.fixedPlacements[tile.key]);
          const mark = marks[tile.key];
          const isEmpty = !color;
          const hasAvailableColors = availableColors.length > 0;
          const isAdjacentToColor =
            isEmpty && hasColoredNeighbor(tile, placements);
          const canPlace =
            !isInitialStateMode &&
            !isSolutionSaved &&
            isEmpty &&
            hasAvailableColors &&
            (isGenerator || isAdjacentToColor);
          const isPlayerTile = Boolean(playerPlacements[tile.key]);
          const canRemove =
            isGenerator &&
            !isInitialStateMode &&
            !isSolutionSaved &&
            isPlayerTile;
          const canRetire = isGenerator && isInitialStateMode && isPlayerTile;
          const showUnavailableNotice =
            !isGenerator && isEmpty && hasAvailableColors && !isAdjacentToColor;
          const showInitialStateUnavailable =
            isGenerator && isInitialStateMode && isEmpty;
          const unavailableMessage = showInitialStateUnavailable
            ? 'no disponible, lee las instrucciones'
            : showUnavailableNotice
              ? 'no disponible, revisa el reglamento'
              : null;
          const coordinate = `(${tile.q},${tile.r})`;
          const definition = color ? COLOR_DEFINITIONS[color] : undefined;
          const feedback = mark ? (mark.valid ? 'correcto' : 'incorrecto') : '';
          const ariaLabel = `Hexágono ${coordinate}, ${definition?.label ?? 'blanco'}${
            isFixed ? ', fijo' : ''
          }${canRemove ? ', se puede borrar' : ''}${
            canRetire ? ', se puede retirar' : ''
          }${unavailableMessage ? ', no disponible' : ''}${
            mark ? `, ${mark.neighborCount} vecinos, ${feedback}` : ''
          }${isInitialStateMode ? ', modo estado inicial activo' : ''}`;
          const positionStyle = {
            left: `calc(50% + ${(tile.column - BOARD_CENTER_INDEX) * 34 + (tile.row % 2 === 0 ? -17 : 0)}px)`,
            top: `calc(50% + ${(tile.row - BOARD_CENTER_INDEX) * 29}px)`,
          };
          const buttonStyle = {
            '--tile-color': definition?.cssColor ?? '#ffffff',
          } as CSSProperties;

          const buttonContents = mark ? (
            <span className="validation-emoji" aria-hidden="true">
              {mark.valid ? '✅' : '❌'}
            </span>
          ) : null;

          return (
            <div className="hex-position" key={tile.key} style={positionStyle}>
              {canPlace ? (
                <DropdownMenu
                  modal={false}
                  open={openTileKey === tile.key}
                  onOpenChange={(open) =>
                    setOpenTileKey(open ? tile.key : null)
                  }
                >
                  <DropdownMenuTrigger
                    className="hex-button"
                    style={buttonStyle}
                    aria-label={ariaLabel}
                    onClick={() => setOpenTileKey(tile.key)}
                    data-center={
                      tile.q === 0 && tile.r === 0 ? 'true' : undefined
                    }
                  >
                    {buttonContents}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="color-menu"
                    side="right"
                    sideOffset={8}
                    align="center"
                  >
                    {availableColors.map((availableColor) => {
                      const availableDefinition =
                        COLOR_DEFINITIONS[availableColor];
                      return (
                        <DropdownMenuItem
                          className="color-menu-item"
                          key={availableColor}
                          onClick={() =>
                            applyTiles([
                              {
                                coordinate: { q: tile.q, r: tile.r },
                                color: availableColor,
                              },
                            ])
                          }
                        >
                          <span
                            className="menu-swatch"
                            style={{
                              backgroundColor: availableDefinition.cssColor,
                            }}
                            aria-hidden="true"
                          />
                          {availableDefinition.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : canRemove ? (
                <DropdownMenu
                  modal={false}
                  open={openTileKey === tile.key}
                  onOpenChange={(open) =>
                    setOpenTileKey(open ? tile.key : null)
                  }
                >
                  <DropdownMenuTrigger
                    className="hex-button"
                    style={buttonStyle}
                    aria-label={ariaLabel}
                    onClick={() => setOpenTileKey(tile.key)}
                    data-center={
                      tile.q === 0 && tile.r === 0 ? 'true' : undefined
                    }
                  >
                    {buttonContents}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="color-menu delete-menu"
                    side="right"
                    sideOffset={8}
                    align="center"
                  >
                    <DropdownMenuItem
                      className="color-menu-item delete-menu-item"
                      onClick={() =>
                        removeGeneratorTile({ q: tile.q, r: tile.r })
                      }
                    >
                      Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : canRetire ? (
                <DropdownMenu
                  modal={false}
                  open={openTileKey === tile.key}
                  onOpenChange={(open) =>
                    setOpenTileKey(open ? tile.key : null)
                  }
                >
                  <DropdownMenuTrigger
                    className="hex-button"
                    style={buttonStyle}
                    aria-label={ariaLabel}
                    onClick={() => setOpenTileKey(tile.key)}
                    data-center={
                      tile.q === 0 && tile.r === 0 ? 'true' : undefined
                    }
                  >
                    {buttonContents}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="color-menu retire-menu"
                    side="right"
                    sideOffset={8}
                    align="center"
                  >
                    <DropdownMenuItem
                      className="color-menu-item retire-menu-item"
                      onClick={() =>
                        retireGeneratorTile({ q: tile.q, r: tile.r })
                      }
                    >
                      Retirar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : unavailableMessage ? (
                <DropdownMenu
                  modal={false}
                  open={openTileKey === tile.key}
                  onOpenChange={(open) =>
                    setOpenTileKey(open ? tile.key : null)
                  }
                >
                  <DropdownMenuTrigger
                    className="hex-button"
                    style={buttonStyle}
                    aria-label={ariaLabel}
                    onClick={() => setOpenTileKey(tile.key)}
                    data-unavailable="true"
                    data-center={
                      tile.q === 0 && tile.r === 0 ? 'true' : undefined
                    }
                  >
                    {buttonContents}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="unavailable-menu"
                    side="right"
                    sideOffset={8}
                    align="center"
                  >
                    <DropdownMenuItem
                      className="unavailable-menu-item"
                      disabled
                    >
                      {unavailableMessage}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  className="hex-button"
                  style={buttonStyle}
                  type="button"
                  aria-disabled="true"
                  aria-label={ariaLabel}
                  data-center={
                    tile.q === 0 && tile.r === 0 ? 'true' : undefined
                  }
                >
                  {buttonContents}
                </button>
              )}
              <span className="coordinate-tooltip" role="tooltip">
                {coordinate}
              </span>
            </div>
          );
        })}
      </div>

      <div className="game-controls">
        {isGenerator ? (
          <div className="session-progress-list" aria-live="polite">
            {isSolutionSaved ? (
              <>
                <p className="session-progress" data-complete="true">
                  <span className="session-progress-marker" aria-hidden="true">
                    ✓
                  </span>
                  Guarda la solución original para continuar.
                </p>
                <p
                  className="session-progress"
                  data-complete={isInitialStateReady ? 'true' : 'false'}
                >
                  <span className="session-progress-marker" aria-hidden="true">
                    {isInitialStateReady ? '✓' : ''}
                  </span>
                  genera el estado inicial para continuar
                </p>
              </>
            ) : (
              <>
                <p
                  className="session-progress"
                  data-complete={isSolutionValidated ? 'true' : 'false'}
                >
                  <span className="session-progress-marker" aria-hidden="true">
                    {isSolutionValidated ? '✓' : ''}
                  </span>
                  Para avanzar debes validar una solución exitosa
                </p>
                {isSolutionValidated ? (
                  <p className="session-progress" data-complete="false">
                    <span
                      className="session-progress-marker"
                      aria-hidden="true"
                    />
                    Guarda la solución original para continuar.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <div className="game-actions">
          {isGenerator ? (
            <>
              <button
                className="primary-action"
                type="button"
                disabled={isSolutionSaved}
                onClick={validateLevel}
              >
                Validar
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!isSolutionValidated || isSaving || isSolutionSaved}
                onClick={requestSolutionName}
              >
                Guardar solución
              </button>
              <button
                className="secondary-action initial-state-action"
                type="button"
                disabled={!isSolutionSaved || !savedLevel || isSavingLevel}
                aria-pressed={isInitialStateMode}
                onClick={toggleInitialStateMode}
              >
                {isInitialStateMode ? 'Salir' : 'Estado inicial'}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={areSessionControlsLocked}
                onClick={resetLevel}
              >
                Reiniciar
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary-action"
                type="button"
                onClick={resetLevel}
              >
                Reiniciar
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={validateLevel}
              >
                Validar
              </button>
            </>
          )}
        </div>
      </div>

      {isGenerator ? (
        <dialog
          className="level-name-dialog"
          ref={levelNameDialogRef}
          aria-labelledby="level-name-dialog-title"
          aria-describedby="level-name-dialog-description"
          onClose={() => setLevelNameError(null)}
        >
          <form
            className="level-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSolution();
            }}
          >
            <h2 id="level-name-dialog-title">Nombre del nivel</h2>
            <p id="level-name-dialog-description">
              Escribe un nombre para identificar el nivel y el archivo de su
              solución original.
            </p>
            <label htmlFor="level-name-input">Nombre</label>
            <input
              id="level-name-input"
              name="levelName"
              type="text"
              value={levelName}
              maxLength={MAX_LEVEL_NAME_LENGTH}
              placeholder="Ej. Puente celeste"
              autoComplete="off"
              autoFocus
              required
              onChange={(event) => {
                setLevelName(event.target.value);
                setLevelNameError(null);
              }}
            />
            {levelNameError ? (
              <p className="level-name-error" role="alert">
                {levelNameError}
              </p>
            ) : null}
            <div className="level-name-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={isSaving}
                onClick={() => levelNameDialogRef.current?.close()}
              >
                Cancelar
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={!levelName.trim() || isSaving}
              >
                {isSaving ? 'Guardando…' : 'Aceptar'}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </main>
  );
}

export default function Home() {
  const hash = useHashRoute();
  const playableLevels = usePlayableLevels();
  if (hash === '#/play') {
    return <PlayScreen levels={playableLevels} />;
  }

  if (hash === '#/build') {
    return <BuildScreen />;
  }

  if (hash === '#/agregar') {
    return <LevelCatalogScreen action="deploy" />;
  }

  if (hash === '#/quitar') {
    return <LevelCatalogScreen action="undeploy" />;
  }

  if (hash === '#/generar') {
    return (
      <BoardScreen
        key="generator"
        level={GENERATOR_TEMPLATE}
        mode="generator"
      />
    );
  }

  const levelMatch = /^#\/nivel\/(\d+)$/.exec(hash);
  const level = levelMatch
    ? playableLevels.find((candidate) => candidate.id === Number(levelMatch[1]))
    : undefined;

  return level ? (
    <BoardScreen key={`level-${level.id}`} level={level} />
  ) : (
    <WelcomeScreen />
  );
}
