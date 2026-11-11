export type ParseStatus = "ok" | "parse_failed" | "fallback";

export interface PeakWindow {
  start: number;
  end: number;
}

export interface TokenPricing {
  model: string;
  inputPeak: number;
  inputOffPeak: number;
}

export interface TideRules {
  peakWindows: string[];
  weekendOffPeak: boolean;
  holidayOffPeak: boolean;
  holidays: string[];
  makeupWorkdays: string[];
  coverageYears: number[];
  lastFetchedDate: string | null;
  fetchedAt: string | null;
  sourceUrl: string;
  parseStatus: ParseStatus;
  rawFootnoteSnippet: string;
  tokenPricing: TokenPricing | null;
  lastError?: string;
}

export interface OfferSnapshot {
  date: string | null;
  text: string;
  sourceUrl: string;
  fetchedAt: string | null;
  status: "idle" | "ok" | "error";
}

export interface SchedulerState {
  enabled: boolean;
  manualLocked: boolean;
  prewarnAt: number | null;
  prewarnBoundary: number | null;
}

export interface CredentialStatus {
  api_key_set: boolean;
  user_token_set: boolean;
}

export interface BalanceResponse {
  balanceCny: number;
  source: "api_key" | "user_token";
  updatedAt: number;
}

export interface UsageResponse {
  supported: true;
  date: string;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  responseTokens: number;
  totalTokens: number;
  requests: number;
  updatedAt: number;
}

export interface PricingResponse {
  peakWindows: string[];
  weekendOffPeak: boolean;
  holidayOffPeak: boolean;
  tokenPricing: TokenPricing | null;
  rawFootnoteSnippet: string;
}

export interface TopupResponse {
  offerText: string | null;
  pageBalanceCny: number | null;
}

export interface CommandError {
  code: string;
  message: string;
  status?: number | null;
}

declare global {
  interface Window {
    DSHTideHint?: {
      setSchedulerEnable(enabled: boolean): SchedulerState;
      setManualLock(locked: boolean): SchedulerState;
    };
  }
}
