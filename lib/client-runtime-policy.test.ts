import { describe, expect, it } from "vitest";
import { buildClientRuntimePolicy, CLIENT_RUNTIME_POLICY } from "@/lib/client-runtime-policy";

describe("client runtime policy", () => {
  it("keeps polling and feedback budgets positive and semantically ordered", () => {
    expect(CLIENT_RUNTIME_POLICY.indexPollActiveMs).toBeGreaterThan(0);
    expect(CLIENT_RUNTIME_POLICY.indexPollIdleMs).toBeGreaterThanOrEqual(
      CLIENT_RUNTIME_POLICY.indexPollActiveMs,
    );
    expect(CLIENT_RUNTIME_POLICY.healthResultPollAttempts).toBeGreaterThan(0);
    expect(CLIENT_RUNTIME_POLICY.healthLatestLimit).toBeLessThanOrEqual(
      CLIENT_RUNTIME_POLICY.healthHistoryLimit,
    );
    expect(CLIENT_RUNTIME_POLICY.noticeDurationMs).toBeGreaterThan(0);
  });

  it("clamps related values and accepts deployment-owned presentation policy", () => {
    const policy = buildClientRuntimePolicy({
      NEXT_PUBLIC_INDEX_POLL_ACTIVE_MS: "9000",
      NEXT_PUBLIC_INDEX_POLL_IDLE_MS: "1000",
      NEXT_PUBLIC_HEALTH_HISTORY_LIMIT: "4",
      NEXT_PUBLIC_HEALTH_LATEST_LIMIT: "9",
      NEXT_PUBLIC_LOGS_PAGE_SIZE: "35",
      NEXT_PUBLIC_LEADERBOARD_DATE_OPTION_COUNT: "7",
      NEXT_PUBLIC_APPLICATION_TIMEZONE: "UTC",
    });
    expect(policy.indexPollIdleMs).toBe(9_000);
    expect(policy.healthLatestLimit).toBe(4);
    expect(policy.logsPageSize).toBe(35);
    expect(policy.leaderboardDateOptionCount).toBe(7);
    expect(policy.applicationTimeZone).toBe("UTC");
  });
});
