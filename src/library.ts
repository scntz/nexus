import type { Game, Platform } from "./types";
import { libraryPlatform } from "./platforms";

export type Sort = "name" | "playtime" | "platform";
export type Availability = "all" | "installed" | "uninstalled";
const searchIndex = new WeakMap<Game, string>();
const sortedIndexes = new WeakMap<Game[], Map<Sort, Game[]>>();
type LibraryFilters = {
  platform: string;
  tab: Availability;
  favoritesOnly?: boolean;
  sort: Sort;
};
const lastScope = new WeakMap<
  Game[],
  { filters: LibraryFilters; games: Game[] }
>();
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
function sortedGames(games: Game[], sort: Sort): Game[] {
  let indexes = sortedIndexes.get(games);
  if (!indexes) {
    indexes = new Map();
    sortedIndexes.set(games, indexes);
  }
  let sorted = indexes.get(sort);
  if (!sorted) {
    sorted = [...games].sort((a, b) =>
      sort === "name"
        ? collator.compare(a.name, b.name)
        : sort === "playtime"
          ? (b.playtime ?? 0) - (a.playtime ?? 0)
          : collator.compare(a.platform, b.platform) ||
            collator.compare(a.name, b.name),
    );
    indexes.set(sort, sorted);
  }
  return sorted;
}
function normalizeSearch(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  return value
    .replace(/[®™]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\p{M}'’]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function searchable(game: Game): string {
  let text = searchIndex.get(game);
  if (text === undefined) {
    text = normalizeSearch(
      `${game.name} ${libraryPlatform(game)} ${game.genre ?? ""}`,
    );
    searchIndex.set(game, text);
  }
  return text;
}

function scopedGames(games: Game[], filters: LibraryFilters): Game[] {
  const { platform, tab, favoritesOnly = false, sort } = filters;
  const sorted = sortedGames(games, sort);
  const installed =
    tab === "installed" ? true : tab === "uninstalled" ? false : undefined;
  if (platform === "all" && installed === undefined && !favoritesOnly)
    return sorted;

  const cached = lastScope.get(games);
  if (
    cached?.filters.platform === platform &&
    cached.filters.tab === tab &&
    cached.filters.favoritesOnly === favoritesOnly &&
    cached.filters.sort === sort
  )
    return cached.games;

  const scoped = sorted.filter(
    (game) =>
      (installed === undefined || game.installed === installed) &&
      (!favoritesOnly || game.favorite) &&
      (platform === "all" || libraryPlatform(game) === platform),
  );
  lastScope.set(games, {
    filters: { platform, tab, favoritesOnly, sort },
    games: scoped,
  });
  return scoped;
}

export function filterGames(
  games: Game[],
  options: LibraryFilters & { query: string },
): Game[] {
  const candidates = scopedGames(games, options);
  const query = normalizeSearch(options.query);
  if (!query) return candidates;
  if (!query.includes(" "))
    return candidates.filter((game) => searchable(game).includes(query));

  // Match a numbered title from the start of its number so "Game 499"
  // does not include "Game 04990" when matching words out of order.
  const words = query.split(" ").map((word) => ({
    word,
    numberPrefix: /^\d/.test(word) ? ` ${word}` : "",
  }));
  return candidates.filter((game) => {
    const text = searchable(game);
    return words.every(({ word, numberPrefix }) =>
      numberPrefix
        ? text.startsWith(word) || text.includes(numberPrefix)
        : text.includes(word),
    );
  });
}

function preserveUnchangedGame(next: Game, previous?: Game): Game {
  if (!previous) return next;
  for (const key of Object.keys(next) as (keyof Game)[]) {
    if (next[key] === previous[key]) continue;
    if (
      key !== "arguments" ||
      next.arguments?.length !== previous.arguments?.length ||
      !next.arguments?.every(
        (arg, index) => arg === previous.arguments?.[index],
      )
    )
      return next;
  }
  for (const key of Object.keys(previous) as (keyof Game)[]) {
    if (previous[key] !== undefined && next[key] === undefined) return next;
  }
  return previous;
}

export function mergeGames(
  existing: Game[],
  discovered: Game[],
  failedPlatforms: Platform[] = [],
  scannedPlatforms?: Platform[],
): Game[] {
  const old = new Map(existing.map((g) => [g.id, g]));
  const ids = new Set(discovered.map((g) => g.id));
  const merged = discovered.map((game) => {
    const previous = old.get(game.id);
    const customized = previous?.customized;
    return preserveUnchangedGame(
      {
        ...game,
        discoverySource: game.discoverySource ?? "local",
        name: customized ? previous.name : game.name,
        cover: customized ? previous.cover : (game.cover ?? previous?.cover),
        hero: customized ? previous.hero : (game.hero ?? previous?.hero),
        description: customized
          ? previous.description
          : (game.description ?? previous?.description),
        genre: customized ? previous.genre : (game.genre ?? previous?.genre),
        executable:
          customized && previous.executable
            ? previous.executable
            : (game.executable ?? previous?.executable),
        customized,
        favorite: previous?.favorite ?? game.favorite,
        lastPlayed: previous?.lastPlayed ?? game.lastPlayed,
        playtime: previous?.playtime ?? game.playtime,
      },
      previous,
    );
  });
  for (const game of existing) {
    if (ids.has(game.id)) continue;
    const unavailable =
      failedPlatforms.includes(game.platform) ||
      (scannedPlatforms && !scannedPlatforms.includes(game.platform));
    if (game.id.startsWith("manual-")) {
      merged.push(
        game.discoverySource === "manual"
          ? game
          : { ...game, discoverySource: "manual" },
      );
    } else if (unavailable) {
      merged.push(game);
    } else {
      const discoverySource =
        game.discoverySource === "local" || game.discoverySource === "history"
          ? "history"
          : "saved";
      merged.push(
        !game.installed && game.discoverySource === discoverySource
          ? game
          : { ...game, discoverySource, installed: false },
      );
    }
  }
  return merged.length === existing.length &&
    merged.every((game, index) => game === existing[index])
    ? existing
    : merged;
}
/** An import is additive; only local discovery may invalidate an installation. */
export function mergeImportedGames(existing: Game[], imported: Game[]): Game[] {
  const result = new Map(existing.map((g) => [g.id, g]));
  for (const game of imported) {
    const previous = result.get(game.id);
    result.set(
      game.id,
      previous
        ? {
            ...game,
            ...previous,
            cover: previous.customized
              ? previous.cover
              : (game.cover ?? previous.cover),
            hero: previous.customized
              ? previous.hero
              : (game.hero ?? previous.hero),
            description: previous.customized
              ? previous.description
              : (game.description ?? previous.description),
            genre: previous.customized
              ? previous.genre
              : (game.genre ?? previous.genre),
            playtime: game.playtime ?? previous.playtime,
            lastPlayed:
              Math.max(game.lastPlayed ?? 0, previous.lastPlayed ?? 0) ||
              undefined,
          }
        : game,
    );
  }
  return [...result.values()];
}
export function relativeTime(time?: number): string {
  if (!time) return "Not played yet";
  const hours = Math.max(0, (Date.now() - time) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return `${Math.floor(hours / 24)}d ago`;
}
export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    if (parsed === null) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (
      fallback &&
      typeof fallback === "object" &&
      !Array.isArray(fallback) &&
      (typeof parsed !== "object" || Array.isArray(parsed))
    )
      return fallback;
    if (
      fallback !== null &&
      typeof fallback !== "object" &&
      typeof parsed !== typeof fallback
    )
      return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}
export function persist(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
