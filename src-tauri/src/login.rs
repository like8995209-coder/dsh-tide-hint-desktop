use tauri::{
    webview::{PageLoadEvent, WebviewWindowBuilder},
    Emitter, Manager, WebviewUrl, WebviewWindow,
};

use crate::{credentials, error::CommandError};

const LOGIN_WINDOW_LABEL: &str = "login";
const MAIN_WINDOW_LABEL: &str = "main";
const DEEPSEEK_LOGIN_URL: &str = "https://platform.deepseek.com/";

/**
 * 登录窗口只注入 DeepSeek 官方页面。脚本兼容 JWT 和当前平台使用的
 * { value, __version } 不透明令牌对象；令牌通过受限 IPC 交给 Rust 后立即
 * 销毁登录窗口，主窗口永远拿不到明文。
 */
const LOGIN_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (window.top !== window || location.hostname !== "platform.deepseek.com") return;
  if (window.__dshTideLoginCaptureInstalled === true) return;
  window.__dshTideLoginCaptureInstalled = true;

  const COMMAND_SAVE = "save_user_token_and_close";
  const COMMAND_CLOSE = "close_login_window";
  let submitted = false;
  let closeRequested = false;

  const invoke = (command, args = {}) => {
    const bridge = window.__TAURI_INTERNALS__;
    if (!bridge || typeof bridge.invoke !== "function") {
      throw new Error("Tauri IPC unavailable");
    }
    return bridge.invoke(command, args);
  };

  const normalizeToken = (raw) => {
    if (typeof raw !== "string" || !raw.trim()) return null;
    let value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") value = parsed.trim();
      if (parsed && typeof parsed === "object") {
        for (const key of ["token", "userToken", "access_token", "value"]) {
          if (typeof parsed[key] === "string") {
            value = parsed[key].trim();
            break;
          }
        }
      }
    } catch {}
    value = value.replace(/^Bearer\s+/i, "").replace(/^"(.*)"$/, "$1");
    if (value.length < 16 || value.length > 8192 || /\s/.test(value)) return null;
    return /^[A-Za-z0-9._~+/=-]+$/.test(value) ? value : null;
  };

  const installChrome = () => {
    if (!document.documentElement || document.getElementById("__dsh_tide_login_bar")) return;
    const bar = document.createElement("div");
    bar.id = "__dsh_tide_login_bar";
    bar.setAttribute(
      "style",
      [
        "position:fixed",
        "top:10px",
        "right:10px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:10px",
        "padding:7px 9px 7px 12px",
        "border:1px solid rgba(255,255,255,.22)",
        "border-radius:10px",
        "background:rgba(16,20,28,.92)",
        "box-shadow:0 8px 28px rgba(0,0,0,.28)",
        "color:#e8edf6",
        "font:12px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
        "backdrop-filter:blur(10px)",
      ].join(";"),
    );

    const label = document.createElement("span");
    label.id = "__dsh_tide_login_status";
    label.textContent = "登录后将自动保存 userToken";
    bar.appendChild(label);

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.setAttribute(
      "style",
      [
        "border:0",
        "border-radius:7px",
        "padding:5px 9px",
        "cursor:pointer",
        "color:#dfe7f3",
        "background:rgba(255,255,255,.12)",
        "font:inherit",
      ].join(";"),
    );
    close.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (closeRequested) return;
      closeRequested = true;
      try {
        await invoke(COMMAND_CLOSE);
      } catch {
        closeRequested = false;
        label.textContent = "关闭失败，请按 Esc";
      }
    });
    bar.appendChild(close);
    document.documentElement.appendChild(bar);
  };

  const setStatus = (text) => {
    const node = document.getElementById("__dsh_tide_login_status");
    if (node) node.textContent = text;
  };

  const poll = async () => {
    installChrome();
    if (submitted) return;
    let token = null;
    try {
      token = normalizeToken(localStorage.getItem("userToken"));
    } catch {
      return;
    }
    if (!token) return;

    submitted = true;
    setStatus("已获取登录凭据，正在安全保存…");
    try {
      await invoke(COMMAND_SAVE, { token });
    } catch {
      submitted = false;
      setStatus("自动保存失败，请关闭后手动粘贴");
    }
  };

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || closeRequested) return;
      closeRequested = true;
      invoke(COMMAND_CLOSE).catch(() => {
        closeRequested = false;
      });
    },
    true,
  );

  installChrome();
  globalThis.setInterval(poll, 1000);
  globalThis.setTimeout(poll, 200);
})();
"#;

pub fn open(app: &tauri::AppHandle) -> Result<(), CommandError> {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = DEEPSEEK_LOGIN_URL
        .parse()
        .map_err(|_| CommandError::new("login_window", "登录地址无效"))?;
    WebviewWindowBuilder::new(app, LOGIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("登录 DeepSeek")
        .inner_size(800.0, 600.0)
        .min_inner_size(680.0, 500.0)
        .center()
        .decorations(false)
        .resizable(true)
        .initialization_script(LOGIN_CAPTURE_SCRIPT)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                println!("[deepseek-login] 页面已加载：{}", payload.url());
                let _ = window.eval(LOGIN_CAPTURE_SCRIPT);
            }
        })
        .build()
        .map_err(|error| CommandError::new("login_window", &error.to_string()))?;
    Ok(())
}

pub fn save_and_close(app: &tauri::AppHandle, token: &str) -> Result<(), CommandError> {
    credentials::set_user_token(token)?;
    let _ = app.emit_to(MAIN_WINDOW_LABEL, "deepseek-user-token-saved", ());
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    Ok(())
}

pub fn close(window: &WebviewWindow) -> Result<(), CommandError> {
    if window.label() != LOGIN_WINDOW_LABEL {
        return Err(CommandError::new(
            "window_forbidden",
            "只能关闭 DeepSeek 登录窗口",
        ));
    }
    window
        .close()
        .map_err(|error| CommandError::new("login_window", &error.to_string()))
}
