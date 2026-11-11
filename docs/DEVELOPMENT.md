# Build and contribute

## Prerequisites

The release target is Windows x64. Install Node.js 22 or newer, npm, Git, Rust 1.90 or newer for x86_64-pc-windows-msvc, Microsoft C++ Build Tools with a Windows SDK, and WebView2.

package-lock.json and Cargo.lock pin dependencies.

    npm ci

The first native build downloads Cargo dependencies. Tauri manages its NSIS tools. Network access is required for missing dependencies and the WebView2 bootstrapper.

Generate the detailed dependency notices after installing frontend and Cargo dependencies.

    node scripts/prepare-notices.mjs

## Develop and verify

    npm run dev
    npm run desktop

The browser server uses an explicit sample collection and cannot discover or launch real games. The desktop command uses the local native app profile and can save library/settings data.

    npm test -- --pool=threads --maxWorkers=2
    node --test scripts/privacy-check.checks.mjs
    cargo test --manifest-path src-tauri/Cargo.toml --lib
    npm run build

Native tests include Windows filesystem/process-lifetime fixtures. One public Epic network test is opt-in and ignored by the default suite.

    npx playwright install chromium
    npm run test:browser

Build the frontend before the browser checks. NEXUS_BROWSER_PATH can choose an existing Chromium executable. Checks start a temporary local production preview and a fresh browser context with synthetic libraries. Screenshots/results go to ignored artifacts.

--diagnose performs read-only local discovery and target validation. Optional measure-startup.ps1 and measure-idle.ps1 produce local measurements. These reports can contain personal installation details and must be reviewed before sharing.

## Build releases

Synchronize versions in package.json, package-lock.json, src/version.ts, Cargo.toml, the Nexus entry of Cargo.lock, and tauri.conf.json.

    npm run release:build

The wrapper adds Rust path remapping for the checkout, profile, and toolchain and restores the environment afterward. It builds the executable, then bundles one NSIS setup using release.bundle.json to include dependency and artwork notices. The release profile enables LTO, size optimization, stripping, and abort-on-panic.

For an executable-only build, use the wrapper's -PortableOnly option. Normally both distribution types are built.

    powershell -NoProfile -File scripts/package-release.ps1 -SideBySide

Packaging produces one portable ZIP, one setup executable, and SHA256SUMS.txt. Portable payloads include only Nexus.exe, short instructions, the license, and attribution files. -SideBySide avoids replacing a running unversioned portable.

The setup installs for the current user and can bootstrap WebView2. The release is unsigned. Signing certificates and private credentials are not stored in this repository.

## Review and publish

Stage the intended source and run the privacy check.

    npm run release:check
    node scripts/check-release-privacy.mjs release/Nexus-1.0.1

The first command scans tracked source. Explicit paths scan payloads. The checker detects generated/private source paths, identity markers, common secret patterns, user-directory strings, and account IDs. It does not decompress archives, so also check extracted contents.

Review staged files, binary strings, archive entries, and payload hashes. Diagnostics, profiles, exports, caches, and build outputs belong outside the source commit and public packages.

Use GitHub no-reply identity and UTC commit/tag timestamps. Push the full source, tag the published version (for example v1.0.1), then publish only the portable ZIP, setup, and checksums. GitHub supplies standard source archives from the tag.

Keep discovery evidence distinct from metadata, preserve saved user data, and bound background work. Put detailed behavioral/limitation changes in docs while keeping README and release notes short.

Project code and documentation are dual-licensed under MIT OR Apache-2.0, at the recipient's option. LICENSE contains the choice and both complete texts; LICENSE-MIT and LICENSE-APACHE provide the individual texts. Keep all three in both distributions. Unless explicitly stated otherwise, contributions intentionally submitted for inclusion use the same dual-license terms. Fonts, logos, artwork, and dependencies retain separate ownership and license notices. Asset scripts preserve public source information.
