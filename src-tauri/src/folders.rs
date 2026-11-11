use crate::model::Game;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, BufReader},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSource {
    pub id: String,
    pub path: String,
    pub system: Option<String>,
    pub executable: Option<String>,
}
pub const SYSTEMS: &[&str] = &[
    "PlayStation",
    "PlayStation 2",
    "PlayStation 3",
    "PSP",
    "PlayStation Vita",
    "Nintendo Switch",
    "Nintendo 3DS",
    "Nintendo DS",
    "Nintendo 64",
    "Super Nintendo",
    "Nintendo Entertainment System",
    "Game Boy",
    "Game Boy Advance",
    "GameCube",
    "Wii",
    "Wii U",
    "Xbox",
    "Xbox 360",
    "Dreamcast",
    "Mega Drive",
];
fn location(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate sources.")?
        .join("folders.json"))
}
pub fn load(path: &Path) -> Result<Vec<FolderSource>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("Cannot read folders.".into()),
    };
    if file.metadata().map_err(|_| "Cannot read folders.")?.len() > 100_000 {
        return Err("Folder configuration is too large.".into());
    }
    serde_json::from_reader(BufReader::new(file))
        .map_err(|_| "Folder configuration is unreadable.".into())
}
fn stable_id(path: &Path) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for b in path.to_string_lossy().to_lowercase().as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("folder-{hash:016x}")
}
fn walk(root: &Path, depth: u8, files: &mut Vec<PathBuf>, budget: &mut usize) -> bool {
    if depth == 0 || *budget == 0 {
        return true;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return false;
    };
    let mut complete = true;
    for entry in entries {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Ok(entry) = entry else {
            complete = false;
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            complete = false;
            continue;
        };
        let path = entry.path();
        if kind.is_symlink() {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if entry
                .metadata()
                .ok()
                .is_some_and(|m| m.file_attributes() & 0x400 != 0)
            {
                continue;
            }
        }
        if kind.is_dir() {
            complete &= walk(&path, depth - 1, files, budget);
        } else if kind.is_file() {
            files.push(path);
        }
    }
    complete
}
pub fn scan(sources: &[FolderSource]) -> (Vec<Game>, Vec<String>, Vec<String>) {
    let mut games = Vec::new();
    let mut warnings = Vec::new();
    let mut failed_platforms = Vec::new();
    if sources.len() > 24 {
        warnings.push("Folder scan reached its 24-source limit.".into());
        failed_platforms.extend(["Standalone".into(), "Emulator".into()]);
    }
    for source in sources.iter().take(24) {
        let root = Path::new(&source.path);
        let platform = if source.system.is_some() {
            "Emulator"
        } else {
            "Standalone"
        };
        if !root.is_absolute() || !root.is_dir() {
            warnings.push(format!("Folder unavailable: {}", source.path));
            failed_platforms.push(platform.into());
            continue;
        }
        let mut files = Vec::new();
        let mut budget = 20_000;
        if !walk(root, 4, &mut files, &mut budget) {
            warnings.push(format!("Could not read all of: {}", source.path));
            failed_platforms.push(platform.into());
        }
        if budget == 0 {
            warnings.push(format!(
                "Folder scan reached its 20,000-entry limit: {}",
                source.path
            ));
            failed_platforms.push(platform.into());
        }
        if let Some(system) = &source.system {
            for file in files.iter().filter(|p| {
                p.file_name()
                    .is_some_and(|n| n.eq_ignore_ascii_case("EBOOT.BIN"))
                    || p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                        [
                            "iso", "cue", "chd", "cso", "rvz", "wbfs", "gcm", "nsp", "xci", "nes",
                            "sfc", "smc", "n64", "z64", "v64", "gba", "gb", "gbc", "nds", "3ds",
                            "cia", "md", "gen", "sms", "gg", "pce", "pbp", "m3u", "vpk", "zip",
                            "7z",
                        ]
                        .contains(&e.to_ascii_lowercase().as_str())
                    })
            }) {
                let name = if file
                    .file_name()
                    .is_some_and(|n| n.eq_ignore_ascii_case("EBOOT.BIN"))
                {
                    file.parent()
                        .and_then(Path::parent)
                        .and_then(Path::parent)
                        .and_then(Path::file_name)
                        .unwrap_or_default()
                } else {
                    file.file_stem().unwrap_or_default()
                }
                .to_string_lossy()
                .replace('_', " ");
                let mut game = Game::new(stable_id(file), name, "Emulator");
                game.system = Some(system.clone());
                game.executable = source.executable.clone();
                game.arguments = Some(vec![file.to_string_lossy().into()]);
                game.install_path = file.parent().map(|p| p.to_string_lossy().into());
                games.push(game);
            }
        } else {
            let mut folders: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
            for file in files
                .iter()
                .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
            {
                let name = file
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                if [
                    "unins",
                    "setup",
                    "crash",
                    "report",
                    "redist",
                    "helper",
                    "updat",
                    "vc_redist",
                    "dxsetup",
                ]
                .iter()
                .any(|bad| name.contains(bad))
                {
                    continue;
                }
                folders
                    .entry(file.parent().unwrap_or(root).to_path_buf())
                    .or_default()
                    .push(file.clone());
            }
            for (folder, executables) in folders {
                if executables.len() != 1 {
                    continue;
                }
                let file = &executables[0];
                let name = if folder == root {
                    file.file_stem().unwrap_or_default()
                } else {
                    folder.file_name().unwrap_or_default()
                }
                .to_string_lossy()
                .replace('_', " ");
                let mut game = Game::new(stable_id(file), name, "Standalone");
                game.executable = Some(file.to_string_lossy().into());
                game.install_path = Some(folder.to_string_lossy().into());
                games.push(game);
            }
        }
    }
    if games.len() > 20_000 {
        warnings.push("Folder discovery reached its 20,000-game limit.".into());
        failed_platforms.extend(["Standalone".into(), "Emulator".into()]);
        games.truncate(20_000);
    }
    failed_platforms.sort_unstable();
    failed_platforms.dedup();
    (games, warnings, failed_platforms)
}
#[tauri::command]
pub async fn folder_sources(app: AppHandle) -> Result<Vec<FolderSource>, String> {
    tauri::async_runtime::spawn_blocking(move || load(&location(&app)?))
        .await
        .map_err(|_| "Cannot read folders.".to_string())?
}
#[tauri::command]
pub async fn save_folder_sources(app: AppHandle, sources: Vec<FolderSource>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if sources.len() > 24 {
            return Err("Choose up to 24 game folders.".into());
        }
        for s in &sources {
            if !Path::new(&s.path).is_absolute() || !Path::new(&s.path).is_dir() {
                return Err("Choose an existing game folder.".into());
            }
            if let Some(system) = &s.system {
                if !SYSTEMS.contains(&system.as_str()) {
                    return Err("Choose a supported console.".into());
                }
                crate::validated_executable(s.executable.as_deref().unwrap_or(""))?;
            }
        }
        let path = location(&app)?;
        fs::create_dir_all(path.parent().unwrap()).map_err(|_| "Cannot save folders.")?;
        let tmp = path.with_extension("tmp");
        fs::write(
            &tmp,
            serde_json::to_vec(&sources).map_err(|_| "Cannot encode folders.")?,
        )
        .map_err(|_| "Cannot save folders.")?;
        fs::rename(tmp, path).map_err(|_| "Cannot commit folders.".into())
    })
    .await
    .map_err(|_| "Cannot save folders.".to_string())?
}
#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)]
        {
            Ok(rfd::FileDialog::new()
                .set_title("Choose a game or ROM folder")
                .pick_folder()
                .map(|p| p.to_string_lossy().into()))
        }
        #[cfg(not(windows))]
        {
            Err("Folder selection requires Windows.".into())
        }
    })
    .await
    .map_err(|_| "Folder selection did not finish.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_ids_and_bounded_scans() {
        let root = std::env::temp_dir().join(format!("nexus-folders-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.iso"), b"rom").unwrap();
        fs::write(root.join("b.txt"), b"ignore").unwrap();
        let source = FolderSource {
            id: "x".into(),
            path: root.to_string_lossy().into(),
            system: Some("PlayStation 2".into()),
            executable: Some("emulator.exe".into()),
        };
        let (games, w, failed) = scan(&[source]);
        assert!(w.is_empty());
        assert!(failed.is_empty());
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].system.as_deref(), Some("PlayStation 2"));
        assert_eq!(stable_id(&root), stable_id(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unavailable_configured_folder_marks_only_its_platform_incomplete() {
        let root = std::env::temp_dir().join(format!("nexus-offline-{}", uuid::Uuid::new_v4()));
        let source = FolderSource {
            id: "x".into(),
            path: root.to_string_lossy().into(),
            system: Some("PlayStation 2".into()),
            executable: Some("emulator.exe".into()),
        };
        let (games, warnings, failed) = scan(&[source]);
        assert!(games.is_empty());
        assert_eq!(warnings.len(), 1);
        assert_eq!(failed, ["Emulator"]);
    }
}
