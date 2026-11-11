import { Brand, Icon } from "./icons";
import type { Game, Platform, SourceStatus } from "./types";

export function SourcesPanel({
  games,
  sources,
  onView,
}: {
  games: Game[];
  sources: SourceStatus[];
  onView: (platform: Platform) => void;
}) {
  const counts = new Map<Platform, { installed: number; saved: number }>();
  for (const game of games) {
    if (game.platform === "Emulator") continue;
    const count = counts.get(game.platform) ?? { installed: 0, saved: 0 };
    if (game.installed) count.installed++;
    else count.saved++;
    counts.set(game.platform, count);
  }
  const detected = new Map(
    sources.map((source) => [source.platform, source.detected]),
  );
  const visible = new Set<Platform>();
  for (const source of sources)
    if (
      source.platform !== "Emulator" &&
      (source.detected || counts.has(source.platform))
    )
      visible.add(source.platform);
  for (const platform of counts.keys()) visible.add(platform);
  return (
    <section aria-label="Automatic discovery">
      <div class="accounts-heading">
        <div>
          <h2>Detected launchers</h2>
          <p>
            Updated when local game manifests change and when you return to
            Nexus.
          </p>
        </div>
        <span class="automatic-status">
          <span class="status-dot" /> Automatic
        </span>
      </div>
      <div class="account-grid">
        {[...visible].map((platform) => {
          const { installed, saved } = counts.get(platform) ?? {
            installed: 0,
            saved: 0,
          };
          return (
            <article class="account-card" key={platform}>
              <div class="account-card-heading">
                <span class="account-logo">
                  <Brand platform={platform} size={28} />
                </span>
                <div>
                  <h3>{platform}</h3>
                  <p class="account-state">
                    <span
                      class={`status-dot ${detected.get(platform) ? "" : "muted"}`}
                    />
                    {detected.get(platform)
                      ? "Detected locally"
                      : "Saved collection"}
                  </p>
                </div>
              </div>
              <div class="account-count">
                <strong>{installed}</strong>
                <span>
                  installed
                  {saved > 0 ? ` · ${saved} saved` : ""}
                </span>
              </div>
              <p class="source-description">
                {platform === "Steam"
                  ? "Nexus reads installation records from your registered Steam library folders."
                  : platform === "Epic Games"
                    ? "Nexus uses installation records and matches catalog metadata to identified games."
                    : "Local and saved games for this platform."}
              </p>
              <div class="account-actions">
                <button
                  class="button secondary small"
                  disabled={!installed && !saved}
                  onClick={() => onView(platform)}
                >
                  View games <Icon name="right" size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.size && (
        <div class="source-empty">
          <Icon name="library" size={30} />
          <h3>No local launchers detected</h3>
          <p>
            Steam and Epic games appear automatically as their local manifests
            become available.
          </p>
        </div>
      )}
      <div class="discovery-note">
        <Icon name="info" size={18} />
        <div>
          <strong>About uninstalled games</strong>
          <p>
            Saved titles remain in Nexus after you uninstall them. Check your
            Steam or Epic account for the complete list of games you own.
          </p>
        </div>
      </div>
    </section>
  );
}
