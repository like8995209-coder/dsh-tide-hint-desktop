use chrono::{Datelike, Duration, FixedOffset, Utc};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{credentials, error::CommandError, http};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceResponse {
    pub balance_cny: f64,
    pub source: String,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResponse {
    pub supported: bool,
    pub date: String,
    pub prompt_cache_hit_tokens: u64,
    pub prompt_cache_miss_tokens: u64,
    pub response_tokens: u64,
    pub total_tokens: u64,
    pub requests: u64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
struct UserSummaryEnvelope {
    data: Option<UserSummaryData>,
}

#[derive(Deserialize)]
struct UserSummaryData {
    biz_code: Option<i64>,
    biz_data: Option<UserSummary>,
}

#[derive(Deserialize)]
struct UserSummary {
    normal_wallets: Option<Vec<Wallet>>,
}

#[derive(Deserialize)]
struct Wallet {
    balance: Option<Value>,
    currency: Option<String>,
}

#[derive(Deserialize)]
struct ApiBalance {
    balance_infos: Option<Vec<ApiWallet>>,
}

#[derive(Deserialize)]
struct ApiWallet {
    currency: Option<String>,
    total_balance: Option<serde_json::Value>,
    topped_up_balance: Option<serde_json::Value>,
}

fn numeric(value: Option<&serde_json::Value>) -> Option<f64> {
    match value? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite() && *value >= 0.0)
}

async fn balance_with_api_key(key: &str) -> Result<f64, CommandError> {
    let client = http::client()?;
    let response = http::api_key_headers(client.get(http::API_BALANCE_URL), key)
        .send()
        .await?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(http::status_error(status));
    }
    if !status.is_success() {
        return Err(http::status_error(status));
    }
    let body: ApiBalance = response
        .json()
        .await
        .map_err(|_| CommandError::parse("API Key 余额响应格式异常"))?;
    let values = body
        .balance_infos
        .unwrap_or_default()
        .into_iter()
        .filter(|wallet| wallet.currency.as_deref() == Some("CNY"))
        .filter_map(|wallet| {
            numeric(wallet.topped_up_balance.as_ref())
                .or_else(|| numeric(wallet.total_balance.as_ref()))
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Err(CommandError::parse("API Key 余额未包含 CNY"));
    }
    Ok(values.iter().sum())
}

async fn balance_with_user_token(token: &str) -> Result<f64, CommandError> {
    let client = http::client()?;
    let response = http::platform_user_headers(client.get(http::USER_SUMMARY_URL), token)
        .send()
        .await?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(CommandError::with_status(
            "unauthorized",
            "DeepSeek 登录已过期，请重新登录",
            status.as_u16(),
        ));
    }
    if !status.is_success() {
        return Err(http::status_error(status));
    }
    let body: UserSummaryEnvelope = response
        .json()
        .await
        .map_err(|_| CommandError::parse("官方余额响应格式异常"))?;
    let data = body
        .data
        .ok_or_else(|| CommandError::parse("官方余额响应为空"))?;
    if data.biz_code != Some(0) {
        return Err(CommandError::new("api", "官方余额接口返回失败"));
    }
    let values = data
        .biz_data
        .and_then(|data| data.normal_wallets)
        .unwrap_or_default()
        .into_iter()
        .filter(|wallet| wallet.currency.as_deref() == Some("CNY"))
        .filter_map(|wallet| numeric(wallet.balance.as_ref()))
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Err(CommandError::parse("官方余额未包含 CNY 充值余额"));
    }
    Ok(values.iter().sum())
}

pub async fn fetch_balance() -> Result<BalanceResponse, CommandError> {
    let api_key = credentials::get_api_key()?;
    let user_token = credentials::get_user_token()?;
    let mut last_error = None;

    if let Some(key) = api_key {
        match balance_with_api_key(&key).await {
            Ok(balance_cny) => {
                return Ok(BalanceResponse {
                    balance_cny,
                    source: "api_key".to_string(),
                    updated_at: Utc::now().timestamp_millis(),
                });
            }
            Err(error) => last_error = Some(error),
        }
    }

    if let Some(token) = user_token {
        match balance_with_user_token(&token).await {
            Ok(balance_cny) => {
                return Ok(BalanceResponse {
                    balance_cny,
                    source: "user_token".to_string(),
                    updated_at: Utc::now().timestamp_millis(),
                });
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        CommandError::new("unconfigured", "尚未登录 DeepSeek，也未配置 API Key")
    }))
}

fn usage_number(value: Option<&Value>) -> u64 {
    match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .or_else(|| number.as_f64().map(|value| value.max(0.0) as u64))
            .unwrap_or(0),
        Some(Value::String(text)) => text
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value as u64)
            .unwrap_or(0),
        _ => 0,
    }
}

pub async fn fetch_usage() -> Result<UsageResponse, CommandError> {
    let token = credentials::get_user_token()?
        .ok_or_else(|| CommandError::new("unconfigured", "尚未登录 DeepSeek，用量查询尚未启用"))?;
    let timezone = FixedOffset::east_opt(8 * 60 * 60).expect("valid UTC+8 offset");
    let now = Utc::now().with_timezone(&timezone);
    let date = now.date_naive();
    let start = date
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight")
        .and_utc()
        .timestamp();
    let next_date = date + Duration::days(1);
    let end = next_date
        .and_hms_opt(0, 0, 0)
        .expect("valid next midnight")
        .and_utc()
        .timestamp();

    let client = http::client()?;
    let response = http::platform_user_headers(
        client.get(http::USAGE_BY_API_KEY_AMOUNT_URL).query(&[
            ("start", start),
            ("end", end),
            ("tz", 28_800),
        ]),
        &token,
    )
    .send()
    .await?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(CommandError::with_status(
            "unauthorized",
            "DeepSeek 登录已过期，请重新登录",
            status.as_u16(),
        ));
    }
    if !status.is_success() {
        return Err(http::status_error(status));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| CommandError::parse("官方用量响应格式异常"))?;
    let business_code = body.get("code").and_then(Value::as_i64);
    let business_message = body
        .get("msg")
        .and_then(Value::as_str)
        .unwrap_or("官方用量接口返回失败");
    if business_code == Some(40003)
        || business_message
            .to_ascii_lowercase()
            .contains("invalid token")
    {
        return Err(CommandError::with_status(
            "unauthorized",
            "DeepSeek 登录已过期，请重新登录",
            401,
        ));
    }
    let envelope = body
        .get("data")
        .filter(|value| !value.is_null())
        .ok_or_else(|| CommandError::new("api", business_message))?;
    if envelope.get("biz_code").and_then(Value::as_i64) != Some(0) {
        return Err(CommandError::new("api", "官方用量接口返回失败"));
    }

    let mut prompt_cache_hit_tokens = 0_u64;
    let mut prompt_cache_miss_tokens = 0_u64;
    let mut response_tokens = 0_u64;
    let mut requests = 0_u64;
    if let Some(series) = envelope
        .pointer("/biz_data/series")
        .and_then(Value::as_array)
    {
        for item in series {
            let Some(buckets) = item.get("buckets").and_then(Value::as_array) else {
                continue;
            };
            for bucket in buckets {
                let Some(usage) = bucket.get("usage").and_then(Value::as_object) else {
                    continue;
                };
                for (key, value) in usage {
                    match key.to_ascii_uppercase().as_str() {
                        "PROMPT_CACHE_HIT_TOKEN" => {
                            prompt_cache_hit_tokens =
                                prompt_cache_hit_tokens.saturating_add(usage_number(Some(value)));
                        }
                        "PROMPT_CACHE_MISS_TOKEN" => {
                            prompt_cache_miss_tokens =
                                prompt_cache_miss_tokens.saturating_add(usage_number(Some(value)));
                        }
                        "RESPONSE_TOKEN" => {
                            response_tokens =
                                response_tokens.saturating_add(usage_number(Some(value)));
                        }
                        "REQUEST" => {
                            requests = requests.saturating_add(usage_number(Some(value)));
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    let total_tokens = prompt_cache_hit_tokens
        .saturating_add(prompt_cache_miss_tokens)
        .saturating_add(response_tokens);
    Ok(UsageResponse {
        supported: true,
        date: format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day()),
        prompt_cache_hit_tokens,
        prompt_cache_miss_tokens,
        response_tokens,
        total_tokens,
        requests,
        updated_at: Utc::now().timestamp_millis(),
    })
}
