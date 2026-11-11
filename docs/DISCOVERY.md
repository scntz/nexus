# Discovery and limitations

## Provider support

Nexus uses explicit local evidence and saved user data. Automatic local discovery does not establish a complete account-level owned library.

| Source | Local input | Supported result and limits |
| --- | --- | --- |
| Steam | Installation registry, libraryfolders.vdf, appmanifest_*.acf | Registered libraries, app IDs, titles, installation state, and manifest progress. Restricted/disconnected libraries can make results partial. |
| Epic Games | Installation manifests | App/namespace identity, installation paths, readiness. Catalog metadata enriches games already detected. |
| Xbox / Microsoft Store | Installed packages containing MicrosoftGame.config | Qualifying game registrations and shell targets. This does not enumerate every Gaming Services installation or subscription entitlement. |
| GOG | Windows game registry records | Installed games with existing folders and recorded executables. |
| Ubisoft Connect | Install registry records | Installed folders and launch URIs. Folder-derived names may need editing. |
| EA | Windows uninstall records with matching publisher and installation folder | Installed candidates. Executables are chosen only when unambiguous. |
| Battle.net | Windows uninstall records with matching publisher and installation folder | Installed candidates with the same conservative executable handling. |
| Standalone | Individual entries and configured folders | Bounded executable discovery. Ambiguous folders need an individual entry. |
| Emulators | Explicit emulator/image pairs and configured system folders | User-provided emulator/ROM launch entries and recognized system labels. |

A source appearing in Settings indicates detected local records or saved entries. It does not prove that every account, drive, or supported game was scanned.

## Ownership and uninstalled games

Installation manifests identify games and describe their current local readiness. Incomplete/unreadable scans preserve affected previous installation state until a reliable scan succeeds.

If a previously detected game disappears from a complete scan of its provider, Nexus retains it as history and marks it uninstalled. Favorites and custom details survive. Details distinguish local discovery, history, manual entries, and older saved data.

History is not a fresh entitlement check. A game may have been refunded, shared, subscribed, moved, or installed under another account. Missing installation files do not prove missing ownership.

A fresh installation can miss games never installed or saved in Nexus. Signing into an original client does not expose that client's authenticated account library to Nexus. There are no additional account connections, login forms, API-key fields, or manual owned-library imports.

Valve documents a key requirement for GetOwnedGames. Epic's commerce interfaces operate within an authenticated user/product context. Nexus does not reuse provider credentials or browser sessions. [Valve owned-games API](https://partner.steamgames.com/doc/webapi/IPlayerService), [Epic commerce documentation](https://dev.epicgames.com/docs/epic-games-store/services/ecom/ecom-overview)

## Metadata and artwork

Steam artwork caches can include browsed products. The non-secret active-user registry number selects descriptions only for app IDs independently detected elsewhere. Neither cache enumerates owned games.

Epic catalog records may include engines, add-ons, unrelated products, or stale titles. Namespace, catalog item, and app identity must match an already detected game before enrichment. Cached metadata never creates ownership.

Public metadata/artwork services supplement these records. Their availability, schemas, rate limits, and product identity can affect covers. Fallback artwork matches known provider identities. Preview fixtures are explicitly synthetic.

## Sync behavior

The saved collection paints before one full startup scan begins in the visible window. Later Steam/Epic updates use narrow native filesystem notifications, burst debouncing, and throttled window-return checks.

Full scans include other supported registrations and configured folders. Fast follow-ups change installation state only for the scopes they actually scanned. Other providers may need manual full Sync or another application start.

The Windows package helper has a deadline, output cap, and job-based cleanup. Folder scans have four levels and a 20,000-entry traversal budget per source. Limits, restricted paths, and unavailable drives can produce incomplete results.

## Additional boundaries

Original clients handle downloads, cancellation, repair, updates, DRM, licenses, and cloud saves. Nexus has no download manager, achievements synchronization, social/chat integration, account switching, or cloud backup.

Duplicate grouping normalizes exact titles across providers, preserves edition/sequel/remaster words, and keeps multiple same-provider entries distinct. Names can still require manual correction. Grouping is optional.

Anonymous web and accessibility approaches were explored during development. Reliable, complete passive ownership import was not established. Production discovery does not scrape provider windows, use OCR crawling, navigate launchers, inject code, attach browser debugging, or extract credential caches.

Validation covers fixtures and supported code paths. It does not qualify every account, launcher version, emulator, game, or Windows configuration. See [Release status](STATUS.md).
