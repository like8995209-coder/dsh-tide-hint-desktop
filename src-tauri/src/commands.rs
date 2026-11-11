use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::{
    balance,
    credentials::{self, CredentialStatus},
    error::CommandError,
    login,
    pricing::{self, PricingResponse, TopupResponse},
};

#[tauri::command]
pub fn get_credential_status() -> Result<CredentialStatus, CommandError> {
    credentials::status()
}

#[tauri::command]
pub fn set_api_key(value: String) -> Result<(), CommandError> {
    credentials::set_api_key(&value)
}

#[tauri::command]
pub fn set_user_token(value: String) -> Result<(), CommandError> {
    credentials::set_user_token(&value)
}

#[tauri::command]
pub fn clear_credentials() -> Result<(), CommandError> {
    credentials::clear()
}

#[tauri::command]
pub async fn fetch_balance() -> Result<balance::BalanceResponse, CommandError> {
    balance::fetch_balance().await
}

#[tauri::command]
pub async fn fetch_usage() -> Result<balance::UsageResponse, CommandError> {
    balance::fetch_usage().await
}

#[tauri::command]
pub async fn open_deepseek_login(app: AppHandle) -> Result<(), CommandError> {
    login::open(&app)
}

#[tauri::command]
pub fn save_user_token_and_close(
    app: AppHandle,
    window: WebviewWindow,
    token: String,
) -> Result<(), CommandError> {
    if window.label() != "login" {
        return Err(CommandError::new(
            "window_forbidden",
            "只能从 DeepSeek 登录窗口保存 userToken",
        ));
    }
    login::save_and_close(&app, &token)
}

#[tauri::command]
pub fn close_login_window(window: WebviewWindow) -> Result<(), CommandError> {
    login::close(&window)
}

#[tauri::command]
pub async fn fetch_pricing() -> Result<PricingResponse, CommandError> {
    pricing::fetch_pricing().await
}

#[tauri::command]
pub async fn fetch_topup() -> Result<TopupResponse, CommandError> {
    pricing::fetch_topup().await
}

#[tauri::command]
pub fn set_expanded(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    const WIDTH: f64 = 520.0;
    const COLLAPSED_HEIGHT: f64 = 240.0;
    const EXPANDED_HEIGHT: f64 = 620.0;
    resize_and_center(
        &window,
        WIDTH,
        if expanded {
            EXPANDED_HEIGHT
        } else {
            COLLAPSED_HEIGHT
        },
        COLLAPSED_HEIGHT,
    )
}

#[tauri::command]
pub fn set_window_mini(window: WebviewWindow, mini: bool) -> Result<(), String> {
    if mini {
        resize_and_center(&window, 380.0, 88.0, 88.0)
    } else {
        resize_and_center(&window, 520.0, 240.0, 240.0)
    }
}

fn resize_and_center(
    window: &WebviewWindow,
    width: f64,
    requested_height: f64,
    min_height: f64,
) -> Result<(), String> {
    const SCREEN_MARGIN: f64 = 12.0;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取当前显示器".to_string())?;
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let max_height = (work_area.size.height as f64 / scale - SCREEN_MARGIN * 2.0).max(min_height);
    let height = requested_height.min(max_height);
    let width_px = (width * scale).round() as i32;
    let height_px = (height * scale).round() as i32;
    let x = work_area.position.x + ((work_area.size.width as i32 - width_px).max(0) / 2);
    let y = work_area.position.y + ((work_area.size.height as i32 - height_px).max(0) / 2);

    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
