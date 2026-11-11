# Privacy and release hygiene

## Public source and packages

The repository contains application code, synthetic fixtures, public asset provenance, tooling, and documentation. Release payloads contain the application, license, short instructions, and required notices.

User libraries, account details, exports, machine reports, development screenshots, private paths, and previous build outputs are excluded. Git attribution uses the requested public display name and a GitHub no-reply address. Repository ownership and commit attribution remain publicly visible. Required third-party attribution is retained.

The release build remaps checkout, Windows profile, and toolchain paths. Release symbols are stripped. The privacy checker scans source and payload inputs for local identity markers, user-directory paths, account IDs, private keys, and common access-token formats in UTF-8 and UTF-16.

These checks supplement manual review and cannot prove the absence of every metadata channel. Compressed archives require extracted-payload inspection. The packager uses an explicit file list and does not select diagnostics, logs, exports, or local libraries.

## Local data

Nexus requires titles, executable paths, installation locations, launch arguments, favorites, folder configuration, and artwork references to function. These records belong to the local user's installation.

JSON/caches use Windows application data for com.nexus.launcher. The library is library.json, configured folders use folders.json, and metadata/artwork have cache directories. WebView preferences live in its local storage.

The portable executable uses the same storage convention. Moving the executable does not move its profile. Exported JSON can contain identifying paths and arguments and should be reviewed before sharing.

Startup diagnostics record the application version, timestamp, elapsed timing, and cached-game count. Optional --diagnose and profiling commands produce local details. Such output can identify software or installation paths and is excluded from publication.

## Provider access

Steam registry paths and a non-secret active-user number locate narrow installation/description data. Epic installation manifests and identity-matched catalog metadata are read.

Production discovery avoids account/session caches, cookies, encrypted licenses, provider browser profiles, and credential reuse. It does not navigate or scrape launcher windows.

User-configured game/ROM folders are scanned only after configuration, with bounded recursion. A finite Windows helper queries qualifying installed game packages. Nexus does not scan arbitrary personal documents.

## Network behavior

Public Steam/Epic metadata requests and approved image CDN requests can disclose an app ID or product slug, application user agent, and ordinary connection metadata such as IP address to the provider. They do not upload a library or folder list.

Trusted artwork handling rejects URL credentials, limits hosts and image sizes, and uses timeouts. Offline caches support continued browsing when requests fail.

Nexus contains no analytics endpoint, advertising integration, telemetry SDK, cloud-library service, account login, or built-in automatic updater. Original launchers have their own network behavior and privacy policies.

## Safe issue reports

Prefer synthetic reproductions. Review screenshots, diagnostics, and exports for account names, paths, and arguments before sharing. Never send credentials, tokens, cookies, or private keys.

The privacy checker reports relative filenames and finding categories rather than the matched private value. Additional markers can be supplied locally through NEXUS_PRIVACY_TERMS as a JSON array in the environment.
