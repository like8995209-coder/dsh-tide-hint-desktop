import {
  PREWARN_EVENT,
  PREWARN_MESSAGE,
  TASK_START_EVENT,
  TASK_STOP_EVENT,
} from "./tide";
import type { SchedulerState } from "./types";

export function evaluateScheduler(
  now: number,
  isPeak: boolean,
  nextBoundary: number | null,
  nextBoundaryIsPeak: boolean,
  current: SchedulerState,
): { state: SchedulerState; signal: "start" | "stop" | null; prewarn: boolean } {
  if (!current.enabled || current.manualLocked) {
    return { state: current, signal: null, prewarn: false };
  }
  const signal = isPeak ? "stop" : "start";
  const remaining =
    nextBoundary === null ? Number.POSITIVE_INFINITY : nextBoundary - now;
  const prewarn =
    !isPeak &&
    nextBoundaryIsPeak &&
    nextBoundary !== null &&
    remaining > 0 &&
    remaining <= 60_000 &&
    current.prewarnBoundary !== nextBoundary;
  return {
    state: prewarn
      ? { ...current, prewarnAt: now, prewarnBoundary: nextBoundary }
      : current,
    signal,
    prewarn,
  };
}

export function dispatchSchedulerEvents(
  state: SchedulerState,
  now: number,
  isPeak: boolean,
  nextBoundary: number | null,
  nextBoundaryIsPeak: boolean,
): SchedulerState {
  const result = evaluateScheduler(
    now,
    isPeak,
    nextBoundary,
    nextBoundaryIsPeak,
    state,
  );
  if (result.signal !== null) {
    window.dispatchEvent(
      new CustomEvent(
        result.signal === "start" ? TASK_START_EVENT : TASK_STOP_EVENT,
        {
          detail: {
            source: "dsh-tide-hint-desktop",
            signal: result.signal,
            isPeak,
            at: now,
            nextBoundary,
          },
        },
      ),
    );
  }
  if (result.prewarn) {
    window.dispatchEvent(
      new CustomEvent(PREWARN_EVENT, {
        detail: {
          source: "dsh-tide-hint-desktop",
          message: PREWARN_MESSAGE,
          text: PREWARN_MESSAGE,
          at: now,
          targetAt: nextBoundary,
        },
      }),
    );
  }
  return result.state;
}
