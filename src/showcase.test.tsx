// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturedGames } from "./FeaturedGames";
import { groupGames } from "./duplicates";
import type { Game } from "./types";

afterEach(cleanup);

it("keeps the selected featured game when the library is reranked", async () => {
  const games: Game[] = [
    {
      id: "alpha",
      name: "Alpha",
      platform: "Steam",
      appId: "1",
      installed: true,
      favorite: false,
      lastPlayed: 20,
    },
    {
      id: "beta",
      name: "Beta",
      platform: "Steam",
      appId: "2",
      installed: true,
      favorite: false,
      lastPlayed: 10,
    },
  ];
  const props = {
    launching: null,
    onPlay: vi.fn(),
    onDetails: vi.fn(),
    onFavorite: vi.fn(),
  };
  const user = userEvent.setup();
  const { rerender } = render(
    <FeaturedGames groups={groupGames(games)} {...props} />,
  );
  const choices = within(screen.getByRole("group", { name: "Featured games" }));
  choices.getByRole("button", { name: "Feature Alpha" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(
    choices.getByRole("button", { name: "Feature Beta" }),
  );
  expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
  rerender(
    <FeaturedGames
      groups={groupGames([games[0], { ...games[1], lastPlayed: 30 }])}
      {...props}
    />,
  );
  expect(
    choices
      .getByRole("button", { name: "Feature Beta" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
});
