use std::time::Duration;

use reqwest::{
    header::{ACCEPT, AUTHORIZATION},
    Client, StatusCode,
};

use crate::error::CommandError;

pub const API_BALANCE_URL: &str = "https://api.deepseek.com/user/balance";
pub const USER_SUMMARY_URL: &str = "https://platform.deepseek.com/api/v0/users/get_user_summary";
pub const USAGE_BY_API_KEY_AMOUNT_URL: &str =
    "https://platform.deepseek.com/api/v0/usage/by_api_key/amount";
pub const PRICING_URL: &str = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
pub const TOP_UP_URL: &str = "https://platform.deepseek.com/top_up";

pub fn client() -> Result<Client, CommandError> {
    Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("dsh-tide-hint-desktop/1.0")
        .build()
        .map_err(Into::into)
}

fn public_client() -> Result<Client, CommandError> {
    Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("dsh-tide-hint-desktop/1.0")
        .build()
        .map_err(Into::into)
}

pub fn is_deepseek_url(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "https")
        && url
            .host_str()
            .is_some_and(|host| host == "deepseek.com" || host.ends_with(".deepseek.com"))
}

pub async fn get_html(url: &str) -> Result<String, CommandError> {
    let client = public_client()?;
    let mut last_error = CommandError::network();
    for _ in 0..2 {
        match client
            .get(url)
            .header(ACCEPT, "text/html,application/xhtml+xml")
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                if !is_deepseek_url(response.url()) {
                    last_error =
                        CommandError::new("redirect", "官方页面重定向到非 deepseek.com 域名");
                    continue;
                }
                return response.text().await.map_err(Into::into);
            }
            Ok(response) => {
                last_error = status_error(response.status());
            }
            Err(error) => last_error = error.into(),
        }
    }
    Err(last_error)
}

pub fn status_error(status: StatusCode) -> CommandError {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        CommandError::with_status("unauthorized", "令牌过期或无效", status.as_u16())
    } else {
        CommandError::with_status("http", "官方接口请求失败", status.as_u16())
    }
}

pub fn platform_user_headers(
    request: reqwest::RequestBuilder,
    token: &str,
) -> reqwest::RequestBuilder {
    request
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
}

pub fn api_key_headers(request: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    request
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, format!("Bearer {key}"))
}
