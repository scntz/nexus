# User guide

## Install and open

Nexus 1.0.1 targets Windows 10 and 11 on x64. Microsoft Edge WebView2 supplies the desktop webview. Download either distribution from GitHub Releases.

For the portable, extract the archive into a writable folder and open Nexus.exe. The executable can be moved independently of an installer. Its library and preferences use Windows application-data folders, so this is not a self-contained USB profile.

The setup installs Nexus for the current Windows user. Its WebView2 bootstrapper may need internet access when the runtime is missing. The application is unsigned and Windows may show a publisher or reputation prompt. Review the download source and compare the published SHA-256 checksum.

Nexus loads its saved collection first. After the collection renders in the visible window, one automatic full sync starts asynchronously. Existing local Steam/Epic sign-in needs no additional action in Nexus. Coverage depends on local installation records. See [Discovery](DISCOVERY.md) for provider-specific boundaries.

## Collection controls

The single toolbar contains search, Sync, sorting, grid/list views, Filters, Add game, and Settings. The plus button opens Add game and the gear opens Settings. Controls remain reachable while scrolling.

Search matches stored title, platform, and genre text, ignoring common accent/punctuation differences. Ctrl+K focuses search. The clear button removes the query. Sort by name, stored playtime, or platform. Playtime can be absent. Nexus records launch requests and a last-played timestamp; it does not measure complete session duration.

Grid view emphasizes artwork. List view exposes additional saved metadata. Large libraries render a viewport-sized subset of cards. Arrow keys, Home, End, Page Up, and Page Down navigate the collection. Layout, sort, compact-cover, and reduced-motion preferences are saved locally.

## Filtering and favorites

Filters combine availability, platform, and Favorites only with search. Wider windows dock the panel beside the collection. Compact windows show an overlay. Sections expand and collapse. Platform choices reflect the collection, including identified emulator systems.

Active chips clear individual criteria. Reset clears search and filters. Escape closes the panel. Installed and uninstalled filters describe local/saved entries, not live license checks.

A star changes favorite state. Grouped cards can represent copies from several providers. The group action affects the copies represented by the card. Individual copies can also be selected in details.

## Details and launch actions

Select a game for its provider, availability, description, artwork, and actions. Matching provider copies appear in an available-copies selector. Play and Install hand off to the original client or a validated executable.

A successful request means Windows accepted the handoff. The provider controls entitlement checks, downloading, updates, and game startup. Some detected titles require repairing their executable in Edit details.

Edit details changes the saved fields exposed by the editor, including artwork and launch information. User customization survives later scans. Use local artwork when automatic metadata is missing. Official artwork refresh is available where supported.

Hide removes a card from the visible collection. Undo reverses the recent hide action, and Settings can restore all hidden games. Game files are not uninstalled by hiding.

## Standalone games, emulators, and folders

Add an individual executable or an emulator/ROM pair through the plus button. Windows .exe paths and readable game images are validated. Nexus includes neither an emulator nor game ROMs.

Settings → Game sources → Game folders configures directory scans. Scanning stops after four levels and a finite entry budget. Directory links and ambiguous executable groups are skipped. Use individual entries for deep or ambiguous layouts.

## Settings, backup, and offline use

General contains appearance, duplicate grouping, artwork refresh, hidden-game restoration, export, and local discovery controls. Game sources shows detected launchers, saved entries, discovery limits, and configured folders.

Export creates a JSON backup with saved game metadata. It can contain installation paths, executable arguments, and artwork references. Treat exports as personal data. The release has an export action and no corresponding manual library-import workflow.

Cached games support browsing, search, favorites, and editing offline. Cached artwork remains available. First discovery, metadata completion, and provider actions can require accessible installations or network services.

Closing Nexus exits the window, native notifications, and associated helper work. There is no tray mode or scheduled discovery service.
