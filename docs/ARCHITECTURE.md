# Architecture

## Process model

Rust and Tauri provide native storage, discovery, file selection, launch validation, and lifecycle management. Preact and TypeScript render the interface through Windows WebView2. Vite bundles the frontend. Fonts, platform icons, and preview assets are local files.

The window thread loads the saved collection through an asynchronous native call. The frontend waits for visible rendering before requesting a background full scan. Metadata and artwork can complete after the collection becomes interactive.

| Area | Modules |
| --- | --- |
| App state, toolbar, Settings, queued persistence | src/App.tsx |
| Search/sort caches, merge rules, metadata preservation | src/library.ts |
| Viewport rendering, geometry, keyboard navigation | src/GameViewport.tsx |
| Conservative duplicate groups | src/duplicates.ts |
| Featured artwork and game pages | src/FeaturedGames.tsx, src/GameDetails.tsx, src/GameEditor.tsx |
| Filtering, coverage, optional folders | src/LibraryFilterPanel.tsx, src/SourcesPanel.tsx, src/FolderSources.tsx |
| Native invocation and browser preview | src/bridge.ts |
| Artwork validation and identity fallbacks | src/artwork.ts, src/catalog.ts |
| Native commands, library storage, launch validation | src-tauri/src/lib.rs |
| Provider discovery and Valve KeyValues | discovery.rs, vdf.rs |
| Filesystem notifications | auto_discovery.rs |
| Configured folder scans and stable IDs | folders.rs |
| Local/public metadata | local_metadata.rs, metadata.rs |
| Trusted image serving and bounded cache | art_cache.rs |
| Windows helper lifetime | child_job.rs |

## Persistence

The native library store uses JSON under the app's Windows data directory. A mutex serializes access. Saves replace the existing file through a temporary file rather than truncating it.

Malformed library JSON is preserved in a unique recovery file before automatic rebuilding. An I/O failure is reported instead of silently becoming an empty library.

Frontend mutations update the visible collection and queue saves. Failure can roll an operation back to its last persisted value and show an error. Discovery requests are serialized, with a pending follow-up scope retained during a running scan.

Merging preserves favorites, customization, historical records, and unaffected provider state. Source warnings and last-sync state are separate from game data. Preferences and hidden IDs use WebView local storage. Folder configuration has its own JSON file.

## Rendering and performance

Search normalization is cached per game object, and sorted indexes per collection/sort. Merge logic reuses unchanged objects to keep caches effective.

The virtualized grid/list mounts visible rows plus two overscan rows. ResizeObserver responds to window, layout, and surrounding-content changes. Keyboard navigation can move beyond the mounted slice and restore focus to the selected card.

Discovery does not run on animation frames or a continuous polling interval. Frames are used for initial paint ordering and layout/focus work. Native watchers wait for operating-system events. There is no persistent tray process or scheduled task.

WebView2's renderer and utility processes contribute to resource use. Hardware, library size, artwork, and active discovery affect measurements. Universal startup-time or RAM guarantees are not made.

## Bounds and validation

The saved library is limited to 50 MB and 50,000 entries. Folder scans have finite depth/entry budgets and bounded output. Limits produce warnings or incomplete results.

Artwork work uses four workers, a bounded queue, timeouts, per-image limits, and a 256 MB disk budget. Pruning removes older cache files. Metadata refresh also has request/time budgets.

Native launches resolve a saved ID and validate the executable or provider protocol. Manual executable and image paths are validated. Process arguments are passed as arguments. Uninstall command text is not a launch source.

The frontend CSP restricts scripts and artwork origins. The Tauri window has a narrow capability declaration. A compatibility installation-status probe exists in the native API; the current interface uses discovery for availability and delegates downloads to providers.

## Adding integrations

Discovery adapters need stable IDs, explicit scanned scope, and incomplete-result handling. Metadata adapters enrich independently identified games. Artwork cannot authorize an ownership entry.

Preserve old saved representations when changing providers. Test partial scans, corrupt manifests, storage failures, customization, and launch-target validation. New work should stay bounded and off the window thread.
