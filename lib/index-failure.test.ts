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

  it("classifies legacy Cloudflare 502 responses", () => {
    expect(resolveIndexFailurePresentation({
      index_error: 'remote-index 502: {"title":"Error 502: Bad gateway","detail":"origin web server returned an invalid response"}',
    })).toMatchObject({
      code: "upstream_bad_gateway",
      origin: "remote_index",
      recovery: "retry_after_service_recovers",
    });
  });

  it("classifies heartbeat timeouts and provider balance failures", () => {
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

  it("falls back safely when a newer relay returns unknown diagnostic codes", () => {
    expect(resolveIndexFailurePresentation({
      index_error: "manifest rejected",
      index_error_code: "future_code",
      index_error_origin: "future_origin",
      index_recovery: "future_recovery",
    })).toEqual({
      code: "index_failed",
      origin: "unknown",
      recovery: "inspect_logs",
      rawDetail: "manifest rejected",
    });
  });
});
