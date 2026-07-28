import { describe, expect, it, vi } from "vitest";
import { parseMaxDevicesPerUser } from "./db";

// 这个值直接进设备淘汰查询的 LIMIT，配错的代价不对称：
//   "0"    -> LIMIT 0，把刚注册的设备一起删掉，用户永远登不上
//   "abc"  -> LIMIT NaN，登录整个报 SQL 错
// 因此非法输入必须退回默认 1，而不是原样传给 SQL。

describe("parseMaxDevicesPerUser 接受合法值", () => {
  it("未设置时默认单设备互踢", () => {
    expect(parseMaxDevicesPerUser(undefined)).toBe(1);
    expect(parseMaxDevicesPerUser("")).toBe(1);
    expect(parseMaxDevicesPerUser("   ")).toBe(1);
  });

  it.each([
    ["1", 1],
    ["2", 2],
    ["10", 10],
    [" 3 ", 3],
  ])("%s -> %i", (raw, expected) => {
    expect(parseMaxDevicesPerUser(raw)).toBe(expected);
  });
});

describe("parseMaxDevicesPerUser 拒绝会锁死账号的值", () => {
  it.each([
    ["0（会连刚注册的设备一起淘汰）", "0"],
    ["负数", "-1"],
    ["非数字", "abc"],
    ["带单位", "3devices"],
    ["小数", "1.5"],
    ["科学计数法之外的垃圾", "NaN"],
    ["Infinity", "Infinity"],
  ])("%s 退回默认 1", (_label, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseMaxDevicesPerUser(raw)).toBe(1);
      // 静默退回会让运维以为配置生效了，必须留痕
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
