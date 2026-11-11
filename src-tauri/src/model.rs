use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub installed: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playtime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_item_id: Option<String>,
    #[serde(default)]
    pub customized: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovery_source: Option<String>,
}

impl Game {
    pub fn new(id: String, name: String, platform: &str) -> Self {
        Self {
            id,
            name,
            platform: platform.into(),
            installed: true,
            favorite: false,
            cover: None,
            hero: None,
            last_played: None,
            playtime: None,
            genre: None,
            description: None,
            executable: None,
            arguments: None,
            launch_uri: None,
            install_uri: None,
            install_path: None,
            app_id: None,
            catalog_namespace: None,
            catalog_item_id: None,
            customized: false,
            system: None,
            download_bytes: None,
            download_total: None,
            discovery_source: None,
        }
    }
    pub fn steam(app_id: &str, name: String) -> Self {
        let mut game = Self::new(format!("steam-{app_id}"), name, "Steam");
        game.app_id = Some(app_id.into());
        game.cover = Some(format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_600x900.jpg"));
        game.hero = Some(format!(
            "https://shared.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_hero.jpg"
        ));
        game.launch_uri = Some(format!("steam://rungameid/{app_id}"));
        game.install_uri = Some(format!("steam://install/{app_id}"));
        game
    }
}

#[derive(Serialize)]
pub struct SourceStatus {
    pub platform: String,
    pub count: usize,
    pub detected: bool,
    pub detail: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub games: Vec<Game>,
    pub sources: Vec<SourceStatus>,
    pub warnings: Vec<String>,
    pub failed_platforms: Vec<String>,
    pub scanned_at: u64,
    pub scanned_platforms: Vec<String>,
}
