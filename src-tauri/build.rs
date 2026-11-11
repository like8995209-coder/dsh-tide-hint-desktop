fn main() {
    const APP_COMMANDS: &[&str] = &[
        "get_credential_status",
        "set_api_key",
        "set_user_token",
        "clear_credentials",
        "fetch_balance",
        "fetch_usage",
        "fetch_pricing",
        "fetch_topup",
        "open_deepseek_login",
        "save_user_token_and_close",
        "close_login_window",
        "set_expanded",
        "set_window_mini",
        "hide_window",
        "set_always_on_top",
    ];

    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
