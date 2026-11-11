import { Modal, GameCover, HeroArtwork } from "./components";
import { Brand, Icon } from "./icons";
import { gameAction } from "./actions";
import { relativeTime } from "./library";
import { libraryPlatform } from "./platforms";
import type { Game } from "./types";
import { bundledArtwork } from "./catalog";

const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function GameDetails({
  game,
  copies = [game],
  onSelectCopy,
  desktop,
  launching,
  onClose,
  onPlay,
  onFavorite,
  onEdit,
  onHide,
  onRefresh,
  onReveal,
  onSync,
}: {
  game: Game;
  copies?: Game[];
  onSelectCopy?: (game: Game) => void;
  desktop: boolean;
  launching: boolean;
  onClose: () => void;
  onPlay: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onHide: () => void;
  onRefresh: () => void;
  onReveal: () => void;
  onSync: () => void;
}) {
  const action = gameAction(game);
  const artwork = bundledArtwork(game);
  const genre = game.genre || artwork?.genre;
  const description = game.description || artwork?.description;
  const launchNote = desktop
    ? action.reason
    : "Playing and installing require Nexus for Windows.";
  const actionIcon = launching
    ? "sync"
    : !game.installed
      ? game.platform === "GOG"
        ? "external"
        : "download"
      : action.enabled
        ? "play"
        : "settings";
  const launchMethod = game.executable
    ? game.platform === "Emulator"
      ? "Emulator + ROM"
      : "Game executable"
    : `${libraryPlatform(game)} launcher`;
  return (
    <Modal
      title="Game details"
      className="game-modal showcase-details"
      onClose={onClose}
    >
      <div class="detail-hero">
        <HeroArtwork key={game.id} game={game} />
        <div class="detail-hero-shade" />
        <div class="detail-hero-title">
          <GameCover className="detail-cover" game={game} eager />
          <div class="detail-identity">
            <div class="detail-platform">
              <span class="detail-platform-label">
                <Brand platform={game.platform} size={17} />
                {libraryPlatform(game)}
              </span>
              <span
                class={`detail-availability ${game.installed ? "is-installed" : ""}`}
              >
                <span class={`status-dot ${game.installed ? "" : "muted"}`} />
                {game.installed ? "Installed" : "Not installed"}
              </span>
            </div>
            <h2>{game.name}</h2>
            {genre && <span class="genre-tag">{genre}</span>}
            <div class="detail-action-panel">
              <button
                class="button primary detail-play"
                disabled={
                  launching || !desktop || (!action.enabled && !action.repair)
                }
                aria-busy={launching || undefined}
                aria-describedby={launchNote ? "launch-reason" : undefined}
                onClick={
                  action.enabled
                    ? onPlay
                    : action.repair === "sync"
                      ? onSync
                      : onEdit
                }
              >
                <Icon
                  name={actionIcon}
                  size={17}
                  fill={actionIcon === "play"}
                />
                {launching ? "Opening…" : action.label}
              </button>
              <button
                class="button detail-favorite"
                aria-pressed={game.favorite}
                onClick={onFavorite}
              >
                <Icon name="star" size={17} fill={game.favorite} />
                {game.favorite ? "Favorited" : "Favorite"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {launchNote && (
        <p class="detail-launch-note" id="launch-reason">
          <Icon name="info" size={16} />
          {launchNote}
        </p>
      )}
      {copies.length > 1 && (
        <div class="game-copies" role="group" aria-label="Available copies">
          <h3>Choose a copy</h3>
          <div>
            {copies.map((copy) => (
              <button
                class={`game-copy ${copy.id === game.id ? "selected" : ""}`}
                aria-pressed={copy.id === game.id}
                onClick={() => onSelectCopy?.(copy)}
                key={copy.id}
              >
                <Brand platform={copy.platform} size={18} />
                <span>
                  <strong>{libraryPlatform(copy)}</strong>
                  <small>
                    {copy.installed ? "Installed" : "Not installed"}
                  </small>
                </span>
                {copy.id === game.id && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="detail-body">
        <section class="detail-main" aria-labelledby="detail-overview">
          <h3 id="detail-overview">About this game</h3>
          <p class="game-description">
            {description || "You can add a description in Edit details."}
          </p>
          {!game.installed && (
            <p class="discovery-detail">
              <Icon name="info" size={16} />
              <span>
                {game.discoverySource === "history"
                  ? "Previously detected on this PC."
                  : "Saved in your Nexus library."}{" "}
                {action.enabled &&
                  "Your launcher checks access when you install."}
              </span>
            </p>
          )}
        </section>
        <section
          class="detail-activity"
          aria-labelledby="detail-activity-title"
        >
          <h3 id="detail-activity-title">Your activity</h3>
          <dl class="detail-facts">
            <div>
              <dt>
                <Icon name="clock" size={15} />
                Time played
              </dt>
              <dd>
                {game.playtime
                  ? `${hours.format(game.playtime)} h`
                  : "Not tracked"}
              </dd>
            </div>
            <div>
              <dt>
                <Icon name="play" size={15} />
                Last launched
              </dt>
              <dd>{relativeTime(game.lastPlayed)}</dd>
            </div>
            <div>
              <dt>
                <Icon name="layers" size={15} />
                Launch method
              </dt>
              <dd>{launchMethod}</dd>
            </div>
          </dl>
        </section>
      </div>
      {game.installPath && (
        <div class="detail-install-path">
          <Icon name="folder" size={15} />
          <span title={game.installPath}>{game.installPath}</span>
        </div>
      )}
      <div class="game-management">
        <button onClick={onEdit}>
          <Icon name="edit" size={15} />
          Edit details
        </button>
        <button
          disabled={!desktop || (!game.installPath && !game.executable)}
          onClick={onReveal}
        >
          <Icon name="folder" size={15} />
          Open folder
        </button>
        <button
          disabled={
            !desktop || !["Steam", "Epic Games"].includes(game.platform)
          }
          onClick={onRefresh}
        >
          <Icon name="sync" size={15} />
          Refresh artwork
        </button>
        <button class="hide-game" onClick={onHide}>
          <Icon name="hide" size={15} />
          Hide game
        </button>
      </div>
    </Modal>
  );
}
