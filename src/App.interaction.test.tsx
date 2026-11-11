// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { GameCover } from "./components";
import type { Game } from "./types";
import { demoGames } from "./data";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
});
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const collection = () =>
  screen.getByRole("region", { name: "Game collection" });
const count = () => collection().querySelectorAll("article").length;

describe("complete library flows", () => {
  it("takes an empty favorites collection back to the existing library", async () => {
    localStorage.setItem(
      "nexus.preview.library",
      JSON.stringify(demoGames.map((g) => ({ ...g, favorite: false }))),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Filter library" }));
    await user.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(count()).toBe(12);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("adds an emulated game from the add form and displays validation inside it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Add game", exact: true }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "This is an emulated game" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add an emulated game",
    });
    expect(
      (within(dialog).getByRole("checkbox") as HTMLInputElement).checked,
    ).toBe(true);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Game name" }),
      "A classic",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Emulator executable" }),
      "C:\\emulator.txt",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "ROM or disc image" }),
      "C:\\game.rom",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add to library" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Windows .exe path"),
    );
  });
  it("only shows owned platforms and filters console games by their actual system", async () => {
    const game = (
      id: string,
      platform: Game["platform"],
      executable?: string,
    ): Game => ({
      id,
      name: id,
      platform,
      executable,
      installed: true,
      favorite: false,
    });
    localStorage.setItem(
      "nexus.preview.library",
      JSON.stringify([
        game("Steam game", "Steam"),
        game("Epic game", "Epic Games"),
        game("PS3 game", "Emulator", "C:\\RPCS3\\rpcs3.exe"),
        game("Switch game", "Emulator", "C:\\Ryujinx\\Ryujinx.exe"),
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Filter library" }));
    const platform = within(
      screen.getByRole("group", { name: "Platform", exact: true }),
    );
    const options = platform
      .getAllByRole("radio")
      .map((radio) => radio.closest("label")?.textContent);
    expect(options).toEqual([
      "All platforms",
      "Steam",
      "Epic Games",
      "PlayStation 3",
      "Nintendo Switch",
    ]);
    await user.click(platform.getByRole("radio", { name: "PlayStation 3" }));
    expect(count()).toBe(1);
    expect(collection().textContent).toContain("PS3 game");
    expect(screen.queryByText("INSTALLED & READY")).toBeNull();
    expect(screen.queryByText("YOUR GAMES. YOUR UNIVERSE.")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Settings", exact: true }),
    );
    await user.click(screen.getByRole("tab", { name: "Game sources" }));
    expect(
      screen.queryByRole("heading", { name: "GOG", exact: true }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Emulator", exact: true }),
    ).toBeNull();
    const steam = screen
      .getByRole("heading", { name: "Steam", exact: true })
      .closest("article")!;
    await user.click(within(steam).getByRole("button", { name: "View games" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(count()).toBe(1);
    expect(collection().textContent).toContain("Steam game");
  });
  it("recovers malformed local preferences and null library storage", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "nexus.preferences",
      JSON.stringify({ playerName: 42, compact: "yes", startPage: "invalid" }),
    );
    localStorage.setItem("nexus.preview.library", "null");
    render(<App />);
    expect(count()).toBe(12);
    expect(
      screen.getByRole("group", { name: "Library controls" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Library", exact: true }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Settings", exact: true }),
    );
    expect(
      (screen.getByRole("textbox", { name: "Player name" }) as HTMLInputElement)
        .value,
    ).toBe("Player");
  });
  it("opens Add game from the plus button and manages sources inside Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    const header = within(
      screen.getByRole("group", { name: "Library controls" }),
    );
    expect(screen.queryByRole("banner")).toBeNull();
    expect(header.queryByRole("button", { name: "Activity" })).toBeNull();
    expect(header.queryByRole("button", { name: "Quick find" })).toBeNull();
    expect(header.queryByRole("button", { name: "Search library" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Recently played" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Game sources" })).toBeNull();
    const addButton = header.getByRole("button", {
      name: "Add game",
      exact: true,
    });
    expect(addButton.textContent).toBe("");
    await user.click(addButton);
    const addGame = await screen.findByRole("dialog", { name: "Add a game" });
    await user.click(within(addGame).getByRole("button", { name: "Cancel" }));
    const settingsButton = header.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await user.click(settingsButton);
    const settings = within(
      screen.getByRole("dialog", { name: "Settings", exact: true }),
    );
    const general = settings.getByRole("tab", { name: "General", exact: true });
    general.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      settings
        .getByRole("tab", { name: "Game sources" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("region", { name: "Automatic discovery" }),
    ).toBeTruthy();
    await user.keyboard("{Home}");
    expect(general.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.queryByRole("region", { name: "Automatic discovery" }),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Start page" })).toBeNull();
    await user.click(settings.getByRole("button", { name: "Close dialog" }));
    expect(document.activeElement).toBe(settingsButton);
  });
  it("loads the library when older preferences select the removed recent view", () => {
    localStorage.setItem(
      "nexus.preferences",
      JSON.stringify({ startPage: "recent" }),
    );
    localStorage.setItem("nexus.sort", "recent");
    render(<App />);
    expect(
      screen.getByRole("region", { name: "Game collection" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("combobox", {
          name: "Sort games",
        }) as HTMLSelectElement
      ).value,
    ).toBe("name");
    expect(count()).toBe(12);
  });
  it("rolls back a favorite when browser storage is full", async () => {
    const user = userEvent.setup();
    render(<App />);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "nexus.preview.library") throw new Error("Quota exceeded");
      original.call(this, key, value);
    });
    await user.click(
      screen.getByRole("button", { name: "Favorite Hollow Knight" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Favorite Hollow Knight" }),
      ).toBeTruthy(),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Storage is full",
    );
  });
  it("persists sorting and provides an explicit search reset", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort games" }),
      "platform",
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search games" }),
      "hollow",
    );
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(count()).toBe(12);
    cleanup();
    render(<App />);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Sort games",
        }) as HTMLSelectElement
      ).value,
    ).toBe("platform");
  });
  it("uses identity-matched bundled artwork when online artwork fails", () => {
    const game: Game = {
      id: "epic",
      name: "Fortnite",
      platform: "Epic Games",
      catalogNamespace: "fn",
      cover: "https://cdn2.unrealengine.com/offline.jpg",
      installed: true,
      favorite: false,
    };
    render(<GameCover game={game} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/art/catalog/fortnite-cover.jpg",
    );
  });
  it("searches, favorites, and persists a change across reopening", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(count()).toBe(12);
    await user.type(
      screen.getByRole("searchbox", { name: "Search games" }),
      "hollow",
    );
    expect(count()).toBe(1);
    await user.click(
      screen.getByRole("button", { name: "Favorite Hollow Knight" }),
    );
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Filter library" }));
    await user.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    expect(count()).toBe(6);
    expect(
      screen.getByRole("button", { name: "View Hollow Knight" }),
    ).toBeTruthy();
    cleanup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Filter library" }));
    await user.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    expect(count()).toBe(6);
  });
  it("edits a game and preserves the edited details after reopening", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "View Hollow Knight" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit details" }),
    );
    const name = await screen.findByRole("textbox", { name: "Game name" });
    await user.clear(name);
    await user.type(name, "Hollow Knight — My edition");
    await user.type(
      screen.getByRole("textbox", { name: "Genre" }),
      " / Favorite",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Hollow Knight — My edition" }),
      ).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    cleanup();
    render(<App />);
    expect(
      screen.getByRole("button", { name: "View Hollow Knight — My edition" }),
    ).toBeTruthy();
  });
  it("hides a game with Undo, and can restore it from Settings later", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "View Hollow Knight" }),
    );
    await user.click(await screen.findByRole("button", { name: "Hide game" }));
    expect(count()).toBe(11);
    await user.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(count()).toBe(12);
    await user.click(
      screen.getByRole("button", { name: "View Hollow Knight" }),
    );
    await user.click(await screen.findByRole("button", { name: "Hide game" }));
    await user.click(
      screen.getByRole("button", { name: "Settings", exact: true }),
    );
    await user.click(
      screen.getByRole("button", { name: "Restore hidden games" }),
    );
    const settings = within(screen.getByRole("dialog", { name: "Settings" }));
    expect(settings.getByText("Hidden games restored.")).toBeTruthy();
    await user.click(settings.getByRole("button", { name: "Close dialog" }));
    expect(count()).toBe(12);
  });
  it("combines title, platform, availability, and favorites in the right panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole("button", { name: "Filter library" });
    await user.click(trigger);
    const drawer = within(
      screen.getByRole("complementary", { name: "Filters" }),
    );
    const search = screen.getByRole("searchbox", {
      name: "Search games",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(
      drawer.getByRole("checkbox", { name: "Favorites only" }),
    );
    expect(drawer.queryByRole("searchbox")).toBeNull();
    await user.type(search, "Baldur");
    await user.click(drawer.getByRole("radio", { name: "GOG" }));
    await user.click(
      drawer.getByRole("radio", { name: "Installed", exact: true }),
    );
    await user.click(drawer.getByRole("checkbox", { name: "Favorites only" }));
    expect(count()).toBe(1);
    expect(
      screen.getByRole("button", { name: "View Baldur’s Gate 3" }),
    ).toBeTruthy();
    await user.click(collection());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search games",
        }) as HTMLInputElement
      ).value,
    ).toBe("Baldur");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search games",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(count()).toBe(12);
  });
  it("supports list layout and sorting and returns from Settings to library search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(collection().querySelector(".game-list")).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort games" }),
      "name",
    );
    expect(collection().querySelector(".game-title")?.textContent).toBe(
      "Baldur’s Gate 3",
    );
    const search = screen.getByRole("searchbox", {
      name: "Search games",
    }) as HTMLInputElement;
    await user.type(search, "hollow");
    await user.click(
      screen.getByRole("button", { name: "Settings", exact: true }),
    );
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(search.value).toBe("hollow");
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });
  it("blocks preview launch and exposes a repairable unsupported action", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "View Control" }));
    const details = await screen.findByRole("dialog", { name: "Game details" });
    const action = within(details).getByRole("button", {
      name: "Open in GOG",
    });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(details).getByRole("button", { name: "Edit details" }),
    ).toBeTruthy();
  });
  it("bounds initial rendering and offers pagination for a large collection", () => {
    const games: Game[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `game-${i}`,
      name: `Game ${i}`,
      platform: "Steam",
      favorite: false,
      installed: false,
    }));
    localStorage.setItem("nexus.preview.library", JSON.stringify(games));
    render(<App />);
    expect(count()).toBeGreaterThan(0);
    expect(count()).toBeLessThanOrEqual(60);
    expect(
      screen.getByRole("button", { name: /Show more games/ }),
    ).toBeTruthy();
  });
  it("recovers a failed cover after new metadata supplies a different URL", () => {
    const game: Game = {
      id: "a",
      name: "Example",
      platform: "Epic Games",
      favorite: false,
      installed: true,
      cover: "https://cdn2.unrealengine.com/missing.jpg",
    };
    const { rerender } = render(<GameCover game={game} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    rerender(
      <GameCover
        game={{ ...game, cover: "https://cdn2.unrealengine.com/fixed.jpg" }}
      />,
    );
    expect(screen.getByRole("img").getAttribute("src")).toContain("fixed.jpg");
  });
});
