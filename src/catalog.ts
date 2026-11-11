import type { Game, Platform } from "./types";

interface Artwork {
  cover: string;
  hero: string;
  description: string;
  genre: string;
}
const epic: Record<string, Artwork> = {
  fn: {
    cover: "/art/catalog/fortnite-cover.jpg",
    hero: "/art/catalog/fortnite-hero.jpg",
    genre: "Battle royale",
    description:
      "Drop into Battle Royale, build your own worlds, or discover something new with friends.",
  },
  "50118b7f954e450f8823df1614b24e80": {
    cover: "/art/catalog/fall-guys-cover.jpg",
    hero: "/art/catalog/fall-guys-hero.jpg",
    genre: "Party platformer",
    description:
      "Race through colorful obstacle courses and compete for the crown in a chaotic multiplayer party.",
  },
  "9773aa1aa54f4f7b80e44bef04986cea": {
    cover: "/art/catalog/rocket-league-cover.jpg",
    hero: "/art/catalog/rocket-league-hero.jpg",
    genre: "Sports & racing",
    description:
      "Rocket-powered cars. Competitive soccer. Team up and take your next shot.",
  },
};
/** Curated publisher artwork, matched by provider identity rather than game title. */
export function bundledArtwork(game: Game): Artwork | undefined {
  if (game.platform === "Epic Games" && game.catalogNamespace)
    return epic[game.catalogNamespace];
  if (game.platform === "Steam" && game.appId === "1097150")
    return epic["50118b7f954e450f8823df1614b24e80"];
}
export const platformInfo: Record<
  Platform,
  { color: string; description: string }
> = {
  Steam: {
    color: "#85b4df",
    description:
      "Discover installed Steam games and keep previously detected titles in your collection.",
  },
  "Epic Games": {
    color: "#c9c9de",
    description:
      "Find installed Epic games automatically and reuse metadata for games already identified.",
  },
  Xbox: {
    color: "#91cc6b",
    description:
      "Discover Xbox and Microsoft Store games installed for your Windows account.",
  },
  GOG: {
    color: "#ca9de4",
    description:
      "Find locally installed GOG games through their Windows installation registrations.",
  },
  EA: {
    color: "#ef959d",
    description:
      "Discover EA games registered on this PC. Choose an executable if a game needs help launching.",
  },
  Ubisoft: {
    color: "#a0acff",
    description:
      "Discover installed Ubisoft Connect games and play through the original launcher.",
  },
  "Battle.net": {
    color: "#71bedb",
    description:
      "Discover registered Blizzard games. Choose an executable if a game needs help launching.",
  },
  Standalone: {
    color: "#b1a6f1",
    description:
      "Bring any Windows game into your library. Choose its executable once, then launch from Nexus.",
  },
  Emulator: {
    color: "#e2ba8f",
    description:
      "Pair an emulator with a ROM or disc image and keep your classics together.",
  },
};
