import type { Game } from "./types";

const keys = new WeakMap<Game, string>();
/** Preserve edition, sequel, and remaster words to avoid destructive near matches. */
export function duplicateKey(game: Game): string {
  let value = keys.get(game);
  if (value === undefined) {
    value = game.name
      .replace(/[®™]/g, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f®™]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (game.platform === "Emulator")
      value += `|${game.system ?? game.executable ?? game.id}`;
    keys.set(game, value);
  }
  return value;
}
export interface GameGroup {
  game: Game;
  copies: Game[];
}
export function groupGames(games: Game[], enabled = true): GameGroup[] {
  if (!enabled) return games.map((game) => ({ game, copies: [game] }));
  const grouped = new Map<string, GameGroup>();
  for (const game of games) {
    const key = duplicateKey(game);
    let group = grouped.get(key);
    // Multiple editions from the same store remain separate entries.
    if (group?.copies.some((copy) => copy.platform === game.platform)) {
      grouped.set(`${key}|${game.id}`, { game, copies: [game] });
      continue;
    }
    if (!group) {
      group = { game, copies: [] };
      grouped.set(key, group);
    }
    group.copies.push(game);
    if (
      (game.installed && !group.game.installed) ||
      (game.installed === group.game.installed &&
        (game.lastPlayed ?? 0) > (group.game.lastPlayed ?? 0))
    )
      group.game = game;
  }
  return [...grouped.values()];
}
