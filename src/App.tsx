import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  clearCredentials,
  fetchBalance,
  fetchPricing,
  fetchTopup,
  fetchUsage,
  getCredentialStatus,
  hideWindow,
  openDeepSeekLogin,
  setAlwaysOnTop,
  setApiKey,
  setExpanded as setWindowExpanded,
  setWindowMini,
  setUserToken,
} from "./invoke";
import { dispatchSchedulerEvents } from "./scheduler";
import appIconUrl from "./assets/app-icon.png";
import {
  API_KEYS_URL,
  PRICING_URL,
  TOP_UP_URL,
  beijingDateKey,
  beijingParts,
  estimateTokensWan,
  formatBalance,
  formatBeijingDateTime,
  formatCountdown,
  formatTokenEstimate,
  loadOffer,
  loadRules,
  loadScheduler,
  nextTransitionAt,
  rulesCoverYear,
  saveOffer,
  saveRules,
  saveScheduler,
  tideStateAt,
} from "./tide";
import type {
  CommandError,
  CredentialStatus,
  OfferSnapshot,
  SchedulerState,
  TideRules,
  UsageResponse,
} from "./types";

const NO_OFFER_TEXT = "官方无额外充值优惠";
const OFFER_ERROR_TEXT = "官方优惠暂不可用（采集失败）";
const AUTO_REFRESH_MS = 60_000;
const AUTO_REFRESH_MAX_MS = 5 * 60_000;
const EMPTY_CREDENTIALS: CredentialStatus = {
  api_key_set: false,
  user_token_set: false,
};

function commandMessage(error: unknown, scope: "balance" | "usage"): string {
  const value = error as Partial<CommandError> | undefined;
  if (value?.code === "unauthorized") {
    return scope === "balance"
      ? "余额凭据已失效，请重新登录或更新 API Key。"
      : "DeepSeek 登录已过期，请重新登录。";
  }
  if (value?.code === "unconfigured") {
    return typeof value.message === "string"
      ? value.message
      : scope === "balance"
        ? "未配置 API Key，余额查询尚未启用。"
        : "尚未登录 DeepSeek，用量查询尚未启用。";
  }
  if (value?.code === "network") return "网络异常，请稍后重试。";
  return typeof value?.message === "string" ? value.message : "操作失败。";
}

function formatUpdatedAt(value: string | null): string {
  return value ? `规则更新：${formatBeijingDateTime(value)}` : "规则更新：内置快照";
}

const tokenNumberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

function formatTokenCount(value: number): string {
  return tokenNumberFormat.format(Math.max(0, Math.trunc(value)));
}

export default function App() {
  const [rules, setRules] = useState<TideRules>(() => loadRules());
  const [offer, setOffer] = useState<OfferSnapshot>(() => loadOffer());
  const [scheduler, setScheduler] = useState<SchedulerState>(() =>
    loadScheduler(),
  );
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [mini, setMini] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [credentials, setCredentials] =
    useState<CredentialStatus>(EMPTY_CREDENTIALS);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [userTokenDraft, setUserTokenDraft] = useState("");
  const [balanceCny, setBalanceCny] = useState<number | null>(null);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);
  const [balanceSource, setBalanceSource] = useState<
    "api_key" | "user_token" | null
  >(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const [refreshingRules, setRefreshingRules] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const dailyStarted = useRef(false);
  const lastAutoRefreshAt = useRef(0);
  const autoRefreshDelay = useRef(AUTO_REFRESH_MS);
  const balanceRefreshInFlight = useRef(false);
  const usageRefreshInFlight = useRef(false);

  const current = tideStateAt(now, rules);
  const target = nextTransitionAt(now, rules);
  const targetIsPeak =
    target === null ? false : tideStateAt(target, rules).isPeak;
  const tokenPrice =
    rules.tokenPricing === null
      ? null
      : current.isPeak
        ? rules.tokenPricing.inputPeak
        : rules.tokenPricing.inputOffPeak;
  const tokenEstimate = estimateTokensWan(balanceCny, tokenPrice);
  const tariffLabel = current.isPeak ? "峰时" : "谷时";
  const coverageWarning =
    rules.holidayOffPeak &&
    !rulesCoverYear(rules, beijingParts(now).year)
      ? `${beijingParts(now).year} 年节假日数据未覆盖，按工作日估算`
      : "";
  const warning =
    [
      rules.parseStatus === "ok" ? "" : "离线规则（内置快照）",
      coverageWarning,
      rules.lastError ?? "",
    ]
      .filter(Boolean)
      .join("；") || "";

  const updateOffer = useCallback((next: OfferSnapshot) => {
    setOffer(next);
    saveOffer(next);
  }, []);

  const refreshBalance = useCallback(async (): Promise<boolean> => {
    if (balanceRefreshInFlight.current) return false;
    balanceRefreshInFlight.current = true;
    setRefreshingBalance(true);
    setBalanceError(null);
    try {
      const result = await fetchBalance();
      setBalanceCny(result.balanceCny);
      setBalanceUpdatedAt(result.updatedAt);
      setBalanceSource(result.source);
      autoRefreshDelay.current = AUTO_REFRESH_MS;
      return true;
    } catch (error) {
      setBalanceError(commandMessage(error, "balance"));
      return false;
    } finally {
      balanceRefreshInFlight.current = false;
      setRefreshingBalance(false);
    }
  }, []);

  const refreshUsage = useCallback(async (): Promise<boolean> => {
    if (usageRefreshInFlight.current) return false;
    usageRefreshInFlight.current = true;
    setRefreshingUsage(true);
    setUsageError(null);
    try {
      setUsage(await fetchUsage());
      autoRefreshDelay.current = AUTO_REFRESH_MS;
      return true;
    } catch (error) {
      setUsageError(commandMessage(error, "usage"));
      return false;
    } finally {
      usageRefreshInFlight.current = false;
      setRefreshingUsage(false);
    }
  }, []);

  const refreshAccounts = useCallback(
    async (status: CredentialStatus) => {
      if (balanceRefreshInFlight.current && usageRefreshInFlight.current) {
        return;
      }
      const [balanceResult, usageResult] = await Promise.allSettled([
        status.api_key_set || status.user_token_set
          ? refreshBalance()
          : Promise.resolve(false),
        status.user_token_set ? refreshUsage() : Promise.resolve(false),
      ]);
      const anySuccess =
        (balanceResult.status === "fulfilled" && balanceResult.value) ||
        (usageResult.status === "fulfilled" && usageResult.value);
      autoRefreshDelay.current = anySuccess
        ? AUTO_REFRESH_MS
        : Math.min(autoRefreshDelay.current * 2, AUTO_REFRESH_MAX_MS);
      lastAutoRefreshAt.current = Date.now();
    },
    [refreshBalance, refreshUsage],
  );

  const refreshDaily = useCallback(async () => {
    setRefreshingRules(true);
    const today = beijingDateKey();
    try {
      const [pricingResult, topupResult] = await Promise.allSettled([
        fetchPricing(),
        fetchTopup(),
      ]);
      let nextRules: TideRules;
      if (pricingResult.status === "fulfilled") {
        const pricing = pricingResult.value;
        nextRules = {
          ...rules,
          peakWindows: pricing.peakWindows,
          weekendOffPeak: pricing.weekendOffPeak,
          holidayOffPeak: pricing.holidayOffPeak,
          tokenPricing: pricing.tokenPricing ?? rules.tokenPricing,
          rawFootnoteSnippet: pricing.rawFootnoteSnippet,
          lastFetchedDate: today,
          fetchedAt: new Date().toISOString(),
          sourceUrl: PRICING_URL,
          parseStatus: "ok",
          lastError: undefined,
        };
      } else {
        nextRules = {
          ...rules,
          lastFetchedDate: today,
          parseStatus: "parse_failed",
          lastError: `官网规则解析失败，沿用${
            rules.fetchedAt ? "上次规则" : "内置快照"
          }`,
        };
      }
      setRules(nextRules);
      saveRules(nextRules);

      const offerOk = topupResult.status === "fulfilled";
      updateOffer({
        date: today,
        text: offerOk
          ? topupResult.value.offerText ?? NO_OFFER_TEXT
          : OFFER_ERROR_TEXT,
        sourceUrl: TOP_UP_URL,
        fetchedAt: new Date().toISOString(),
        status: offerOk ? "ok" : "error",
      });
    } finally {
      setRefreshingRules(false);
    }
  }, [rules, updateOffer]);

  const loadCredentialState = useCallback(async () => {
    const status = await getCredentialStatus();
    setCredentials(status);
    lastAutoRefreshAt.current = Date.now();
    if (status.api_key_set || status.user_token_set) void refreshBalance();
    else setBalanceError("登录 DeepSeek 或配置 API Key 后可查看余额。");
    if (status.user_token_set) void refreshUsage();
    else setUsageError("登录 DeepSeek 后可查看今日 Token 用量。");
    return status;
  }, [refreshBalance, refreshUsage]);

  useEffect(() => {
    void loadCredentialState().catch(() => {
      setNotice("无法读取凭据状态。");
    });
    void isAutostartEnabled()
      .then(setAutoStart)
      .catch(() => {});
  }, [loadCredentialState]);

  useEffect(() => {
    if (dailyStarted.current) return;
    dailyStarted.current = true;
    const today = beijingDateKey();
    if (rules.lastFetchedDate !== today || offer.date !== today) {
      void refreshDaily();
    }
  }, [offer.date, refreshDaily, rules.lastFetchedDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      document.visibilityState !== "visible" ||
      (!credentials.api_key_set && !credentials.user_token_set) ||
      now - lastAutoRefreshAt.current < autoRefreshDelay.current
    ) {
      return;
    }
    lastAutoRefreshAt.current = now;
    void refreshAccounts(credentials);
  }, [credentials, now, refreshAccounts]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const next = dispatchSchedulerEvents(
      scheduler,
      now,
      current.isPeak,
      target,
      targetIsPeak,
    );
    if (next !== scheduler) {
      setScheduler(next);
      saveScheduler(next);
    }
  }, [current.isPeak, now, scheduler, target, targetIsPeak]);

  useEffect(() => {
    window.DSHTideHint = {
      setSchedulerEnable(enabled) {
        const next = { ...scheduler, enabled: Boolean(enabled) };
        setScheduler(next);
        saveScheduler(next);
        return next;
      },
      setManualLock(locked) {
        const next = { ...scheduler, manualLocked: Boolean(locked) };
        setScheduler(next);
        saveScheduler(next);
        return next;
      },
    };
    return () => {
      delete window.DSHTideHint;
    };
  }, [scheduler]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let disposed = false;

    const register = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) unlisten();
      else disposers.push(unlisten);
    };

    void register("deepseek-user-token-saved", () => {
      setLoginOpen(false);
      setSettingsOpen(false);
      setNotice("DeepSeek 登录成功，userToken 已安全写入 Windows Credential Manager。");
      setUserTokenDraft("");
      void loadCredentialState().catch(() => {
        setNotice("登录成功，但凭据状态刷新失败。");
      });
    });
    void register("deepseek-login-closed", () => {
      setLoginOpen(false);
      void getCredentialStatus()
        .then((status) => {
          setCredentials(status);
          if (status.user_token_set) {
            setNotice("登录窗口已关闭，已保留现有 DeepSeek 登录。");
            void refreshUsage();
          } else {
            setNotice("登录窗口已关闭，可重试或在设置中手动粘贴 userToken。");
          }
        })
        .catch(() => {
          setNotice("登录窗口已关闭，可重试或手动粘贴 userToken。");
        });
    });
    void register("tray-refresh", () => {
      void refreshBalance();
      void refreshUsage();
    });

    return () => {
      disposed = true;
      disposers.splice(0).forEach((dispose) => dispose());
    };
  }, [loadCredentialState, refreshBalance, refreshUsage]);

  const updateScheduler = (patch: Partial<SchedulerState>) => {
    const next = { ...scheduler, ...patch };
    setScheduler(next);
    saveScheduler(next);
  };

  const toggleExpanded = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next) setSettingsOpen(false);
    try {
      await setWindowExpanded(next);
    } catch {
      setNotice("调整窗口尺寸失败。");
    }
  };

  const enterMiniMode = async () => {
    setMini(true);
    setExpanded(false);
    setSettingsOpen(false);
    try {
      await setWindowMini(true);
    } catch {
      setMini(false);
      setNotice("切换小窗失败。");
    }
  };

  const expandFromMini = async () => {
    setMini(false);
    setExpanded(true);
    try {
      await setWindowExpanded(true);
    } catch {
      setNotice("展开详情失败。");
    }
  };

  const togglePinned = async () => {
    const next = !pinned;
    try {
      await setAlwaysOnTop(next);
      setPinned(next);
    } catch {
      setNotice("切换置顶失败。");
    }
  };

  const toggleAutoStart = async (enabled: boolean) => {
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      setAutoStart(await isAutostartEnabled());
    } catch {
      setNotice("切换开机自启失败。");
    }
  };

  const startDeepSeekLogin = async () => {
    if (loginOpen) return;
    setLoginOpen(true);
    setNotice("");
    try {
      await openDeepSeekLogin();
    } catch (error) {
      setLoginOpen(false);
      setNotice(commandMessage(error, "usage"));
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        void startDeepSeekLogin();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saveToken = async (kind: "api" | "user") => {
    const value = kind === "api" ? apiKeyDraft : userTokenDraft;
    if (value.trim() === "") {
      const alreadySet =
        kind === "api" ? credentials.api_key_set : credentials.user_token_set;
      setNotice(alreadySet ? "已保持现有凭据不变。" : "凭据不能为空。");
      return;
    }
    try {
      if (kind === "api") await setApiKey(value.trim());
      else await setUserToken(value.trim());
      setApiKeyDraft("");
      setUserTokenDraft("");
      const status = await getCredentialStatus();
      setCredentials(status);
      lastAutoRefreshAt.current = Date.now();
      setNotice(kind === "api" ? "API Key 已保存。" : "userToken 已保存。");
      if (kind === "api") void refreshBalance();
      else {
        void refreshUsage();
        void refreshBalance();
      }
    } catch (error) {
      setNotice(commandMessage(error, kind === "api" ? "balance" : "usage"));
    }
  };

  const clearAllCredentials = async () => {
    try {
      await clearCredentials();
      setCredentials(EMPTY_CREDENTIALS);
      setBalanceCny(null);
      setBalanceUpdatedAt(null);
      setBalanceSource(null);
      setUsage(null);
      setBalanceError("登录 DeepSeek 或配置 API Key 后可查看余额。");
      setUsageError("登录 DeepSeek 后可查看今日 Token 用量。");
      setNotice("凭据已清除。");
    } catch (error) {
      setNotice(commandMessage(error, "usage"));
    }
  };

  const offerWarning =
    offer.status === "error" ? "官方优惠采集失败" : "";
  const updatedText = formatUpdatedAt(rules.fetchedAt);
  const targetText =
    target === null
      ? "等待规则更新"
      : `${formatBeijingDateTime(target)}（北京时间）`;
  const loginLabel = loginOpen
    ? "登录中…"
    : credentials.user_token_set
      ? "重新登录"
      : "登录 DeepSeek";
  const balanceHint = balanceError
    ? "⚠ 余额"
    : balanceSource === "user_token"
      ? "userToken"
      : balanceSource === "api_key"
        ? "API Key"
        : credentials.api_key_set
          ? "API Key"
          : "未配置";
  const usageHint = usageError
    ? "⚠ 重新登录"
    : credentials.user_token_set
      ? "userToken"
      : "未登录";

  if (mini) {
    return (
      <main className={`mini-shell ${current.isPeak ? "peak" : "offpeak"}`}>
        <section className="mini-card">
          <div className="mini-row">
            <img
              className="mini-brand"
              src={appIconUrl}
              alt=""
              draggable={false}
              data-tauri-drag-region
              title="拖动窗口"
            />
            <span className="mini-status">
              {current.isPeak ? "峰时·原价" : "谷时·半价"}
            </span>
            <span className="mini-drag" data-tauri-drag-region />
            <span className="mini-countdown">
              距切换{" "}
              <b>{target === null ? "--:--:--" : formatCountdown(target - now)}</b>
            </span>
            <button
              className="mini-action"
              title="展开详情"
              aria-label="展开详情"
              onClick={(event) => {
                event.stopPropagation();
                void expandFromMini();
              }}
            >
              ↗
            </button>
          </div>
          <div className="mini-row">
            <span className="mini-money">
              余额 <b>{formatBalance(balanceCny)}</b>
            </span>
            <span className="mini-rate">
              {tariffLabel}约合 <b>{formatTokenEstimate(tokenEstimate)}</b> tokens
            </span>
          </div>
          <div className="mini-row">
            <span className="mini-usage">
              今日 <b>{usage ? formatTokenCount(usage.totalTokens) : "—"}</b> tokens
            </span>
            <span className="mini-drag" data-tauri-drag-region />
            <button
              className="mini-action mini-charge"
              title="打开 DeepSeek 官方充值页"
              aria-label="打开 DeepSeek 官方充值页"
              onClick={() => void openUrl(TOP_UP_URL)}
            >
              充值
            </button>
            <button
              className="mini-action"
              title="隐藏到托盘"
              aria-label="隐藏到托盘"
              onClick={(event) => {
                event.stopPropagation();
                void hideWindow();
              }}
            >
              ×
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell ${expanded ? "expanded" : "collapsed"} min-h-screen`}>
      <header className="titlebar flex items-center justify-between" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          <img
            className="brand-mark"
            src={appIconUrl}
            alt=""
            draggable={false}
          />
          DSH 峰谷提示
        </span>
        <span className="window-actions flex items-center">
          <button
            className="login-button"
            disabled={loginOpen}
            onClick={() => void startDeepSeekLogin()}
          >
            {loginLabel}
          </button>
          <button
            className={pinned ? "active" : ""}
            title="置顶"
            onClick={() => void togglePinned()}
          >
            ⌖
          </button>
          <button
            className="mini-button"
            title="切换到小窗模式"
            onClick={() => void enterMiniMode()}
          >
            小窗
          </button>
          <button
            className="mode-button"
            title={expanded ? "收起详情" : "展开详情"}
            onClick={() => void toggleExpanded()}
          >
            {expanded ? "⌃" : "⌄"}
          </button>
          <button title="隐藏到托盘" onClick={() => void hideWindow()}>
            ×
          </button>
        </span>
      </header>

      <section
        className={`status-card ${current.isPeak ? "peak" : "offpeak"}`}
        role="link"
        tabIndex={0}
        title="打开 DeepSeek 官方充值页"
        onClick={() => void openUrl(TOP_UP_URL)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void openUrl(TOP_UP_URL);
          }
        }}
      >
        <div className="status-head flex items-center justify-between">
          <span className="status-label">
            {current.isPeak ? "峰时·原价" : "谷时·半价"}
          </span>
          <span className="countdown">
            距切换 <b>{target === null ? "--:--:--" : formatCountdown(target - now)}</b>
          </span>
        </div>

        <div className="balance-row flex items-center">
          <span className="muted">余额</span>
          <strong>{formatBalance(balanceCny)}</strong>
          <span className="token-estimate">
            {tariffLabel}约合 {formatTokenEstimate(tokenEstimate)} tokens
          </span>
          <span
            className={`account-hint ${balanceError ? "warning" : "muted"}`}
            title={balanceError ?? "API Key 余额"}
          >
            {balanceHint}
          </span>
          <button
            className={`refresh ${refreshingBalance ? "spinning" : ""}`}
            disabled={refreshingBalance}
            title="刷新 API Key 余额"
            aria-label="刷新 API Key 余额"
            onClick={(event) => {
              event.stopPropagation();
              void refreshBalance();
            }}
          >
            ↻
          </button>
        </div>

        <div className="usage-row flex items-center">
          <span className="muted">今日用量</span>
          <strong>
            {usage ? `${formatTokenCount(usage.totalTokens)} tokens` : "—"}
          </strong>
          <span
            className={`account-hint ${usageError ? "warning" : "muted"}`}
            title={usageError ?? "DeepSeek userToken 用量"}
          >
            {usageHint}
          </span>
          <button
            className={`refresh ${refreshingUsage ? "spinning" : ""}`}
            disabled={refreshingUsage}
            title="刷新 DeepSeek 用量"
            aria-label="刷新 DeepSeek 用量"
            onClick={(event) => {
              event.stopPropagation();
              void refreshUsage();
            }}
          >
            ↻
          </button>
        </div>

        <div className="mini-row flex items-center">
          <span className={warning || offerWarning ? "warning" : "muted"}>
            {warning || offerWarning ? "⚠ " : ""}
            {updatedText}
          </span>
          <label onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={scheduler.enabled}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                updateScheduler({ enabled: event.currentTarget.checked })
              }
            />
            自动调度
          </label>
          <label onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={scheduler.manualLocked}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                updateScheduler({ manualLocked: event.currentTarget.checked })
              }
            />
            手动锁定
          </label>
        </div>
      </section>

      {notice ? (
        <div className="notice flex items-start" role="status" aria-live="polite">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      ) : null}

      {expanded ? (
        <section className="details space-y-3">
          <div className="detail-grid">
            <span>下一状态</span>
            <b>{targetText}</b>
            <span>API 余额</span>
            <b className={balanceError ? "warning" : ""}>
              {formatBalance(balanceCny)}
              {balanceUpdatedAt
                ? ` · ${formatBeijingDateTime(balanceUpdatedAt)}`
                : ""}
            </b>
            <span>今日 Token</span>
            <b className={usageError ? "warning" : ""}>
              {usage ? formatTokenCount(usage.totalTokens) : "—"}
            </b>
            <span>余额折算</span>
            <b>
              {tariffLabel}约合 {formatTokenEstimate(tokenEstimate)} tokens
              {tokenPrice === null ? "" : ` · ¥${tokenPrice}/百万 tokens`}
            </b>
            <span>自动刷新</span>
            <b>每 60 秒 · 窗口隐藏时暂停</b>
            <span>用量明细</span>
            <b>
              {usage
                ? `缓存命中 ${formatTokenCount(
                    usage.promptCacheHitTokens,
                  )} · 未命中 ${formatTokenCount(
                    usage.promptCacheMissTokens,
                  )} · 输出 ${formatTokenCount(
                    usage.responseTokens,
                  )} · ${formatTokenCount(usage.requests)} 次请求`
                : usageError ?? "登录后查询"}
            </b>
            <span>折算基准</span>
            <b>
              {rules.tokenPricing
                ? `${rules.tokenPricing.model} · ¥${tokenPrice ?? "—"}/百万 tokens`
                : "—"}
            </b>
            <span>官方充值优惠</span>
            <b>{offer.text}</b>
          </div>

          {warning ? <p className="warning detail-warning">⚠ {warning}</p> : null}
          <div className="link-row flex flex-wrap">
            <button onClick={() => void openUrl(TOP_UP_URL)}>打开官方充值</button>
            <button onClick={() => void openUrl(API_KEYS_URL)}>获取 API Key</button>
            <button onClick={() => void openUrl(PRICING_URL)}>官方价格页</button>
            <button
              disabled={refreshingRules}
              onClick={() => void refreshDaily()}
            >
              {refreshingRules ? "刷新中…" : "刷新规则与优惠"}
            </button>
          </div>

          <div className="settings-head flex items-center justify-between">
            <button
              className="settings-toggle"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              {settingsOpen ? "收起设置" : "展开设置"}
            </button>
            <label className="switch inline-flex items-center">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(event) => void toggleAutoStart(event.currentTarget.checked)}
              />
              开机自启
            </label>
          </div>

          {settingsOpen ? (
            <section className="settings space-y-3">
              <div className="guide">
                <b>DeepSeek 无感登录</b>
                <p>
                  登录窗口会自动读取 DeepSeek 官方站点的 `userToken` 并安全保存；
                  余额使用你单独填写的 API Key，两项功能互不阻断。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button disabled={loginOpen} onClick={() => void startDeepSeekLogin()}>
                    {loginLabel}
                  </button>
                  <button onClick={() => void openUrl(API_KEYS_URL)}>
                    打开 API Keys 页面
                  </button>
                </div>
                <p className="muted">
                  若自动获取持续失败，可在下方手动粘贴 userToken。
                </p>
              </div>

              <label className="field">
                <span>
                  userToken {credentials.user_token_set ? "· 已安全保存" : ""}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={userTokenDraft}
                  placeholder={
                    credentials.user_token_set
                      ? "已设置，留空不修改"
                      : "手动粘贴 userToken"
                  }
                  onChange={(event) => setUserTokenDraft(event.target.value)}
                />
                <button onClick={() => void saveToken("user")}>保存 userToken</button>
              </label>

              <label className="field">
                <span>API Key {credentials.api_key_set ? "· 已安全保存" : ""}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKeyDraft}
                  placeholder={
                    credentials.api_key_set ? "已设置，留空不修改" : "粘贴 API Key"
                  }
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                />
                <button onClick={() => void saveToken("api")}>保存 API Key</button>
              </label>
              <p className="muted">
                凭据仅存于 Windows Credential Manager，前端只能读取“是否已设置”。
              </p>
              <button className="danger" onClick={() => void clearAllCredentials()}>
                清除全部凭据
              </button>
            </section>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
