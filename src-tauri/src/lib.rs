mod art_cache;
mod auto_discovery;
mod child_job;
mod discovery;
mod folders;
mod local_metadata;
mod metadata;
mod model;
mod vdf;

use model::{Discovery, Game};
use std::{
    ffi::OsStr,
    fs,
    io::{self, BufReader},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

#[tauri::command]
async fn startup_ready(app: AppHandle, frontend_ms: f64, games: usize) -> Result<(), String> {
    let elapsed = STARTED
        .get()
        .map(|v| v.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    if !frontend_ms.is_finite() || frontend_ms < 0.0 || games > 50_000 {
        return Err("Invalid startup sample.".into());
    }
    tauri::async_runtime::spawn_blocking(move|| {
        let root=app.path().app_data_dir().map_err(|_|"Cannot locate diagnostics.")?.join("diagnostics");
        fs::create_dir_all(&root).map_err(|_|"Cannot save diagnostics.")?;
        let sample=serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"timestamp":discovery::now(),"nativeEntryToCachedLibraryMs":elapsed,"frontendReadyMs":frontend_ms,"cachedGames":games,"note":"One startup sample recorded after cached library render. Excludes OS process creation; not a controlled cold-start benchmark."});
        fs::write(root.join("startup.json"),serde_json::to_vec_pretty(&sample).unwrap()).map_err(|_|"Cannot save diagnostics.".to_string())
    }).await.map_err(|_|"Startup diagnostic did not finish.".to_string())?
}

/// CLI detection validates targets without launching a game or opening a UI.
pub fn diagnostics() -> serde_json::Value {
    let quick_started = std::time::Instant::now();
    let quick = discovery::discover_scoped(true);
    let launcher_ms = quick_started.elapsed().as_secs_f64() * 1000.0;
    let started = std::time::Instant::now();
    let result = discovery::discover();
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    let games: Vec<_>=result.games.iter().map(|g|serde_json::json!({"name":g.name,"platform":g.platform,"installed":g.installed,"hasLocalDescription":g.description.is_some(),"hasLocalSteamArtwork":g.cover.as_deref().and_then(local_metadata::steam_image).is_some(),"validLaunchTarget":if let Some(exe)=&g.executable {validated_executable(exe).is_ok()}else{safe_launch_uri(g).is_ok()}})).collect();
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"timestamp":discovery::now(),"discoveryMs":elapsed,"launcherDiscoveryMs":launcher_ms,"launcherGames":quick.games.len(),"games":games,"warnings":result.warnings,"sources":result.sources,"note":"Real local discovery and launch target validation. No games launched, account requests, or credentials accessed. Catalog and artwork caches do not establish ownership."})
}

struct LibraryStore {
    path: PathBuf,
    lock: Mutex<()>,
}
impl LibraryStore {
    fn load(&self) -> Result<Vec<Game>, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Library storage is busy. Please restart Nexus.")?;
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("Cannot open library: {error}")),
        };
        if file.metadata().map_err(|e| e.to_string())?.len() > 50 * 1024 * 1024 {
            return Err("Saved library exceeds the 50 MB limit.".into());
        }
        let games: Vec<Game> = match serde_json::from_reader(BufReader::new(file)) {
            Ok(games) => games,
            Err(error) if error.is_io() => return Err(format!("Cannot read library: {error}")),
            Err(_) => {
                // A broken disposable cache must not turn the next launch into setup.
                // Preserve all original bytes before automatic discovery rebuilds it.
                let backup = self
                    .path
                    .with_file_name(format!("library-recovery-{}.json", uuid::Uuid::new_v4()));
                fs::rename(&self.path, backup).map_err(|_| "Saved library is unreadable and could not be backed up. Your file has not been changed.".to_string())?;
                return Ok(Vec::new());
            }
        };
        // Exclude a shared Steam runtime that older development scans classified as a game.
        Ok(games
            .into_iter()
            .filter(|g| !(g.platform == "Steam" && g.app_id.as_deref() == Some("228980")))
            .collect())
    }
    fn save(&self, games: &[Game]) -> Result<(), String> {
        if games.len() > 50_000 {
            return Err("Library limit is 50,000 games.".into());
        }
        if games
            .iter()
            .any(|g| g.name.is_empty() || g.name.len() > 1000 || g.id.len() > 500)
        {
            return Err("Invalid library entry.".into());
        }
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Library storage is busy. Please restart Nexus.")?;
        let data = serde_json::to_vec(games).map_err(|e| e.to_string())?;
        if data.len() > 50 * 1024 * 1024 {
            return Err(
                "Your library exceeds 50 MB. Use smaller custom cover images before saving.".into(),
            );
        }
        let parent = self.path.parent().ok_or("Invalid library path")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temp = parent.join("library.json.tmp");
        use std::io::Write;
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&data).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, &self.path).map_err(|e| format!("Could not commit saved library: {e}"))
    }
}

#[tauri::command]
async fn load_library(app: AppHandle) -> Result<Vec<Game>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LibraryStore>().load())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_library(app: AppHandle, games: Vec<Game>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LibraryStore>().save(&games))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn discover_games(app: AppHandle, fast: Option<bool>) -> Result<Discovery, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fast = fast.unwrap_or(false);
        let mut result = discovery::discover_scoped(fast);
        if let Some(watcher) = app.try_state::<auto_discovery::AutoDiscovery>() {
            watcher.update();
        }
        if !fast {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|_| "Cannot locate game folders.".to_string())?
                .join("folders.json");
            match folders::load(&path) {
                Ok(sources) => {
                    let (games, warnings, failed_platforms) = folders::scan(&sources);
                    result.games.extend(games);
                    result.warnings.extend(warnings);
                    result.failed_platforms.extend(failed_platforms);
                }
                Err(error) => {
                    result.warnings.push(error);
                    result
                        .failed_platforms
                        .extend(["Standalone".into(), "Emulator".into()]);
                }
            }
        }
        let mut seen = std::collections::HashSet::new();
        result.games.retain(|g| seen.insert(g.id.clone()));
        for source in &mut result.sources {
            source.count = result
                .games
                .iter()
                .filter(|g| g.platform == source.platform)
                .count();
            source.detected |= source.count > 0;
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("Discovery did not finish: {e}"))?
}

#[tauri::command]
async fn refresh_metadata(
    app: AppHandle,
    force: bool,
    ids: Vec<String>,
) -> Result<Vec<metadata::MetadataPatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<LibraryStore>();
        let games = store.load()?;
        let cache = store
            .path
            .parent()
            .ok_or("Invalid cache location")?
            .join("metadata");
        metadata::refresh(&games, &cache, force, &ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A lightweight check used only while an installation handoff is pending.
#[tauri::command]
async fn installation_status(ids: Vec<String>) -> Result<Vec<Game>, String> {
    if ids.len() > 200 {
        return Err("Too many pending installations.".into());
    }
    tauri::async_runtime::spawn_blocking(move || discovery::installation_status(&ids))
        .await
        .map_err(|_| "Could not check installation status.".into())
}

#[tauri::command]
fn validate_launch_path(path: String) -> Result<(), String> {
    validated_executable(&path).map(|_| ())
}

#[tauri::command]
async fn reveal_game_folder(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let games = app.state::<LibraryStore>().load()?;
        let game = games
            .iter()
            .find(|g| g.id == id)
            .ok_or("Game was not found.")?;
        let folder = game
            .install_path
            .as_ref()
            .map(PathBuf::from)
            .or_else(|| {
                game.executable
                    .as_ref()
                    .and_then(|s| Path::new(s).parent().map(Path::to_path_buf))
            })
            .ok_or("No installation folder is available for this game.")?;
        if !folder.is_dir() {
            return Err(
                "The installation folder is no longer available. Sync your library.".into(),
            );
        }
        shell_open(folder.as_os_str(), None)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validated_executable(value: &str) -> Result<&Path, String> {
    let path = Path::new(value);
    if !path.is_absolute()
        || !path.is_file()
        || !path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("exe"))
    {
        return Err("The game executable is missing or is not a Windows .exe. Add its current path with Add game.".into());
    }
    Ok(path)
}

const ROM_EXTENSIONS: &[&str] = &[
    "iso", "bin", "cue", "chd", "cso", "rvz", "wbfs", "gcm", "nsp", "xci", "nes", "sfc", "smc",
    "n64", "z64", "v64", "gba", "gb", "gbc", "nds", "3ds", "cia", "zip", "7z", "md", "gen", "sms",
    "gg", "pce", "pbp", "m3u", "vpk",
];

fn validate_rom(args: &[String]) -> Result<(), String> {
    let [rom] = args else {
        return Err("Choose one ROM or disc image for this emulator.".into());
    };
    let rom = Path::new(rom);
    if !rom.is_absolute()
        || !rom.is_file()
        || !rom.extension().is_some_and(|ext| {
            ROM_EXTENSIONS
                .iter()
                .any(|value| ext.eq_ignore_ascii_case(value))
        })
    {
        return Err(
            "The ROM or disc image is unavailable. Reconnect its drive or choose its current path."
                .into(),
        );
    }
    Ok(())
}

fn validate_manual(game: &Game) -> Result<(), String> {
    if !game.id.starts_with("manual-")
        || !["Standalone", "Emulator"].contains(&game.platform.as_str())
    {
        return Err("Invalid manual game type.".into());
    }
    validated_executable(
        game.executable
            .as_deref()
            .ok_or("Choose a game executable.")?,
    )?;
    let args = game.arguments.as_deref().unwrap_or(&[]);
    if game.platform == "Emulator" {
        validate_rom(args)?;
    } else if !args.is_empty() {
        return Err("Standalone game arguments are not supported.".into());
    }
    Ok(())
}
#[tauri::command]
fn validate_manual_game(game: Game) -> Result<(), String> {
    validate_manual(&game)
}

#[tauri::command]
async fn pick_file(kind: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let dialog = rfd::FileDialog::new();
            let result = match kind.as_str() {
                "executable" => dialog
                    .set_title("Choose a game or emulator")
                    .add_filter("Windows executable", &["exe"])
                    .pick_file(),
                "rom" => dialog
                    .set_title("Choose a ROM or disc image")
                    .add_filter("ROMs and disc images", ROM_EXTENSIONS)
                    .pick_file(),
                _ => return Err("Unsupported file type.".into()),
            };
            Ok(result.map(|p| p.to_string_lossy().into()))
        }
        #[cfg(not(windows))]
        {
            let _ = kind;
            Err("File selection is supported on Windows.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn safe_launch_uri(game: &Game) -> Result<String, String> {
    let id = game.app_id.as_deref().unwrap_or("");
    if game.platform == "Steam" && !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(format!(
            "steam://{}/{id}",
            if game.installed {
                "rungameid"
            } else {
                "install"
            }
        ));
    }
    if !game.installed {
        if let Some(id) = game.app_id.as_deref().filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        }) {
            match game.platform.as_str() {
                "Epic Games" => {
                    return Ok(format!(
                        "com.epicgames.launcher://apps/{id}?action=install&silent=false"
                    ))
                }
                "GOG" if id.bytes().all(|b| b.is_ascii_digit()) => {
                    return Ok(format!("goggalaxy://openGameView/{id}"))
                }
                "Ubisoft" if id.bytes().all(|b| b.is_ascii_digit()) => {
                    return Ok(format!("uplay://install/{id}"))
                }
                _ => {}
            }
        }
        return Err("This platform does not provide a supported install action here. Install the game in its original launcher, then sync Nexus.".into());
    }
    if game.platform == "Epic Games" {
        let valid = |s: &str| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        };
        if let Some(app) = game.app_id.as_deref().filter(|s| valid(s)) {
            let app = match (
                game.catalog_namespace.as_deref().filter(|s| valid(s)),
                game.catalog_item_id.as_deref().filter(|s| valid(s)),
            ) {
                (Some(ns), Some(item)) => format!("{ns}%3A{item}%3A{app}"),
                _ => app.into(),
            };
            return Ok(format!(
                "com.epicgames.launcher://apps/{app}?action=launch&silent=true"
            ));
        }
    }
    let uri = game
        .launch_uri
        .as_deref()
        .ok_or("This game needs an executable. Use Add game to choose its .exe.")?;
    let valid = match game.platform.as_str() {
        "Epic Games" => uri
            .strip_prefix("com.epicgames.launcher://apps/")
            .is_some_and(|s| {
                s.ends_with("?action=launch&silent=true")
                    && s.trim_end_matches("?action=launch&silent=true")
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.~%".contains(&b))
            }),
        "Ubisoft" => uri.strip_prefix("uplay://launch/").is_some_and(|s| {
            s.strip_suffix("/0")
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
        }),
        "Xbox" => uri.strip_prefix("shell:AppsFolder\\").is_some_and(|s| {
            s.contains('!')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-!".contains(&b))
        }),
        _ => false,
    };
    if !valid {
        return Err("This game does not have a supported platform launch link. Add its executable manually.".into());
    }
    Ok(uri.into())
}

#[cfg(windows)]
fn shell_open(target: &OsStr, provider: Option<&str>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{
        Shell::{
            ShellExecuteW, SE_ERR_ACCESSDENIED, SE_ERR_ASSOCINCOMPLETE, SE_ERR_DDEBUSY,
            SE_ERR_DDEFAIL, SE_ERR_DDETIMEOUT, SE_ERR_FNF, SE_ERR_NOASSOC, SE_ERR_PNF,
            SE_ERR_SHARE,
        },
        WindowsAndMessaging::SW_SHOWNORMAL,
    };
    let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result > 32 {
        return Ok(());
    }
    let location = provider.unwrap_or("this folder");
    Err(match result as u32 {
        SE_ERR_FNF | SE_ERR_PNF | SE_ERR_NOASSOC | SE_ERR_ASSOCINCOMPLETE if provider.is_some() =>
            format!("Windows cannot find the handler for {location}. Open or repair its launcher, then try again."),
        SE_ERR_FNF | SE_ERR_PNF => "The installation folder is no longer available. Sync your library.".into(),
        SE_ERR_ACCESSDENIED => format!("Windows denied access to {location}. Check its permissions and try again."),
        SE_ERR_DDEBUSY | SE_ERR_DDEFAIL | SE_ERR_DDETIMEOUT | SE_ERR_SHARE =>
            format!("{location} is busy or did not respond. Wait a moment and try again."),
        _ => format!("Windows could not open {location} (error {result})."),
    })
}
#[cfg(not(windows))]
fn shell_open(_: &OsStr, _: Option<&str>) -> Result<(), String> {
    Err("Game launching is supported on Windows.".into())
}

#[tauri::command]
async fn launch_game(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let games = app.state::<LibraryStore>().load()?;
        let game = games
            .iter()
            .find(|g| g.id == id)
            .ok_or("Game was not found. Sync your library and try again.")?;
        if game.id.starts_with("demo-") {
            return Err("Sample games cannot be launched. Sync your own library.".into());
        }
        if game.installed && game.executable.is_some() {
            if game.id.starts_with("manual-") {
                validate_manual(game)?;
            } else if game.platform == "Emulator" {
                validate_rom(game.arguments.as_deref().unwrap_or(&[]))?;
            }
            let exe = validated_executable(game.executable.as_deref().unwrap())?;
            let mut command = std::process::Command::new(exe);
            if let Some(args) = &game.arguments {
                command.args(args);
            }
            if let Some(parent) = exe.parent() {
                command.current_dir(parent);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            command
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("Windows could not launch this game: {e}"))?;
        } else {
            shell_open(OsStr::new(&safe_launch_uri(game)?), Some(&game.platform))?;
        }
        Ok(if game.installed {
            format!("Launch requested for {}.", game.name)
        } else {
            format!("Install request sent to {}.", game.platform)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    let _ = STARTED.set(std::time::Instant::now());
    let builder = tauri::Builder::default().register_asynchronous_uri_scheme_protocol(
        "nexus-art",
        |context, request, responder| {
            art_cache::ArtCache::serve(context.app_handle(), request, responder);
        },
    );
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                if let Some(watcher) = window
                    .app_handle()
                    .try_state::<auto_discovery::AutoDiscovery>()
                {
                    watcher.stop();
                }
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let path = root.join("library.json");
            app.manage(art_cache::ArtCache::new(root.join("artwork")));
            if let Ok(watcher) = auto_discovery::AutoDiscovery::new(app.handle().clone()) {
                // The first background scan registers directories. An external drive must
                // never hold up cached-library startup on the window thread.
                app.manage(watcher);
            }
            app.manage(LibraryStore {
                path,
                lock: Mutex::new(()),
            });
            // An explicit, isolated visual preview never calls native discovery or launch commands.
            if std::env::args().any(|arg| arg == "--preview") {
                if let Some(window) = app.get_webview_window("main") {
                    let mut url = if cfg!(debug_assertions) {
                        app.config()
                            .build
                            .dev_url
                            .clone()
                            .unwrap_or(tauri::Url::parse("http://tauri.localhost")?)
                    } else {
                        tauri::Url::parse("http://tauri.localhost")?
                    };
                    url.set_query(Some("preview"));
                    window.navigate(url)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            save_library,
            discover_games,
            launch_game,
            validate_manual_game,
            pick_file,
            refresh_metadata,
            validate_launch_path,
            reveal_game_folder,
            folders::folder_sources,
            folders::save_folder_sources,
            folders::pick_folder,
            installation_status,
            startup_ready
        ])
        .run(tauri::generate_context!())
        .expect("Nexus could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steam_actions_are_derived_from_numeric_ids() {
        let mut g = Game::steam("42", "Example".into());
        assert_eq!(safe_launch_uri(&g).unwrap(), "steam://rungameid/42");
        g.installed = false;
        assert_eq!(safe_launch_uri(&g).unwrap(), "steam://install/42");
        g.app_id = Some("42&evil".into());
        assert!(safe_launch_uri(&g).is_err());
    }
    #[test]
    fn rejects_cross_platform_protocols_and_injection() {
        let mut g = Game::new("test".into(), "Example".into(), "Xbox");
        g.launch_uri = Some("shell:AppsFolder\\Microsoft.Example_123!App".into());
        assert!(safe_launch_uri(&g).is_ok());
        g.launch_uri = Some("shell:AppsFolder\\example!App & calc".into());
        assert!(safe_launch_uri(&g).is_err());
        g.launch_uri = Some("https://example.com".into());
        assert!(safe_launch_uri(&g).is_err());
    }
    #[test]
    fn unsupported_installs_fail_explicitly() {
        let mut g = Game::new("test".into(), "Example".into(), "EA");
        g.installed = false;
        assert!(safe_launch_uri(&g).is_err());
    }
    #[test]
    fn storage_roundtrip_replaces_without_truncating() {
        let root = std::env::temp_dir().join(format!(
            "nexus-store-{}-{}",
            std::process::id(),
            discovery::now()
        ));
        let store = LibraryStore {
            path: root.join("library.json"),
            lock: Mutex::new(()),
        };
        assert!(store.load().unwrap().is_empty());
        store.save(&[Game::steam("42", "Example".into())]).unwrap();
        assert_eq!(store.load().unwrap()[0].name, "Example");
        store.save(&[]).unwrap();
        assert!(store.load().unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn damaged_library_is_backed_up_before_automatic_rebuild() {
        let root = std::env::temp_dir().join(format!("nexus-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let store = LibraryStore {
            path: root.join("library.json"),
            lock: Mutex::new(()),
        };
        fs::write(&store.path, b"{broken original cache").unwrap();
        assert!(store.load().unwrap().is_empty());
        let backup = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
        assert_eq!(fs::read(&backup).unwrap(), b"{broken original cache");
        store
            .save(&[Game::steam("42", "Recovered".into())])
            .unwrap();
        assert_eq!(store.load().unwrap().len(), 1);
        assert!(backup.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
