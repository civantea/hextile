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
  getRemainingInventory,
  hasColoredNeighbor,
  isColorId,
  placeTiles,
  validatePlacements,
  type ColorId,
  type Coordinate,
  type LevelDefinition,
  type Placements,
  type ValidationMarks,
} from '@/lib/hextile';
import {
  levelManifestToDefinition,
  type PlayableLevelManifest,
} from '@/lib/playable-level';

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

const LEVELS = Object.values(
  import.meta.glob<PlayableLevelManifest>('../niveles/etapa-*/*.json', {
    eager: true,
    import: 'default',
  }),
)
  .filter((manifest) => manifest.deployed)
  .map(levelManifestToDefinition)
  .sort(
    (left, right) =>
      left.stage - right.stage || left.levelNumber - right.levelNumber,
  );

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
  const stageGroups = Array.from(
    LEVELS.reduce<Map<number, LevelDefinition[]>>((groups, level) => {
      const stageLevels = groups.get(level.stage) ?? [];
      stageLevels.push(level);
      groups.set(level.stage, stageLevels);
      return groups;
    }, new Map()),
  );

  return (
    <main className="home-screen play-screen">
      <div className="home-panel">
        <h1 className="home-title">HEXTILE</h1>
        <nav aria-label="Niveles disponibles" className="level-list">
          {stageGroups.map(([stage, stageLevels]) => (
            <section className="level-stage" key={stage}>
              <h2 className="level-stage-heading">Etapa {stage}</h2>
              <div className="level-grid">
                {stageLevels.map((level) => (
                  <a
                    aria-label={`Etapa ${stage}, nivel ${level.levelNumber}`}
                    className="level-link"
                    href={`#/nivel/${stage}/${level.levelNumber}`}
                    key={`${stage}-${level.levelNumber}`}
                  >
                    {level.levelNumber}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>
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

function LevelScreen({ level }: { level: LevelDefinition }) {
  const [playerPlacements, setPlayerPlacements] = useState<Placements>({});
  const [marks, setMarks] = useState<ValidationMarks>({});
  const [openTileKey, setOpenTileKey] = useState<string | null>(null);
  const playerPlacementsRef = useRef<Placements>({});

  const levelColors = useMemo(
    () => Object.keys(level.inventory) as ColorId[],
    [level.inventory],
  );

  const remaining = useMemo(
    () => getRemainingInventory(level.inventory, playerPlacements),
    [level.inventory, playerPlacements],
  );
  const placements = useMemo(
    () => ({ ...level.fixedPlacements, ...playerPlacements }),
    [level.fixedPlacements, playerPlacements],
  );
  const availableColors = levelColors.filter(
    (color) => (remaining[color] ?? 0) > 0,
  );

  const applyTiles = useCallback(
    (requested: Array<{ coordinate: Coordinate; color: ColorId }>) => {
      let next: Placements = playerPlacementsRef.current;
      flushSync(() => {
        next = placeTiles(
          playerPlacementsRef.current,
          level.inventory,
          requested,
          level.fixedPlacements,
        );
        playerPlacementsRef.current = next;
        setPlayerPlacements(next);
        setMarks({});
        setOpenTileKey(null);
      });
      return next;
    },
    [level.fixedPlacements, level.inventory],
  );

  const validateLevel = useCallback(() => {
    const nextMarks = validatePlacements({
      ...level.fixedPlacements,
      ...playerPlacementsRef.current,
    });
    flushSync(() => setMarks(nextMarks));
    return nextMarks;
  }, [level.fixedPlacements]);

  const resetLevel = useCallback(() => {
    flushSync(() => {
      playerPlacementsRef.current = {};
      setPlayerPlacements({});
      setMarks({});
      setOpenTileKey(null);
    });
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
      title: 'Colocar piezas del nivel',
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
        return {
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
      description: `Quita todas las piezas y marcas y restaura ${level.label}.`,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        resetLevel();
        return { reset: true, remaining: level.inventory };
      },
    });

    return () => lifecycle.abort();
  }, [
    applyTiles,
    level.inventory,
    level.label,
    levelColors,
    resetLevel,
    validateLevel,
  ]);

  return (
    <main className="game-screen">
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
          {level.rules.general.map((rule) => (
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
          aria-labelledby="inventory-title"
        >
          <h2 id="inventory-title">Colores disponibles</h2>
          <div className="inventory-list">
            {levelColors.map((color) => {
              const definition = COLOR_DEFINITIONS[color];
              return (
                <div className="inventory-item" key={color}>
                  <span
                    className="color-swatch"
                    style={{ backgroundColor: definition.cssColor }}
                    aria-hidden="true"
                  />
                  <span
                    aria-label={`${definition.label}: ${remaining[color] ?? 0}`}
                  >
                    {remaining[color] ?? 0}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
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
          const canPlace = isEmpty && hasAvailableColors && isAdjacentToColor;
          const showUnavailableNotice =
            isEmpty && hasAvailableColors && !isAdjacentToColor;
          const coordinate = `(${tile.q},${tile.r})`;
          const definition = color ? COLOR_DEFINITIONS[color] : undefined;
          const feedback = mark ? (mark.valid ? 'correcto' : 'incorrecto') : '';
          const ariaLabel = `Hexágono ${coordinate}, ${definition?.label ?? 'blanco'}${
            isFixed ? ', fijo' : ''
          }${showUnavailableNotice ? ', no disponible' : ''}${
            mark ? `, ${mark.neighborCount} vecinos, ${feedback}` : ''
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
              ) : showUnavailableNotice ? (
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
                      no disponible, revisa el reglamento
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
      </div>
    </main>
  );
}

export default function Home() {
  const hash = useHashRoute();
  const levelMatch = /^#\/nivel\/(\d+)\/(\d+)$/.exec(hash);
  const level = levelMatch
    ? LEVELS.find(
        (candidate) =>
          candidate.stage === Number(levelMatch[1]) &&
          candidate.levelNumber === Number(levelMatch[2]),
      )
    : undefined;

  return level ? (
    <LevelScreen
      key={`level-${level.stage}-${level.levelNumber}`}
      level={level}
    />
  ) : (
    <HomeScreen />
  );
}
