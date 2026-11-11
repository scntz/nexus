import { useMemo, useState } from "preact/hooks";
import { GameCover, HeroArtwork } from "./components";
import { Brand, Icon } from "./icons";
import { bundledArtwork } from "./catalog";
import { gameAction } from "./actions";
import { libraryPlatform } from "./platforms";
import type { GameGroup } from "./duplicates";
import type { Game } from "./types";

function mostRecent(game: Game, other: Game) {
  return (other.lastPlayed ?? 0) - (game.lastPlayed ?? 0);
}

function featureOrder(game: Game, other: Game) {
  return (
    Number(other.installed) - Number(game.installed) || mostRecent(game, other)
  );
}

/** Rank the featured games without sorting the entire library again. */
function insertRanked(
  shelf: Game[],
  game: Game,
  limit: number,
  compare: (a: Game, b: Game) => number,
) {
  if (shelf.length === limit && compare(game, shelf[limit - 1]) >= 0) return;
  const slot = shelf.findIndex((other) => compare(game, other) < 0);
  if (slot < 0) shelf.push(game);
  else shelf.splice(slot, 0, game);
  if (shelf.length > limit) shelf.pop();
}

function featuredActionIcon(game: Game, opening: boolean) {
  if (opening) return "sync";
  if (game.installed) return "play";
  return game.platform === "GOG" ? "external" : "download";
}

export function FeaturedGames({
  groups,
  launching,
  onPlay,
  onDetails,
  onFavorite,
}: {
  groups: GameGroup[];
  launching: string | null;
  onPlay: (game: Game) => void;
  onDetails: (game: Game) => void;
  onFavorite: (game: Game) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const featured = useMemo(() => {
    const games: Game[] = [];
    for (const { game } of groups) insertRanked(games, game, 4, featureOrder);
    return games;
  }, [groups]);
  const hero = featured.find((game) => game.id === selected) ?? featured[0];
  if (!hero) return null;
  const heroAction = gameAction(hero);
  const heroDescription = hero.description || bundledArtwork(hero)?.description;
  const heroGenre = hero.genre || bundledArtwork(hero)?.genre;
  const heroOpening = launching === hero.id;
  const heroIndex = featured.indexOf(hero);
  const heroFavorite =
    groups
      .find((group) => group.game.id === hero.id)
      ?.copies.some((game) => game.favorite) ?? hero.favorite;
  return (
    <div class="library-featured nexus-showcase">
      <section class="hero home-feature" aria-label="Featured game">
        <HeroArtwork key={hero.id} game={hero} />
        <div class="hero-shade" />
        <div class="hero-content">
          <div class="feature-platform">
            <Brand platform={hero.platform} size={16} />
            <span>{libraryPlatform(hero)}</span>
            {heroGenre && <span class="feature-genre">{heroGenre}</span>}
          </div>
          <h2 aria-live="polite">{hero.name}</h2>
          {heroDescription && <p>{heroDescription}</p>}
          <div class="hero-actions">
            {heroAction.enabled && (
              <button
                class="button primary play-button"
                onClick={() => onPlay(hero)}
                disabled={heroOpening}
                aria-busy={heroOpening || undefined}
              >
                <Icon
                  name={featuredActionIcon(hero, heroOpening)}
                  size={17}
                  fill={hero.installed && !heroOpening}
                />
                {heroOpening ? "Opening…" : heroAction.label}
              </button>
            )}
            <button
              class={`button ${heroAction.enabled ? "hero-secondary" : "primary"}`}
              onClick={() => onDetails(hero)}
            >
              Details
              <Icon name="right" size={16} />
            </button>
          </div>
        </div>
        <button
          class={`hero-favorite ${heroFavorite ? "favorited" : ""}`}
          aria-label={
            heroFavorite ? "Remove from favorites" : "Add to favorites"
          }
          aria-pressed={heroFavorite}
          title={heroFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => onFavorite(hero)}
        >
          <Icon name="star" size={19} fill={heroFavorite} />
        </button>
        {featured.length > 1 && (
          <div
            class="feature-stepper"
            role="group"
            aria-label="Switch featured game"
          >
            <button
              class="icon-button"
              aria-label="Previous featured game"
              onClick={() =>
                setSelected(
                  featured[(heroIndex + featured.length - 1) % featured.length]
                    .id,
                )
              }
            >
              <Icon name="left" size={18} />
            </button>
            <span aria-hidden="true">
              {heroIndex + 1} / {featured.length}
            </span>
            <button
              class="icon-button"
              aria-label="Next featured game"
              onClick={() =>
                setSelected(featured[(heroIndex + 1) % featured.length].id)
              }
            >
              <Icon name="right" size={18} />
            </button>
          </div>
        )}
      </section>
      {featured.length > 1 && (
        <div
          class="feature-switcher"
          role="group"
          aria-label="Featured games"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll("button"),
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index === -1) return;
            let next: number;
            switch (event.key) {
              case "ArrowLeft":
                next = (index + buttons.length - 1) % buttons.length;
                break;
              case "ArrowRight":
                next = (index + 1) % buttons.length;
                break;
              case "Home":
                next = 0;
                break;
              case "End":
                next = buttons.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            setSelected(featured[next].id);
            buttons[next].focus();
          }}
        >
          {featured.map((game) => (
            <button
              key={game.id}
              class={game.id === hero.id ? "selected" : ""}
              onClick={() => setSelected(game.id)}
              aria-label={`Feature ${game.name}`}
              aria-pressed={game.id === hero.id}
              title={game.name}
            >
              <GameCover game={game} />
              <span class="feature-choice">
                <strong>{game.name}</strong>
                <small>{libraryPlatform(game)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
