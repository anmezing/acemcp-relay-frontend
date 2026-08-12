import { describe, expect, it } from "vitest";
import { authProviderLabel, authProviderLabels } from "./auth-provider";

describe("auth provider labels", () => {
  it("maps persisted Better Auth provider ids without inferring from email", () => {
    expect(authProviderLabel("credential")).toBe("邮箱/密码");
    expect(authProviderLabel("github")).toBe("GitHub");
    expect(authProviderLabel("linuxdo")).toBe("LinuxDo");
  });

  it("keeps unknown providers visible and removes duplicates", () => {
    expect(authProviderLabels(["github", "github", "future-provider"])).toEqual([
      "GitHub",
      "future-provider",
    ]);
  });
});
