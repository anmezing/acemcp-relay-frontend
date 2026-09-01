import { describe, expect, it } from "vitest";
import { isIndexJobWaitingForClient, resolveIndexPhaseTranslationKey } from "./index-job-phase";

describe("index job phase presentation", () => {
  it("does not present a created job as active vector generation", () => {
    expect(isIndexJobWaitingForClient("created")).toBe(true);
    expect(resolveIndexPhaseTranslationKey("created")).toBe("indexPhaseWaitingForClient");
  });

  it("maps active server phases to user-facing labels", () => {
    expect(isIndexJobWaitingForClient("uploading")).toBe(false);
    expect(resolveIndexPhaseTranslationKey("uploading")).toBe("indexPhaseUploading");
    expect(resolveIndexPhaseTranslationKey("indexing")).toBe("indexPhaseIndexing");
    expect(resolveIndexPhaseTranslationKey("publishing")).toBe("indexPhasePublishing");
  });
});
