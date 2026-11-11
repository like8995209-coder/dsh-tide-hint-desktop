use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub status: Option<u16>,
}

impl CommandError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status: None,
        }
    }

    pub fn with_status(code: &str, message: &str, status: u16) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status: Some(status),
        }
    }

    pub fn network() -> Self {
        Self::new("network", "网络异常")
    }

    pub fn parse(message: &str) -> Self {
        Self::new("parse", message)
    }
}

impl From<reqwest::Error> for CommandError {
    fn from(error: reqwest::Error) -> Self {
        if error.is_timeout() || error.is_connect() || error.is_request() {
            Self::network()
        } else {
            Self::new("http", &error.to_string())
        }
    }
}

impl From<keyring::Error> for CommandError {
    fn from(error: keyring::Error) -> Self {
        Self::new("credential_store", &error.to_string())
    }
}
