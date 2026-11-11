#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if std::env::args().any(|arg| arg == "--diagnose") {
        let report = serde_json::to_string_pretty(&nexus_lib::diagnostics()).unwrap();
        if let Some(root) = std::env::var_os("APPDATA") {
            let root = std::path::PathBuf::from(root).join("com.nexus.launcher/diagnostics");
            let _ = std::fs::create_dir_all(&root);
            let _ = std::fs::write(root.join("discovery.json"), &report);
        }
        println!("{report}");
        return;
    }
    nexus_lib::run();
}
