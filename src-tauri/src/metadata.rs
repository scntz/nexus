//! Public product artwork only. No credentials, scraping sessions, or ownership inference.
use crate::{discovery::now, model::Game};
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::Path,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataPatch {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Cache {
    saved_at: u64,
    patch: MetadataPatch,
}

fn trusted_art(value: &serde_json::Value) -> Option<String> {
    let url = reqwest::Url::parse(value.as_str()?).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    if ![
        "cdn2.unrealengine.com",
        "cdn1.epicgames.com",
        "cdn2.epicgames.com",
    ]
    .contains(&url.host_str()?)
    {
        return None;
    }
    Some(url.to_string())
}
pub fn product_slug(name: &str) -> String {
    let mut slug = String::new();
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if ['\'', '’', '®', '™'].contains(&character) {
            continue;
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    slug.trim_end_matches('-').to_string()
}
pub fn parse_epic_product(game: &Game, value: &serde_json::Value) -> Option<MetadataPatch> {
    let expected = game.catalog_namespace.as_deref()?;
    if value["namespace"].as_str()? != expected {
        return None;
    }
    let page = value["pages"]
        .as_array()?
        .iter()
        .find(|p| p["_slug"] == "home")?;
    let data = &page["data"];
    let cover = trusted_art(&data["hero"]["portraitBackgroundImageUrl"]);
    let hero = trusted_art(&data["hero"]["backgroundImageUrl"]);
    if cover.is_none() && hero.is_none() {
        return None;
    }
    let description = data["about"]["shortDescription"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(1500).collect());
    Some(MetadataPatch {
        id: game.id.clone(),
        cover,
        hero,
        description,
        genre: None,
    })
}

pub fn refresh(
    games: &[Game],
    cache_dir: &Path,
    force: bool,
    ids: &[String],
) -> Result<Vec<MetadataPatch>, String> {
    fs::create_dir_all(cache_dir).map_err(|e| format!("Could not create artwork cache: {e}"))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent(concat!(
            "Nexus/",
            env!("CARGO_PKG_VERSION"),
            " public-game-artwork"
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut requests = 0;
    let mut unreachable = 0;
    let deadline = Instant::now() + Duration::from_secs(20);
    for game in games {
        if (!ids.is_empty() && !ids.contains(&game.id))
            || (game.customized && (!force || ids.is_empty()))
        {
            continue;
        }
        // Local catalog/previously saved metadata already covers startup. Only explicit
        // refresh requests should spend network work on an otherwise complete entry.
        if !force && ids.is_empty() && game.cover.is_some() && game.hero.is_some() {
            continue;
        }
        if game.platform == "Steam" && (force || !ids.is_empty()) {
            if let Some(id) = &game.app_id {
                if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) {
                    let source = Game::steam(id, game.name.clone());
                    let mut patch = MetadataPatch {
                        id: game.id.clone(),
                        cover: source.cover,
                        hero: source.hero,
                        ..Default::default()
                    };
                    // Requested details only: no full-library store requests at startup.
                    if !ids.is_empty() {
                        let path = cache_dir.join(format!("steam-{id}.json"));
                        let cached = fs::read(&path)
                            .ok()
                            .filter(|v| v.len() < 3_000_000)
                            .and_then(|v| serde_json::from_slice::<Cache>(&v).ok());
                        if !force
                            && cached.as_ref().is_some_and(|c| {
                                c.patch.id == game.id
                                    && now().saturating_sub(c.saved_at) < 14 * 86_400_000
                            })
                        {
                            patch = cached.unwrap().patch;
                        } else if let Ok(response) = client
                            .get("https://store.steampowered.com/api/appdetails")
                            .query(&[
                                ("appids", id.as_str()),
                                ("filters", "basic,genres"),
                                ("l", "english"),
                            ])
                            .send()
                        {
                            if response.status().is_success() {
                                use std::io::Read;
                                let mut bytes = Vec::new();
                                if response.take(3_000_001).read_to_end(&mut bytes).is_ok()
                                    && bytes.len() <= 3_000_000
                                {
                                    if let Some(details) =
                                        serde_json::from_slice::<serde_json::Value>(&bytes)
                                            .ok()
                                            .and_then(|v| parse_steam_details(game, &v))
                                    {
                                        patch = details;
                                        if let Ok(bytes) = serde_json::to_vec(&Cache {
                                            saved_at: now(),
                                            patch: patch.clone(),
                                        }) {
                                            let _ = fs::write(path, bytes);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    result.push(patch);
                }
            }
            continue;
        }
        if game.platform != "Epic Games" || game.catalog_namespace.is_none() {
            continue;
        }
        let mut hasher = DefaultHasher::new();
        game.id.hash(&mut hasher);
        let path = cache_dir.join(format!("{:016x}.json", hasher.finish()));
        if !force {
            if let Ok(bytes) = fs::read(&path) {
                if let Ok(cache) = serde_json::from_slice::<Cache>(&bytes) {
                    let ttl = if cache.patch.cover.is_some() {
                        14 * 86_400_000
                    } else {
                        86_400_000
                    };
                    if cache.patch.id == game.id && now().saturating_sub(cache.saved_at) < ttl {
                        result.push(cache.patch);
                        continue;
                    }
                }
            }
        }
        if requests >= 32 || Instant::now() >= deadline {
            break;
        }
        requests += 1;
        let slug = product_slug(&game.name);
        if slug.is_empty() {
            continue;
        }
        let url =
            format!("https://store-content.ak.epicgames.com/api/en-US/content/products/{slug}");
        // Temporary connection failures must not suppress retries for a day.
        let response = match client.get(url).send() {
            Ok(response) if response.status().is_success() || response.status().as_u16() == 404 => {
                response
            }
            _ => {
                unreachable += 1;
                continue;
            }
        };
        let patch = Some(response)
            .filter(|r| r.status().is_success() && r.content_length().unwrap_or(0) <= 3_000_000)
            .and_then(|response| {
                use std::io::Read;
                let mut bytes = Vec::new();
                response.take(3_000_001).read_to_end(&mut bytes).ok()?;
                if bytes.len() > 3_000_000 {
                    return None;
                }
                serde_json::from_slice(&bytes).ok()
            })
            .and_then(|value| parse_epic_product(game, &value))
            .unwrap_or_else(|| MetadataPatch {
                id: game.id.clone(),
                ..Default::default()
            });
        let cache = Cache {
            saved_at: now(),
            patch: patch.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec(&cache) {
            let _ = fs::write(path, bytes);
        }
        result.push(patch);
    }
    if result.is_empty() && unreachable > 0 {
        Err("Artwork could not be reached. Check your connection and try again. You can also choose a local cover in Edit details.".into())
    } else {
        Ok(result)
    }
}

pub fn parse_steam_details(game: &Game, value: &serde_json::Value) -> Option<MetadataPatch> {
    let id = game.app_id.as_deref()?;
    let entry = &value[id];
    if entry["success"].as_bool() != Some(true) {
        return None;
    }
    let data = &entry["data"];
    if data["steam_appid"].as_u64()?.to_string() != id {
        return None;
    }
    let mut inside = false;
    let mut text = String::new();
    for c in data["short_description"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(5000)
    {
        match c {
            '<' => inside = true,
            '>' => {
                inside = false;
                text.push(' ');
            }
            _ if !inside => text.push(c),
            _ => {}
        }
    }
    let text = text
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    let source = Game::steam(id, game.name.clone());
    Some(MetadataPatch {
        id: game.id.clone(),
        cover: source.cover,
        hero: source.hero,
        description: if text.trim().is_empty() {
            None
        } else {
            Some(text.trim().chars().take(1500).collect())
        },
        genre: data["genres"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|g| g["description"].as_str())
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .filter(|s| !s.is_empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn steam_details_are_identity_checked_and_plain_text() {
        let game = Game::steam("42", "A game".into());
        let data = serde_json::json!({"42":{"success":true,"data":{"steam_appid":42,"short_description":"An <b>adventure</b> &amp; a game.","genres":[{"description":"Action"}]}}});
        let patch = parse_steam_details(&game, &data).unwrap();
        assert_eq!(patch.genre.as_deref(), Some("Action"));
        assert!(!patch.description.unwrap().contains('<'));
        assert!(parse_steam_details(&Game::steam("43", "Other".into()), &data).is_none());
    }
    fn game() -> Game {
        let mut g = Game::new("epicgames-Fortnite".into(), "Fortnite".into(), "Epic Games");
        g.catalog_namespace = Some("fn".into());
        g
    }
    #[test]
    fn normalizes_titles_without_trademark_glyphs() {
        assert_eq!(product_slug("Rocket League®"), "rocket-league");
        assert_eq!(
            product_slug("Tom Clancy’s Rainbow Six™ Siege"),
            "tom-clancys-rainbow-six-siege"
        );
    }
    #[test]
    fn extracts_only_matching_product_artwork() {
        let value = serde_json::json!({"namespace":"fn","pages":[{"_slug":"home","data":{"hero":{"portraitBackgroundImageUrl":"https://cdn2.unrealengine.com/cover.jpg","backgroundImageUrl":"https://cdn1.epicgames.com/hero.jpg"},"about":{"shortDescription":"An adventure."}}}]});
        let patch = parse_epic_product(&game(), &value).unwrap();
        assert!(patch.cover.is_some());
        assert_eq!(patch.description.as_deref(), Some("An adventure."));
        let mut other = game();
        other.catalog_namespace = Some("different-game".into());
        assert!(parse_epic_product(&other, &value).is_none());
    }
    #[test]
    fn rejects_untrusted_image_origins() {
        let value = serde_json::json!({"namespace":"fn","pages":[{"_slug":"home","data":{"hero":{"portraitBackgroundImageUrl":"https://untrusted.example/cover.jpg"}}}]});
        assert!(parse_epic_product(&game(), &value).is_none());
    }

    #[test]
    fn parses_real_provider_responses() {
        let samples: Vec<serde_json::Value> = serde_json::from_str(
            include_str!("../fixtures/epic-products.json").trim_start_matches('\u{feff}'),
        )
        .unwrap();
        for value in samples {
            let mut source = game();
            source.catalog_namespace = Some(value["namespace"].as_str().unwrap().into());
            let patch = parse_epic_product(&source, &value)
                .expect("Official product fixture should supply artwork");
            assert!(patch.cover.is_some() && patch.hero.is_some());
        }
    }

    #[test]
    #[ignore = "requires the public Epic endpoint"]
    fn live_epic_artwork() {
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap()
            .get("https://store-content.ak.epicgames.com/api/en-US/content/products/fortnite")
            .send()
            .expect("Epic HTTPS request")
            .error_for_status()
            .unwrap();
        let value: serde_json::Value = response.json().unwrap();
        assert!(parse_epic_product(&game(), &value).is_some());
    }
}
