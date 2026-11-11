mod balance;
mod commands;
mod credentials;
mod error;
mod http;
mod login;
mod pricing;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

fn toggle_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            commands::show_main(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_credential_status,
            commands::set_api_key,
            commands::set_user_token,
            commands::clear_credentials,
            commands::fetch_balance,
            commands::fetch_usage,
            commands::fetch_pricing,
            commands::fetch_topup,
            commands::open_deepseek_login,
            commands::save_user_token_and_close,
            commands::close_login_window,
            commands::set_expanded,
            commands::set_window_mini,
            commands::hide_window,
            commands::set_always_on_top,
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "刷新余额与用量", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &refresh, &quit])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or_else(|| std::io::Error::other("missing window icon"))?,
                )
                .tooltip("DSH 峰谷提示")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main(app),
                    "refresh" => {
                        commands::show_main(app);
                        let _ = app.emit("tray-refresh", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "login" {
                if let WindowEvent::CloseRequested { .. } = event {
                    let _ = window
                        .app_handle()
                        .emit_to("main", "deepseek-login-closed", ());
                }
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-tide-hint desktop");
}
