// @vitest-environment jsdom
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { groupGames } from "./duplicates";
import { visibleRange } from "./GameViewport";
import { mergeImportedGames } from "./library";
import type { Game } from "./types";
const game = (
  id: string,
  platform: Game["platform"],
  installed = false,
  name = "Hades",
): Game => ({
  id,
  name,
  platform,
  installed,
  favorite: false,
  appId: platform === "Steam" ? "1145360" : "hades",
  cover: "/art/hades.jpg",
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.scrollTo = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0),
  );
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("production library experience", () => {
  it("keeps a favorite visible when another store's copy is installed", async () => {
    localStorage.setItem(
      "nexus.preview.library",
      JSON.stringify([
        { ...game("s", "Steam"), favorite: true },
        game("e", "Epic Games", true),
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Filter library" }));
    await user.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    const collection = screen.getByRole("region", { name: "Game collection" });
    expect(
      within(collection).getByRole("button", { name: "View Hades" }),
    ).toBeTruthy();
  });
  it("opens the collection with one control bar and an icon-only Add button", () => {
    localStorage.setItem(
      "nexus.preferences",
      JSON.stringify({ startPage: "home" }),
    );
    render(<App />);
    expect(
      screen.queryByRole("heading", { name: "Library", exact: true }),
    ).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("region", { name: "Featured game" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Game collection" }),
    ).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Library controls" }))
        .getAllByRole("button")
        .map(
          (button) => button.getAttribute("aria-label") || button.textContent,
        ),
    ).toEqual([
      "Sync library",
      "Grid view",
      "List view",
      "Filter library",
      "Add game",
      "Settings",
    ]);
    expect(screen.queryByText(/games in this view/)).toBeNull();
    expect(screen.queryByText("JUMP BACK IN")).toBeNull();
  });
  it("groups cross-store copies, chooses the installed copy, and switches in details", async () => {
    localStorage.setItem(
      "nexus.preview.library",
      JSON.stringify([game("s", "Steam"), game("e", "Epic Games", true)]),
    );
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByRole("button", { name: "View Hades" })).toHaveLength(
      1,
    );
    expect(screen.getByText("2 copies")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "View Hades" }));
    const copies = screen.getByRole("group", { name: "Available copies" });
    expect(copies).toBeTruthy();
    await user.click(within(copies).getByRole("button", { name: /Steam/ }));
    expect(
      within(screen.getByRole("dialog", { name: "Game details" })).getByRole(
        "button",
        {
          name: "Install game",
        },
      ),
    ).toBeTruthy();
  });
  it("does not group remasters, editions, or same-store entries", () => {
    const games = [
      game("s", "Steam", false, "Control"),
      game("e", "Epic Games", true, "Control™"),
      game("g", "GOG", false, "Control Ultimate Edition"),
      game("s2", "Steam", false, "Control"),
    ];
    const groups = groupGames(games);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.copies.length === 2)?.game.id).toBe("e");
    expect(groupGames(games, false)).toHaveLength(4);
  });
  it("keeps installations and custom metadata when refreshing ownership", () => {
    const installed = {
      ...game("s", "Steam", true),
      customized: true,
      cover: "/art/elden-ring.jpg",
      description: "Custom",
      favorite: true,
    };
    const merged = mergeImportedGames(
      [installed],
      [
        {
          ...game("s", "Steam"),
          cover: "/art/hades.jpg",
          description: "Provider",
          playtime: 30,
        },
      ],
    );
    expect(merged[0]).toMatchObject({
      installed: true,
      cover: "/art/elden-ring.jpg",
      description: "Custom",
      favorite: true,
      playtime: 30,
    });
    const fresh = mergeImportedGames(
      [game("s", "Steam", true)],
      [{ ...game("s", "Steam"), description: "Provider" }],
    );
    expect(fresh[0].description).toBe("Provider");
    expect(fresh[0].installed).toBe(true);
  });
  it("bounds rendering at the start, middle, end, and after overscrolling a large library", () => {
    for (const scroll of [0, 1500, 400000, 99999999]) {
      const range = visibleRange(50000, 5, 350, scroll, 900);
      expect(range.end - range.start).toBeLessThanOrEqual(40);
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.end).toBeLessThanOrEqual(50000);
      expect(range.top).toBeGreaterThanOrEqual(0);
      expect(range.bottom).toBeGreaterThanOrEqual(0);
    }
    expect(visibleRange(0, 5, 350, 0, 900).end).toBe(0);
  });
});
