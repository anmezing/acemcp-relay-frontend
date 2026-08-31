import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/relay-console", () => ({
  getRelayAdminHeaders: () => ({ "X-LCE-Console-Token": "test-console-token" }),
}));

import {
  getClientVersionSummary,
  LCE_CLOUD_PACKAGE,
  saveRelayMinimumClientVersion,
} from "@/lib/client-version-policy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client version policy", () => {
  it("uses npm latest as the only published-version source and relay for the minimum", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("registry.npmjs.org")) {
        return Response.json({ version: "1.3.4" });
      }
      return Response.json({
        package: LCE_CLOUD_PACKAGE,
        latest_version: "9.9.9",
        minimum_version: "1.3.3",
        index_client_version_required: true,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getClientVersionSummary()).resolves.toMatchObject({
      packageName: LCE_CLOUD_PACKAGE,
      latestVersion: "1.3.4",
      latestVersionSource: "registry",
      minimumVersion: "1.3.3",
      indexClientVersionRequired: true,
      warnings: [],
    });
  });

  it("does not present a relay/env mirror as the current published version", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("registry.npmjs.org")) {
        return new Response("unavailable", { status: 503 });
      }
      return Response.json({
        package: LCE_CLOUD_PACKAGE,
        latest_version: "9.9.9",
        minimum_version: null,
        index_client_version_required: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getClientVersionSummary()).resolves.toMatchObject({
      latestVersion: null,
      latestVersionSource: null,
      warnings: ["package_registry_unavailable"],
    });
  });

  it("rejects an invalid minimum before contacting relay", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveRelayMinimumClientVersion("latest")).rejects.toThrow("invalid client version");
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
