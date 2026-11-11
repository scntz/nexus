# Release status

## 1.0.1 licensing correction

Project code and documentation are now dual-licensed under MIT OR Apache-2.0, at the recipient's option. Source metadata, documentation, and both Windows distributions include this choice and the complete license texts. The 1.0.0 release remains available as originally published.

The correction passed 58 frontend tests, five privacy-check regressions, source/payload privacy scans, SPDX/version consistency checks, and extracted-archive license/binary integrity checks.

## Achievements in 1.0.0

The application includes an artwork-led collection, a persistent toolbar, instant local search, grid/list views, favorites, platform/availability filters, game details, customization, optional duplicate grouping, hidden-game restoration, and export.

The collection loads before asynchronous discovery. Steam/Epic changes can trigger debounced filesystem notifications. Full scans inspect other implemented Windows registrations and configured folders. Local discovery requires no account login or API key.

Launch/install buttons perform Windows/provider handoffs. Standalone and emulator entries use validated paths. Artwork and metadata are cached, custom details survive sync, and persistence failures have a visible recovery path.

Distribution includes the complete source, one portable package, one normal per-user setup, license/notices, a short README, and detailed documentation.

## Validation scope

Release checks cover frontend interaction/unit tests, native parsing/storage/target validation, and a fresh production browser context using synthetic fixtures and a 10,000-game collection.

The 1.0.0 validation passed 58 frontend tests, 26 native tests, 44 browser checks, and five privacy-check regression tests. One opt-in public Epic network test was skipped.

Browser checks cover the single toolbar, responsive layouts, search, filters, virtualized scrolling, keyboard focus, details, Settings spacing, and offline use. Windows smoke checks cover process startup and the packaged executable.

The NSIS archive and extracted payload were checked for integrity and private markers. Its executable differs from the portable only in Tauri's expected three-byte installer bundle-type marker. Interactive installation, uninstall registration, and every Windows upgrade path were not exercised by this payload check.

Fixtures do not qualify every account, provider version, emulator, game, or Windows installation. Real game execution, paid entitlement checks, and provider download completion are outside non-disruptive validation.

A browser fixture is not a controlled cold-start or physical-RAM benchmark. Private commit and summed working sets differ from physical RAM. Machine-specific performance samples and local library observations are excluded from public material.

## Known limitations

- Complete never-installed owned libraries are outside the current zero-setup integration.
- Original clients handle downloads, cancellation, repair, updates, DRM, licensing, and cloud saves.
- EA/Battle.net detection depends on registrations and may need executable repair.
- Xbox detection covers qualifying installed packages and can be incomplete.
- Artwork services may be unavailable or change without notice.
- Full session-duration tracking, achievement synchronization, and social features are absent.
- Duplicate names and ambiguous/deep/restricted game folders can require manual correction.
- Folder work is bounded, and disconnected drives can produce partial scans.
- Portable profiles use Windows app-data storage.
- Binaries are unsigned and require WebView2.
- There is no built-in updater, account management, cloud sync, or Linux/macOS release.

## Improvement areas

Further work can expand reliable local records, improve metadata identity matching, extend Windows installation coverage, and strengthen build reproducibility.

Full ownership integration would require a separately authorized provider interface and an explicit change to the zero-setup model. Incomplete discovery and cached artwork must never be described as proof of complete account ownership.
