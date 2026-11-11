use regex::Regex;
use serde::Serialize;

use crate::{error::CommandError, http};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPricing {
    pub model: String,
    pub input_peak: f64,
    pub input_off_peak: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingResponse {
    pub peak_windows: Vec<String>,
    pub weekend_off_peak: bool,
    pub holiday_off_peak: bool,
    pub token_pricing: Option<TokenPricing>,
    pub raw_footnote_snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupResponse {
    pub offer_text: Option<String>,
    pub page_balance_cny: Option<f64>,
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn text_of_html(value: &str) -> String {
    let excluded =
        Regex::new(r"(?is)<(?:script|style|noscript)\b[^>]*>.*?</(?:script|style|noscript)>")
            .expect("excluded tag regex");
    let tag = Regex::new(r"(?is)<[^>]+>").expect("tag regex");
    decode_entities(&tag.replace_all(&excluded.replace_all(value, " "), " "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn blocks(html: &str, tags: &[&str]) -> Vec<String> {
    let mut values = Vec::new();
    for tag in tags {
        let pattern = format!(r"(?is)<{tag}\b[^>]*>(.*?)</{tag}>");
        let Ok(regex) = Regex::new(&pattern) else {
            continue;
        };
        values.extend(
            regex
                .captures_iter(html)
                .map(|capture| text_of_html(&capture[1]))
                .filter(|value| !value.is_empty()),
        );
    }
    if values.is_empty() {
        let text = text_of_html(html);
        if !text.is_empty() {
            values.push(text);
        }
    }
    values
}

fn price_in_row(row: &str) -> Option<f64> {
    Regex::new(r"\d+(?:\.\d+)?")
        .ok()?
        .find(row)
        .and_then(|value| value.as_str().parse::<f64>().ok())
        .filter(|value| *value > 0.0)
}

fn token_pricing(html: &str) -> Option<TokenPricing> {
    let rows = Regex::new(r"(?is)<tr\b[^>]*>(.*?)</tr>")
        .ok()?
        .captures_iter(html)
        .map(|capture| text_of_html(&capture[1]))
        .collect::<Vec<_>>();
    let input_index = rows
        .iter()
        .position(|row| row.contains("tokens输入") && row.contains("缓存未命中"))?;
    let output_index = rows
        .iter()
        .enumerate()
        .find(|(index, row)| *index > input_index && row.contains("tokens输出"))
        .map(|(index, _)| index)
        .unwrap_or(input_index + 3);
    let section = &rows[input_index..output_index.min(rows.len())];
    let off_peak_row = section.iter().find(|row| row.contains("空闲"))?;
    let peak_row = section.iter().find(|row| row.contains("高峰"))?;
    Some(TokenPricing {
        model: "deepseek-flash 输入（缓存未命中）".to_string(),
        input_peak: price_in_row(peak_row)?,
        input_off_peak: price_in_row(off_peak_row)?,
    })
}

pub fn parse_pricing(html: &str) -> Result<PricingResponse, CommandError> {
    let snippet = blocks(html, &["p", "li", "div", "section", "article"])
        .into_iter()
        .find(|block| {
            block.contains("高峰")
                && (block.contains("空闲") || block.contains("闲时") || block.contains("非高峰"))
                && (block.contains("周末") || block.contains("法定节假日"))
        })
        .ok_or_else(|| CommandError::parse("官网规则解析失败"))?;
    let window_re = Regex::new(
        r"([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|—|~|～|至|到)\s*([01]?\d|2[0-3]):([0-5]\d)",
    )
    .map_err(|_| CommandError::parse("峰时窗口解析失败"))?;
    let mut peak_windows = Vec::new();
    for capture in window_re.captures_iter(&snippet) {
        let start = format!(
            "{:02}:{}",
            capture[1].parse::<u8>().unwrap_or(0),
            &capture[2]
        );
        let end = format!(
            "{:02}:{}",
            capture[3].parse::<u8>().unwrap_or(0),
            &capture[4]
        );
        if end > start {
            peak_windows.push(format!("{start}-{end}"));
        }
    }
    peak_windows.sort();
    peak_windows.dedup();
    let weekday_rule = Regex::new(r"工作日|周一至周五|周一.*?周五")
        .map_err(|_| CommandError::parse("工作日规则解析失败"))?;
    let weekend_rule = Regex::new(
        r"周末[^。；]{0,100}(?:空闲|闲时|谷时|半价|非高峰)|(?:空闲|闲时|谷时|半价|非高峰)[^。；]{0,100}周末",
    )
    .map_err(|_| CommandError::parse("周末规则解析失败"))?;
    let holiday_rule = Regex::new(
        r"法定节假日[^。；]{0,100}(?:空闲|闲时|谷时|半价|非高峰)|(?:空闲|闲时|谷时|半价|非高峰)[^。；]{0,100}法定节假日",
    )
    .map_err(|_| CommandError::parse("节假日规则解析失败"))?;
    let weekend_off_peak = weekend_rule.is_match(&snippet);
    let holiday_off_peak = holiday_rule.is_match(&snippet);
    if peak_windows.is_empty()
        || peak_windows.len() > 4
        || !weekday_rule.is_match(&snippet)
        || !weekend_off_peak
        || !holiday_off_peak
    {
        return Err(CommandError::parse("官网规则缺项，沿用旧规则"));
    }
    Ok(PricingResponse {
        peak_windows,
        weekend_off_peak,
        holiday_off_peak,
        token_pricing: token_pricing(html),
        raw_footnote_snippet: snippet.chars().take(700).collect(),
    })
}

pub fn parse_topup(html: &str) -> TopupResponse {
    let promo_words = Regex::new(r"优惠|活动|赠送|加赠|返现|折扣|立减|满减").expect("promo regex");
    let external_url = Regex::new(r#"https?://[^\s，。；]+"#).expect("url regex");
    let offer_text = blocks(html, &["p", "li", "div", "section", "article"])
        .into_iter()
        .flat_map(|block| {
            block
                .split(['。', '！', '？', '!', '?'])
                .map(str::trim)
                .filter(|text| text.len() >= 8 && text.len() <= 220)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .find(|text| {
            (text.contains("充值") || text.contains("余额") || text.contains("储值"))
                && promo_words.is_match(text)
                && !text.contains("第三方")
                && !text.contains("代理")
                && !text.contains("代充")
                && !text.contains("折扣码")
                && !text.contains("邀请码")
                && external_url.find_iter(text).all(|value| {
                    match reqwest::Url::parse(value.as_str()) {
                        Ok(url) => http::is_deepseek_url(&url),
                        Err(_) => false,
                    }
                })
        });
    let balance_re = Regex::new(r"(?:账户余额|可用余额|余额)[^0-9]{0,24}[¥￥]?\s*(\d+(?:\.\d+)?)")
        .expect("balance regex");
    let json_balance_re =
        Regex::new(r#""(?:balance|available_balance|cash_balance)"\s*:\s*"?(\d+(?:\.\d+)?)"#)
            .expect("json balance regex");
    let page_balance_cny = json_balance_re
        .captures(html)
        .and_then(|capture| capture[1].parse::<f64>().ok())
        .or_else(|| {
            let visible = text_of_html(html);
            balance_re
                .captures(&visible)
                .and_then(|capture| capture[1].parse::<f64>().ok())
        })
        .filter(|value| value.is_finite() && *value >= 0.0);
    TopupResponse {
        offer_text,
        page_balance_cny,
    }
}

pub async fn fetch_pricing() -> Result<PricingResponse, CommandError> {
    parse_pricing(&http::get_html(http::PRICING_URL).await?)
}

pub async fn fetch_topup() -> Result<TopupResponse, CommandError> {
    Ok(parse_topup(&http::get_html(http::TOP_UP_URL).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rule_and_flash_input_price() {
        let html = r#"
          <p>空闲时段价格为高峰时段价格的一半。北京时间周一至周五 9:00 - 12:00、
          14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</p>
          <table>
            <tr><td>百万tokens输入<br>（缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr>
            <tr><td>高峰时段</td><td>2元</td><td>9元</td></tr>
          </table>
        "#;
        let parsed = parse_pricing(html).expect("pricing");
        assert_eq!(parsed.peak_windows, vec!["09:00-12:00", "14:00-18:00"]);
        assert_eq!(parsed.token_pricing.expect("price").input_off_peak, 1.0);
    }
}
