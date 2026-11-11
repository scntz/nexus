import type { Game } from "./types";
export function gameAction(game: Game): {
  label: string;
  enabled: boolean;
  reason?: string;
  repair?: "executable" | "sync";
} {
  if (game.installed) {
    if (
      game.executable ||
      game.launchUri ||
      (game.platform === "Steam" && /^\d+$/.test(game.appId || ""))
    )
      return { label: "Play now", enabled: true };
    if (
      !["Standalone", "Emulator", "GOG", "EA", "Battle.net"].includes(
        game.platform,
      )
    )
      return {
        label: "Sync library",
        enabled: false,
        repair: "sync",
        reason:
          "Sync your library to restore this game's launcher information.",
      };
    return {
      label: "Set up launch",
      enabled: false,
      repair: "executable",
      reason: "Choose the game executable in Edit details to enable play.",
    };
  }
  if (game.platform === "Steam" && /^\d+$/.test(game.appId || ""))
    return { label: "Install game", enabled: true };
  if (game.platform === "Epic Games" && /^[a-zA-Z0-9_-]{1,128}$/.test(game.appId || ""))
    return { label: "Install game", enabled: true };
  if (game.platform === "GOG" && /^\d+$/.test(game.appId || ""))
    return { label: "Open in GOG", enabled: true };
  return {
    label: "Install in launcher",
    enabled: false,
    reason: `Install this game in ${game.platform}, then sync your library.`,
  };
}
export function greeting(hour = new Date().getHours()): string {
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}
