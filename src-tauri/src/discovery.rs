use crate::{
    model::{Discovery, Game, SourceStatus},
    vdf,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn read_small(path: &Path) -> io::Result<String> {
    const LIMIT: u64 = 16 * 1024 * 1024;
    let file = fs::File::open(path)?;
    if file.metadata()?.len() > LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Manifest is too large",
        ));
    }
    let mut value = String::new();
    file.take(LIMIT + 1).read_to_string(&mut value)?;
    if value.len() as u64 > LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Manifest is too large",
        ));
    }
    Ok(value)
}
fn entries(path: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
}

pub fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{enums::*, RegKey};
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                let path = PathBuf::from(path);
                if path.is_absolute() {
                    roots.push(path);
                }
            }
        }
        for name in ["PROGRAMFILES(X86)", "PROGRAMFILES"] {
            if let Some(path) = std::env::var_os(name) {
                let path = PathBuf::from(path).join("Steam");
                if path.join("steamapps").is_dir() || path.join("steam.exe").is_file() {
                    roots.push(path);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    roots.retain(|r| seen.insert(r.to_string_lossy().to_lowercase()));
    roots
}

pub fn scan_steam_at(roots: &[PathBuf], warnings: &mut Vec<String>) -> Vec<Game> {
    let libraries = steam_libraries(roots, warnings);
    scan_steam_libraries(&libraries, warnings, None)
}
pub fn steam_libraries(roots: &[PathBuf], warnings: &mut Vec<String>) -> Vec<PathBuf> {
    let mut libraries = roots.to_vec();
    for root in roots {
        let text = match read_small(&root.join("steamapps/libraryfolders.vdf")) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => {
                warnings.push("A Steam library manifest could not be read.".into());
                continue;
            }
        };
        let parsed = vdf::parse(&text).ok();
        let Some(folders) = parsed
            .as_ref()
            .and_then(|v| v.get("libraryfolders"))
            .and_then(vdf::Value::object)
        else {
            warnings.push("A Steam library manifest could not be read.".into());
            continue;
        };
        for (key, folder) in folders {
            if key.parse::<u32>().is_err() {
                continue;
            }
            let path = folder
                .string("path")
                .or_else(|| folder.text())
                .map(PathBuf::from);
            match path {
                Some(path) if path.is_absolute() => libraries.push(path),
                _ => warnings.push("A Steam library path is invalid.".into()),
            }
        }
    }
    let mut seen_paths = HashSet::new();
    libraries.retain(|p| seen_paths.insert(p.to_string_lossy().to_lowercase()));
    if libraries.len() > 24 {
        warnings.push("Steam discovery reached its 24-folder limit.".into());
        libraries.truncate(24);
    }
    libraries
}
fn scan_steam_libraries(
    libraries: &[PathBuf],
    warnings: &mut Vec<String>,
    ids: Option<&[u32]>,
) -> Vec<Game> {
    let mut games = Vec::new();
    for library in libraries {
        let directory = library.join("steamapps");
        if let Some(ids) = ids {
            for id in ids {
                let path = directory.join(format!("appmanifest_{id}.acf"));
                if let Some(game) = steam_game(&path, *id, warnings, true) {
                    games.push(game);
                }
            }
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            warnings.push("A Steam library folder is unavailable. Reconnect its drive or check its permissions.".into());
            continue;
        };
        for entry in entries {
            let Ok(entry) = entry else {
                warnings.push("A Steam library folder could not be read completely.".into());
                continue;
            };
            let name = entry.file_name();
            let Some(id) = name
                .to_str()
                .and_then(|name| name.strip_prefix("appmanifest_"))
                .and_then(|name| name.strip_suffix(".acf"))
                .and_then(|id| id.parse::<u32>().ok())
            else {
                continue;
            };
            if let Some(game) = steam_game(&entry.path(), id, warnings, false) {
                games.push(game);
            }
        }
    }
    prefer_available_installs(&mut games);
    games
}

fn safe_relative_path(value: &str) -> Option<&Path> {
    let path = Path::new(value);
    (!value.is_empty() && path.components().all(|c| matches!(c, Component::Normal(_))))
        .then_some(path)
}

fn steam_game(
    path: &Path,
    expected_id: u32,
    warnings: &mut Vec<String>,
    missing_ok: bool,
) -> Option<Game> {
    let text = match read_small(path) {
        Ok(text) => text,
        Err(error) if missing_ok && error.kind() == io::ErrorKind::NotFound => return None,
        Err(_) => {
            warnings.push("A Steam game manifest could not be read.".into());
            return None;
        }
    };
    let parsed = vdf::parse(&text).ok();
    let state = parsed.as_ref().and_then(|v| v.get("AppState"));
    let fields = state.and_then(|state| {
        Some((
            state.string("appid")?.parse::<u32>().ok()?,
            state.string("name")?.trim(),
            safe_relative_path(state.string("installdir")?)?,
            state.string("StateFlags")?.parse::<u32>().ok()?,
        ))
    });
    let Some((id, name, dir, flags)) =
        fields.filter(|(id, name, _, _)| *id == expected_id && *id > 0 && !name.is_empty())
    else {
        warnings.push("A Steam game manifest is incomplete or invalid.".into());
        return None;
    };
    // Shared runtimes are manifests too, but are not playable library entries.
    if id == 228980 || name.to_lowercase().contains("redistributable") {
        return None;
    }
    let install_path = path.parent()?.join("common").join(dir);
    let mut game = Game::steam(&id.to_string(), name.into());
    game.installed = flags & 4 != 0 && directory_exists(&install_path, "Steam", warnings)?;
    let bytes = |key| {
        state
            .and_then(|v| v.string(key))
            .and_then(|v| v.parse::<u64>().ok())
    };
    if let Some(total) = bytes("BytesToDownload").filter(|total| *total > 0) {
        let downloaded = bytes("BytesDownloaded").unwrap_or(0);
        if downloaded < total || !game.installed {
            game.download_bytes = Some(downloaded.min(total));
            game.download_total = Some(total);
        }
    }
    game.install_path = Some(install_path.to_string_lossy().into());
    Some(game)
}

fn directory_exists(path: &Path, provider: &str, warnings: &mut Vec<String>) -> Option<bool> {
    match fs::metadata(path) {
        Ok(metadata) => Some(metadata.is_dir()),
        Err(error)
            if error.kind() == io::ErrorKind::NotFound
                && path.ancestors().last().is_some_and(Path::is_dir) =>
        {
            Some(false)
        }
        Err(_) => {
            warnings.push(format!("An installation folder for {provider} is unavailable. Reconnect its drive or check its permissions."));
            None
        }
    }
}

fn prefer_available_installs(games: &mut Vec<Game>) {
    let mut preferred = HashMap::<String, Game>::new();
    for game in games.drain(..) {
        let rank = |game: &Game| {
            (
                game.installed,
                game.executable.is_some() || game.launch_uri.is_some(),
                game.download_bytes.unwrap_or(0),
            )
        };
        match preferred.entry(game.id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(game);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let old = entry.get();
                if rank(&game) > rank(old)
                    || (rank(&game) == rank(old) && game.install_path < old.install_path)
                {
                    entry.insert(game);
                }
            }
        }
    }
    games.extend(preferred.into_values());
    games.sort_unstable_by(|a, b| a.id.cmp(&b.id));
}

pub fn epic_manifests() -> PathBuf {
    PathBuf::from(std::env::var_os("PROGRAMDATA").unwrap_or_else(|| "C:\\ProgramData".into()))
        .join("Epic/EpicGamesLauncher/Data/Manifests")
}
fn scan_epic_at(root: &Path, warnings: &mut Vec<String>, ids: Option<&HashSet<&str>>) -> Vec<Game> {
    let mut games = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return games,
        Err(_) => {
            warnings.push("The Epic installation manifest folder is unavailable.".into());
            return games;
        }
    };
    for entry in entries {
        let Ok(entry) = entry else {
            warnings
                .push("The Epic installation manifest folder could not be read completely.".into());
            continue;
        };
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("item"))
        {
            continue;
        }
        let Some(value) = read_small(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        else {
            warnings.push("An Epic game manifest could not be read.".into());
            continue;
        };
        if value["bIsApplication"].as_bool() == Some(false) {
            continue;
        }
        let (Some(id), Some(name), Some(location)) = (
            value["AppName"].as_str(),
            value["DisplayName"].as_str(),
            value["InstallLocation"].as_str(),
        ) else {
            warnings.push("An Epic game manifest is missing installation information.".into());
            continue;
        };
        if ids.is_some_and(|ids| !ids.contains(id)) {
            continue;
        }
        let location = Path::new(location);
        if id.is_empty() || name.trim().is_empty() || !location.is_absolute() {
            warnings
                .push("An Epic game manifest contains invalid installation information.".into());
            continue;
        }
        let mut game = Game::new(format!("epicgames-{id}"), name.trim().into(), "Epic Games");
        game.app_id = Some(id.into());
        game.catalog_namespace = value["CatalogNamespace"].as_str().map(String::from);
        game.catalog_item_id = value["CatalogItemId"].as_str().map(String::from);
        let Some(directory) = directory_exists(location, "Epic Games", warnings) else {
            continue;
        };
        game.installed = directory && value["bIsIncompleteInstall"].as_bool() != Some(true);
        if let Some(launch_file) = value["LaunchExecutable"]
            .as_str()
            .filter(|file| !file.is_empty())
        {
            let Some(launch_file) = safe_relative_path(launch_file) else {
                warnings.push("An Epic game manifest contains an invalid executable path.".into());
                continue;
            };
            if game.installed {
                game.installed = match fs::metadata(location.join(launch_file)) {
                    Ok(metadata) => metadata.is_file(),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                    Err(_) => {
                        warnings.push("An Epic game executable could not be checked.".into());
                        continue;
                    }
                };
            }
        }
        game.install_path = Some(location.to_string_lossy().into());
        let encoded: String = id
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect();
        game.launch_uri = Some(format!(
            "com.epicgames.launcher://apps/{encoded}?action=launch&silent=true"
        ));
        games.push(game);
    }
    prefer_available_installs(&mut games);
    games
}

/// Probe only pending installs. Steam's filenames encode the AppID. Epic's do
/// not, so only that provider requires enumerating manifests for a status check.
pub fn installation_status(ids: &[String]) -> Vec<Game> {
    let steam: Vec<_> = ids
        .iter()
        .filter_map(|id| id.strip_prefix("steam-")?.parse::<u32>().ok())
        .collect();
    let epic: HashSet<_> = ids
        .iter()
        .filter_map(|id| id.strip_prefix("epicgames-"))
        .collect();
    let mut warnings = Vec::new();
    let mut games = Vec::new();
    if !steam.is_empty() {
        let libraries = steam_libraries(&steam_roots(), &mut warnings);
        games.extend(scan_steam_libraries(
            &libraries,
            &mut warnings,
            Some(&steam),
        ));
    }
    if !epic.is_empty() {
        games.extend(scan_epic_at(&epic_manifests(), &mut warnings, Some(&epic)));
    }
    games
}

#[cfg(windows)]
fn registry_games() -> Vec<Game> {
    use winreg::{enums::*, RegKey};
    let mut games = Vec::new();
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for base in [
            r"SOFTWARE\GOG.com\Games",
            r"SOFTWARE\WOW6432Node\GOG.com\Games",
        ] {
            if let Ok(root) = RegKey::predef(hive).open_subkey(base) {
                for id in root.enum_keys().filter_map(Result::ok) {
                    let Ok(key) = root.open_subkey(&id) else {
                        continue;
                    };
                    let Ok(name) = key.get_value::<String, _>("gameName") else {
                        continue;
                    };
                    let path = key.get_value::<String, _>("path").unwrap_or_default();
                    if !Path::new(&path).is_dir() {
                        continue;
                    }
                    let mut game = Game::new(format!("gog-{id}"), name, "GOG");
                    game.app_id = Some(id);
                    game.install_path = Some(path.clone());
                    if let Ok(exe) = key.get_value::<String, _>("exe") {
                        let p = PathBuf::from(&exe);
                        game.executable = Some(
                            if p.is_absolute() {
                                p
                            } else {
                                PathBuf::from(path).join(p)
                            }
                            .to_string_lossy()
                            .into(),
                        );
                    }
                    games.push(game);
                }
            }
        }
        for base in [
            r"SOFTWARE\Ubisoft\Launcher\Installs",
            r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs",
        ] {
            if let Ok(root) = RegKey::predef(hive).open_subkey(base) {
                for id in root.enum_keys().filter_map(Result::ok) {
                    if !id.chars().all(|c| c.is_ascii_digit()) {
                        continue;
                    }
                    let Ok(key) = root.open_subkey(&id) else {
                        continue;
                    };
                    let Ok(path) = key.get_value::<String, _>("InstallDir") else {
                        continue;
                    };
                    if !Path::new(&path).is_dir() {
                        continue;
                    }
                    let name = Path::new(path.trim_end_matches(['\\', '/']))
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                    let mut game = Game::new(format!("ubisoft-{id}"), name, "Ubisoft");
                    game.app_id = Some(id.clone());
                    game.install_path = Some(path);
                    game.launch_uri = Some(format!("uplay://launch/{id}/0"));
                    games.push(game);
                }
            }
        }
        for base in [
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ] {
            if let Ok(root) = RegKey::predef(hive).open_subkey(base) {
                for id in root.enum_keys().filter_map(Result::ok) {
                    let Ok(key) = root.open_subkey(&id) else {
                        continue;
                    };
                    let Ok(name) = key.get_value::<String, _>("DisplayName") else {
                        continue;
                    };
                    let publisher = key
                        .get_value::<String, _>("Publisher")
                        .unwrap_or_default()
                        .to_lowercase();
                    let lowered = name.to_lowercase();
                    if [
                        "launcher",
                        "battle.net",
                        "ea app",
                        "origin",
                        "ubisoft connect",
                        "anti-cheat",
                        "redistributable",
                    ]
                    .iter()
                    .any(|s| lowered.contains(s))
                    {
                        continue;
                    }
                    let platform = if publisher.contains("electronic arts") || publisher == "ea" {
                        "EA"
                    } else if publisher.contains("blizzard") {
                        "Battle.net"
                    } else {
                        continue;
                    };
                    let Ok(location) = key.get_value::<String, _>("InstallLocation") else {
                        continue;
                    };
                    if !Path::new(&location).is_dir() {
                        continue;
                    }
                    let mut game = Game::new(
                        format!("{}-{id}", platform.to_lowercase().replace('.', "")),
                        name,
                        platform,
                    );
                    game.install_path = Some(location.clone());
                    // Prefer an unambiguous executable matching the game or registry key; never execute uninstall commands.
                    let candidates: Vec<_> = entries(Path::new(&location))
                        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
                        .filter(|p| {
                            let n = p
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_lowercase();
                            !["unins", "setup", "crash", "report", "redist", "helper"]
                                .iter()
                                .any(|bad| n.contains(bad))
                        })
                        .collect();
                    if candidates.len() == 1 {
                        game.executable = Some(candidates[0].to_string_lossy().into());
                    }
                    games.push(game);
                }
            }
        }
    }
    games
}

#[cfg(windows)]
fn xbox_games(warnings: &mut Vec<String>) -> Vec<Game> {
    use std::{
        io::Read,
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    // One finite, hidden process per user-requested scan. Only packages with MicrosoftGame.config qualify.
    let script = r#"$ErrorActionPreference='SilentlyContinue'; $items=@(Get-AppxPackage | ForEach-Object { $p=$_; $f=Join-Path $p.InstallLocation 'MicrosoftGame.config'; if (Test-Path -LiteralPath $f) { $m=Get-AppxPackageManifest -Package $p.PackageFullName; foreach ($a in $m.Package.Applications.Application) { if ($a.Id) { [PSCustomObject]@{name=$p.Name;displayName=[string]$m.Package.Properties.DisplayName;family=$p.PackageFamilyName;application=[string]$a.Id;location=$p.InstallLocation} } } } }); ConvertTo-Json -InputObject $items -Compress"#;
    let child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        warnings.push("Windows package discovery was unavailable.".into());
        return Vec::new();
    };
    let _job = match crate::child_job::ChildJob::attach(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            warnings.push("Windows package discovery could not start safely.".into());
            return Vec::new();
        }
    };
    let stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(stdout) = stdout {
            let _ = stdout.take(8 * 1024 * 1024).read_to_end(&mut bytes);
        }
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(8);
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    warnings.push("Windows package discovery did not complete.".into());
                }
                break status.success();
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                warnings.push(
                    "Xbox package scan timed out; other platforms are still available.".into(),
                );
                break false;
            }
        }
    };
    let output = reader.join().unwrap_or_default();
    if !success {
        return Vec::new();
    }
    let Ok(items) = serde_json::from_slice::<Vec<serde_json::Value>>(&output) else {
        warnings.push("Windows package metadata could not be read.".into());
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|v| {
            let (family, application) = (v["family"].as_str()?, v["application"].as_str()?);
            let package_name = v["name"].as_str()?;
            let display = v["displayName"]
                .as_str()
                .filter(|s| !s.starts_with("ms-resource:") && !s.is_empty())
                .unwrap_or(package_name);
            let mut game = Game::new(
                format!("xbox-{family}-{application}"),
                display.into(),
                "Xbox",
            );
            game.launch_uri = Some(format!("shell:AppsFolder\\{family}!{application}"));
            game.install_path = v["location"].as_str().map(String::from);
            Some(game)
        })
        .collect()
}

pub fn discover() -> Discovery {
    discover_scoped(false)
}
pub fn discover_scoped(fast: bool) -> Discovery {
    let mut warnings = Vec::new();
    let mut failed_platforms = Vec::new();
    let roots = steam_roots();
    let mut games = scan_steam_at(&roots, &mut warnings);
    if !warnings.is_empty() {
        failed_platforms.push("Steam".into());
    }
    let epic = epic_manifests();
    let previous_warnings = warnings.len();
    games.extend(scan_epic_at(&epic, &mut warnings, None));
    if warnings.len() > previous_warnings {
        failed_platforms.push("Epic Games".into());
    }
    crate::local_metadata::enrich_steam(&mut games, &roots);
    if let Some(data) = epic.parent() {
        crate::local_metadata::enrich_epic(&mut games, &data.join("Catalog/catcache.bin"));
    }
    #[cfg(windows)]
    {
        if !fast {
            games.extend(registry_games());
            let previous_warnings = warnings.len();
            games.extend(xbox_games(&mut warnings));
            if warnings.len() > previous_warnings {
                failed_platforms.push("Xbox".into());
            }
        }
    }
    prefer_available_installs(&mut games);
    for game in &mut games {
        game.discovery_source = Some("local".into());
    }
    games.sort_by_cached_key(|game| game.name.to_lowercase());
    let sources = [
        "Steam",
        "Epic Games",
        "Xbox",
        "GOG",
        "EA",
        "Ubisoft",
        "Battle.net",
        "Standalone",
        "Emulator",
    ]
    .iter()
    .filter(|p| !fast || **p == "Steam" || **p == "Epic Games")
    .map(|p| {
        let count = games.iter().filter(|g| &g.platform == p).count();
        SourceStatus {
            platform: p.to_string(),
            count,
            detected: count > 0
                || (*p == "Steam" && !roots.is_empty())
                || (*p == "Epic Games" && epic.is_dir()),
            detail: match *p {
                "Steam" => "Steam library folders and installation manifests. The complete owned library is not exposed locally.",
                "Epic Games" => {
                    "Epic installation manifests, with metadata from its local catalog. The catalog alone does not establish ownership."
                }
                "Xbox" => "Windows game packages with MicrosoftGame.config metadata.",
                "GOG" => "GOG installation registrations on this PC.",
                "EA" | "Battle.net" => {
                    "Windows game registrations. Ambiguous executables need manual setup."
                }
                "Ubisoft" => "Ubisoft Connect install registrations and launch links.",
                "Standalone" => "Add a game executable to include it in your library.",
                _ => "Add an emulator executable with a ROM or disc image.",
            }
            .into(),
        }
    })
    .collect();
    warnings.sort();
    warnings.dedup();
    Discovery {
        games,
        sources,
        warnings,
        failed_platforms,
        scanned_at: now(),
        scanned_platforms: if fast {
            vec!["Steam".into(), "Epic Games".into()]
        } else {
            [
                "Steam",
                "Epic Games",
                "Xbox",
                "GOG",
                "EA",
                "Ubisoft",
                "Battle.net",
                "Standalone",
                "Emulator",
            ]
            .map(String::from)
            .to_vec()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("nexus-{name}-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn steam_respects_install_state_and_external_libraries() {
        let root = temp_dir("steam");
        let external = root.join("external");
        fs::create_dir_all(root.join("steamapps")).unwrap();
        fs::create_dir_all(external.join("steamapps/common/Example")).unwrap();
        fs::write(
            root.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\" {{ \"1\" {{ \"path\" \"{}\" }} }}",
                external.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        fs::write(external.join("steamapps/appmanifest_42.acf"), r#""AppState" { "appid" "42" "name" "Example" "installdir" "Example" "StateFlags" "4" }"#).unwrap();
        let mut warnings = Vec::new();
        let games = scan_steam_at(&[root.clone()], &mut warnings);
        assert_eq!(games.len(), 1);
        assert!(games[0].installed);
        assert_eq!(games[0].id, "steam-42");
        assert!(warnings.is_empty());
        fs::remove_dir_all(external.join("steamapps/common/Example")).unwrap();
        assert!(!scan_steam_at(&[root.clone()], &mut warnings)[0].installed);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn epic_incomplete_install_is_not_ready() {
        let root = temp_dir("epic");
        let value = serde_json::json!({"AppName":"example","DisplayName":"Example","InstallLocation":root.to_string_lossy(),"bIsIncompleteInstall":true});
        fs::write(root.join("example.item"), value.to_string()).unwrap();
        let games = scan_epic_at(&root, &mut Vec::new(), None);
        assert_eq!(games.len(), 1);
        assert!(!games[0].installed);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn steam_partial_scan_prefers_the_healthy_copy_and_reports_unavailable_libraries() {
        let root = temp_dir("steam-moved");
        let stale = root.join("stale");
        let ready = root.join("ready");
        let unavailable = root.join("external-drive");
        fs::create_dir_all(stale.join("steamapps")).unwrap();
        fs::create_dir_all(ready.join("steamapps/common/Example")).unwrap();
        let manifest = r#""AppState" { "appid" "42" "name" "Example" "installdir" "Example" "StateFlags" "4" "BytesToDownload" "100" "BytesDownloaded" "100" }"#;
        for folder in [&stale, &ready] {
            fs::write(folder.join("steamapps/appmanifest_42.acf"), manifest).unwrap();
        }
        fs::write(stale.join("steamapps/appmanifest_7.acf"), manifest).unwrap();
        let mut warnings = Vec::new();
        let games = scan_steam_libraries(
            &[stale.clone(), unavailable, ready.clone()],
            &mut warnings,
            None,
        );
        assert_eq!(games.len(), 1);
        assert!(games[0].installed);
        assert!(Path::new(games[0].install_path.as_deref().unwrap()).starts_with(&ready));
        assert_eq!(games[0].download_total, None);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("unavailable")));
        assert!(warnings.iter().any(|warning| warning.contains("invalid")));

        warnings.clear();
        let games = scan_steam_libraries(&[stale, ready], &mut warnings, Some(&[42]));
        assert_eq!(games.len(), 1);
        assert!(games[0].installed);
        assert!(warnings.is_empty(), "unrelated manifest was parsed");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn epic_prefers_a_manifest_with_its_launch_file_present() {
        let root = temp_dir("epic-moved");
        let stale = root.join("stale");
        let ready = root.join("ready");
        fs::create_dir_all(&stale).unwrap();
        fs::create_dir_all(&ready).unwrap();
        let manifest = |location: &Path| {
            serde_json::json!({
                "AppName":"example", "DisplayName":"Example", "InstallLocation":location,
                "LaunchExecutable":"example.exe", "bIsIncompleteInstall":false
            })
        };
        fs::write(root.join("first.item"), manifest(&stale).to_string()).unwrap();
        fs::write(root.join("second.item"), manifest(&ready).to_string()).unwrap();
        assert!(!scan_epic_at(&root, &mut Vec::new(), None)[0].installed);
        fs::write(ready.join("example.exe"), b"fixture").unwrap();
        let games = scan_epic_at(&root, &mut Vec::new(), None);
        assert_eq!(games.len(), 1);
        assert!(games[0].installed);
        assert_eq!(
            games[0].install_path.as_deref().map(Path::new),
            Some(ready.as_path())
        );
        fs::remove_dir_all(root).unwrap();
    }
}
