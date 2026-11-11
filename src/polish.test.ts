import { describe, it, expect } from "vitest";
import { gameAction, greeting } from "./actions";
import { isArtworkUrl, applyMetadata, artworkOutcome } from "./artwork";
import { mergeGames } from "./library";
import type { Game } from "./types";
import { bundledArtwork } from "./catalog";
const game = (patch: Partial<Game> = {}): Game => ({
  id: "example",
  name: "Example",
  platform: "Epic Games",
  installed: true,
  favorite: false,
  ...patch,
});

describe("real platform actions", () => {
  it("only enables install for a supported provider and identifier", () => {
    expect(
      gameAction(game({ platform: "Steam", appId: "42", installed: false })),
    ).toMatchObject({ enabled: true, label: "Install game" });
    expect(gameAction(game({ installed: false }))).toMatchObject({
      enabled: false,
      label: "Install in launcher",
    });
    expect(
      gameAction(
        game({ platform: "Steam", appId: "invalid", installed: false }),
      ).enabled,
    ).toBe(false);
  });
  it("requires an actual launch target and explains how to repair it", () => {
    expect(gameAction(game()).enabled).toBe(false);
    expect(
      gameAction(game({ executable: "C:\\Games\\Example.exe" })).enabled,
    ).toBe(true);
    expect(
      gameAction(
        game({
          launchUri:
            "com.epicgames.launcher://apps/Example?action=launch&silent=true",
        }),
      ).enabled,
    ).toBe(true);
  });
  it("greets the player according to the time of day", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
  });
});
describe("artwork and customization", () => {
  it("never assigns bundled artwork just because a title matches", () => {
    expect(bundledArtwork(game({name:"Fortnite"}))).toBeUndefined();
    expect(bundledArtwork(game({name:"Renamed game",catalogNamespace:"fn"}))?.cover).toContain("fortnite-cover");
    expect(bundledArtwork(game({platform:"GOG",catalogNamespace:"fn"}))).toBeUndefined();
  });
  it("reports partial provider failures instead of claiming a complete refresh", () => {
    const games = [
      game({ id: "steam", platform: "Steam" }),
      game({ id: "epic" }),
      game({ id: "custom", customized: true }),
    ];
    expect(
      artworkOutcome(games, [
        { id: "steam", cover: "https://shared.steamstatic.com/cover.jpg" },
      ]),
    ).toEqual({ updated: 1, missing: 1 });
    expect(
      artworkOutcome(
        games,
        [{ id: "epic", cover: "https://cdn2.unrealengine.com/cover.jpg" }],
        ["epic"],
      ),
    ).toEqual({ updated: 1, missing: 0 });
  });
  it("accepts official Steam/Epic origins and rejects lookalikes and executable URLs", () => {
    expect(isArtworkUrl("https://cdn2.unrealengine.com/cover.jpg")).toBe(true);
    expect(isArtworkUrl("https://cdn1.epicgames.com/offer/cover.jpg")).toBe(
      true,
    );
    expect(
      isArtworkUrl("https://cdn2.unrealengine.com.evil.example/cover.jpg"),
    ).toBe(false);
    expect(
      isArtworkUrl("https://user:secret@cdn2.unrealengine.com/image.jpg"),
    ).toBe(false);
    expect(isArtworkUrl("javascript:alert(1)")).toBe(false);
    expect(isArtworkUrl("data:image/svg+xml;base64,AAA=")).toBe(false);
  });
  it("enriches only matching games and preserves custom artwork", () => {
    const original = [
      game(),
      game({
        id: "custom",
        customized: true,
        cover: "https://shared.steamstatic.com/custom.jpg",
      }),
    ];
    const patches = [
      {
        id: "example",
        cover: "https://cdn2.unrealengine.com/example.jpg",
        description: "Official description",
      },
      { id: "custom", cover: "https://cdn2.unrealengine.com/override.jpg" },
    ];
    const result = applyMetadata(original, patches);
    expect(result[0].description).toBe("Official description");
    expect(result[0].cover).toContain("example.jpg");
    expect(result[1]).toEqual(original[1]);
    const manual = applyMetadata(original, [
      { ...patches[1], description: "Provider text" },
    ], ["custom"]);
    expect(manual[1]).toMatchObject({ customized: true, cover: patches[1].cover });
    expect(manual[1].description).toBe(original[1].description);
    expect(applyMetadata(original, [{ id: "custom" }], ["custom"])).toBe(original);
  });
  it("retains downloaded metadata and custom details across local rescans", () => {
    const existing = game({
      name: "My title",
      customized: true,
      cover: "https://cdn2.unrealengine.com/custom.jpg",
      genre: "Custom genre",
      favorite: true,
      executable: "C:\\Games\\custom.exe",
    });
    const [merged] = mergeGames(
      [existing],
      [game({ name: "Original title", executable: "C:\\Games\\default.exe" })],
    );
    expect(merged).toMatchObject({
      name: "My title",
      customized: true,
      cover: existing.cover,
      genre: "Custom genre",
      favorite: true,
      executable: existing.executable,
    });
  });
});
