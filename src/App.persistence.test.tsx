// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { loadLibrary, scanLibrary, saveLibrary, native } from "./bridge";
import type { Game } from "./types";
vi.mock("./bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bridge")>()),
  isDesktop: true,
  isNativeShell: true,
  loadLibrary: vi.fn(),
  scanLibrary: vi.fn(),
  saveLibrary: vi.fn(),
  native: vi.fn(),
}));
const game: Game = {
  id: "manual-00000000-0000-4000-8000-000000000001",
  name: "My game",
  platform: "Standalone",
  installed: true,
  favorite: false,
  executable: "C:\\Games\\game.exe",
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.scrollTo = vi.fn();
});
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem("nexus.preferences", JSON.stringify({startPage:"library"}));
  vi.mocked(loadLibrary).mockResolvedValue([game]);
  vi.mocked(scanLibrary).mockRejectedValue(
    new Error("Discovery unavailable in this test"),
  );
  vi.mocked(saveLibrary).mockResolvedValue(undefined);
  vi.mocked(native).mockResolvedValue(undefined);
});
afterEach(cleanup);

it("rolls back a failed native favorite save and lets the next attempt recover", async () => {
  vi.mocked(saveLibrary).mockRejectedValueOnce(new Error("Disk full"));
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Favorite My game" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Favorite My game" }),
    ).toBeTruthy(),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("Disk full");
  await user.click(screen.getByRole("button", { name: "Favorite My game" }));
  await waitFor(() => expect(vi.mocked(saveLibrary)).toHaveBeenCalledTimes(2));
  expect(
    screen.getByRole("button", { name: "Unfavorite My game" }),
  ).toBeTruthy();
});
it("keeps the editor open with an inline error when native persistence fails", async () => {
  vi.mocked(saveLibrary).mockRejectedValueOnce(new Error("Disk full"));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "View My game" }));
  await user.click(await screen.findByRole("button", { name: "Edit details" }));
  const editor = await screen.findByRole("dialog", { name: "Edit game" });
  const name = within(editor).getByRole("textbox", { name: "Game name" });
  await user.clear(name);
  await user.type(name, "Changed name");
  await user.click(
    within(editor).getByRole("button", { name: "Save changes" }),
  );
  expect((await within(editor).findByRole("alert")).textContent).toContain(
    "Disk full",
  );
  await user.click(within(editor).getByRole("button", { name: "Cancel" }));
  const details = await screen.findByRole("dialog", { name: "Game details" });
  expect(
    within(details).getByRole("heading", { name: "My game", exact: true }),
  ).toBeTruthy();
});
it("keeps a failed addition out of the library and supports retrying the same form", async () => {
  vi.mocked(saveLibrary).mockRejectedValueOnce(new Error("Disk full"));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "View My game" });
  await user.click(
    screen.getByRole("button", { name: "Add game", exact: true }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Add a game" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Game name" }),
    "Another game",
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "Game executable" }),
    "C:\\Games\\another.exe",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Add to library" }),
  );
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "Disk full",
  );
  expect(
    screen.queryByRole("button", { name: "View Another game" }),
  ).toBeNull();
  await user.click(
    within(dialog).getByRole("button", { name: "Add to library" }),
  );
  expect(
    await screen.findByRole("button", { name: "View Another game" }),
  ).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
