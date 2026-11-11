use keyring::Entry;

use crate::error::CommandError;

const SERVICE: &str = "dsh-tide-hint-desktop";
const API_KEY_USER: &str = "deepseek-api-key";
const USER_TOKEN_USER: &str = "deepseek-user-token";

fn entry(user: &str) -> Result<Entry, CommandError> {
    Entry::new(SERVICE, user).map_err(Into::into)
}

pub fn set_secret(user: &str, value: &str) -> Result<(), CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(CommandError::new("empty", "凭据不能为空"));
    }
    entry(user)?.set_password(value).map_err(Into::into)
}

pub fn get_secret(user: &str) -> Result<Option<String>, CommandError> {
    match entry(user)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn delete_secret(user: &str) -> Result<(), CommandError> {
    match entry(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn set_api_key(value: &str) -> Result<(), CommandError> {
    set_secret(API_KEY_USER, value)
}

pub fn set_user_token(value: &str) -> Result<(), CommandError> {
    let value = value.trim();
    let normalized = match serde_json::from_str::<serde_json::Value>(value) {
        Ok(serde_json::Value::String(token)) => token,
        Ok(serde_json::Value::Object(record)) => ["value", "token", "userToken", "access_token"]
            .iter()
            .find_map(|key| record.get(*key).and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| value.to_string()),
        _ => value.to_string(),
    };
    let token = normalized.trim();
    if token.len() < 16
        || token.len() > 8192
        || token.chars().any(char::is_whitespace)
        || !token
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._~+/=-".contains(character))
    {
        return Err(CommandError::new(
            "invalid_token",
            "未能识别有效的 DeepSeek userToken",
        ));
    }
    set_secret(USER_TOKEN_USER, token)
}

pub fn get_api_key() -> Result<Option<String>, CommandError> {
    get_secret(API_KEY_USER)
}

pub fn get_user_token() -> Result<Option<String>, CommandError> {
    get_secret(USER_TOKEN_USER)
}

pub fn clear() -> Result<(), CommandError> {
    delete_secret(API_KEY_USER)?;
    delete_secret(USER_TOKEN_USER)
}

#[derive(serde::Serialize)]
pub struct CredentialStatus {
    pub api_key_set: bool,
    pub user_token_set: bool,
}

pub fn status() -> Result<CredentialStatus, CommandError> {
    Ok(CredentialStatus {
        api_key_set: get_api_key()?.is_some(),
        user_token_set: get_user_token()?.is_some(),
    })
}
