import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Game } from "./types";
import { Brand, Icon } from "./icons";
import { bundledArtwork } from "./catalog";
import { libraryPlatform } from "./platforms";
import { artworkSource } from "./artwork";

export function Modal({
  children,
  title,
  onClose,
  className = "",
  busy = false,
}: {
  children: ComponentChildren;
  title: string;
  onClose: () => void;
  className?: string;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      class={`modal ${className}`}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-body">
        <div class="modal-header">
          <h2>{title}</h2>
          <button
            class="icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function GameCover({
  game,
  className = "",
  eager = false,
}: {
  game: Game;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [game.cover, game.id]);
  const source = [game.cover, bundledArtwork(game)?.cover].find(
    (url) => url && !failed.includes(url),
  );
  return source ? (
    <img
      class={className}
      src={artworkSource(source)}
      alt={`${game.name} cover`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed((old) => [...old, source])}
    />
  ) : (
    <div class={`cover-fallback ${className}`}>
      <Brand platform={game.platform} size={38} />
      <span>{game.name}</span>
      <small>{libraryPlatform(game)}</small>
    </div>
  );
}

export function HeroArtwork({ game }: { game: Game }) {
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [game.id, game.hero, game.cover]);
  const local = bundledArtwork(game);
  const source = [game.hero, local?.hero, game.cover, local?.cover].find(
    (url) => url && !failed.includes(url),
  );
  return source ? (
    <img
      class="hero-art"
      src={artworkSource(source)}
      alt=""
      decoding="async"
      onError={() => setFailed((old) => [...old, source])}
    />
  ) : null;
}

export function CreditsModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("Loading notices…");
  useEffect(() => {
    let active = true;
    fetch("/THIRD_PARTY_NOTICES.txt")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load the bundled notices.");
        return r.text();
      })
      .then((value) => {
        if (active) setText(value);
      })
      .catch((error) => {
        if (active) setText(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Modal
      title="Credits & licenses"
      onClose={onClose}
      className="credits-modal"
    >
      <p class="modal-intro">
        Platform logos identify the original game platforms. All trademarks
        belong to their respective owners.
      </p>
      <pre class="license-text">{text}</pre>
    </Modal>
  );
}
