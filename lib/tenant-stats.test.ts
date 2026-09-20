import { describe, expect, it } from "vitest";
import { topLanguages } from "./tenant-stats";

describe("topLanguages", () => {
  it("picks the largest languages regardless of key order", () => {
    const alphabetical = {
      cpp: 4, css: 11, go: 74, html: 18, java: 1896, javascript: 364, json: 204,
      kotlin: 139, less: 150, markdown: 214, python: 900, typescript: 2500, yaml: 60,
    };
    expect(topLanguages(alphabetical).map(([lang]) => lang)).toEqual([
      "typescript", "java", "python", "javascript", "markdown", "json", "less", "kotlin", "go", "yaml",
    ]);
  });

  it("breaks ties by name and drops empty entries", () => {
    expect(topLanguages({ b: 2, a: 2, zero: 0, c: 3 })).toEqual([["c", 3], ["a", 2], ["b", 2]]);
  });
});
