# DSH 峰谷提示桌面版

基于 Tauri v2、React 18、TypeScript、Vite 和 TailwindCSS 的 Windows 桌面工具。
它保留 `dsh-tide-hint` 的峰谷规则、倒计时、节假日调休、官方优惠和自动调度功能，
并把账户登录改成内嵌 DeepSeek 官方 WebView 的无感获取流程。

这是第三方非官方工具。充值与账户操作请认准
`https://platform.deepseek.com/top_up`。

## 下载

Windows 单文件安装包见
[GitHub Releases](https://github.com/like8995209-coder/dsh-tide-hint-desktop/releases)。
安装后会自动创建“DSH 峰谷提示”桌面快捷方式。

## 功能对齐

| 功能 | 实现 |
|---|---|
| 余额查询 | 优先用 API Key 请求 `GET https://api.deepseek.com/user/balance`；未配置或该请求失败时，用登录得到的 userToken 请求 `GET https://platform.deepseek.com/api/v0/users/get_user_summary`，汇总 CNY `normal_wallets.balance` |
| Token 用量查询 | userToken 通过 Rust 携带 `Authorization: Bearer <userToken>` 请求 `GET https://platform.deepseek.com/api/v0/usage/by_api_key/amount`；查询北京时间当日，汇总缓存命中的输入 Token、缓存未命中的输入 Token、输出 Token 和请求次数 |
| 凭据来源 | userToken 优先由内嵌官方登录窗口自动获取；无法自动获取时支持手动粘贴。API Key 使用密码输入框手动填写。两者均写入 Windows Credential Manager |
| 独立状态 | API Key 只影响余额，userToken 只影响用量；任一凭据缺失、过期或请求失败，均不影响另一项和峰谷倒计时 |
| 展示字段 | 峰谷状态、HH:MM:SS 倒计时、余额、以“万 tokens”显示的余额折算、今日 Token 总量、缓存命中/未命中/输出 Token、请求次数、规则更新时间、官方优惠和调度状态 |
| 刷新 | 启动时独立加载余额与用量；分别提供刷新按钮；每日首次启动更新规则与充值优惠；每秒更新倒计时与调度信号 |
| 状态提示 | 未配置 API Key、未登录 DeepSeek、401/403 凭据过期、网络异常、离线规则和解析失败均独立显示 |
| 其他功能 | UTC+8 工作日峰谷、2025–2026 节假日及 2026 调休、跨周末/节假日倒计时、官方充值优惠、自动调度、60 秒预警、置顶、托盘、单实例和开机自启 |

## WebView 无感登录

点击主窗口的“登录 DeepSeek”按钮，或按 `Ctrl+L`：

1. Rust 创建约 `800 × 600` 的无边框 `login` WebView，加载
   `https://platform.deepseek.com/`。
2. 登录窗口注入只读轮询脚本，每秒检查官方页面的
   `localStorage["userToken"]`。同时兼容旧 JWT 和当前平台的
   `{"value":"……","__version":"0"}` 不透明令牌对象。
3. 取得有效 token 后，通过受限 Tauri IPC 调用
   `save_user_token_and_close`。token 直接进入 Rust 和 Windows Credential Manager，
   主窗口不会收到明文。
4. 保存成功后立即销毁登录窗口，并通知主窗口刷新登录状态与今日用量。
5. 按 `Esc` 或页面右上角“关闭”可退出登录窗口；直接关闭窗口会恢复主窗口的登录按钮和状态。
6. 自动获取失败时，展开“设置”即可手动粘贴 userToken，不影响 API Key 余额。

登录窗口的 capability 只允许 `platform.deepseek.com` 调用
`save_user_token_and_close` 和 `close_login_window` 两个命令，没有文件、Shell、
任意 URL 或其他凭据命令权限。

## 凭据安全

- 凭据使用 Rust `keyring` v3 存入 Windows Credential Manager。
- service：`dsh-tide-hint-desktop`
- userToken 项：`deepseek-user-token`
- API Key 项：`deepseek-api-key`
- `get_credential_status` 只返回“是否已设置”，不返回凭据值。
- 前端密码输入框保存后立即清空；主窗口 WebView 不保存凭据。
- 需要直连 DeepSeek 的 HTTP 请求全部位于 Rust 侧，前端只调用 Tauri `invoke`。
- 不抓 Cookie，不做 OAuth 回调，不内嵌代理或第三方充值页面。

## 系统集成

- 主窗口为纯色、非透明的无边框圆角窗口，默认小窗高度 240px，展开高度限制为
  620px，设置内容在窗口内部滚动，避免在高 DPI 屏幕上超出桌面。
- 标题栏“小窗”按钮可切换为约 380×88 的三行紧凑卡片，完整显示峰谷、
  倒计时、余额、按当前峰谷价格折算的 Token 和今日用量；卡片可拖动，并通过
  独立“充值 / 展开 / 隐藏”按钮操作，点击数据区域不会误触充值页。
- 余额和用量每 60 秒自动刷新，复用原有 1 秒 UI tick，不创建额外定时器；连续
  失败时逐步退避到最长 5 分钟，窗口隐藏时暂停请求。
- 左键托盘图标显示/隐藏；右键菜单含显示/隐藏、刷新、退出。
- 关闭主窗口只隐藏到托盘，托盘“退出”才结束进程。
- `tauri-plugin-single-instance` 保证单实例。
- `tauri-plugin-autostart` 管理开机自启，默认关闭。

## 开发与构建

环境要求：

- Node.js 20.19+（或 22.12+）
- Rust stable
- Visual Studio 2022 Build Tools（MSVC），或 Rust GNU toolchain + llvm-mingw
- WebView2 Runtime

```powershell
cd C:\Users\M4099\Documents\Codex\dsh-tide-hint-tauri
npm install
npm run tauri dev
```

`scripts/tauri.mjs` 会优先使用 MSVC。若当前终端没有 `cl.exe`，但已安装
`stable-x86_64-pc-windows-gnu` 和 llvm-mingw，则自动切换到 GNU 构建；也可通过
环境变量 `TAURI_MINGW_BIN` 指定 MinGW 的 `bin` 目录。

生产构建：

```powershell
npm run tauri build
```

Windows 单文件安装包输出到
`src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/`。安装程序按当前用户
安装，并自动在桌面创建“DSH 峰谷提示”快捷方式。

应用图标原始设计保存在 `assets/icon-original.png`，裁切后的 1024px 源文件为
`src-tauri/icons/icon-source.png`。需要更换图标时，覆盖原始设计并执行：

```powershell
npm run icons
npm run tauri -- icon src-tauri/icons/icon-source.png
```

只检查前端：

```powershell
npm run build
```

## 官方接口

所有固定端点集中在 `src-tauri/src/http.rs`：

- API Key 余额：`https://api.deepseek.com/user/balance`
- userToken 余额：`https://platform.deepseek.com/api/v0/users/get_user_summary`
- userToken 用量：
  `https://platform.deepseek.com/api/v0/usage/by_api_key/amount`
- 官方价格页：`https://api-docs.deepseek.com/zh-cn/quick_start/pricing`
- 官方充值页：`https://platform.deepseek.com/top_up`
- 官方 API Keys 页面：`https://platform.deepseek.com/api_keys`

若官方端点或字段变化，只修改 Rust 常量和解析函数。用量接口使用官方前端相同的
`start`、`end`、`tz` 参数，其中 `tz=28800` 表示 UTC+8；前端字段契约保持不变。

## 零 Token 约束

运行时不调用 LLM，不注入系统提示，不修改对话请求，不生成文本，也不产生 Token
消耗。优惠文案直接展示官方原文或固定模板。
