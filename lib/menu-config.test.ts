import { describe, expect, it } from "vitest";
import { CONSOLE_MENU_CATALOG, normalizeMenuVisibility, USER_MENU_IDS } from "./menu-config";

describe("menu visibility", () => {
  it("defaults every catalog menu to visible", () => {
    const result = normalizeMenuVisibility(null);
    expect(Object.keys(result)).toHaveLength(CONSOLE_MENU_CATALOG.length);
    expect(Object.values(result).every(Boolean)).toBe(true);
  });

  it("keeps only explicit false hidden and ignores unknown keys", () => {
    const result = normalizeMenuVisibility({ plans: false, keys: "false", injected: false });
    expect(result.plans).toBe(false);
    expect(result.keys).toBe(true);
    expect(result).not.toHaveProperty("injected");
  });

  it("only exposes ordinary-user menus to the administrator editor", () => {
    expect(USER_MENU_IDS).toContain("plans");
    expect(USER_MENU_IDS).toContain("version");
    expect(USER_MENU_IDS).not.toContain("users");
    expect(USER_MENU_IDS).not.toContain("system-settings");
  });
});
