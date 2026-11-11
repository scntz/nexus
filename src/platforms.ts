import type { Game } from "./types";

/** Console identity comes from the configured emulator, never the game title. */
export function libraryPlatform(game: Game): string {
  if (game.platform !== "Emulator") return game.platform;
  if (game.system) return game.system;
  const executable = game.executable?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const systems: [RegExp, string][] = [
    [/^rpcs3(?:\.exe)?$/, "PlayStation 3"],
    [/^(?:pcsx2.*|aethersx2)(?:\.exe)?$/, "PlayStation 2"],
    [/^(?:duckstation.*|epsxe)(?:\.exe)?$/, "PlayStation"],
    [/^ppsspp.*(?:\.exe)?$/, "PSP"],
    [/^vita3k(?:\.exe)?$/, "PlayStation Vita"],
    [
      /^(?:ryujinx|yuzu|suyu|sudachi|eden|citron)(?:\.exe)?$/,
      "Nintendo Switch",
    ],
    [/^(?:citra.*|azahar.*)(?:\.exe)?$/, "Nintendo 3DS"],
    [/^(?:melonds|desmume.*)(?:\.exe)?$/, "Nintendo DS"],
    [/^cemu(?:\.exe)?$/, "Wii U"],
    [/^(?:project64|simple64|mupen64.*)(?:\.exe)?$/, "Nintendo 64"],
    [/^(?:snes9x.*|bsnes.*)(?:\.exe)?$/, "Super Nintendo"],
    [/^(?:mesen|fceux)(?:\.exe)?$/, "Nintendo Entertainment System"],
    [/^(?:mgba|visualboyadvance.*)(?:\.exe)?$/, "Game Boy Advance"],
    [/^xenia.*(?:\.exe)?$/, "Xbox 360"],
    [/^xemu(?:\.exe)?$/, "Xbox"],
  ];
  if (/^dolphin(?:\.exe)?$/.test(executable)) {
    const rom = game.arguments?.[0]?.toLowerCase() ?? "";
    return rom.endsWith(".gcm") ? "GameCube" : "GameCube / Wii";
  }
  return (
    systems.find(([pattern]) => pattern.test(executable))?.[1] ?? "Other games"
  );
}

export function libraryPlatforms(games: Game[]): string[] {
  return [...new Set(games.map(libraryPlatform))];
}
