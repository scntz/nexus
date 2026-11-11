//! Metadata only: these caches never enumerate games or establish ownership.
//! Deliberately excludes loginusers/localconfig/config, license caches, logs and web profiles.
use crate::{art_cache, model::Game};
use base64::Engine;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

fn read_capped(path: &Path, max: u64) -> Option<Vec<u8>> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > max {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(max + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= max).then_some(bytes)
}
fn text(value: &str) -> String {
    let mut inside = false;
    let plain: String = value
        .chars()
        .filter(|c| {
            if *c == '<' {
                inside = true;
                false
            } else if *c == '>' {
                inside = false;
                false
            } else {
                !inside
            }
        })
        .take(1800)
        .collect();
    plain
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
#[cfg(windows)]
fn active_steam_user() -> Option<u32> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Steam\ActiveProcess")
        .ok()?
        .get_value::<u32, _>("ActiveUser")
        .ok()
        .filter(|id| *id > 0)
}
#[cfg(not(windows))]
fn active_steam_user() -> Option<u32> {
    None
}

pub fn enrich_steam(games: &mut [Game], roots: &[PathBuf]) {
    let Some(user) = active_steam_user() else {
        return;
    };
    for root in roots {
        enrich_steam_at(
            games,
            &root.join(format!("userdata/{user}/config/librarycache")),
        );
    }
}
fn enrich_steam_at(games: &mut [Game], cache: &Path) {
    for game in games.iter_mut().filter(|g| g.platform == "Steam") {
        let Some(id) = game
            .app_id
            .as_deref()
            .filter(|id| id.parse::<u32>().is_ok())
        else {
            continue;
        };
        let Some(value) = read_capped(&cache.join(format!("{id}.json")), 2_000_000)
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        else {
            continue;
        };
        let Some(parts) = value.as_array() else {
            continue;
        };
        let data = parts
            .iter()
            .find(|part| part[0] == "descriptions")
            .map(|p| &p[1]["data"]);
        if let Some(description) = data
            .and_then(|d| {
                d["strSnippet"]
                    .as_str()
                    .or_else(|| d["strFullDescription"].as_str())
            })
            .map(text)
            .filter(|s| !s.is_empty())
        {
            game.description = Some(description);
        }
    }
}
pub fn enrich_epic(games: &mut [Game], catalog: &Path) {
    let Some(bytes) = read_capped(catalog, 24_000_000) else {
        return;
    };
    let decoded = if bytes.starts_with(b"[") {
        bytes
    } else {
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(
            bytes
                .into_iter()
                .filter(|b| !b.is_ascii_whitespace())
                .collect::<Vec<_>>(),
        ) else {
            return;
        };
        bytes
    };
    let Ok(value) = serde_json::from_slice::<Value>(&decoded) else {
        return;
    };
    enrich_epic_value(games, &value);
}
fn enrich_epic_value(games: &mut [Game], value: &Value) {
    let Some(items) = value.as_array() else {
        return;
    };
    let index: std::collections::HashMap<_, _> = items
        .iter()
        .take(50_000)
        .filter_map(|v| Some(((v["namespace"].as_str()?, v["id"].as_str()?), v)))
        .collect();
    for game in games.iter_mut().filter(|g| g.platform == "Epic Games") {
        let (Some(ns), Some(id), Some(app)) =
            (&game.catalog_namespace, &game.catalog_item_id, &game.app_id)
        else {
            continue;
        };
        let Some(item) = index.get(&(ns.as_str(), id.as_str())) else {
            continue;
        };
        if !item["releaseInfo"]
            .as_array()
            .is_some_and(|r| r.iter().any(|r| r["appId"].as_str() == Some(app)))
        {
            continue;
        }
        game.description = item["description"]
            .as_str()
            .map(text)
            .filter(|s| !s.is_empty());
        let image = |kinds: &[&str]| {
            item["keyImages"].as_array().and_then(|images| {
                kinds.iter().find_map(|kind| {
                    images
                        .iter()
                        .find(|v| v["type"].as_str() == Some(*kind))
                        .and_then(|v| v["url"].as_str())
                        .filter(|u| art_cache::trusted(u))
                        .map(String::from)
                })
            })
        };
        game.cover = image(&[
            "DieselGameBoxTall",
            "OfferImageTall",
            "DieselGameBox",
            "Thumbnail",
        ]);
        game.hero = image(&["DieselStoreFrontWide", "OfferImageWide", "DieselGameBox"]);
    }
}

/// Only fixed image names for an already requested numeric Steam app are read.
pub fn steam_image(url: &str) -> Option<Vec<u8>> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !art_cache::trusted(url) || !parsed.host_str()?.contains("steamstatic.com") {
        return None;
    }
    let parts: Vec<_> = parsed.path_segments()?.collect();
    let index = parts.iter().position(|s| *s == "apps")?;
    let id = parts.get(index + 1)?;
    if id.parse::<u32>().is_err() {
        return None;
    }
    let name = *parts.last()?;
    if !["library_600x900.jpg", "library_hero.jpg", "header.jpg"].contains(&name) {
        return None;
    }
    for root in crate::discovery::steam_roots() {
        if let Some(bytes) = steam_image_at(&root.join("appcache/librarycache"), id, name) {
            return Some(bytes);
        }
    }
    None
}
fn steam_image_at(cache: &Path, id: &str, name: &str) -> Option<Vec<u8>> {
    if let Some(bytes) = read_capped(&cache.join(format!("{id}_{name}")), 4_000_000) {
        if art_cache::image_type(&bytes).is_some() {
            return Some(bytes);
        }
    }
    let folder = cache.join(id);
    let direct = folder.join(name);
    if let Some(bytes) = read_capped(&direct, 4_000_000) {
        if art_cache::image_type(&bytes).is_some() {
            return Some(bytes);
        }
    }
    for entry in fs::read_dir(folder).ok()?.filter_map(Result::ok).take(32) {
        let kind = entry.file_type().ok()?;
        // Fixed two-level cache lookup, never follow junctions into arbitrary trees.
        if !kind.is_dir() || kind.is_symlink() {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if entry.metadata().ok()?.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        if let Some(bytes) = read_capped(&entry.path().join(name), 4_000_000) {
            if art_cache::image_type(&bytes).is_some() {
                return Some(bytes);
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_metadata_cannot_add_unowned_games_and_requires_exact_identity() {
        let mut game = Game::new("epicgames-app".into(), "Installed".into(), "Epic Games");
        game.app_id = Some("app".into());
        game.catalog_namespace = Some("ns".into());
        game.catalog_item_id = Some("item".into());
        let mut games = vec![game];
        let mut catalog = serde_json::json!([{"namespace":"wrong","id":"item","releaseInfo":[{"appId":"app"}],"description":"Wrong"},{"namespace":"ns","id":"not-owned","releaseInfo":[{"appId":"unowned"}],"description":"Unowned"}]);
        enrich_epic_value(&mut games, &catalog);
        assert_eq!(games.len(), 1);
        assert!(games[0].description.is_none());
        catalog[0]["namespace"] = "ns".into();
        catalog[0]["description"] = "<b>Correct</b> &amp; local".into();
        enrich_epic_value(&mut games, &catalog);
        assert_eq!(games[0].description.as_deref(), Some("Correct & local"));
        assert_eq!(games.len(), 1);
    }
    #[test]
    fn steam_metadata_does_not_enumerate_cached_titles_or_read_credentials() {
        let root = std::env::temp_dir().join(format!("nexus-safe-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("42.json"),
            r#"[["descriptions",{"data":{"strSnippet":"<p>Local description</p>"}}]]"#,
        )
        .unwrap();
        fs::write(
            root.join("99.json"),
            r#"[["descriptions",{"data":{"strSnippet":"Not owned"}}]]"#,
        )
        .unwrap();
        let mut games = vec![Game::steam("42", "Game".into())];
        enrich_steam_at(&mut games, &root);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].description.as_deref(), Some("Local description"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn hashed_steam_images_are_found_offline() {
        let root = std::env::temp_dir().join(format!("nexus-art-local-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("42/hash")).unwrap();
        fs::write(
            root.join("42/hash/library_600x900.jpg"),
            [0xff, 0xd8, 0xff, 0x01],
        )
        .unwrap();
        assert!(steam_image_at(&root, "42", "library_600x900.jpg").is_some());
        assert!(steam_image("https://shared.steamstatic.com/apps/../password.jpg").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
