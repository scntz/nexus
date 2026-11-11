import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Modal, GameCover, CreditsModal } from "./components";
import type { TargetedKeyboardEvent } from "preact";
import { bundledArtwork } from "./catalog";
import { errorMessage } from "./errors";
import { APP_VERSION } from "./version";
import { libraryPlatform, libraryPlatforms } from "./platforms";
import { GameDetails } from "./GameDetails";
import { GameEditor } from "./GameEditor";
import { FeaturedGames } from "./FeaturedGames";
import { SourcesPanel } from "./SourcesPanel";
import { FolderSources } from "./FolderSources";
import { GameViewport } from "./GameViewport";
import { LibraryFilterPanel } from "./LibraryFilterPanel";
import { groupGames, duplicateKey } from "./duplicates";
import {
  applyMetadata,
  artworkOutcome,
  verifyArtwork,
  type MetadataPatch,
} from "./artwork";
import { gameAction } from "./actions";
import { Brand, Icon } from "./icons";
import { demoGames } from "./data";
import {
  filterGames,
  mergeGames,
  persist,
  readStored,
  type Availability,
  type Sort,
} from "./library";
import {
  isDesktop,
  isNativeShell,
  launchGame,
  loadLibrary,
  native,
  saveLibrary,
  scanLibrary,
} from "./bridge";
import {
  platforms,
  type Game,
  type Platform,
  type Preferences,
  type SourceStatus,
} from "./types";

function loadPreferences(): Preferences {
  const value = readStored<Partial<Preferences>>("nexus.preferences", {});
  return {
    compact: value.compact === true,
    reduceMotion: value.reduceMotion === true,
    groupCopies: value.groupCopies !== false,
    playerName:
      typeof value.playerName === "string" && value.playerName.trim()
        ? value.playerName.trim().slice(0, 24)
        : "Player",
  };
}
type ModalState =
  | { type: "game"; game: Game }
  | { type: "edit"; game: Game }
  | { type: "add"; emulator?: boolean }
  | { type: "about" }
  | { type: "credits" }
  | null;

function navigateTabs(event: TargetedKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next]?.focus();
  buttons[next]?.click();
}

export function App() {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "sources">(
    "general",
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() =>
    readStored("nexus.hiddenGames", []),
  );
  const [library, setGames] = useState<Game[]>(() =>
    isDesktop
      ? []
      : readStored<Game[]>("nexus.preview.library", demoGames).filter(
          (g) =>
            g &&
            typeof g.id === "string" &&
            typeof g.name === "string" &&
            platforms.includes(g.platform),
        ),
  );
  const games = useMemo(() => {
    const hidden = new Set(hiddenIds);
    return library.filter((game) => !hidden.has(game.id));
  }, [library, hiddenIds]);
  const [loaded, setLoaded] = useState(!isDesktop);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Availability>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [platform, setPlatform] = useState<string>("all");
  const [sort, setSort] = useState<Sort>(() => {
    const value = readStored<string>("nexus.sort", "name");
    return ["name", "playtime", "platform"].includes(value)
      ? (value as Sort)
      : "name";
  });
  const [layout, setLayout] = useState<"grid" | "list">(() =>
    readStored<string>("nexus.layout", "grid") === "list" ? "list" : "grid",
  );
  const [syncIssues, setSyncIssues] = useState<string[]>([]);
  const [online, setOnline] = useState(navigator.onLine !== false);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{
    message: string;
    kind?: "error" | "success";
    action?: () => void;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const metadataBusyRef = useRef(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const launchBusy = useRef(false);
  const [sources, setSources] = useState<SourceStatus[]>(() =>
    readStored("nexus.sources", []),
  );
  const [lastSync, setLastSync] = useState<number | null>(() =>
    readStored("nexus.lastSync", null),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  const filterDrawerRef = useRef<HTMLElement>(null);
  const gamesRef = useRef(library);
  gamesRef.current = library;
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const lastPersisted = useRef(library);
  const scanBusyRef = useRef(false);
  const queuedScan = useRef<boolean | null>(null);
  const libraryReady = useRef(!isDesktop);
  const launchSyncStarted = useRef(false);
  const lastAutoCheck = useRef(0);

  function notify(
    message: string,
    kind?: "error" | "success",
    action?: () => void,
  ) {
    setToast({ message, kind, action });
  }
  function updateGames(next: Game[] | ((old: Game[]) => Game[])) {
    const value = typeof next === "function" ? next(gamesRef.current) : next;
    if (value === gamesRef.current) return saveQueue.current;
    gamesRef.current = value;
    setGames(value);
    const request = isDesktop
      ? saveQueue.current.then(() => saveLibrary(value))
      : persist("nexus.preview.library", value)
        ? Promise.resolve()
        : Promise.reject(
            new Error(
              "Storage is full. Export your library or choose smaller cover images, then try again.",
            ),
          );
    if (isDesktop) saveQueue.current = request.catch(() => {});
    void request.then(
      () => {
        lastPersisted.current = value;
      },
      (error) => {
        if (gamesRef.current === value) {
          gamesRef.current = lastPersisted.current;
          setGames(lastPersisted.current);
        }
        notify(`Could not save library: ${errorMessage(error)}`, "error");
      },
    );
    return request;
  }
  function resetFilters(provider: string = "all") {
    setPlatform(provider);
    setTab("all");
    setFavoritesOnly(false);
  }
  function viewSource(provider: Platform) {
    setSettingsOpen(false);
    resetFilters(provider);
    setQuery("");
    window.scrollTo({ top: 0 });
  }
  function closeFilters() {
    setFiltersOpen(false);
    filtersToggleRef.current?.focus({ preventScroll: true });
  }
  function hideGame(game: Game) {
    setHiddenIds((old) => {
      const next = [...new Set([...old, game.id])];
      persist("nexus.hiddenGames", next);
      return next;
    });
    setModal(null);
    notify(
      `${game.name} hidden. Its files and installation are untouched.`,
      undefined,
      () => {
        setHiddenIds((old) => {
          const next = old.filter((id) => id !== game.id);
          persist("nexus.hiddenGames", next);
          return next;
        });
        setToast(null);
      },
    );
  }
  async function enrich(force = false, ids: string[] = []) {
    if (!isDesktop || metadataBusyRef.current) return;
    metadataBusyRef.current = true;
    setMetadataBusy(true);
    try {
      await saveQueue.current;
      const originals = new Map<string, Game>();
      if (force && ids.length) {
        const selected = new Set(ids);
        for (const game of gamesRef.current)
          if (selected.has(game.id)) originals.set(game.id, game);
      }
      let patches = await native<MetadataPatch[]>("refresh_metadata", {
        force,
        ids,
      });
      if (originals.size) {
        patches = await Promise.all(
          patches.map(async (patch) => {
            const original = originals.get(patch.id);
            if (!original?.customized) return patch;
            const [cover, hero] = await Promise.all([
              verifyArtwork(patch.cover),
              verifyArtwork(patch.hero),
            ]);
            const current = gamesRef.current.find((g) => g.id === patch.id);
            return {
              ...patch,
              cover: current?.cover === original.cover ? cover : undefined,
              hero: current?.hero === original.hero ? hero : undefined,
            };
          }),
        );
      }
      if (patches.length)
        await updateGames((old) =>
          applyMetadata(old, patches, force ? ids : []),
        );
      if (force) {
        const outcome = artworkOutcome(gamesRef.current, patches, ids);
        notify(
          outcome.missing
            ? `Artwork refreshed for ${outcome.updated} games; ${outcome.missing} could not be retrieved. Check your connection or firewall, or choose a local cover in Edit details.`
            : outcome.updated
              ? "Artwork refreshed."
              : "No automatic artwork is available. You can choose a cover in Edit details.",
          outcome.missing ? "error" : outcome.updated ? "success" : undefined,
        );
      }
    } catch (e) {
      if (force) notify(String(e), "error");
    } finally {
      metadataBusyRef.current = false;
      setMetadataBusy(false);
    }
  }
  useEffect(() => {
    if (modal?.type === "game" && isDesktop)
      void enrich(false, [modal.game.id]);
  }, [modal?.type === "game" ? modal.game.id : ""]);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const changed = () => {
      if (!launchSyncStarted.current || document.visibilityState === "hidden")
        return;
      lastAutoCheck.current = Date.now();
      void scan(true, true);
    };
    const returned = () => {
      if (!scanBusyRef.current && Date.now() - lastAutoCheck.current > 10_000)
        changed();
    };
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", returned);
    if ("__TAURI_INTERNALS__" in window)
      void import("@tauri-apps/api/event")
        .then(async ({ listen }) => {
          const stop = await listen("library-changed", changed);
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", returned);
    };
  }, []);
  async function scan(quiet = false, fast = false) {
    if (!isDesktop) {
      notify(
        "You’re exploring the browser preview. Local game discovery is available in the Windows desktop app.",
      );
      return;
    }
    if (!libraryReady.current) {
      if (!quiet)
        notify("The saved library must load before syncing.", "error");
      return;
    }
    if (scanBusyRef.current) {
      queuedScan.current = queuedScan.current === false ? false : fast;
      return;
    }
    scanBusyRef.current = true;
    setScanning(true);
    try {
      const result = await scanLibrary(fast);
      await updateGames((old) =>
        mergeGames(
          old,
          result.games,
          result.failedPlatforms,
          result.scannedPlatforms,
        ),
      );
      setSources((old) => {
        const next = result.scannedPlatforms
          ? [
              ...old.filter(
                (s) => !result.scannedPlatforms!.includes(s.platform),
              ),
              ...result.sources,
            ]
          : result.sources;
        persist("nexus.sources", next);
        return next;
      });
      setSyncIssues(result.warnings);
      setLastSync(result.scannedAt);
      persist("nexus.lastSync", result.scannedAt);
      void enrich();
      if (!quiet || result.warnings.length)
        notify(
          result.warnings.length
            ? `Found ${result.games.length} games. ${result.warnings.join(" ")}`
            : `Library up to date. Found ${result.games.filter((g) => g.installed).length} installed games.`,
          result.warnings.length ? undefined : "success",
        );
    } catch (error) {
      notify(String(error), "error");
    } finally {
      scanBusyRef.current = false;
      setScanning(false);
      if (queuedScan.current !== null) {
        const fast = queuedScan.current;
        queuedScan.current = null;
        void scan(true, fast);
      }
    }
  }
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    loadLibrary()
      .then((saved) => {
        if (!cancelled) {
          libraryReady.current = true;
          gamesRef.current = saved;
          lastPersisted.current = saved;
          setGames(saved);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoaded(true);
        notify(`Could not load saved library: ${String(error)}`, "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !isDesktop) return;
    let frame: number | undefined;
    const schedule = () => {
      if (
        frame !== undefined ||
        launchSyncStarted.current ||
        document.visibilityState === "hidden"
      )
        return;
      // Let the saved library paint in the visible window before starting discovery.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (document.visibilityState === "hidden") return;
          launchSyncStarted.current = true;
          lastAutoCheck.current = Date.now();
          void native("startup_ready", {
            frontendMs: performance.now(),
            games: gamesRef.current.length,
          }).catch(() => {});
          if (libraryReady.current) void scan(true);
        });
      });
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [loaded]);
  useEffect(() => {
    if (!toast || toast.action || toast.kind === "error") return;
    const id = window.setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (document.querySelector("dialog[open]:not(.settings-dialog)"))
          return;
        e.preventDefault();
        setSettingsOpen(false);
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      } else if (
        e.key === "Escape" &&
        filterDrawerRef.current &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        closeFilters();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useLayoutEffect(() => {
    if (filtersOpen)
      filterDrawerRef.current
        ?.querySelector("input")
        ?.focus({ preventScroll: true });
  }, [filtersOpen]);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "reduce-motion",
      prefs.reduceMotion,
    );
    persist("nexus.preferences", prefs);
  }, [prefs]);

  const availablePlatforms = useMemo(() => libraryPlatforms(games), [games]);
  useEffect(() => {
    if (platform !== "all" && !availablePlatforms.includes(platform))
      setPlatform("all");
  }, [availablePlatforms, platform]);
  const filtersActive = platform !== "all" || tab !== "all" || favoritesOnly;
  const filtered = useMemo(
    () => filterGames(games, { query, platform, tab, favoritesOnly, sort }),
    [games, query, platform, tab, favoritesOnly, sort],
  );
  const groups = useMemo(
    () => groupGames(filtered, prefs.groupCopies !== false),
    [filtered, prefs.groupCopies],
  );
  const displayedGames = useMemo(() => groups.map((g) => g.game), [groups]);
  const displayedCopies = useMemo(
    () => new Map(groups.map((g) => [g.game.id, g.copies])),
    [groups],
  );
  function toggleGroupFavorite(game: Game) {
    const copies = displayedCopies.get(game.id) ?? [game];
    const ids = new Set(copies.map((g) => g.id));
    const favorite = !copies.some((g) => g.favorite);
    void updateGames((old) =>
      old.map((g) => (ids.has(g.id) ? { ...g, favorite } : g)),
    );
  }
  const previews = games.some((g) => g.id.startsWith("demo-"));
  async function play(game: Game) {
    if (launchBusy.current) return;
    if (!isDesktop) {
      setModal({ type: "game", game });
      notify(
        "Preview mode: play and install become available when running Nexus for Windows.",
      );
      return;
    }
    if (!gameAction(game).enabled) {
      const action = gameAction(game);
      if (action.repair === "sync") void scan();
      else
        setModal({
          type: action.repair === "executable" ? "edit" : "game",
          game,
        });
      return;
    }
    launchBusy.current = true;
    setLaunching(game.id);
    try {
      await saveQueue.current;
      const result = await launchGame(game.id);
      if (game.installed)
        updateGames((old) =>
          old.map((g) =>
            g.id === game.id ? { ...g, lastPlayed: Date.now() } : g,
          ),
        );
      notify(result, "success");
    } catch (error) {
      notify(String(error), "error");
    } finally {
      launchBusy.current = false;
      setLaunching(null);
    }
  }
  function toggleFavorite(game: Game) {
    updateGames((old) =>
      old.map((g) => (g.id === game.id ? { ...g, favorite: !g.favorite } : g)),
    );
  }
  function exportLibrary() {
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), games: library },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexus-library.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Library exported.");
  }

  const librarySearch = (
    <label class="search-box">
      <Icon name="search" size={17} />
      <input
        ref={searchRef}
        type="search"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder="Search games…"
        aria-label="Search games"
      />
      {query ? (
        <button
          class="clear-search"
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            searchRef.current?.focus();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      ) : (
        <kbd>Ctrl K</kbd>
      )}
    </label>
  );

  const feedback = toast && (
    <div
      class={`toast ${toast.kind || ""}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <Icon name={toast.kind === "success" ? "check" : "info"} size={20} />
      <span>{toast.message}</span>
      {toast.action && (
        <button class="toast-undo" onClick={toast.action}>
          Undo
        </button>
      )}
      <button aria-label="Dismiss message" onClick={() => setToast(null)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );

  return (
    <div class={`app-shell ${prefs.compact ? "compact" : ""}`}>
      <a class="skip-link" href="#main">
        Skip to library
      </a>
      <main id="main" class="main-content">
        <div class="library-toolbar" role="group" aria-label="Library controls">
          {librarySearch}
          {!online && (
            <span
              class="offline-indicator"
              role="status"
              aria-label="Offline"
              title="Offline"
            >
              <Icon name="globe" size={15} />
              <span>Offline</span>
            </span>
          )}
          {(scanning || metadataBusy) && (
            <span class="sr-only" role="status">
              {scanning ? "Discovering games…" : "Loading artwork…"}
            </span>
          )}
          <button
            class="button sync-button"
            aria-label={scanning ? "Syncing library" : "Sync library"}
            title={
              scanning
                ? "Syncing library"
                : metadataBusy
                  ? "Loading artwork…"
                  : "Sync library"
            }
            onClick={() => void scan()}
            disabled={!loaded || scanning}
          >
            <Icon
              name="sync"
              size={16}
              className={scanning || metadataBusy ? "spinning" : ""}
            />
            <span>{scanning ? "Syncing…" : "Sync library"}</span>
          </button>
          <div class="library-view-options">
            <label class="sort-select">
              <span class="sr-only">Sort games</span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.currentTarget.value as Sort);
                  persist("nexus.sort", e.currentTarget.value);
                }}
              >
                <option value="name">Name: A–Z</option>
                <option value="playtime">Most played</option>
                <option value="platform">Platform</option>
              </select>
              <Icon name="chevron" size={13} />
            </label>
            <div class="view-switch" aria-label="Library layout">
              <button
                class={layout === "grid" ? "active" : ""}
                aria-label="Grid view"
                aria-pressed={layout === "grid"}
                onClick={() => {
                  setLayout("grid");
                  persist("nexus.layout", "grid");
                }}
              >
                <Icon name="grid" size={16} />
              </button>
              <button
                class={layout === "list" ? "active" : ""}
                aria-label="List view"
                aria-pressed={layout === "list"}
                onClick={() => {
                  setLayout("list");
                  persist("nexus.layout", "list");
                }}
              >
                <Icon name="list" size={17} />
              </button>
            </div>
            <button
              ref={filtersToggleRef}
              class={`button secondary filter-button ${filtersOpen || filtersActive ? "is-active" : ""}`}
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-label="Filter library"
              aria-expanded={filtersOpen}
              aria-controls={filtersOpen ? "library-filters" : undefined}
            >
              <Icon name="filter" size={17} />
              Filters
            </button>
          </div>
          <button
            class="icon-button add-game-button"
            aria-label="Add game"
            aria-haspopup="dialog"
            title="Add a game"
            onClick={() => {
              setFiltersOpen(false);
              setModal({ type: "add" });
            }}
          >
            <Icon name="plus" size={20} />
          </button>
          <button
            class="icon-button settings-button"
            aria-label="Settings"
            aria-haspopup="dialog"
            title="Settings"
            onClick={() => {
              setFiltersOpen(false);
              setSettingsTab("general");
              setSettingsOpen(true);
            }}
          >
            <Icon name="settings" size={19} />
          </button>
        </div>

        {syncIssues.length > 0 && (
          <div class="sync-issues" role="status">
            <Icon name="info" size={17} />
            <div>
              <strong>Some sources need attention</strong>
              <span>{syncIssues.join(" ")}</span>
            </div>
            <button
              class="icon-button"
              aria-label="Dismiss sync notice"
              onClick={() => setSyncIssues([])}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        <div class={filtersOpen ? "library-body with-filters" : "library-body"}>
          <section class="collection" aria-label="Game collection">
            {filtersActive && (
              <div class="library-active-filters">
                {platform !== "all" && (
                  <div class="active-filter">
                    <Brand
                      platform={
                        platforms.includes(platform as Platform)
                          ? (platform as Platform)
                          : "Emulator"
                      }
                    />
                    {platform}
                    <button
                      aria-label="Clear platform filter"
                      onClick={() => setPlatform("all")}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                )}
                {favoritesOnly && (
                  <div class="active-filter">
                    <Icon name="star" size={14} /> Favorites
                    <button
                      aria-label="Clear favorites filter"
                      onClick={() => setFavoritesOnly(false)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                )}
                {tab !== "all" && (
                  <div class="active-filter">
                    {tab === "installed" ? "Installed" : "Not installed"}
                    <button
                      aria-label="Clear availability filter"
                      onClick={() => setTab("all")}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {loaded && !query.trim() && !filtersActive && (
              <FeaturedGames
                groups={groups}
                launching={launching}
                onPlay={(game) => void play(game)}
                onDetails={(game) => setModal({ type: "game", game })}
                onFavorite={toggleGroupFavorite}
              />
            )}
            {!loaded || (scanning && !games.length) ? (
              <div class="empty-state">
                <Icon name="sync" className="spinning" size={30} />
                <h3>
                  {loaded ? "Discovering games…" : "Loading your library…"}
                </h3>
              </div>
            ) : filtered.length ? (
              <GameViewport
                games={displayedGames}
                layout={layout}
                compact={prefs.compact}
              >
                {(game, index) => {
                  const copies = displayedCopies.get(game.id) ?? [game];
                  const cardFavorite = copies.some((g) => g.favorite);
                  const action = gameAction(game);
                  return (
                    <article
                      class={`game-card ${game.installed ? "installed" : ""}`}
                      key={game.id}
                    >
                      <div class="cover-wrap">
                        <button
                          class="cover-button"
                          onClick={() => setModal({ type: "game", game })}
                          aria-label={`View ${game.name}`}
                        >
                          <GameCover game={game} eager={index < 6} />
                        </button>
                        <button
                          class={`card-favorite ${cardFavorite ? "favorited" : ""}`}
                          aria-label={`${cardFavorite ? "Unfavorite" : "Favorite"} ${game.name}`}
                          aria-pressed={cardFavorite}
                          title={
                            cardFavorite ? "Remove favorite" : "Add favorite"
                          }
                          onClick={() => toggleGroupFavorite(game)}
                        >
                          <Icon name="star" size={15} fill={cardFavorite} />
                        </button>
                        {copies.length > 1 && (
                          <span class="copies-badge">
                            <Icon name="layers" size={12} />
                            {copies.length} copies
                          </span>
                        )}
                        {!game.installed && (
                          <span class="not-installed-badge">
                            <Icon name="download" size={11} /> Not installed
                          </span>
                        )}
                        <button
                          class="quick-play"
                          onClick={() => play(game)}
                          aria-label={`${action.enabled ? (game.installed ? "Play" : "Install") : game.installed ? action.label : "View install options for"} ${game.name}`}
                          disabled={launching === game.id}
                        >
                          <Icon
                            name={
                              action.enabled
                                ? game.installed
                                  ? "play"
                                  : "download"
                                : "more"
                            }
                            size={18}
                            fill={game.installed}
                          />
                          <span>
                            {launching === game.id
                              ? "Opening…"
                              : action.enabled
                                ? action.label
                                : game.installed
                                  ? action.label
                                  : "View install options"}
                          </span>
                        </button>
                      </div>
                      <div class="game-info">
                        <button
                          class="game-title"
                          title={game.name}
                          onClick={() => setModal({ type: "game", game })}
                        >
                          {game.name}
                        </button>
                        <div class="game-subtitle">
                          <Brand platform={game.platform} size={13} />
                          <span>{libraryPlatform(game)}</span>
                          <span
                            class={`game-status ${game.installed ? "available" : ""}`}
                          >
                            {game.installed ? (
                              <>
                                <span class="status-dot" />
                                Installed
                              </>
                            ) : (
                              "Not installed"
                            )}
                          </span>
                        </div>
                      </div>
                      <div class="list-extra">
                        <span>
                          {game.genre || bundledArtwork(game)?.genre || "Game"}
                        </span>
                        <span>
                          {game.playtime ? `${game.playtime} hrs` : "—"}
                        </span>
                        <button
                          class="button secondary"
                          disabled={launching === game.id}
                          title={action.reason}
                          onClick={() => play(game)}
                        >
                          <Icon
                            name={game.installed ? "play" : "download"}
                            size={15}
                          />
                          {launching === game.id
                            ? "Opening…"
                            : action.enabled
                              ? game.installed
                                ? "Play"
                                : "Install"
                              : game.installed
                                ? action.label
                                : "View options"}
                        </button>
                      </div>
                    </article>
                  );
                }}
              </GameViewport>
            ) : (
              <div class="empty-state">
                <div class="empty-icon">
                  <Icon
                    name={query ? "search" : favoritesOnly ? "star" : "gamepad"}
                    size={30}
                  />
                </div>
                <h3>
                  {query
                    ? "No games found."
                    : favoritesOnly
                      ? "No matching favorites"
                      : filtersActive
                        ? "No games in this view."
                        : "Your library is empty"}
                </h3>
                <p>
                  {query
                    ? `No matches for “${query}”. Try a different title or platform.`
                    : filtersActive
                      ? "Try changing your filters."
                      : "Steam and Epic installations appear automatically."}
                </p>
                <button
                  class="button secondary"
                  onClick={() => {
                    if (query || filtersActive) {
                      setQuery("");
                      resetFilters();
                    } else setModal({ type: "add" });
                  }}
                >
                  {query || filtersActive ? "Clear filters" : "Add a game"}
                </button>
                {isDesktop && !games.length && (
                  <button
                    class="text-button explore-preview"
                    onClick={() => {
                      window.location.search = "?preview";
                    }}
                  >
                    Explore the sample library
                    <Icon name="right" size={13} />
                  </button>
                )}
              </div>
            )}
          </section>
          {filtersOpen && (
            <LibraryFilterPanel
              panelRef={filterDrawerRef}
              availability={tab}
              platform={platform}
              availablePlatforms={availablePlatforms}
              favoritesOnly={favoritesOnly}
              canReset={filtersActive || Boolean(query.trim())}
              onAvailabilityChange={setTab}
              onPlatformChange={setPlatform}
              onFavoritesChange={setFavoritesOnly}
              onReset={() => {
                setQuery("");
                resetFilters();
                searchRef.current?.focus({ preventScroll: true });
              }}
              onClose={closeFilters}
            />
          )}
        </div>
        {(previews || (isNativeShell && !isDesktop)) && (
          <div class="preview-switch">
            {previews && <span class="preview-label">Sample library</span>}
            {isNativeShell && !isDesktop && (
              <button
                class="text-button"
                onClick={() => {
                  window.location.search = "";
                }}
              >
                Return to your real library <Icon name="right" size={12} />
              </button>
            )}
          </div>
        )}
      </main>
      {settingsOpen && (
        <Modal
          title="Settings"
          className="settings-dialog"
          onClose={() => setSettingsOpen(false)}
        >
          <div class="settings-content">
            <div
              class="library-tabs settings-tabs"
              role="tablist"
              aria-label="Settings sections"
              onKeyDown={navigateTabs}
            >
              {(
                [
                  ["general", "General"],
                  ["sources", "Game sources"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  id={`settings-${value}-tab`}
                  class={settingsTab === value ? "active" : ""}
                  role="tab"
                  aria-selected={settingsTab === value}
                  aria-controls={`settings-${value}`}
                  tabIndex={settingsTab === value ? 0 : -1}
                  onClick={() => setSettingsTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              id="settings-general"
              role="tabpanel"
              aria-labelledby="settings-general-tab"
              hidden={settingsTab !== "general"}
            >
              <div class="settings-general">
                <div class="settings-section">
                  <h3>Profile & appearance</h3>
                  <div class="setting-row">
                    <div>
                      <strong>Player name</strong>
                    </div>
                    <input
                      class="text-input name-input"
                      maxLength={24}
                      value={prefs.playerName}
                      onInput={(e) =>
                        setPrefs({
                          ...prefs,
                          playerName: e.currentTarget.value,
                        })
                      }
                      onBlur={() => {
                        if (!prefs.playerName.trim())
                          setPrefs({ ...prefs, playerName: "Player" });
                      }}
                      aria-label="Player name"
                    />
                  </div>
                  <SettingToggle
                    label="Compact covers"
                    description="Fit more of your collection on screen."
                    checked={prefs.compact}
                    onChange={() =>
                      setPrefs({ ...prefs, compact: !prefs.compact })
                    }
                  />
                  <SettingToggle
                    label="Reduce motion"
                    description="Keep transitions to a minimum."
                    checked={prefs.reduceMotion}
                    onChange={() =>
                      setPrefs({
                        ...prefs,
                        reduceMotion: !prefs.reduceMotion,
                      })
                    }
                  />
                  <div class="setting-row">
                    <div>
                      <strong>Keyboard shortcuts</strong>
                      <p>Ctrl+K focuses Library search.</p>
                    </div>
                  </div>
                </div>
                <div class="settings-section">
                  <h3>Library & data</h3>
                  <SettingToggle
                    label="Group duplicate games"
                    description="Show one card for matching titles across stores. Choose a copy in game details."
                    checked={prefs.groupCopies !== false}
                    onChange={() =>
                      setPrefs({
                        ...prefs,
                        groupCopies: prefs.groupCopies === false,
                      })
                    }
                  />
                  {hiddenIds.length > 0 && (
                    <div class="setting-row">
                      <div>
                        <strong>Hidden games</strong>
                        <p>
                          {hiddenIds.length} games are hidden from your
                          collection.
                        </p>
                      </div>
                      <button
                        class="button secondary small"
                        onClick={() => {
                          setHiddenIds([]);
                          persist("nexus.hiddenGames", []);
                          notify("Hidden games restored.", "success");
                        }}
                      >
                        <Icon name="undo" size={14} />
                        Restore hidden games
                      </button>
                    </div>
                  )}
                  {isDesktop && (
                    <div class="setting-row">
                      <div>
                        <strong>Game artwork</strong>
                        <p>
                          Refresh official Steam and Epic covers. Custom details
                          are preserved.
                        </p>
                      </div>
                      <button
                        class="button secondary small"
                        onClick={() => enrich(true)}
                        disabled={metadataBusy}
                      >
                        <Icon name="image" size={14} />
                        {metadataBusy ? "Refreshing…" : "Refresh artwork"}
                      </button>
                    </div>
                  )}
                  <div class="setting-row">
                    <div>
                      <strong>Library backup</strong>
                      <p>Save a copy of your library and custom details.</p>
                    </div>
                    <div class="setting-actions">
                      <button
                        class="button secondary small"
                        onClick={exportLibrary}
                      >
                        Export library
                        <Icon name="external" size={13} />
                      </button>
                    </div>
                  </div>
                  <div class="setting-row">
                    <div>
                      <strong>Local discovery</strong>
                      <p>
                        {lastSync
                          ? `Last synced ${new Date(lastSync).toLocaleString()}`
                          : "Scan your installed launchers and game manifests."}
                      </p>
                    </div>
                    <button
                      class="button secondary small"
                      onClick={() => void scan()}
                      disabled={!loaded || scanning}
                    >
                      <Icon
                        name="sync"
                        size={14}
                        className={scanning ? "spinning" : ""}
                      />
                      {scanning ? "Syncing…" : "Sync now"}
                    </button>
                  </div>
                  {!isDesktop && (
                    <div class="setting-row">
                      <div>
                        <strong>Preview collection</strong>
                        <p>
                          Restore the sample library and its original favorites.
                        </p>
                      </div>
                      <button
                        class="button secondary small"
                        onClick={() => {
                          updateGames(demoGames);
                          notify("Sample library restored.", "success");
                        }}
                      >
                        Restore preview
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div class="about-strip">
                <img src="/nexus.svg" alt="" />
                <div>
                  <strong>
                    Nexus <span>{APP_VERSION}</span>
                  </strong>
                  <p>Windows game library</p>
                </div>
                <button
                  class="text-button"
                  onClick={() => setModal({ type: "about" })}
                >
                  About Nexus
                  <Icon name="right" size={14} />
                </button>
              </div>
            </div>
            <div
              id="settings-sources"
              role="tabpanel"
              aria-labelledby="settings-sources-tab"
              hidden={settingsTab !== "sources"}
            >
              {settingsTab === "sources" && (
                <>
                  <div class="sources-settings-toolbar">
                    <p>Games sync automatically from your local launchers.</p>
                    <button
                      class="button sync-button"
                      onClick={() => void scan()}
                      disabled={!loaded || scanning}
                    >
                      <Icon
                        name="sync"
                        size={16}
                        className={scanning ? "spinning" : ""}
                      />
                      {scanning ? "Syncing…" : "Sync all platforms"}
                    </button>
                  </div>
                  <SourcesPanel
                    games={games}
                    sources={sources}
                    onView={viewSource}
                  />
                  <FolderSources
                    onScan={() => void scan()}
                    onError={(message) => notify(message, "error")}
                  />
                </>
              )}
            </div>
          </div>
          {feedback}
        </Modal>
      )}
      {!settingsOpen && feedback}
      {modal?.type === "game" && (
        <GameDetails
          game={games.find((g) => g.id === modal.game.id) || modal.game}
          copies={games.filter(
            (g) => duplicateKey(g) === duplicateKey(modal.game),
          )}
          onSelectCopy={(game) => setModal({ type: "game", game })}
          desktop={isDesktop}
          launching={launching === modal.game.id}
          onClose={() => setModal(null)}
          onPlay={() =>
            play(games.find((g) => g.id === modal.game.id) || modal.game)
          }
          onFavorite={() =>
            toggleFavorite(
              games.find((g) => g.id === modal.game.id) || modal.game,
            )
          }
          onEdit={() =>
            setModal({
              type: "edit",
              game: games.find((g) => g.id === modal.game.id) || modal.game,
            })
          }
          onHide={() => hideGame(modal.game)}
          onSync={() => {
            setModal(null);
            void scan();
          }}
          onRefresh={() => {
            void enrich(true, [modal.game.id]);
          }}
          onReveal={() => {
            void native("reveal_game_folder", { id: modal.game.id }).catch(
              (e) => notify(String(e), "error"),
            );
          }}
        />
      )}
      {modal?.type === "edit" && (
        <GameEditor
          game={modal.game}
          onClose={() => setModal({ type: "game", game: modal.game })}
          onSave={async (game) => {
            await updateGames((old) =>
              old.map((g) => (g.id === game.id ? game : g)),
            );
            setModal({ type: "game", game });
            notify("Game details saved.", "success");
          }}
        />
      )}
      {modal?.type === "add" && (
        <AddGameModal
          initialEmulator={modal.emulator}
          onClose={() => setModal(null)}
          onAdd={async (game) => {
            if (isDesktop) await native("validate_manual_game", { game });
            await updateGames((old) => [...old, game]);
            setModal(null);
            notify(`${game.name} added to your library.`, "success");
          }}
          notify={notify}
        />
      )}
      {modal?.type === "about" && (
        <Modal title="About Nexus" onClose={() => setModal(null)}>
          <div class="about-content">
            <img src="/nexus.svg" alt="Nexus" />
            <h3>Nexus</h3>
            <p>
              Nexus is a local-first Windows game library built with Rust,
              Tauri, and Preact. No telemetry or persistent background service.
              No account required for local discovery.
            </p>
            <p>
              Game artwork in the preview belongs to its respective publishers.
              Nexus is an independent project and is not affiliated with the
              platforms shown.
            </p>
            <span class="muted-text">Version {APP_VERSION} · Windows</span>
            <button
              class="text-button credits-button"
              onClick={() => setModal({ type: "credits" })}
            >
              Credits & licenses
              <Icon name="right" size={13} />
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "credits" && (
        <CreditsModal onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div class="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        class={`toggle ${checked ? "on" : ""}`}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

function AddGameModal({
  onClose,
  onAdd,
  notify,
  initialEmulator = false,
}: {
  onClose: () => void;
  onAdd: (game: Game) => Promise<void>;
  notify: (message: string, kind?: "error" | "success") => void;
  initialEmulator?: boolean;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [rom, setRom] = useState("");
  const [emulator, setEmulator] = useState(initialEmulator);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function browse(isRom = false) {
    try {
      const value = await native<string | null>("pick_file", {
        kind: isRom ? "rom" : "executable",
      });
      if (value) {
        if (isRom) setRom(value);
        else {
          setPath(value);
          if (!name)
            setName(
              value
                .split(/[\\/]/)
                .pop()
                ?.replace(/\.exe$/i, "") || "",
            );
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal
      title={emulator ? "Add an emulated game" : "Add a game"}
      onClose={onClose}
      busy={busy}
    >
      <p class="modal-intro">
        Choose a Windows executable or an emulator and game file.
      </p>
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            if (!name.trim() || !/\.exe$/i.test(path.trim()))
              throw new Error("Enter a name and a Windows .exe path.");
            if (emulator && !rom.trim())
              throw new Error("Choose a ROM for your emulator.");
            await onAdd({
              id: `manual-${crypto.randomUUID()}`,
              name: name.trim(),
              platform: emulator ? "Emulator" : "Standalone",
              installed: true,
              favorite: false,
              executable: path.trim(),
              arguments: emulator ? [rom.trim()] : [],
              genre: emulator ? "Emulated game" : "Standalone game",
            });
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Game name
          <input
            class="text-input"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Game title"
            required
            maxLength={200}
          />
        </label>
        <label>
          {emulator ? "Emulator executable" : "Game executable"}
          <div class="file-input">
            <input
              class="text-input"
              value={path}
              onInput={(e) => setPath(e.currentTarget.value)}
              placeholder="C:\Games\My Game\game.exe"
              required
            />
            <button
              type="button"
              class="button secondary"
              onClick={() => browse()}
              aria-label="Browse executable"
            >
              <Icon name="folder" size={18} />
            </button>
          </div>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={emulator}
            onChange={(e) => setEmulator(e.currentTarget.checked)}
          />
          This is an emulated game
        </label>
        {emulator && (
          <label>
            ROM or disc image
            <div class="file-input">
              <input
                class="text-input"
                value={rom}
                onInput={(e) => setRom(e.currentTarget.value)}
                placeholder="C:\Games\ROMs\game.iso"
                required
              />
              <button
                type="button"
                class="button secondary"
                onClick={() => browse(true)}
                aria-label="Browse ROM"
              >
                <Icon name="folder" size={18} />
              </button>
            </div>
          </label>
        )}
        {!isDesktop && (
          <p class="inline-note">
            In browser preview, paths are saved for demonstration. File browsing
            and launching require the Windows app.
          </p>
        )}
        {error && (
          <div class="form-error" role="alert">
            <Icon name="info" size={16} />
            {error}
          </div>
        )}
        <div class="form-actions">
          <button
            class="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button class="button primary" type="submit" disabled={busy}>
            <Icon name="plus" size={17} />
            {busy ? "Adding…" : "Add to library"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
