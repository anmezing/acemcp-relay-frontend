type PublicEnv = Readonly<Record<string, string | undefined>>;

function positivePublicInteger(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const normalized = raw.trim();
  const parsed = Number.parseInt(normalized, 10);
  return /^\d+$/.test(normalized) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function validTimeZone(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return fallback;
  }
}

export function buildClientRuntimePolicy(env: PublicEnv = process.env) {
  const indexPollActiveMs = positivePublicInteger(env.NEXT_PUBLIC_INDEX_POLL_ACTIVE_MS, 5_000);
  const syncHealthHistoryLimit = positivePublicInteger(
    env.NEXT_PUBLIC_HEALTH_HISTORY_LIMIT,
    60,
  );

  return Object.freeze({
    applicationTimeZone: validTimeZone(
      env.NEXT_PUBLIC_APPLICATION_TIMEZONE,
      "Asia/Shanghai",
    ),
    indexPollActiveMs,
    indexPollIdleMs: Math.max(
      indexPollActiveMs,
      positivePublicInteger(env.NEXT_PUBLIC_INDEX_POLL_IDLE_MS, 30_000),
    ),
    logsAutoRefreshMs: positivePublicInteger(env.NEXT_PUBLIC_LOGS_AUTO_REFRESH_MS, 5_000),
    logsPageSize: positivePublicInteger(env.NEXT_PUBLIC_LOGS_PAGE_SIZE, 20),
    leaderboardRefreshMs: positivePublicInteger(env.NEXT_PUBLIC_LEADERBOARD_REFRESH_MS, 30_000),
    leaderboardDateOptionCount: positivePublicInteger(
      env.NEXT_PUBLIC_LEADERBOARD_DATE_OPTION_COUNT,
      3,
    ),
    paymentStatusPollMs: positivePublicInteger(env.NEXT_PUBLIC_PAYMENT_STATUS_POLL_MS, 2_000),
    healthHistoryLimit: syncHealthHistoryLimit,
    healthLatestLimit: Math.min(
      syncHealthHistoryLimit,
      positivePublicInteger(env.NEXT_PUBLIC_HEALTH_LATEST_LIMIT, 1),
    ),
    healthResultPollMs: positivePublicInteger(env.NEXT_PUBLIC_HEALTH_RESULT_POLL_MS, 5_000),
    healthResultPollAttempts: positivePublicInteger(env.NEXT_PUBLIC_HEALTH_RESULT_POLL_ATTEMPTS, 12),
    healthCountdownTickMs: positivePublicInteger(env.NEXT_PUBLIC_HEALTH_COUNTDOWN_TICK_MS, 1_000),
    healthSlowThresholdMs: positivePublicInteger(env.NEXT_PUBLIC_HEALTH_SLOW_THRESHOLD_MS, 5_000),
    hoverIntentMs: positivePublicInteger(env.NEXT_PUBLIC_HOVER_INTENT_MS, 120),
    noticeDurationMs: positivePublicInteger(env.NEXT_PUBLIC_NOTICE_DURATION_MS, 2_000),
    invitationRedirectMs: positivePublicInteger(env.NEXT_PUBLIC_INVITATION_REDIRECT_MS, 1_200),
    minimumLoadingFeedbackMs: positivePublicInteger(env.NEXT_PUBLIC_MINIMUM_LOADING_FEEDBACK_MS, 300),
  });
}

// Browser polling and feedback timings are centralized here. NEXT_PUBLIC_*
// overrides are build-time deployment policy; zero/invalid values fall back to
// bounded defaults instead of disabling refresh or creating tight loops.
export const CLIENT_RUNTIME_POLICY = buildClientRuntimePolicy();
