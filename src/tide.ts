import type {
  OfferSnapshot,
  ParseStatus,
  PeakWindow,
  SchedulerState,
  TideRules,
  TokenPricing,
} from "./types";

export const PRICING_URL =
  "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
export const TOP_UP_URL = "https://platform.deepseek.com/top_up";
export const API_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const RULES_CACHE_KEY = "dsh-tide-hint.rules";
export const OFFER_CACHE_KEY = "dsh-tide-hint.offer";
export const SCHEDULER_CACHE_KEY = "dsh-tide-hint.scheduler";
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export const TASK_START_EVENT = "dsh-tide:task-start";
export const TASK_STOP_EVENT = "dsh-tide:task-stop";
export const PREWARN_EVENT = "dsh-tide:prewarn";
export const PREWARN_MESSAGE =
  "距峰时原价时段60秒，即将自动停止后台任务。";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCH_DAYS = 400;

export const CHINA_PUBLIC_HOLIDAYS = [
  "2025-01-01",
  "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
  "2025-02-01", "2025-02-02", "2025-02-03", "2025-02-04",
  "2025-04-04", "2025-04-05", "2025-04-06",
  "2025-05-01", "2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05",
  "2025-05-31", "2025-06-01", "2025-06-02",
  "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04",
  "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08",
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  "2026-10-05", "2026-10-06", "2026-10-07",
];

export const CHINA_MAKEUP_WORKDAYS = [
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10",
];

const BUILTIN_TOKEN_PRICING: TokenPricing = {
  model: "deepseek-flash 输入（缓存未命中）",
  inputPeak: 2,
  inputOffPeak: 1,
};

export const BUILTIN_RULES: TideRules = {
  peakWindows: ["09:00-12:00", "14:00-18:00"],
  weekendOffPeak: true,
  holidayOffPeak: true,
  holidays: CHINA_PUBLIC_HOLIDAYS,
  makeupWorkdays: CHINA_MAKEUP_WORKDAYS,
  coverageYears: [2025, 2026],
  lastFetchedDate: null,
  fetchedAt: null,
  sourceUrl: PRICING_URL,
  parseStatus: "fallback",
  rawFootnoteSnippet:
    "内置官方定价快照：工作日 09:00-12:00、14:00-18:00 为高峰，其余含周末和法定节假日为空闲。",
  tokenPricing: BUILTIN_TOKEN_PRICING,
};

export const DEFAULT_SCHEDULER: SchedulerState = {
  enabled: false,
  manualLocked: false,
  prewarnAt: null,
  prewarnBoundary: null,
};

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function beijingParts(timestamp = Date.now()) {
  const shifted = new Date(timestamp + BEIJING_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  };
}

export function beijingDateKey(timestamp = Date.now()): string {
  return beijingParts(timestamp).dateKey;
}

export function addDays(dateKey: string, days: number): string {
  const midpoint = Date.parse(`${dateKey}T00:00:00.000Z`);
  return new Date(midpoint + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

export function isWorkingDay(dateKey: string, rules: TideRules): boolean {
  // 调休上班日优先级高于周末谷时。
  if (rules.makeupWorkdays.includes(dateKey)) return true;
  if (rules.holidays.includes(dateKey) && rules.holidayOffPeak) return false;
  const day = weekdayOf(dateKey);
  if ((day === 0 || day === 6) && rules.weekendOffPeak) return false;
  return true;
}

export function parsePeakWindows(values: string[]): PeakWindow[] {
  const windows: PeakWindow[] = [];
  for (const text of values) {
    const match = text.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (end > start) windows.push({ start, end });
  }
  return windows.sort((a, b) => a.start - b.start);
}

export function tideStateAt(timestamp: number, rules: TideRules) {
  const p = beijingParts(timestamp);
  const minute = p.hour * 60 + p.minute;
  const isPeak =
    isWorkingDay(p.dateKey, rules) &&
    parsePeakWindows(rules.peakWindows).some(
      (window) => minute >= window.start && minute < window.end,
    );
  return { isPeak, dateKey: p.dateKey, minute };
}

function beijingBoundary(dateKey: string, minutes: number): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return (
    Date.UTC(year, month - 1, day, 0, minutes, 0, 0) -
    BEIJING_OFFSET_MS
  );
}

export function nextTransitionAt(
  timestamp: number,
  rules: TideRules,
): number | null {
  const current = tideStateAt(timestamp, rules);
  const windows = parsePeakWindows(rules.peakWindows);
  if (windows.length === 0) return null;
  if (current.isPeak) {
    const end = windows
      .filter(
        (window) =>
          current.minute >= window.start && current.minute < window.end,
      )
      .map((window) => window.end)
      .sort((a, b) => a - b)[0];
    if (end !== undefined) return beijingBoundary(current.dateKey, end);
  }
  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const dateKey = addDays(current.dateKey, offset);
    if (!isWorkingDay(dateKey, rules)) continue;
    for (const window of windows) {
      const boundary = beijingBoundary(dateKey, window.start);
      if (boundary > timestamp) return boundary;
    }
  }
  return null;
}

export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(
    Math.floor((total % 3600) / 60),
  )}:${pad(total % 60)}`;
}

export function formatBeijingDateTime(value: string | number | null): string {
  if (value === null) return "—";
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const p = beijingParts(time);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatBalance(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `¥${value.toFixed(2)}`;
}

export function estimateTokensWan(
  balance: number | null,
  pricePerMillion: number | null,
): number | null {
  if (balance === null || pricePerMillion === null || pricePerMillion <= 0) {
    return null;
  }
  // 每百万 Token 单价换算为“万 Token”：百万数乘以 100。
  return (balance / pricePerMillion) * 100;
}

export function formatTokenEstimate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} 万`;
}

export function rulesCoverYear(rules: TideRules, year: number): boolean {
  if (rules.coverageYears.includes(year)) return true;
  const prefix = `${year}-`;
  return (
    rules.holidays.some((date) => date.startsWith(prefix)) ||
    rules.makeupWorkdays.some((date) => date.startsWith(prefix))
  );
}

type LegacyRecord = Record<string, unknown>;

function asRecord(value: unknown): LegacyRecord {
  return value !== null && typeof value === "object"
    ? (value as LegacyRecord)
    : {};
}

function legacyValue(
  record: LegacyRecord,
  camelKey: string,
  snakeKey: string,
): unknown {
  return record[camelKey] ?? record[snakeKey];
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const values = value.filter(
    (item): item is string =>
      typeof item === "string" &&
      parsePeakWindows([item]).length > 0,
  );
  return values.length > 0 ? values : [...fallback];
}

function dateArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item),
  );
}

export function loadRules(): TideRules {
  try {
    const value = localStorage.getItem(RULES_CACHE_KEY);
    if (!value) return structuredClone(BUILTIN_RULES);
    const parsed = asRecord(JSON.parse(value));
    const tokenRecord = asRecord(
      legacyValue(parsed, "tokenPricing", "token_pricing"),
    );
    const parsedTokenPeak = legacyValue(
      tokenRecord,
      "inputPeak",
      "input_peak",
    );
    const parsedTokenOffPeak = legacyValue(
      tokenRecord,
      "inputOffPeak",
      "input_off_peak",
    );
    const tokenPricing =
      typeof tokenRecord.model === "string" &&
      typeof parsedTokenPeak === "number" &&
      Number.isFinite(parsedTokenPeak) &&
      parsedTokenPeak > 0 &&
      typeof parsedTokenOffPeak === "number" &&
      Number.isFinite(parsedTokenOffPeak) &&
      parsedTokenOffPeak > 0
        ? {
            model: tokenRecord.model,
            inputPeak: parsedTokenPeak,
            inputOffPeak: parsedTokenOffPeak,
          }
        : structuredClone(BUILTIN_TOKEN_PRICING);
    const parsedStatus = legacyValue(parsed, "parseStatus", "parse_status");
    const parseStatus: ParseStatus =
      parsedStatus === "ok" || parsedStatus === "parse_failed"
        ? parsedStatus
        : "fallback";
    const parsedFetchedAt = legacyValue(parsed, "fetchedAt", "fetched_at");
    const parsedLastFetchedDate = legacyValue(
      parsed,
      "lastFetchedDate",
      "last_fetched_date",
    );
    return {
      ...structuredClone(BUILTIN_RULES),
      peakWindows: stringArray(
        legacyValue(parsed, "peakWindows", "peak_windows"),
        BUILTIN_RULES.peakWindows,
      ),
      weekendOffPeak:
        typeof legacyValue(parsed, "weekendOffPeak", "weekend_off_peak") ===
        "boolean"
          ? Boolean(
              legacyValue(parsed, "weekendOffPeak", "weekend_off_peak"),
            )
          : BUILTIN_RULES.weekendOffPeak,
      holidayOffPeak:
        typeof legacyValue(parsed, "holidayOffPeak", "holiday_off_peak") ===
        "boolean"
          ? Boolean(
              legacyValue(parsed, "holidayOffPeak", "holiday_off_peak"),
            )
          : BUILTIN_RULES.holidayOffPeak,
      holidays: Array.from(
        new Set([
          ...CHINA_PUBLIC_HOLIDAYS,
          ...dateArray(parsed.holidays, []),
        ]),
      ).sort(),
      makeupWorkdays: Array.from(
        new Set([
          ...CHINA_MAKEUP_WORKDAYS,
          ...dateArray(
            legacyValue(parsed, "makeupWorkdays", "makeup_workdays"),
            [],
          ),
        ]),
      ).sort(),
      coverageYears: Array.isArray(
        legacyValue(parsed, "coverageYears", "coverage_years"),
      )
        ? (
            legacyValue(
              parsed,
              "coverageYears",
              "coverage_years",
            ) as unknown[]
          ).filter(
            (year): year is number =>
              typeof year === "number" && Number.isInteger(year),
          )
        : [...BUILTIN_RULES.coverageYears],
      lastFetchedDate:
        typeof parsedLastFetchedDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsedLastFetchedDate)
          ? parsedLastFetchedDate
          : null,
      fetchedAt: typeof parsedFetchedAt === "string" ? parsedFetchedAt : null,
      sourceUrl: PRICING_URL,
      parseStatus,
      rawFootnoteSnippet:
        typeof legacyValue(
          parsed,
          "rawFootnoteSnippet",
          "raw_footnote_snippet",
        ) === "string"
          ? String(
              legacyValue(
                parsed,
                "rawFootnoteSnippet",
                "raw_footnote_snippet",
              ),
            )
          : "",
      tokenPricing,
      lastError:
        typeof legacyValue(parsed, "lastError", "last_error") === "string"
          ? String(legacyValue(parsed, "lastError", "last_error"))
          : undefined,
    };
  } catch {
    return structuredClone(BUILTIN_RULES);
  }
}

export function loadOffer(): OfferSnapshot {
  try {
    const value = localStorage.getItem(OFFER_CACHE_KEY);
    if (!value) {
      return {
        date: null,
        text: "官方优惠加载中…",
        sourceUrl: TOP_UP_URL,
        fetchedAt: null,
        status: "idle",
      };
    }
    const parsed = asRecord(JSON.parse(value));
    return {
      date: typeof parsed.date === "string" ? parsed.date : null,
      text:
        typeof parsed.text === "string" ? parsed.text : "官方优惠加载中…",
      sourceUrl: TOP_UP_URL,
      fetchedAt:
        typeof legacyValue(parsed, "fetchedAt", "fetched_at") === "string"
          ? String(legacyValue(parsed, "fetchedAt", "fetched_at"))
          : null,
      status:
        parsed.status === "ok" || parsed.status === "error"
          ? parsed.status
          : "idle",
    };
  } catch {
    return {
      date: null,
      text: "官方优惠加载中…",
      sourceUrl: TOP_UP_URL,
      fetchedAt: null,
      status: "idle",
    };
  }
}

export function loadScheduler(): SchedulerState {
  try {
    const value = localStorage.getItem(SCHEDULER_CACHE_KEY);
    if (!value) return { ...DEFAULT_SCHEDULER };
    const parsed = asRecord(JSON.parse(value));
    const finiteTimestamp = (candidate: unknown) =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
        ? candidate
        : null;
    return {
      enabled: parsed.enabled === true,
      manualLocked:
        legacyValue(parsed, "manualLocked", "manual_locked") === true,
      prewarnAt: finiteTimestamp(
        legacyValue(parsed, "prewarnAt", "prewarn_at"),
      ),
      prewarnBoundary: finiteTimestamp(
        legacyValue(parsed, "prewarnBoundary", "prewarn_boundary"),
      ),
    };
  } catch {
    return { ...DEFAULT_SCHEDULER };
  }
}

export function saveRules(rules: TideRules): void {
  localStorage.setItem(RULES_CACHE_KEY, JSON.stringify(rules));
}

export function saveOffer(offer: OfferSnapshot): void {
  localStorage.setItem(OFFER_CACHE_KEY, JSON.stringify(offer));
}

export function saveScheduler(state: SchedulerState): void {
  localStorage.setItem(SCHEDULER_CACHE_KEY, JSON.stringify(state));
}
