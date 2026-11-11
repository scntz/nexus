import type { Discovery, Game } from "./types";
import { isArtworkUrl } from "./artwork";

export const isNativeShell =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isDesktop =
  isNativeShell && !new URLSearchParams(window.location.search).has("preview");
export async function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktop)
    throw new Error(
      "This feature needs the Nexus Windows app. The browser preview cannot access your computer or launch games.",
    );
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
export const scanLibrary = (fast = false) =>
  native<Discovery>("discover_games", { fast });
export const loadLibrary = () => native<Game[]>("load_library");
export const saveLibrary = (games: Game[]) =>
  native<void>("save_library", { games });
export const launchGame = (id: string) => native<string>("launch_game", { id });

export function parseImport(value: unknown): Game[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "games" in value
      ? (value as { games: unknown }).games
      : null;
  if (!Array.isArray(items) || items.length > 50_000)
    throw new Error(
      "Choose a Nexus JSON export with a games array (up to 50,000 games).",
    );
  const seen = new Set<string>();
  return items.map((item, index) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      !item.name.trim()
    )
      throw new Error(`Game ${index + 1} needs a name.`);
    const platforms = [
      "Steam",
      "Epic Games",
      "Xbox",
      "GOG",
      "EA",
      "Ubisoft",
      "Battle.net",
      "Standalone",
      "Emulator",
    ];
    if (!platforms.includes(item.platform))
      throw new Error(`Unsupported platform for “${item.name}”.`);
    const appId =
      typeof item.appId === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(item.appId)
        ? item.appId
        : undefined;
    const preservedId =
      typeof item.id === "string" &&
      /^(manual-[a-f0-9-]{36}|folder-[a-f0-9]{16})$/.test(item.id)
        ? item.id
        : undefined;
    const id =
      preservedId ||
      `${item.platform.toLowerCase().replace(/[^a-z]/g, "")}-${appId || `import-${index}-${item.name}`}`;
    if (seen.has(id)) throw new Error(`Duplicate game: ${item.name}.`);
    seen.add(id);
    return {
      id,
      name: item.name.trim().slice(0, 200),
      platform: item.platform,
      catalogNamespace:
        item.platform === "Epic Games" &&
        typeof item.catalogNamespace === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(item.catalogNamespace)
          ? item.catalogNamespace
          : undefined,
      catalogItemId:
        item.platform === "Epic Games" &&
        typeof item.catalogItemId === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(item.catalogItemId)
          ? item.catalogItemId
          : undefined,
      system:
        item.platform === "Emulator" &&
        typeof item.system === "string" &&
        item.system.trim().length <= 80
          ? item.system.trim() || undefined
          : undefined,
      appId,
      installed: false,
      favorite: item.favorite === true,
      genre:
        typeof item.genre === "string" ? item.genre.slice(0, 100) : undefined,
      playtime:
        typeof item.playtime === "number" &&
        Number.isFinite(item.playtime) &&
        item.playtime >= 0
          ? item.playtime
          : undefined,
      lastPlayed:
        typeof item.lastPlayed === "number" &&
        Number.isSafeInteger(item.lastPlayed) &&
        item.lastPlayed > 0 &&
        item.lastPlayed <= Date.now()
          ? item.lastPlayed
          : undefined,
      cover: isArtworkUrl(item.cover)
        ? item.cover
        : appId && item.platform === "Steam"
          ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`
          : undefined,
      hero: isArtworkUrl(item.hero) ? item.hero : undefined,
      customized: item.customized === true,
      description:
        typeof item.description === "string"
          ? item.description.slice(0, 1500)
          : undefined,
      installUri:
        item.platform === "Steam" && appId && /^\d+$/.test(appId)
          ? `steam://install/${appId}`
          : undefined,
      launchUri:
        item.platform === "Steam" && appId && /^\d+$/.test(appId)
          ? `steam://rungameid/${appId}`
          : undefined,
    } as Game;
  });
}
