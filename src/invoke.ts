import { invoke } from "@tauri-apps/api/core";
import type {
  BalanceResponse,
  CredentialStatus,
  PricingResponse,
  TopupResponse,
  UsageResponse,
} from "./types";

export const getCredentialStatus = () =>
  invoke<CredentialStatus>("get_credential_status");

export const setApiKey = (value: string) =>
  invoke<void>("set_api_key", { value });

export const setUserToken = (value: string) =>
  invoke<void>("set_user_token", { value });

export const clearCredentials = () => invoke<void>("clear_credentials");

export const fetchBalance = () => invoke<BalanceResponse>("fetch_balance");

export const fetchUsage = () => invoke<UsageResponse>("fetch_usage");

export const openDeepSeekLogin = () => invoke<void>("open_deepseek_login");

export const fetchPricing = () => invoke<PricingResponse>("fetch_pricing");

export const fetchTopup = () => invoke<TopupResponse>("fetch_topup");

export const setExpanded = (expanded: boolean) =>
  invoke<void>("set_expanded", { expanded });

export const setWindowMini = (mini: boolean) =>
  invoke<void>("set_window_mini", { mini });

export const hideWindow = () => invoke<void>("hide_window");

export const setAlwaysOnTop = (enabled: boolean) =>
  invoke<void>("set_always_on_top", { enabled });
