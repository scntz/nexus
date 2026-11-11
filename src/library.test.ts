import { describe, it, expect } from "vitest";
import { filterGames, mergeGames, mergeImportedGames } from "./library";
import type { Game } from "./types";
const game = (id: string, fields: Partial<Game> = {}): Game => ({
  id,
  name: id,
  platform: "Steam",
  installed: true,
  favorite: false,
  ...fields,
});

describe("library discovery reconciliation", () => {
  it("preserves favorites and launch history when manifests are rescanned", () => {
    const merged = mergeGames(
      [game("steam-1", { favorite: true, lastPlayed: 100, playtime: 12 })],
      [game("steam-1")],
    );
    expect(merged[0]).toMatchObject({
      favorite: true,
      lastPlayed: 100,
      playtime: 12,
      installed: true,
    });
  });
  it("retains missing owned games as uninstalled and keeps manual entries installed", () => {
    const merged = mergeGames(
      [game("steam-1"), game("manual-2", { platform: "Emulator" })],
      [],
    );
    expect(merged.map((g) => g.installed)).toEqual([false, true]);
  });
  it("preserves cached installations when a source scan failed", () => {
    const merged = mergeGames(
      [game("xbox-1", { platform: "Xbox" }), game("steam-1")],
      [],
      ["Xbox"],
    );
    expect(merged.map((g) => g.installed)).toEqual([true, false]);
  });
  it("reuses an unchanged discovery snapshot, including parsed launch arguments", () => {
    const cached = [
      game("steam-1", {
        discoverySource: "local",
        favorite: true,
        arguments: ["--windowed"],
      }),
      game("steam-2", { discoverySource: "history", installed: false }),
    ];
    const scanned = game("steam-1", { arguments: ["--windowed"] });
    expect(mergeGames(cached, [scanned])).toBe(cached);
    const changed = mergeGames(cached, [
      { ...scanned, arguments: ["--fullscreen"] },
    ]);
    expect(changed[0]).not.toBe(cached[0]);
    expect(changed[1]).toBe(cached[1]);
  });
  it("an import never marks unrelated games as uninstalled", () => {
    const merged = mergeImportedGames(
      [
        game("epic-1", { platform: "Epic Games" }),
        game("steam-2", { favorite: true }),
      ],
      [
        game("steam-2", { installed: false, playtime: 23 }),
        game("steam-3", { installed: false }),
      ],
    );
    expect(merged).toHaveLength(3);
    expect(merged.find((g) => g.id === "epic-1")?.installed).toBe(true);
    expect(merged.find((g) => g.id === "steam-2")).toMatchObject({
      installed: true,
      favorite: true,
      playtime: 23,
    });
    expect(merged.find((g) => g.id === "steam-3")?.installed).toBe(false);
  });
});
describe("library queries", () => {
  const games = [
    game("one", {
      name: "Hollow Knight",
      genre: "Metroidvania",
      favorite: true,
      lastPlayed: 10,
    }),
    game("two", {
      name: "Hades",
      platform: "Epic Games",
      installed: false,
      lastPlayed: 20,
    }),
    game("three", { name: "ELDEN RING", playtime: 40 }),
  ];
  const defaults = {
    query: "",
    platform: "all",
    tab: "all",
    sort: "name",
  } as const;
  it("searches names, genres and platforms without case sensitivity", () => {
    expect(
      filterGames(games, { ...defaults, query: "  HOLLOW " }).map((g) => g.id),
    ).toEqual(["one"]);
    expect(
      filterGames(games, { ...defaults, query: "metroidvania" }),
    ).toHaveLength(1);
    expect(filterGames(games, { ...defaults, query: "epic" })).toHaveLength(1);
  });
  it("matches accents, punctuation and words in a different order", () => {
    const library = [game("rpg", { name: "Baldur’s Gate III™", genre: "RPG" })];
    expect(
      filterGames(library, { ...defaults, query: "Gáte baldurs RPG" }),
    ).toEqual(library);
  });
  it("combines availability, provider and favorites filters", () => {
    expect(
      filterGames(games, {
        ...defaults,
        platform: "Steam",
        tab: "installed",
        favoritesOnly: true,
      }).map((g) => g.id),
    ).toEqual(["one"]);
    expect(
      filterGames(games, { ...defaults, tab: "uninstalled" }).map((g) => g.id),
    ).toEqual(["two"]);
  });
  it("sorts the library by title and playtime", () => {
    expect(filterGames(games, defaults).map((g) => g.id)).toEqual([
      "three",
      "two",
      "one",
    ]);
    expect(filterGames(games, { ...defaults, sort: "playtime" })[0].id).toBe(
      "three",
    );
  });
  it("handles a 50,000-game collection without mutating its source", () => {
    const large = Array.from({ length: 50_000 }, (_, i) =>
      game(`steam-${i}`, {
        name: `Adventure ${String(i).padStart(5, "0")}`,
        installed: i % 2 === 0,
      }),
    );
    const before = performance.now();
    const found = filterGames(large, {
      ...defaults,
      query: "Adventure 499",
      tab: "installed",
      sort: "name",
    });
    const elapsed = performance.now() - before;
    expect(found).toHaveLength(50);
    expect(found[0].name).toBe("Adventure 49900");
    expect(large[0].id).toBe("steam-0");
    const cachedStart = performance.now();
    expect(
      filterGames(large, {
        ...defaults,
        query: "Adventure 498",
        tab: "installed",
        sort: "name",
      }),
    ).toHaveLength(50);
    console.info(
      `50,000-game search/filter/sort: first ${elapsed.toFixed(2)} ms; cached ${(performance.now() - cachedStart).toFixed(2)} ms (Node test runtime)`,
    );
  });
});
