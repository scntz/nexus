import type { Game } from "./types";
export interface MetadataPatch {
  id: string;
  cover?: string;
  hero?: string;
  description?: string;
  genre?: string;
}
export function artworkOutcome(
  games: Game[],
  patches: MetadataPatch[],
  ids: string[] = [],
) {
  const candidates = games.filter(
    (g) =>
      (!g.customized || ids.includes(g.id)) &&
      ["Steam", "Epic Games"].includes(g.platform) &&
      (!ids.length || ids.includes(g.id)),
  );
  const found = new Set(
    patches.filter((p) => p.cover || p.hero).map((p) => p.id),
  );
  const updated = candidates.filter((g) => found.has(g.id)).length;
  return { updated, missing: candidates.length - updated };
}
export function isArtworkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/^\/art\/(catalog\/)?[a-z0-9-]+\.(jpg|png|webp)$/i.test(value))
    return true;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
    return value.length <= 2_800_000;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "shared.steamstatic.com",
        "shared.cloudflare.steamstatic.com",
        "shared.fastly.steamstatic.com",
        "cdn.cloudflare.steamstatic.com",
        "cdn.akamai.steamstatic.com",
        "cdn1.epicgames.com",
        "cdn2.unrealengine.com",
        "cdn2.epicgames.com",
        "images.gog-statics.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
/** Desktop covers are served by the bounded native disk cache; previews stay portable. */
export function artworkSource(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("https:") || !isArtworkUrl(url)) return url;
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window))
    return url;
  return `http://nexus-art.localhost/image?url=${encodeURIComponent(url)}`;
}

/** Verify a new image before replacing artwork the player chose manually. */
export function verifyArtwork(
  url: string | undefined,
): Promise<string | undefined> {
  if (!isArtworkUrl(url)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (result?: string) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const timeout = window.setTimeout(finish, 8000);
    image.onload = () => finish(image.naturalWidth > 0 ? url : undefined);
    image.onerror = () => finish();
    image.src = artworkSource(url)!;
  });
}
export function applyMetadata(
  games: Game[],
  patches: MetadataPatch[],
  replaceArtworkFor: readonly string[] = [],
): Game[] {
  const byId = new Map(patches.map((p) => [p.id, p]));
  const replaceArtwork = new Set(replaceArtworkFor);
  let changed = false;
  const next = games.map((game) => {
    const patch = byId.get(game.id);
    if (!patch || (game.customized && !replaceArtwork.has(game.id)))
      return game;
    const cover = isArtworkUrl(patch.cover) ? patch.cover : game.cover;
    const hero = isArtworkUrl(patch.hero) ? patch.hero : game.hero;
    const description = game.customized
      ? game.description
      : patch.description || game.description;
    const genre = game.customized ? game.genre : patch.genre || game.genre;
    if (
      cover === game.cover &&
      hero === game.hero &&
      description === game.description &&
      genre === game.genre
    )
      return game;
    changed = true;
    return {
      ...game,
      cover,
      hero,
      description,
      genre,
    };
  });
  return changed ? next : games;
}
export async function readArtworkFile(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error("Choose an image under 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp)
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () =>
      resolve(
        String(reader.result).replace(
          /^data:[^;]+;/,
          `data:image/${png ? "png" : jpeg ? "jpeg" : "webp"};`,
        ),
      );
    reader.readAsDataURL(file);
  });
}
