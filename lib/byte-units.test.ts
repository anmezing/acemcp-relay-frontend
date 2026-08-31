import { describe, expect, it } from "vitest";
import {
  bytesToQuotaDraft,
  formatByteLimit,
  formatBytes,
  quotaDraftToBytes,
} from "./byte-units";

describe("bytesToQuotaDraft", () => {
  it("uses GiB as the default unit for unset and unlimited quotas", () => {
    expect(bytesToQuotaDraft(null)).toEqual({ amount: "", unit: "GiB" });
    expect(bytesToQuotaDraft(0)).toEqual({ amount: "0", unit: "GiB" });
  });

  it("preserves existing byte values without silently changing their meaning", () => {
    expect(bytesToQuotaDraft(4)).toEqual({ amount: "4", unit: "B" });
    expect(bytesToQuotaDraft(4 * 1024 ** 3)).toEqual({
      amount: "4",
      unit: "GiB",
    });
    expect(bytesToQuotaDraft(1536 * 1024 ** 2)).toEqual({
      amount: "1536",
      unit: "MiB",
    });
  });

  it("rejects invalid stored quotas", () => {
    expect(() => bytesToQuotaDraft(-1)).toThrow("Invalid byte quota");
    expect(() => bytesToQuotaDraft(1.5)).toThrow("Invalid byte quota");
    expect(() => bytesToQuotaDraft(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Invalid byte quota"
    );
  });
});

describe("quotaDraftToBytes", () => {
  it("keeps blank and zero semantics explicit", () => {
    expect(quotaDraftToBytes("", "GiB")).toBeNull();
    expect(quotaDraftToBytes("   ", "MiB")).toBeNull();
    expect(quotaDraftToBytes("0", "GiB")).toBe(0);
  });

  it("converts human-readable binary units to integer bytes", () => {
    expect(quotaDraftToBytes("4", "GiB")).toBe(4 * 1024 ** 3);
    expect(quotaDraftToBytes("1.5", "GiB")).toBe(1536 * 1024 ** 2);
    expect(quotaDraftToBytes("0.1", "GiB")).toBe(107_374_182);
    expect(quotaDraftToBytes("2", "TiB")).toBe(2 * 1024 ** 4);
  });

  it("accepts only whole bytes when B is selected", () => {
    expect(quotaDraftToBytes("12.0", "B")).toBe(12);
    expect(quotaDraftToBytes("12.1", "B")).toBeUndefined();
  });

  it("rejects invalid, negative, unsafe, and effectively-zero values", () => {
    expect(quotaDraftToBytes("-1", "GiB")).toBeUndefined();
    expect(quotaDraftToBytes("1e3", "GiB")).toBeUndefined();
    expect(quotaDraftToBytes("1.", "GiB")).toBeUndefined();
    expect(quotaDraftToBytes("0.0000000001", "B")).toBeUndefined();
    expect(quotaDraftToBytes("9007199254740992", "B")).toBeUndefined();
    expect(quotaDraftToBytes("1." + "0".repeat(40), "GiB")).toBeUndefined();
  });
});

describe("byte formatting", () => {
  it("distinguishes zero usage from an unlimited zero limit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatByteLimit(0, "不限")).toBe("不限");
  });

  it("formats byte quantities consistently", () => {
    expect(formatBytes(4)).toBe("4 B");
    expect(formatBytes(4 * 1024 ** 3)).toBe("4.0 GiB");
    expect(formatByteLimit(1536 * 1024 ** 2, "unlimited")).toBe("1.5 GiB");
  });
});
