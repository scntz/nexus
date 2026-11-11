//! OS directory notifications, not polling. Only launcher manifest/metadata paths are watched.
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, SyncSender},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

enum Message {
    Changed,
    Stop,
}
struct State {
    watcher: RecommendedWatcher,
    paths: Vec<PathBuf>,
}
pub struct AutoDiscovery {
    state: Mutex<State>,
    sender: SyncSender<Message>,
}
fn relevant(event: &Event) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|p| {
        let name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        (name.starts_with("appmanifest_") && name.ends_with(".acf"))
            || name == "libraryfolders.vdf"
            || name.ends_with(".item")
            || name == "catcache.bin"
            || ["steamapps", "manifests", "catalog"].contains(&name.as_str())
            || (name == "data"
                && p.parent()
                    .and_then(Path::file_name)
                    .is_some_and(|parent| parent.eq_ignore_ascii_case("EpicGamesLauncher")))
    })
}
fn nearest_directory(path: &Path) -> Option<PathBuf> {
    let mut candidate = path;
    // Stay inside the launcher directory tree. Do not watch all of ProgramData or a drive.
    for _ in 0..3 {
        if candidate.parent().is_some() && candidate.is_dir() {
            return Some(candidate.to_path_buf());
        }
        candidate = candidate.parent()?;
    }
    None
}
impl AutoDiscovery {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel(8);
        let events = sender.clone();
        let watcher=notify::recommended_watcher(move |result: notify::Result<Event>| {
            if result.as_ref().map(relevant).unwrap_or(true) { let _=events.try_send(Message::Changed); }
        }).map_err(|_|"Live file notifications are unavailable. Nexus will check when you return to its window.".to_string())?;
        std::thread::spawn(move || {
            while let Ok(message) = receiver.recv() {
                if matches!(message, Message::Stop) {
                    break;
                }
                let until = Instant::now() + Duration::from_secs(2);
                loop {
                    match receiver.recv_timeout(
                        Duration::from_millis(450)
                            .min(until.saturating_duration_since(Instant::now())),
                    ) {
                        Ok(Message::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Ok(Message::Changed) if Instant::now() >= until => break,
                        Ok(_) => {}
                    }
                }
                let _ = app.emit_to("main", "library-changed", ());
            }
        });
        Ok(Self {
            state: Mutex::new(State {
                watcher,
                paths: Vec::new(),
            }),
            sender,
        })
    }
    pub fn update(&self) {
        let roots = crate::discovery::steam_roots();
        let mut wanted = crate::discovery::steam_libraries(&roots, &mut Vec::new())
            .into_iter()
            .map(|p| p.join("steamapps"))
            .collect::<Vec<_>>();
        wanted.extend(roots);
        let epic = crate::discovery::epic_manifests();
        wanted.push(epic.clone());
        if let Some(data) = epic.parent() {
            wanted.push(data.join("Catalog"));
            wanted.push(data.to_path_buf());
        }
        let mut paths: Vec<_> = wanted.iter().filter_map(|p| nearest_directory(p)).collect();
        paths.sort();
        paths.dedup();
        paths.truncate(32);
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if paths == state.paths {
            return;
        }
        let previous = std::mem::take(&mut state.paths);
        for path in &previous {
            if !paths.contains(path) {
                let _ = state.watcher.unwatch(path);
            }
        }
        state.paths = paths
            .into_iter()
            .filter(|path| {
                previous.contains(path)
                    || state
                        .watcher
                        .watch(path, RecursiveMode::NonRecursive)
                        .is_ok()
            })
            .collect();
    }
    pub fn stop(&self) {
        let _ = self.sender.send(Message::Stop);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_log_browser_and_account_changes() {
        for path in [
            "loginusers.vdf",
            "localconfig.vdf",
            "Cookies",
            "licensecache",
            "EpicGamesLauncher.log",
            "42.json",
        ] {
            assert!(!relevant(&Event::new(EventKind::Any).add_path(path.into())));
        }
        for path in [
            "appmanifest_730.acf",
            "libraryfolders.vdf",
            "game.item",
            "catcache.bin",
            "EpicGamesLauncher/Data",
        ] {
            assert!(relevant(&Event::new(EventKind::Any).add_path(path.into())));
        }
    }
    #[test]
    fn native_manifest_notification_is_delivered_without_polling() {
        let root = std::env::temp_dir().join(format!("nexus-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |e: notify::Result<Event>| {
            if let Ok(e) = e {
                if relevant(&e) {
                    let _ = sender.send(());
                }
            }
        })
        .unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();
        std::fs::write(root.join("appmanifest_42.acf"), "fixture").unwrap();
        assert!(receiver.recv_timeout(Duration::from_secs(3)).is_ok());
        drop(watcher);
        std::fs::remove_dir_all(root).unwrap();
    }
}
