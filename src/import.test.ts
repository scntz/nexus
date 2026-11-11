import { describe, it, expect } from "vitest";
import { parseImport } from "./bridge";

describe("library imports", () => {
  it("preserves safe folder and console identities without trusting their executable", () => {
    const [game] = parseImport([
      {
        id: "folder-1234567890abcdef",
        platform: "Emulator",
        name: "A classic",
        system: "PlayStation 3",
        executable: "C:\\untrusted.exe",
        installed: true,
      },
    ]);
    expect(game.id).toBe("folder-1234567890abcdef");
    expect(game.system).toBe("PlayStation 3");
    expect(game.executable).toBeUndefined();
    expect(game.installed).toBe(false);
  });
  it("accepts Steam's canonical artwork origin", () => {
    const url =
      "https://shared.steamstatic.com/store_item_assets/steam/apps/42/library_600x900.jpg";
    expect(
      parseImport([
        { name: "Example", platform: "Steam", appId: "42", cover: url },
      ])[0].cover,
    ).toBe(url);
  });
  it("imports owned Steam games without trusting installation or execution fields", () => {
    const [g] = parseImport({
      games: [
        {
          name: "Example",
          platform: "Steam",
          appId: "42",
          installed: true,
          executable: "C:\\untrusted.exe",
          arguments: ["--command"],
          launchUri: "file:///bad.exe",
          favorite: true,
        },
      ],
    });
    expect(g).toMatchObject({
      id: "steam-42",
      installed: false,
      favorite: true,
      launchUri: "steam://rungameid/42",
      installUri: "steam://install/42",
    });
    expect(g.executable).toBeUndefined();
    expect(g.arguments).toBeUndefined();
  });
  it("rejects unsupported formats, invalid platforms, duplicate IDs and absent names", () => {
    expect(() => parseImport({})).toThrow();
    expect(() => parseImport([{ name: "", platform: "Steam" }])).toThrow();
    expect(() =>
      parseImport([{ name: "Example", platform: "Unknown" }]),
    ).toThrow();
    expect(() =>
      parseImport([
        { name: "One", platform: "Steam", appId: "42" },
        { name: "Two", platform: "Steam", appId: "42" },
      ]),
    ).toThrow();
  });
  it("does not create install or launch links from malformed app IDs", () => {
    const [g] = parseImport([
      {
        name: "Example",
        platform: "Steam",
        appId: "42&command=bad",
        cover: "https://untrusted.example/image.jpg",
      },
    ]);
    expect(g.appId).toBeUndefined();
    expect(g.cover).toBeUndefined();
    expect(g.installUri).toBeUndefined();
  });
});
