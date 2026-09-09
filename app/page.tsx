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
  GENERAL_RULES,
  GENERATOR_GENERAL_RULES,
  GENERATOR_TEMPLATE,
  LEVELS,
  getPlacementCounts,
  getRemainingInventory,
  hasColoredNeighbor,
  isColorId,
  placeTiles,
  placeUnrestrictedTiles,
  removeUnrestrictedTile,
  retireUnrestrictedTile,
  validatePlacements,
  type ColorId,
  type LevelDefinition,
  type Placements,
  type RequestedPlacement,
  type ValidationMarks,
} from '@/lib/hextile';
import { placementsToSolution } from '@/lib/level-manifest';

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

type SaveStatus = {
  tone: 'success' | 'error';
  message: string;
};

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

function HomeScreen() {
  return (
    <main className="home-screen">
      <div className="home-panel">
        <h1 className="home-title">HEXTILE</h1>
        <nav aria-label="Niveles disponibles" className="level-list">
          {LEVELS.map((level) => (
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
      <a className="generator-link" href="#/generar">
        <span>Generar nivel</span>
        <span aria-hidden="true">&#8594;</span>
      </a>
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
  const generalRules = isGenerator
    ? GENERATOR_GENERAL_RULES
    : GENERAL_RULES;
  const levelColors = useMemo(
    () => Object.keys(level.inventory) as ColorId[],
    [level],
  );
  const [playerPlacements, setPlayerPlacements] = useState<Placements>({});
  const [marks, setMarks] = useState<ValidationMarks>({});
  const [openTileKey, setOpenTileKey] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialStateMode, setIsInitialStateMode] = useState(false);
  const [initialHandCounts, setInitialHandCounts] = useState<
    Partial<Record<ColorId, number>>
  >(() => getPlacementCounts(levelColors, {}));
  const playerPlacementsRef = useRef<Placements>({});
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
        : levelColors.filter(
            (color) => (inventoryCounts[color] ?? 0) > 0,
          ),
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
    flushSync(() => setMarks(nextMarks));
    return nextMarks;
  }, [level.fixedPlacements]);

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
      setIsInitialStateMode((current) => !current);
      setOpenTileKey(null);
    });
  }, []);

  const resetLevel = useCallback(() => {
    flushSync(() => {
      playerPlacementsRef.current = {};
      setPlayerPlacements({});
      setInitialHandCounts(getPlacementCounts(levelColors, {}));
      setIsInitialStateMode(false);
      setMarks({});
      setOpenTileKey(null);
      setSaveStatus(null);
    });
  }, [levelColors]);

  const saveSolution = useCallback(async () => {
    const currentPlacements = playerPlacementsRef.current;
    const nextMarks = validatePlacements(currentPlacements);
    flushSync(() => setMarks(nextMarks));

    if (Object.keys(currentPlacements).length === 0) {
      setSaveStatus({
        tone: 'error',
        message:
          'No se puede guardar: pinta y valida al menos un hexágono.',
      });
      return;
    }

    if (Object.values(nextMarks).some((mark) => !mark.valid)) {
      setSaveStatus({
        tone: 'error',
        message:
          'No se puede guardar: la validación contiene uno o más ❌.',
      });
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);
    try {
      const response = await fetch('/__hextile/save-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solution: placementsToSolution(currentPlacements),
        }),
      });
      const result = (await response.json()) as {
        id?: string;
        error?: string;
      };
      if (!response.ok || !result.id) {
        throw new Error(result.error ?? 'No se pudo guardar la solución.');
      }

      setSaveStatus({
        tone: 'success',
        message: `Solución guardada en niveles/${result.id}.json.`,
      });
    } catch (error) {
      setSaveStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar la solución.',
      });
    } finally {
      setIsSaving(false);
    }
  }, []);

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
        <a href="#/" className="brand-link" aria-label="Volver a los niveles">
          HEXTILE
        </a>
        <h1>{level.label}</h1>
      </header>

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

      <aside
        className="level-sidebar"
        aria-label="Reglamento de colores e inventario"
      >
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

        <section
          className="inventory-panel sidebar-card"
          aria-labelledby={
            isGenerator ? 'selected-colors-title' : 'inventory-title'
          }
        >
          {isGenerator ? (
            <div className="generator-inventory-columns">
              <div className="generator-inventory-column">
                <h2 id="selected-colors-title">Colores seleccionados</h2>
                <ColorCountList
                  colors={levelColors}
                  counts={inventoryCounts}
                />
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
              className="save-solution-action"
              type="button"
              disabled={isSaving}
              onClick={() => void saveSolution()}
            >
              {isSaving ? 'Guardando…' : 'Guardar solución'}
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
            isEmpty &&
            hasAvailableColors &&
            (isGenerator || isAdjacentToColor);
          const isPlayerTile = Boolean(playerPlacements[tile.key]);
          const canRemove =
            isGenerator && !isInitialStateMode && isPlayerTile;
          const canRetire =
            isGenerator && isInitialStateMode && isPlayerTile;
          const showUnavailableNotice =
            !isGenerator &&
            isEmpty &&
            hasAvailableColors &&
            !isAdjacentToColor;
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
          }${
            isInitialStateMode ? ', modo estado inicial activo' : ''
          }`;
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

      <div className="game-actions">
        <button className="secondary-action" type="button" onClick={resetLevel}>
          Reiniciar
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={validateLevel}
        >
          Validar
        </button>
        {isGenerator ? (
          <button
            className="secondary-action initial-state-action"
            type="button"
            aria-pressed={isInitialStateMode}
            onClick={toggleInitialStateMode}
          >
            {isInitialStateMode ? 'Salir' : 'Estado inicial'}
          </button>
        ) : null}
      </div>
    </main>
  );
}

export default function Home() {
  const hash = useHashRoute();
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
    ? LEVELS.find((candidate) => candidate.id === Number(levelMatch[1]))
    : undefined;

  return level ? (
    <BoardScreen key={`level-${level.id}`} level={level} />
  ) : (
    <HomeScreen />
  );
}
