import { describe, expect, it } from "vitest";
import { libraryPlatform, libraryPlatforms } from "./platforms";
import { filterGames } from "./library";
import type { Game } from "./types";

const game = (executable: string, arguments_: string[] = []): Game => ({
  id: executable,
  name: "A game",
  platform: "Emulator",
  installed: true,
  favorite: false,
  executable,
  arguments: arguments_,
});

describe("library console groups", () => {
  it("recognizes console executables across Windows and portable paths", () => {
    expect(libraryPlatform(game("C:\\Games\\RPCS3.exe"))).toBe("PlayStation 3");
    expect(libraryPlatform(game("/games/Ryujinx.exe"))).toBe("Nintendo Switch");
    expect(libraryPlatform(game("C:\\games\\pcsx2-qt.exe"))).toBe(
      "PlayStation 2",
    );
  });
  it("does not guess a console from a game title or a directory", () => {
    expect(
      libraryPlatform({
        ...game("C:\\rpcs3\\unknown.exe"),
        name: "Nintendo Switch",
      }),
    ).toBe("Other games");
    expect(libraryPlatform(game("dolphin.exe", ["game.gcm"]))).toBe("GameCube");
    expect(libraryPlatform(game("dolphin.exe", ["game.iso"]))).toBe(
      "GameCube / Wii",
    );
  });
  it("deduplicates available groups and searches console names", () => {
    const games = [game("rpcs3.exe"), { ...game("rpcs3.exe"), id: "another" }];
    expect(libraryPlatforms(games)).toEqual(["PlayStation 3"]);
    expect(
      filterGames(games, {
        query: "playstation 3",
        platform: "PlayStation 3",
        tab: "all",
        sort: "name",
      }),
    ).toHaveLength(2);
    expect(libraryPlatforms([])).toEqual([]);
  });
});
