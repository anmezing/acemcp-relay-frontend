export type IndexFailureCode =
  | "client_disconnected"
  | "heartbeat_timeout"
  | "embedding_space_changed"
  | "upstream_bad_gateway"
  | "provider_billing"
  | "provider_rate_limited"
  | "provider_invalid_request"
  | "repository_file_limit"
  | "repository_file_size_limit"
  | "index_quota_exceeded"
  | "provider_authentication"
  | "network_unavailable"
  | "index_failed";

export type IndexFailureOrigin =
  | "relay"
  | "remote_index"
  | "provider"
  | "client"
  | "network"
  | "unknown";

export type IndexRecoveryCode =
  | "restart_client"
  | "reset_root"
  | "retry_after_service_recovers"
  | "fix_provider_billing"
  | "retry_later"
  | "reduce_repository"
  | "wait_for_quota_reset"
  | "fix_credentials"
  | "contact_admin"
  | "inspect_logs";

export interface IndexFailureLike {
  index_error?: string;
  index_error_code?: string;
  index_error_origin?: string;
  index_recovery?: string;
}

export interface IndexFailurePresentation {
  code: IndexFailureCode;
  origin: IndexFailureOrigin;
  recovery: IndexRecoveryCode;
  rawDetail: string;
}

type ContractIndexRecoveryCode = Exclude<IndexRecoveryCode, "inspect_logs">;

const failureDiagnosticsByCode = {
  client_disconnected: { origin: "client", recovery: "restart_client" },
  heartbeat_timeout: { origin: "relay", recovery: "restart_client" },
  embedding_space_changed: { origin: "remote_index", recovery: "reset_root" },
  upstream_bad_gateway: {
    origin: "remote_index",
    recovery: "retry_after_service_recovers",
  },
  provider_billing: { origin: "provider", recovery: "fix_provider_billing" },
  provider_rate_limited: { origin: "provider", recovery: "retry_later" },
  provider_invalid_request: { origin: "provider", recovery: "contact_admin" },
  repository_file_limit: { origin: "client", recovery: "reduce_repository" },
  repository_file_size_limit: { origin: "client", recovery: "reduce_repository" },
  index_quota_exceeded: { origin: "relay", recovery: "wait_for_quota_reset" },
  provider_authentication: { origin: "provider", recovery: "fix_credentials" },
  network_unavailable: { origin: "network", recovery: "restart_client" },
  index_failed: { origin: "unknown", recovery: "contact_admin" },
} satisfies Record<
  IndexFailureCode,
  { origin: IndexFailureOrigin; recovery: ContractIndexRecoveryCode }
>;

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function classifyLegacyFailure(detail: string): Omit<IndexFailurePresentation, "rawDetail"> {
  const lower = detail.trim().toLowerCase();
  if (includesAny(lower, ["client disconnected before first upload"])) {
    return { code: "client_disconnected", origin: "client", recovery: "restart_client" };
  }
  if (includesAny(lower, ["heartbeat timed out", "heartbeat timeout"])) {
    return { code: "heartbeat_timeout", origin: "relay", recovery: "restart_client" };
  }
  if (includesAny(lower, [
    "cloud embedding space changed",
    "embedding space changed",
    "clear the tenant root before starting a new index job",
  ])) {
    return { code: "embedding_space_changed", origin: "remote_index", recovery: "reset_root" };
  }
  if (includesAny(lower, ["remote-index 502", "bad gateway", "cloudflare", "origin web server returned"])) {
    return { code: "upstream_bad_gateway", origin: "remote_index", recovery: "retry_after_service_recovers" };
  }
  if (includesAny(lower, ["payment required", "insufficient balance", "insufficient credit", "余额不足", "欠费", "billing", "remote-index 402"])) {
    return { code: "provider_billing", origin: "provider", recovery: "fix_provider_billing" };
  }
  if (includesAny(lower, ["too many requests", "rate limit", "rate-limit", "remote-index 429"])) {
    return { code: "provider_rate_limited", origin: "provider", recovery: "retry_later" };
  }
  if (includesAny(lower, ["the parameter is invalid", "[20015]", "valid utf-8", "special characters are properly escaped"])) {
    return { code: "provider_invalid_request", origin: "provider", recovery: "contact_admin" };
  }
  if (includesAny(lower, ["manifest exceeds", "unreadable file list exceeds", "too many files", "file count limit", "maximum file count", "100,000 files", "100000 files", "文件数量", "文件数超过"])) {
    return { code: "repository_file_limit", origin: "client", recovery: "reduce_repository" };
  }
  if (includesAny(lower, ["manifest file size is invalid", "file exceeds the", "byte limit", "file too large", "file size limit", "maximum file size", "512 kib", "524288", "文件大小超过", "单文件过大"])) {
    return { code: "repository_file_size_limit", origin: "client", recovery: "reduce_repository" };
  }
  // Only the platform's explicit daily index quota may use reset-based recovery.
  // A provider's generic "quota exceeded" message has a different owner and fix.
  if (includesAny(lower, [
    "daily index quota exceeded",
    "index quota exceeded",
    "index_quota_exceeded",
    "每日索引配额",
    "索引配额已用尽",
    "超出索引配额",
  ])) {
    return { code: "index_quota_exceeded", origin: "relay", recovery: "wait_for_quota_reset" };
  }
  if (includesAny(lower, ["unauthorized", "invalid api key", "invalid token", "authentication failed", "remote-index 401", "remote-index 403"])) {
    return { code: "provider_authentication", origin: "provider", recovery: "fix_credentials" };
  }
  if (includesAny(lower, ["connection refused", "connection reset", "network is unreachable", "network down", "no such host", "i/o timeout", "context deadline exceeded", "unexpected eof", "socket hang up"])) {
    return { code: "network_unavailable", origin: "network", recovery: "restart_client" };
  }
  return { code: "index_failed", origin: "unknown", recovery: "contact_admin" };
}

export function resolveIndexFailurePresentation(root: IndexFailureLike): IndexFailurePresentation {
  const rawDetail = root.index_error?.trim() ?? "";
  const fallback = classifyLegacyFailure(rawDetail);
  const reportedCode = root.index_error_code?.trim() as IndexFailureCode | undefined;
  const expected = reportedCode && Object.prototype.hasOwnProperty.call(failureDiagnosticsByCode, reportedCode)
    ? failureDiagnosticsByCode[reportedCode]
    : undefined;

  // cloud-protocol defines the diagnostic as one atomic tuple. Never combine a
  // recognized code with a missing/mismatched owner or recovery from another
  // source; malformed and future tuples must fall back as a whole.
  let diagnostic: Omit<IndexFailurePresentation, "rawDetail"> = fallback;
  if (
    reportedCode &&
    expected &&
    root.index_error_origin?.trim() === expected.origin &&
    root.index_recovery?.trim() === expected.recovery
  ) {
    diagnostic = { code: reportedCode, ...expected };
  }

  return {
    ...diagnostic,
    rawDetail,
  };
}
