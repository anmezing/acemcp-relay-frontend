import { describe, expect, it } from "vitest";
import { resolveIndexFailurePresentation } from "./index-failure";

describe("index failure presentation", () => {
  it("prefers structured diagnostics returned by relay", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "opaque upstream detail",
      index_error_code: "provider_billing",
      index_error_origin: "provider",
      index_recovery: "fix_provider_billing",
    })).toEqual({
      code: "provider_billing",
      origin: "provider",
      recovery: "fix_provider_billing",
      rawDetail: "opaque upstream detail",
    });
  });

  it("uses the exact structured 20015 tuple even when legacy text is misleading", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "network down while formatting an upstream response",
      index_error_code: "provider_invalid_request",
      index_error_origin: "provider",
      index_recovery: "contact_admin",
    })).toEqual({
      code: "provider_invalid_request",
      origin: "provider",
      recovery: "contact_admin",
      rawDetail: "network down while formatting an upstream response",
    });
  });

  it("falls back atomically when a structured tuple is partial", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "Embedding API 错误: The parameter is invalid. [20015]",
      index_error_code: "network_unavailable",
    })).toEqual({
      code: "provider_invalid_request",
      origin: "provider",
      recovery: "contact_admin",
      rawDetail: "Embedding API 错误: The parameter is invalid. [20015]",
    });
  });

  it("falls back atomically when a structured tuple is mismatched", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "dial tcp: connection refused",
      index_error_code: "provider_invalid_request",
      index_error_origin: "provider",
      index_recovery: "retry_later",
    })).toEqual({
      code: "network_unavailable",
      origin: "network",
      recovery: "restart_client",
      rawDetail: "dial tcp: connection refused",
    });
  });

  it("classifies an embedding-space change as requiring a full root reset", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "LCE cloud index begin failed: cloud embedding space changed; clear the tenant root before starting a new index job",
    })).toMatchObject({
      code: "embedding_space_changed",
      origin: "remote_index",
      recovery: "reset_root",
    });
  });

  it("classifies legacy Cloudflare 502 responses", () => {
    expect(resolveIndexFailurePresentation({
      index_error: 'remote-index 502: {"title":"Error 502: Bad gateway","detail":"origin web server returned an invalid response"}',
    })).toMatchObject({
      code: "upstream_bad_gateway",
      origin: "remote_index",
      recovery: "retry_after_service_recovers",
    });
  });

  it("classifies client disconnects, heartbeat timeouts, and provider failures", () => {
    expect(resolveIndexFailurePresentation({ index_error: "index client disconnected before first upload" })).toMatchObject({
      code: "client_disconnected",
      origin: "client",
      recovery: "restart_client",
    });
    expect(resolveIndexFailurePresentation({ index_error: "index job heartbeat timed out" })).toMatchObject({
      code: "heartbeat_timeout",
      origin: "relay",
      recovery: "restart_client",
    });
    expect(resolveIndexFailurePresentation({ index_error: "embedding provider insufficient balance" })).toMatchObject({
      code: "provider_billing",
      origin: "provider",
      recovery: "fix_provider_billing",
    });
    expect(resolveIndexFailurePresentation({ index_error: "Embedding API 错误: The parameter is invalid. [20015]" })).toMatchObject({
      code: "provider_invalid_request",
      origin: "provider",
      recovery: "contact_admin",
    });
  });

  it("classifies the relay's exact repository limit errors", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "manifest exceeds 100000 files",
    })).toMatchObject({
      code: "repository_file_limit",
      origin: "client",
      recovery: "reduce_repository",
    });
    expect(resolveIndexFailurePresentation({
      index_error: "file exceeds the 524288 byte limit: generated/data.json",
    })).toMatchObject({
      code: "repository_file_size_limit",
      origin: "client",
      recovery: "reduce_repository",
    });
    expect(resolveIndexFailurePresentation({
      index_error: "manifest file size is invalid: generated/data.json",
    })).toMatchObject({
      code: "repository_file_size_limit",
      origin: "client",
      recovery: "reduce_repository",
    });
  });

  it("distinguishes the platform daily index quota from provider quota wording", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "daily index quota exceeded (used=2147483648, limit=2147483648, remaining=0 bytes)",
    })).toMatchObject({
      code: "index_quota_exceeded",
      origin: "relay",
      recovery: "wait_for_quota_reset",
    });
    expect(resolveIndexFailurePresentation({
      index_error: "embedding provider quota exceeded",
    })).toMatchObject({
      code: "index_failed",
      origin: "unknown",
      recovery: "contact_admin",
    });
  });

  it("falls back safely when a newer relay returns unknown diagnostic codes", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "manifest rejected",
      index_error_code: "future_code",
      index_error_origin: "future_origin",
      index_recovery: "future_recovery",
    })).toEqual({
      code: "index_failed",
      origin: "unknown",
      recovery: "contact_admin",
      rawDetail: "manifest rejected",
    });
  });
});
