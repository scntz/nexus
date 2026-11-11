// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { loadLibrary, scanLibrary, saveLibrary, native } from "./bridge";
import { mergeGames } from "./library";
import type { Game } from "./types";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  isDesktop: true,
  isNativeShell: true,
  loadLibrary: vi.fn(),
  scanLibrary: vi.fn(),
  saveLibrary: vi.fn(),
  native: vi.fn(),
}));
const steam: Game = {
  id: "steam-42",
  appId: "42",
  name: "Local game",
  platform: "Steam",
  installed: true,
  favorite: true,
};
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
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(loadLibrary).mockResolvedValue([]);
  vi.mocked(saveLibrary).mockResolvedValue(undefined);
  vi.mocked(native).mockImplementation(async (command) =>
    command === "refresh_metadata" ? [] : undefined,
  );
  vi.mocked(scanLibrary).mockResolvedValue({
    games: [steam],
    sources: [
      { platform: "Steam", count: 1, detected: true, detail: "Local library" },
    ],
    warnings: [],
    failedPlatforms: [],
    scannedPlatforms: ["Steam", "Epic Games"],
    scannedAt: Date.now(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("discovers a clean install automatically without account commands, keys, imports, or setup", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("region", { name: "Featured game" });
  expect(vi.mocked(scanLibrary)).toHaveBeenCalledExactlyOnceWith(false);
  expect(
    vi
      .mocked(native)
      .mock.calls.some(([command]) =>
        /account|connect|login|steam_key|import/.test(command),
      ),
  ).toBe(false);
  await user.click(
    screen.getByRole("button", { name: "Settings", exact: true }),
  );
  await user.click(
    screen.getByRole("tab", { name: "Game sources", exact: true }),
  );
  expect(
    screen.getByRole("region", { name: "Automatic discovery" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /connect|import|sign in/i }),
  ).toBeNull();
  expect(screen.queryByRole("textbox", { name: /key|steamid/i })).toBeNull();
  expect(screen.getByText("About uninstalled games")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "General", exact: true }));
  expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
});
it("shows the saved library before starting one full sync in the visible window", async () => {
  vi.mocked(loadLibrary).mockResolvedValue([steam]);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const listeners = vi.spyOn(document, "addEventListener");
  render(<App />);
  await screen.findByRole("button", { name: "View Local game" });
  await waitFor(() =>
    expect(
      listeners.mock.calls.filter(([type]) => type === "visibilitychange"),
    ).toHaveLength(2),
  );
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    frames.push(callback),
  );
  window.dispatchEvent(new Event("focus"));
  expect(frames).toHaveLength(0);
  expect(scanLibrary).not.toHaveBeenCalled();

  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames).toHaveLength(1);
  act(() => frames.shift()?.(performance.now()));
  expect(scanLibrary).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  await act(async () => frames.shift()?.(performance.now()));
  expect(scanLibrary).toHaveBeenCalledExactlyOnceWith(false);
  expect(native).toHaveBeenCalledWith(
    "startup_ready",
    expect.objectContaining({ games: 1 }),
  );
  expect(vi.mocked(native).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(scanLibrary).mock.invocationCallOrder[0],
  );
  expect(screen.getByRole("button", { name: "View Local game" })).toBeTruthy();
});
it("automatically checks launcher manifests when returning to the window", async () => {
  render(<App />);
  await screen.findByRole("region", { name: "Featured game" });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(scanLibrary).toHaveBeenCalledExactlyOnceWith(false);
  window.dispatchEvent(new Event("focus"));
  expect(scanLibrary).toHaveBeenCalledTimes(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(scanLibrary).toHaveBeenNthCalledWith(2, true));
  expect(vi.mocked(saveLibrary)).toHaveBeenCalledTimes(1);
});
it("retains missing games as history without turning unrelated caches into ownership", () => {
  const old = { ...steam, discoverySource: "local" as const };
  const history = mergeGames([old], [], [], ["Steam"]);
  expect(history[0]).toMatchObject({
    installed: false,
    favorite: true,
    discoverySource: "history",
  });
  const xbox: Game = { ...steam, id: "xbox-1", platform: "Xbox" };
  expect(mergeGames([xbox], [], [], ["Steam", "Epic Games"])[0].installed).toBe(
    true,
  );
  expect(mergeGames([old], [], ["Steam"], ["Steam"])[0].installed).toBe(true);
});
