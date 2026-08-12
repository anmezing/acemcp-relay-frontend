import { describe, expect, it } from "vitest";
import { parseSiliconFlowRerankModels } from "./rerank-model-discovery";

describe("parseSiliconFlowRerankModels", () => {
  it("returns sorted unique non-empty model ids", () => {
    expect(parseSiliconFlowRerankModels({
      data: [
        { id: "z/model" },
        { id: " a/model " },
        { id: "z/model" },
        { id: "" },
        { id: 42 },
      ],
    })).toEqual(["a/model", "z/model"]);
  });

  it("rejects unexpected response shapes without guessing", () => {
    expect(parseSiliconFlowRerankModels(null)).toEqual([]);
    expect(parseSiliconFlowRerankModels({ models: ["a"] })).toEqual([]);
  });
});
