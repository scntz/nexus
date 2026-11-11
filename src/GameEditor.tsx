import { useRef, useState } from "preact/hooks";
import { Modal, GameCover } from "./components";
import { Icon } from "./icons";
import { isArtworkUrl, readArtworkFile } from "./artwork";
import { isDesktop, native } from "./bridge";
import type { Game } from "./types";
import { errorMessage } from "./errors";

export function GameEditor({
  game,
  onClose,
  onSave,
}: {
  game: Game;
  onClose: () => void;
  onSave: (game: Game) => Promise<void>;
}) {
  const [name, setName] = useState(game.name);
  const [genre, setGenre] = useState(game.genre || "");
  const [description, setDescription] = useState(game.description || "");
  const [cover, setCover] = useState(game.cover || "");
  const [hero, setHero] = useState(game.hero || "");
  const [executable, setExecutable] = useState(game.executable || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const canEditLaunch = [
    "Standalone",
    "Emulator",
    "EA",
    "GOG",
    "Battle.net",
  ].includes(game.platform);
  async function chooseExecutable() {
    try {
      const path = await native<string | null>("pick_file", {
        kind: "executable",
      });
      if (path) setExecutable(path);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal
      title="Edit game"
      className="editor-modal"
      onClose={onClose}
      busy={saving}
    >
      <p class="modal-intro">
        Fine-tune the details. Your changes stay in Nexus and are preserved when
        you sync.
      </p>
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setSaving(true);
          try {
            if (!name.trim()) throw new Error("Enter a game name.");
            if (cover && !isArtworkUrl(cover))
              throw new Error(
                "Choose an image file or use a Steam or Epic artwork URL.",
              );
            if (hero && !isArtworkUrl(hero))
              throw new Error(
                "Use a Steam or Epic artwork URL for the background.",
              );
            if (
              canEditLaunch &&
              executable &&
              executable !== game.executable &&
              isDesktop
            )
              await native("validate_launch_path", { path: executable.trim() });
            await onSave({
              ...game,
              name: name.trim(),
              genre: genre.trim() || undefined,
              description: description.trim() || undefined,
              cover: cover
                ? cover.startsWith("data:") || cover.startsWith("/")
                  ? cover
                  : new URL(cover).href
                : undefined,
              hero: hero
                ? hero.startsWith("/")
                  ? hero
                  : new URL(hero).href
                : undefined,
              executable: canEditLaunch
                ? executable.trim() || undefined
                : game.executable,
              customized: true,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div class="editor-layout">
          <div class="editor-art">
            <div class="editor-cover">
              <GameCover game={{ ...game, cover: cover || undefined }} eager />
            </div>
            <button
              type="button"
              class="button secondary small"
              onClick={() => imageInput.current?.click()}
            >
              <Icon name="image" size={14} />
              Choose cover
            </button>
            <span>PNG, JPEG, WebP · up to 2 MB</span>
            <input
              ref={imageInput}
              class="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Choose cover image"
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0];
                if (file)
                  try {
                    setCover(await readArtworkFile(file));
                    setError("");
                  } catch (e) {
                    setError(errorMessage(e));
                  }
              }}
            />
          </div>
          <div class="editor-fields">
            <label>
              Game name
              <input
                class="text-input"
                value={name}
                onInput={(e) => setName(e.currentTarget.value)}
                maxLength={200}
                required
              />
            </label>
            <label>
              Genre
              <input
                class="text-input"
                value={genre}
                onInput={(e) => setGenre(e.currentTarget.value)}
                maxLength={100}
                placeholder="e.g. Action adventure"
              />
            </label>
            <label>
              Description
              <textarea
                class="text-input"
                value={description}
                onInput={(e) => setDescription(e.currentTarget.value)}
                maxLength={1500}
                rows={4}
                placeholder="A little context for your next adventure."
              />
            </label>
          </div>
        </div>
        <details class="editor-advanced">
          <summary>
            Artwork links & launch options
            <Icon name="chevron" size={14} />
          </summary>
          <div>
            <label>
              Cover URL
              <input
                class="text-input"
                value={cover.startsWith("data:") ? "" : cover}
                onInput={(e) => setCover(e.currentTarget.value)}
                placeholder={
                  cover.startsWith("data:")
                    ? "Custom image selected"
                    : "https://shared.steamstatic.com/…"
                }
              />
            </label>
            <label>
              Background URL
              <input
                class="text-input"
                value={hero}
                onInput={(e) => setHero(e.currentTarget.value)}
                placeholder="Steam or Epic image URL"
              />
            </label>
            {canEditLaunch && (
              <label>
                {game.platform === "Emulator"
                  ? "Emulator executable"
                  : "Game executable"}
                <div class="file-input">
                  <input
                    class="text-input"
                    value={executable}
                    onInput={(e) => setExecutable(e.currentTarget.value)}
                    placeholder="C:\Games\My Game\game.exe"
                  />
                  <button
                    type="button"
                    class="button secondary"
                    aria-label="Browse game executable"
                    onClick={chooseExecutable}
                  >
                    <Icon name="folder" size={17} />
                  </button>
                </div>
              </label>
            )}
          </div>
        </details>
        {error && (
          <div class="form-error" role="alert">
            <Icon name="info" size={16} />
            {error}
          </div>
        )}
        <div class="form-actions">
          <button
            class="button secondary"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button class="button primary" type="submit" disabled={saving}>
            <Icon name="check" size={16} />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
