export const CONSOLE_MENU_CATALOG = [
  { id: "top-console", label: "控制台", group: "顶部导航" }, { id: "top-leaderboard", label: "排行榜", group: "顶部导航" },
  { id: "top-status", label: "状态监控", group: "顶部导航" },
  { id: "keys", label: "密钥管理", group: "我的" }, { id: "plans", label: "套餐订阅", group: "我的" },
  { id: "team", label: "组织", group: "我的" }, { id: "docs", label: "配置说明", group: "我的" },
  { id: "model-config", label: "模型设置", group: "我的" }, { id: "profile", label: "用户信息", group: "我的" },
  { id: "index", label: "索引管理", group: "数据" }, { id: "logs", label: "请求日志", group: "数据" },
  { id: "org", label: "组织概览", group: "管理" }, { id: "users", label: "用户管理", group: "管理" },
  { id: "call-stats", label: "调用统计", group: "管理" }, { id: "quota", label: "配额管理", group: "管理" },
  { id: "admin-orgs", label: "组织管理", group: "管理" }, { id: "plans-admin", label: "套餐管理", group: "管理" },
  { id: "models", label: "模型管理", group: "管理" }, { id: "system-settings", label: "系统设置", group: "系统" },
  { id: "system-logs", label: "系统日志", group: "系统" },
] as const;
export const USER_MENU_IDS: ConsoleMenuId[] = [
  "top-console", "top-leaderboard", "top-status",
  "keys", "plans", "team", "docs", "model-config", "profile", "index", "logs",
];
export type ConsoleMenuId = typeof CONSOLE_MENU_CATALOG[number]["id"];
export const DEFAULT_MENU_VISIBILITY = Object.fromEntries(CONSOLE_MENU_CATALOG.map((item) => [item.id, true])) as Record<ConsoleMenuId, boolean>;
export function normalizeMenuVisibility(value: unknown): Record<ConsoleMenuId, boolean> {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(CONSOLE_MENU_CATALOG.map(({ id }) => [id, raw[id] !== false])) as Record<ConsoleMenuId, boolean>;
}
