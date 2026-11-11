//! Four bounded workers serve trusted artwork from a persistent, size-limited cache.
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        mpsc::{sync_channel, SyncSender},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    http::{Request, Response},
    AppHandle, Manager, UriSchemeResponder,
};
const LIMIT: u64 = 256 * 1024 * 1024;
struct Job {
    url: String,
    responder: UriSchemeResponder,
}
pub struct ArtCache {
    sender: SyncSender<Job>,
}
pub fn trusted(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && [
                "shared.steamstatic.com",
                "shared.cloudflare.steamstatic.com",
                "shared.fastly.steamstatic.com",
                "cdn.cloudflare.steamstatic.com",
                "cdn.akamai.steamstatic.com",
                "cdn1.epicgames.com",
                "cdn2.epicgames.com",
                "cdn2.unrealengine.com",
                "images.gog-statics.com",
            ]
            .contains(&u.host_str().unwrap_or(""))
    })
}
pub(crate) fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
fn prune(root: &Path) {
    let mut files: Vec<_> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.path(), m.len(), m.modified().ok()))
        })
        .collect();
    let mut size: u64 = files.iter().map(|(_, s, _)| s).sum();
    if size <= LIMIT {
        return;
    }
    files.sort_by_key(|(_, _, t)| *t);
    for (path, len, _) in files {
        if size <= LIMIT * 9 / 10 {
            break;
        }
        if fs::remove_file(path).is_ok() {
            size = size.saturating_sub(len);
        }
    }
}
impl ArtCache {
    pub fn new(root: PathBuf) -> Self {
        let (sender, receiver) = sync_channel::<Job>(128);
        let receiver = Arc::new(Mutex::new(receiver));
        let disk = Arc::new(Mutex::new(()));
        for _ in 0..4 {
            let receiver = receiver.clone();
            let root = root.clone();
            let disk = disk.clone();
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(4))
                    .timeout(Duration::from_secs(9))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .ok();
                loop {
                    let job = match receiver.lock().ok().and_then(|r| r.recv().ok()) {
                        Some(job) => job,
                        None => break,
                    };
                    let mut hash = DefaultHasher::new();
                    job.url.hash(&mut hash);
                    let path = root.join(format!("{:016x}.img", hash.finish()));
                    let cached = fs::metadata(&path)
                        .ok()
                        .filter(|m| m.len() <= 4_000_000)
                        .and_then(|_| fs::read(&path).ok())
                        .filter(|b| image_type(b).is_some());
                    let bytes = cached.or_else(|| {
                        let bytes = crate::local_metadata::steam_image(&job.url).or_else(|| {
                            let response = client
                                .as_ref()?
                                .get(&job.url)
                                .send()
                                .ok()?
                                .error_for_status()
                                .ok()?;
                            let mut bytes = Vec::new();
                            response.take(4_000_001).read_to_end(&mut bytes).ok()?;
                            if bytes.len() > 4_000_000 || image_type(&bytes).is_none() {
                                return None;
                            }
                            Some(bytes)
                        })?;
                        if let Ok(_guard) = disk.lock() {
                            let _ = fs::create_dir_all(&root);
                            let temporary = path.with_extension("tmp");
                            if fs::write(&temporary, &bytes)
                                .and_then(|_| fs::rename(&temporary, &path))
                                .is_ok()
                            {
                                prune(&root);
                            }
                        }
                        Some(bytes)
                    });
                    if let Some(bytes) = bytes {
                        let response = Response::builder()
                            .status(200)
                            .header("Content-Type", image_type(&bytes).unwrap_or("image/jpeg"))
                            .header("Cache-Control", "public, max-age=604800, immutable")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap();
                        job.responder.respond(response);
                    } else {
                        job.responder.respond(
                            Response::builder()
                                .status(404)
                                .body(Vec::<u8>::new())
                                .unwrap(),
                        );
                    }
                }
            });
        }
        Self { sender }
    }
    pub fn serve(app: &AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
        let url = reqwest::Url::parse(&request.uri().to_string())
            .ok()
            .and_then(|u| {
                u.query_pairs()
                    .find(|(k, _)| k == "url")
                    .map(|(_, v)| v.to_string())
            });
        if let Some(url) = url.filter(|u| trusted(u)) {
            if let Err(error) = app
                .state::<ArtCache>()
                .sender
                .try_send(Job { url, responder })
            {
                let job = match error {
                    std::sync::mpsc::TrySendError::Full(job)
                    | std::sync::mpsc::TrySendError::Disconnected(job) => job,
                };
                job.responder.respond(
                    Response::builder()
                        .status(503)
                        .body(Vec::<u8>::new())
                        .unwrap(),
                );
            }
        } else {
            responder.respond(
                Response::builder()
                    .status(403)
                    .body(Vec::<u8>::new())
                    .unwrap(),
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_cannot_fetch_local_or_untrusted_resources() {
        assert!(trusted("https://shared.steamstatic.com/a.jpg"));
        assert!(!trusted("http://shared.steamstatic.com/a.jpg"));
        assert!(!trusted("https://shared.steamstatic.com.evil/a.jpg"));
        assert!(!trusted("file:///C:/secret"));
        assert_eq!(image_type(b"<html>"), None);
    }
}
