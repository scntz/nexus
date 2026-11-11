import { useEffect, useState } from "preact/hooks";
import { native, isDesktop } from "./bridge";
import { Modal } from "./components";
import { Icon } from "./icons";
import { errorMessage } from "./errors";
import type { FolderSource } from "./types";
const systems = [
  "PlayStation",
  "PlayStation 2",
  "PlayStation 3",
  "PSP",
  "PlayStation Vita",
  "Nintendo Switch",
  "Nintendo 3DS",
  "Nintendo DS",
  "Nintendo 64",
  "Super Nintendo",
  "Nintendo Entertainment System",
  "Game Boy",
  "Game Boy Advance",
  "GameCube",
  "Wii",
  "Wii U",
  "Xbox",
  "Xbox 360",
  "Dreamcast",
  "Mega Drive",
];
export function FolderSources({
  onScan,
  onError,
}: {
  onScan: () => void;
  onError: (message: string) => void;
}) {
  const [sources, setSources] = useState<FolderSource[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isDesktop)
      native<FolderSource[]>("folder_sources")
        .then((v) => setSources(v ?? []))
        .catch((e) => onError(errorMessage(e)));
  }, []);
  async function save(next: FolderSource[]) {
    setBusy(true);
    try {
      await native("save_folder_sources", { sources: next });
      setSources(next);
      setAdding(false);
      onScan();
    } catch (e) {
      onError(errorMessage(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="folder-sources">
      <div class="accounts-heading">
        <div>
          <h2>Game folders</h2>
          <p>Scan standalone games and ROM folders when Nexus syncs.</p>
        </div>
        <button
          class="button secondary"
          disabled={!isDesktop || busy}
          onClick={() => setAdding(true)}
        >
          <Icon name="folder" size={16} />
          Add folder
        </button>
      </div>
      {sources.length ? (
        sources.map((source) => (
          <div class="folder-source-row" key={source.id}>
            <span class="folder-source-icon">
              <Icon name={source.system ? "gamepad" : "folder"} size={22} />
            </span>
            <div>
              <strong>{source.system ?? "Standalone games"}</strong>
              <span title={source.path}>{source.path}</span>
            </div>
            <button
              class="icon-button"
              aria-label={`Remove ${source.path}`}
              disabled={busy}
              onClick={() =>
                void save(sources.filter((s) => s.id !== source.id)).catch(
                  () => {},
                )
              }
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))
      ) : (
        <div class="folder-empty">
          <Icon name="folder" size={20} />
          <p>
            No additional folders. Use Add game for individual executables or
            emulator and ROM pairs.
          </p>
        </div>
      )}
      {adding && (
        <AddFolder
          busy={busy}
          onClose={() => setAdding(false)}
          onAdd={(source) => save([...sources, source])}
        />
      )}
    </section>
  );
}
function AddFolder({
  busy,
  onClose,
  onAdd,
}: {
  busy: boolean;
  onClose: () => void;
  onAdd: (s: FolderSource) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [system, setSystem] = useState("");
  const [executable, setExecutable] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Add game folder" onClose={onClose} busy={busy}>
      <p class="modal-intro">
        Choose a folder containing your games. Nexus scans up to four folder
        levels during library sync; it does not run a background file watcher.
      </p>
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onAdd({
              id: crypto.randomUUID(),
              path,
              system: system || undefined,
              executable: system ? executable : undefined,
            });
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        <label>
          Platform
          <select
            class="text-input"
            value={system}
            onChange={(e) => setSystem(e.currentTarget.value)}
          >
            <option value="">Standalone games</option>
            {systems.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Game folder
          <div class="file-input">
            <input
              class="text-input"
              value={path}
              onInput={(e) => setPath(e.currentTarget.value)}
              required
            />
            <button
              type="button"
              class="button secondary"
              aria-label="Browse game folder"
              onClick={async () => {
                try {
                  const path = await native<string | null>("pick_folder");
                  if (path) setPath(path);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <Icon name="folder" size={18} />
            </button>
          </div>
        </label>
        {system && (
          <label>
            Emulator executable
            <div class="file-input">
              <input
                class="text-input"
                value={executable}
                onInput={(e) => setExecutable(e.currentTarget.value)}
                required
              />
              <button
                type="button"
                class="button secondary"
                aria-label="Browse emulator executable"
                onClick={async () => {
                  try {
                    const path = await native<string | null>("pick_file", {
                      kind: "executable",
                    });
                    if (path) setExecutable(path);
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                <Icon name="folder" size={18} />
              </button>
            </div>
          </label>
        )}
        {error && (
          <div class="form-error" role="alert">
            {error}
          </div>
        )}
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button class="button primary" disabled={busy}>
            {busy ? "Saving…" : "Add folder"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
