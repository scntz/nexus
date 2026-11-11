import type { ComponentChildren, RefObject } from "preact";
import { Brand, Icon } from "./icons";
import type { Availability } from "./library";
import { platforms, type Platform } from "./types";

const availabilityOptions = [
  ["all", "All games"],
  ["installed", "Installed"],
  ["uninstalled", "Not installed"],
] as const;

function FilterChoice({
  children,
  selected,
  group,
  onChange,
}: {
  children: ComponentChildren;
  selected: boolean;
  group?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="filter-choice">
      <input
        type={group ? "radio" : "checkbox"}
        name={group}
        checked={selected}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span class="filter-choice-label">{children}</span>
      <Icon name="check" size={16} className="filter-choice-check" />
    </label>
  );
}

export function LibraryFilterPanel({
  panelRef,
  availability,
  platform,
  availablePlatforms,
  favoritesOnly,
  canReset,
  onAvailabilityChange,
  onPlatformChange,
  onFavoritesChange,
  onReset,
  onClose,
}: {
  panelRef: RefObject<HTMLElement>;
  availability: Availability;
  platform: string;
  availablePlatforms: string[];
  favoritesOnly: boolean;
  canReset: boolean;
  onAvailabilityChange: (value: Availability) => void;
  onPlatformChange: (value: string) => void;
  onFavoritesChange: (checked: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div class="filter-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        id="library-filters"
        ref={panelRef}
        class="filter-drawer"
        aria-labelledby="filter-drawer-title"
      >
        <div class="filter-drawer-header">
          <h2 id="filter-drawer-title">Filters</h2>
          <button
            class="filter-reset"
            aria-label="Reset filters"
            disabled={!canReset}
            onClick={onReset}
          >
            Reset
          </button>
          <button
            class="icon-button"
            aria-label="Close filters"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div class="filter-favorites">
          <FilterChoice selected={favoritesOnly} onChange={onFavoritesChange}>
            Favorites only
          </FilterChoice>
        </div>
        <details class="filter-group" open>
          <summary>
            Availability <Icon name="chevron" size={16} />
          </summary>
          <fieldset aria-label="Availability">
            {availabilityOptions.map(([value, label]) => (
              <FilterChoice
                key={value}
                group="filter-availability"
                selected={availability === value}
                onChange={() => onAvailabilityChange(value)}
              >
                {label}
              </FilterChoice>
            ))}
          </fieldset>
        </details>
        {availablePlatforms.length > 0 && (
          <details class="filter-group" open>
            <summary>
              Platform <Icon name="chevron" size={16} />
            </summary>
            <fieldset aria-label="Platform">
              <FilterChoice
                group="filter-platform"
                selected={platform === "all"}
                onChange={() => onPlatformChange("all")}
              >
                All platforms
              </FilterChoice>
              {availablePlatforms.map((label) => (
                <FilterChoice
                  key={label}
                  group="filter-platform"
                  selected={platform === label}
                  onChange={() => onPlatformChange(label)}
                >
                  <Brand
                    platform={
                      platforms.includes(label as Platform)
                        ? (label as Platform)
                        : "Emulator"
                    }
                    size={15}
                  />
                  {label}
                </FilterChoice>
              ))}
            </fieldset>
          </details>
        )}
      </aside>
    </>
  );
}
