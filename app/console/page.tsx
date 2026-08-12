"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buildCloudMcpConfigJson, buildCloudMcpConfigToml, buildMcpConfigJson, buildMcpConfigToml } from "@/lib/mcp-config";
import {
  Copy, Eye, EyeOff, RefreshCw, Info, LogOut, Loader2, Github, Trash2,
  Key, FileText, User, Database, ScrollText, Building2, Users, Coins,
  Gauge, Cpu, Settings, Terminal, Shield, ChevronDown
} from "lucide-react";

// shadcn/ui components
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminOverviewTab } from "@/components/admin/AdminOverviewTab";
import { AdminUsersTab } from "@/components/admin/AdminUsersTab";
import { AdminLogsTab } from "@/components/admin/AdminLogsTab";
import { AdminStatsTab } from "@/components/admin/AdminStatsTab";
import { AdminQuotaTab } from "@/components/admin/AdminQuotaTab";
import { AdminModelsTab } from "@/components/admin/AdminModelsTab";
import { AdminSettingsTab } from "@/components/admin/AdminSettingsTab";
import { AdminOrgsTab } from "@/components/admin/AdminOrgsTab";
import { OrgTab } from "@/components/OrgTab";
import { OrgKeysCards } from "@/components/OrgKeysCards";
import { AGENT_RULES_CLOUD, AGENT_RULES_REMOTE, CLOUD_TOOLS, REMOTE_TOOLS } from "@/lib/agent-rules";
import { UserModelConfigTab } from "@/components/UserModelConfigTab";

type Tab =
  | "keys" | "docs" | "profile" | "model-config" | "team"
  | "index" | "logs"
  | "org" | "users" | "call-stats" | "quota" | "admin-orgs" | "models"
  | "system-settings" | "system-logs";

interface SidebarSection {
  label: string;
  admin?: boolean;
  items: { id: Tab; label: string; icon: React.ReactNode }[];
}

const ALL_SECTIONS: SidebarSection[] = [
  {
    label: "我的",
    items: [
      { id: "keys", label: "密钥管理", icon: <Key className="w-4 h-4" /> },
      { id: "team", label: "组织", icon: <Building2 className="w-4 h-4" /> },
      { id: "docs", label: "配置说明", icon: <FileText className="w-4 h-4" /> },
      { id: "model-config", label: "模型设置", icon: <Cpu className="w-4 h-4" /> },
      { id: "profile", label: "用户信息", icon: <User className="w-4 h-4" /> },
    ],
  },
  {
    label: "数据",
    items: [
      { id: "index", label: "索引管理", icon: <Database className="w-4 h-4" /> },
      { id: "logs", label: "请求日志", icon: <ScrollText className="w-4 h-4" /> },
    ],
  },
  {
    label: "管理",
    admin: true,
    items: [
      { id: "org", label: "组织概览", icon: <Building2 className="w-4 h-4" /> },
      { id: "users", label: "用户管理", icon: <Users className="w-4 h-4" /> },
      { id: "call-stats", label: "调用统计", icon: <Coins className="w-4 h-4" /> },
      { id: "quota", label: "配额管理", icon: <Gauge className="w-4 h-4" /> },
      { id: "admin-orgs", label: "组织管理", icon: <Building2 className="w-4 h-4" /> },
      { id: "models", label: "模型管理", icon: <Cpu className="w-4 h-4" /> },
    ],
  },
  {
    label: "系统",
    admin: true,
    items: [
      { id: "system-settings", label: "系统设置", icon: <Settings className="w-4 h-4" /> },
      { id: "system-logs", label: "系统日志", icon: <Terminal className="w-4 h-4" /> },
    ],
  },
];

interface RequestLog {
  id: string;
  status: string;
  statusCode: number | null;
  requestPath: string;
  requestMethod: string;
  requestTimestamp: string;
  responseDurationMs: number | null;
  clientIp: string;
}

interface LogStats {
  successCount: number;
  failedCount: number;
  totalCount: number;
  contextEngineCount: number;
}

interface LogsResponse {
  stats: LogStats;
  logs: RequestLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

interface ErrorDetail {
  id: number;
  source: string;
  error: string;
  createdAt: string;
}

interface LogDetailResponse {
  log: RequestLog;
  errors: ErrorDetail[];
}

interface UserInfo {
  id: string;
  username: string;
  name: string;
  email: string;
  image: string;
  trustLevel: number;
  githubCreatedAt: string | null;
  createdAt: string;
}

type AuthProvider = "github" | "linuxdo";

function detectProvider(user: UserInfo): AuthProvider {
  return user.githubCreatedAt ? "github" : "linuxdo";
}

function formatGithubAccountAge(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  return `${days} 天`;
}

interface KeyInfo {
  hasKey: boolean;
  maskedKey: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
  tier?: "free" | "pro";
}

interface ActiveIndexJob {
  root_id: string;
  indexed_files: number;
  total_files: number;
  phase: string;
}

interface TenantStats {
  exists: boolean;
  fileCount: number;
  chunkCount: number;
  vectorIndexedCount: number;
  totalSizeBytes: number;
  languages: Record<string, number>;
  indexingCount?: number;
  active_job?: ActiveIndexJob;
}

interface RelayRoot {
  workspace_id: string;
  root_id: string;
  // relay 派生字段：root_id 按最后一个 '@' 拆分出 base_root_id 与 view_branch
  // （无 '@' 时 view_branch = "default"）。旧 relay 可能缺失，前端用
  // resolveRootView 自行拆分兜底。注意 branch 是 start 上报的 git 元数据，
  // 不参与分支视图分组。
  base_root_id?: string;
  view_branch?: string;
  branch: string;
  revision: string;
  cloud_revision: number;
  indexed_at: string;
  file_count: number;
  total_size_bytes: number;
}

function isActiveIndexJob(value: unknown): value is ActiveIndexJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<ActiveIndexJob>;
  return (
    typeof job.root_id === "string" &&
    typeof job.phase === "string" &&
    typeof job.indexed_files === "number" &&
    Number.isFinite(job.indexed_files) &&
    typeof job.total_files === "number" &&
    Number.isFinite(job.total_files)
  );
}

function isRelayRoot(value: unknown): value is RelayRoot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Partial<RelayRoot>;
  return (
    typeof root.workspace_id === "string" &&
    typeof root.root_id === "string" &&
    // 派生字段向后兼容：旧 relay 不发 base_root_id/view_branch，缺失时放行，
    // 由 resolveRootView 按最后一个 '@' 拆分兜底
    (root.base_root_id === undefined || typeof root.base_root_id === "string") &&
    (root.view_branch === undefined || typeof root.view_branch === "string") &&
    typeof root.branch === "string" &&
    typeof root.revision === "string" &&
    typeof root.indexed_at === "string" &&
    typeof root.cloud_revision === "number" &&
    typeof root.file_count === "number" &&
    typeof root.total_size_bytes === "number"
  );
}

function formatSizeBytes(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

// 分支视图归属：优先用 relay 派生的 base_root_id + view_branch；旧 relay
// 缺失时按最后一个 '@' 拆分 root_id 兜底（无 '@' 时 base=root_id、
// branch="default"）。不使用 git 元数据 branch 做分组。
function resolveRootView(root: RelayRoot): { baseRootId: string; branch: string } {
  if (root.base_root_id && root.view_branch) {
    return { baseRootId: root.base_root_id, branch: root.view_branch };
  }
  const at = root.root_id.lastIndexOf("@");
  if (at > 0 && at < root.root_id.length - 1) {
    return { baseRootId: root.root_id.slice(0, at), branch: root.root_id.slice(at + 1) };
  }
  return { baseRootId: root.root_id, branch: "default" };
}

// 徽标文案："default" 视图沿用 start 上报的 git 分支（与旧展示一致），
// 具名分支视图显示视图分支名
function rootBranchLabel(root: RelayRoot): string {
  const { branch } = resolveRootView(root);
  return branch !== "default" ? branch : root.branch || "";
}

interface RootGroup {
  baseRootId: string;
  workspaceId: string;
  entries: { root: RelayRoot; branch: string }[];
}

// 按 base_root_id 分组（保持 relay 返回顺序），组内每项是一个分支视图
function groupRootsByBase(roots: RelayRoot[]): RootGroup[] {
  const groups = new Map<string, RootGroup>();
  for (const root of roots) {
    const { baseRootId, branch } = resolveRootView(root);
    const existing = groups.get(baseRootId);
    if (existing) {
      existing.entries.push({ root, branch });
    } else {
      groups.set(baseRootId, {
        baseRootId,
        workspaceId: root.workspace_id,
        entries: [{ root, branch }],
      });
    }
  }
  return [...groups.values()];
}

function isTenantStats(value: unknown): value is TenantStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const stats = value as Partial<TenantStats>;
  const numericFields = [
    stats.fileCount,
    stats.chunkCount,
    stats.vectorIndexedCount,
    stats.totalSizeBytes,
  ];

  return (
    typeof stats.exists === "boolean" &&
    numericFields.every((field) => typeof field === "number" && Number.isFinite(field)) &&
    Boolean(stats.languages) &&
    typeof stats.languages === "object" &&
    !Array.isArray(stats.languages) &&
    (stats.indexingCount == null ||
      (typeof stats.indexingCount === "number" && Number.isFinite(stats.indexingCount))) &&
    (stats.active_job == null || isActiveIndexJob(stats.active_job))
  );
}


// 复制成功反馈：ref 存 timer id，重复点击先清旧 timer，卸载时清理（防
// 卸载后 setState 与连点叠 timer）
function useCopyFeedback(duration = 2000): {
  copied: boolean;
  trigger: () => void;
  reset: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    clear();
    setCopied(true);
    timerRef.current = window.setTimeout(() => setCopied(false), duration);
  }, [clear, duration]);

  const reset = useCallback(() => {
    clear();
    setCopied(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { copied, trigger, reset };
}

export default function ConsolePage() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("keys");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { copied, trigger: markCopied } = useCopyFeedback();
  const [logsData, setLogsData] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const { copied: copiedConfig, trigger: markConfigCopied, reset: resetConfigCopied } = useCopyFeedback();
  const [configError, setConfigError] = useState("");
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [logDetail, setLogDetail] = useState<LogDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearResult, setClearResult] = useState<{ success: boolean; message: string } | null>(null);
  const [tenantStats, setTenantStats] = useState<TenantStats | null>(null);
  const [tenantStatsLoading, setTenantStatsLoading] = useState(true);
  const [tenantStatsError, setTenantStatsError] = useState<string | null>(null);
  const [roots, setRoots] = useState<RelayRoot[] | null>(null);
  const [rootsLoading, setRootsLoading] = useState(false);
  const [rootsError, setRootsError] = useState<string | null>(null);
  const [rootPendingDelete, setRootPendingDelete] = useState<RelayRoot | null>(null);
  const [deleteRootLoading, setDeleteRootLoading] = useState(false);
  const [deleteRootResult, setDeleteRootResult] = useState<{ success: boolean; message: string } | null>(null);
  // 索引上下文：null = 个人租户；组织时按组织密钥查询，删除权限依 orgRole
  const [rootsOrg, setRootsOrg] = useState<{ id: string; name: string } | null>(null);
  const [rootsOrgRole, setRootsOrgRole] = useState<"owner" | "member" | null>(null);
  const { data: myOrgs } = authClient.useListOrganizations();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mcpConfigFormat, setMcpConfigFormat] = useState<"json" | "toml">("json");
  const [mcpConfigMode, setMcpConfigMode] = useState<"cloud" | "remote">("cloud");

  const mcpConfig = useMemo(() => {
    if (mcpConfigMode === "cloud") {
      return mcpConfigFormat === "toml"
        ? buildCloudMcpConfigToml(fullKey)
        : buildCloudMcpConfigJson(fullKey);
    }
    return mcpConfigFormat === "toml"
      ? buildMcpConfigToml(fullKey)
      : buildMcpConfigJson(fullKey);
  }, [fullKey, mcpConfigFormat, mcpConfigMode]);

  const generateAndCopyConfig = async () => {
    if (loading) return;
    resetConfigCopied();
    setConfigError("");
    setLoading(true);
    try {
      const res = await fetch("/api/mcp-config", { method: "POST" });
      if (!res.ok) throw new Error(`获取 MCP 配置失败（HTTP ${res.status}）`);
      const data = await res.json();
      const key = data.apiKey as string;
      setFullKey(key);
      await fetchKeyInfo();

      let config: string;
      if (mcpConfigMode === "cloud") {
        config = mcpConfigFormat === "toml"
          ? buildCloudMcpConfigToml(key)
          : buildCloudMcpConfigJson(key);
      } else {
        config = mcpConfigFormat === "toml"
          ? buildMcpConfigToml(key)
          : buildMcpConfigJson(key);
      }
      await navigator.clipboard.writeText(config);
      markConfigCopied();
    } catch (error) {
      console.error("一键复制配置失败:", error);
      setConfigError(
        error instanceof Error ? error.message : "复制失败，请重试"
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchUserInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/user");
      if (res.ok) {
        const data = await res.json();
        setUserInfo(data);
      }
    } catch (error) {
      console.error("获取用户信息失败:", error);
    }
  }, []);

  const fetchKeyInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/key");
      if (res.ok) {
        const data = await res.json();
        setKeyInfo(data);
      }
    } catch (error) {
      console.error("获取密钥信息失败:", error);
    }
  }, []);

  // background=true 用于轮询：不闪 loading 态，静默失败（保留上次数据）
  const fetchTenantStats = useCallback(async (background = false, orgContext = rootsOrg) => {
    if (!background) {
      setTenantStatsLoading(true);
      setTenantStatsError(null);
    }
    try {
      const url = orgContext
        ? `/api/tenant-stats?orgId=${encodeURIComponent(orgContext.id)}`
        : "/api/tenant-stats";
      const res = await fetch(url);
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : `获取索引统计失败（HTTP ${res.status}）`;
        throw new Error(message);
      }
      if (!isTenantStats(data)) {
        throw new Error("索引统计响应格式异常");
      }

      setTenantStats(data);
      if (background) setTenantStatsError(null);
    } catch (error) {
      console.error("获取索引统计失败:", error);
      if (!background) {
        setTenantStatsError(error instanceof Error ? error.message : "获取索引统计失败");
      }
    } finally {
      if (!background) setTenantStatsLoading(false);
    }
  }, [rootsOrg]);

  const fetchRoots = useCallback(async (background = false) => {
    if (!background) {
      setRootsLoading(true);
      setRootsError(null);
    }
    try {
      const url = rootsOrg
        ? `/api/roots?orgId=${encodeURIComponent(rootsOrg.id)}`
        : "/api/roots";
      const res = await fetch(url);
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : `获取索引列表失败（HTTP ${res.status}）`;
        throw new Error(message);
      }
      if (
        !data || typeof data !== "object" || !("roots" in data) ||
        !Array.isArray((data as { roots: unknown }).roots) ||
        !(data as { roots: unknown[] }).roots.every(isRelayRoot)
      ) {
        throw new Error("索引列表响应格式异常");
      }

      setRoots((data as { roots: RelayRoot[] }).roots);
      const orgRole = (data as { orgRole?: unknown }).orgRole;
      setRootsOrgRole(orgRole === "owner" || orgRole === "member" ? orgRole : null);
      if (background) setRootsError(null);
    } catch (error) {
      console.error("获取索引列表失败:", error);
      if (!background) {
        setRootsError(error instanceof Error ? error.message : "获取索引列表失败");
      }
    } finally {
      if (!background) setRootsLoading(false);
    }
  }, [rootsOrg]);

  const handleDeleteRoot = useCallback(async () => {
    if (!rootPendingDelete) return;
    setDeleteRootLoading(true);
    setDeleteRootResult(null);
    try {
      const res = await fetch("/api/roots/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_id: rootPendingDelete.root_id,
          ...(rootsOrg ? { org_id: rootsOrg.id } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeleteRootResult({
          success: true,
          message: `已删除索引（清理 ${data.deleted_files ?? 0} 个文件），该项目下次使用时需重新索引`,
        });
        await Promise.all([fetchRoots(), fetchTenantStats(false, rootsOrg)]);
      } else if (res.status === 409) {
        setDeleteRootResult({
          success: false,
          message: data.error || "该项目正在索引中，请等待完成后再删除",
        });
      } else {
        setDeleteRootResult({ success: false, message: data.error || "删除失败" });
      }
    } catch {
      setDeleteRootResult({ success: false, message: "网络错误" });
    } finally {
      setDeleteRootLoading(false);
      setRootPendingDelete(null);
    }
  }, [rootPendingDelete, rootsOrg, fetchRoots, fetchTenantStats]);

  const fetchIsAdmin = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/check");
      if (res.ok) {
        const data = await res.json();
        setIsAdmin(data.isAdmin);
      }
    } catch {}
  }, []);

  const sections = useMemo(
    () => (isAdmin ? ALL_SECTIONS : ALL_SECTIONS.filter((s) => !s.admin)),
    [isAdmin]
  );
  const mobileItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );

  // isAdmin 为 false 时 admin tab 的 TabsContent 不渲染：若 activeTab 落在
  // admin tab（如权限校验失败/回收），内容区会空白。渲染期直接归一到 "keys"，
  // 不用 effect setState（避免级联渲染，也满足 set-state-in-effect 规则）。
  const effectiveTab: Tab = useMemo(() => {
    if (isAdmin) return activeTab;
    return mobileItems.some((item) => item.id === activeTab) ? activeTab : "keys";
  }, [isAdmin, activeTab, mobileItems]);

  const activeMobileItem = mobileItems.find((item) => item.id === effectiveTab) ?? mobileItems[0];

  const fetchLogs = useCallback(async (page = 1, forceRefreshStats = false) => {
    setLogsLoading(true);
    const startTime = Date.now();
    try {
      // 第 1 页或强制刷新时获取统计数据
      const needStats = forceRefreshStats || page === 1;
      const url = needStats
        ? `/api/logs?page=${page}&limit=20&withStats=true`
        : `/api/logs?page=${page}&limit=20`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();

        if (needStats) {
          // 带统计数据的响应
          setLogsData(data);
        } else {
          // 只更新日志列表，保留原有统计数据和 total
          setLogsData(prev => prev ? {
            ...prev,
            logs: data.logs,
            pagination: {
              ...data.pagination,
              total: prev.pagination.total,
            },
          } : data);
        }
        setLogsPage(page);
      }
    } catch (error) {
      console.error("获取请求日志失败:", error);
    } finally {
      // 确保动画至少显示 300ms
      const elapsed = Date.now() - startTime;
      if (elapsed < 300) {
        await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
      }
      setLogsLoading(false);
    }
  }, []);

  const fetchLogDetail = useCallback(async (logId: string) => {
    setDetailLoading(true);
    setShowDetailDialog(true);
    try {
      const res = await fetch(`/api/logs/${logId}`);
      if (res.ok) {
        const data = await res.json();
        setLogDetail(data);
      }
    } catch (error) {
      console.error("获取日志详情失败:", error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Fetch logs when switching to logs tab (only on tab switch, not on page change)
  useEffect(() => {
    if (activeTab !== "logs" || !session || logsData) return;

    const timeoutId = window.setTimeout(() => {
      void fetchLogs(1);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, session, logsData, fetchLogs]);

  // Auto-refresh logs
  useEffect(() => {
    if (!autoRefresh || activeTab !== "logs") return;

    const intervalId = setInterval(() => {
      fetchLogs(1, true);  // 自动刷新回到第1页并获取统计
    }, 5000);

    return () => clearInterval(intervalId);
  }, [autoRefresh, activeTab, fetchLogs]);

  // 进入索引管理页时拉取"我的索引"列表（只在首次进入时触发）
  useEffect(() => {
    if (activeTab !== "index" || !session || roots !== null) return;

    const timeoutId = window.setTimeout(() => {
      void fetchRoots();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, session, roots, fetchRoots]);

  // 索引统计轮询：仅在索引管理页且页面可见时进行；有构建任务时缩短到
  // 5 秒并同时刷新索引列表，否则 30 秒兜底刷新
  const hasActiveJob = Boolean(tenantStats?.active_job);
  useEffect(() => {
    if (activeTab !== "index" || !session) return;

    const intervalMs = hasActiveJob ? 5000 : 30000;
    let intervalId: number | null = null;

    const tick = () => {
      void fetchTenantStats(true);
      if (hasActiveJob) void fetchRoots(true);
    };
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const sync = () => {
      if (document.visibilityState === "visible") {
        if (intervalId === null) intervalId = window.setInterval(tick, intervalMs);
      } else {
        stop();
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [activeTab, session, hasActiveJob, fetchTenantStats, fetchRoots]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (!session) return;

    const timeoutId = window.setTimeout(() => {
      void fetchUserInfo();
      void fetchKeyInfo();
      void fetchTenantStats();
      void fetchIsAdmin();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isPending, session, router, fetchUserInfo, fetchKeyInfo, fetchTenantStats, fetchIsAdmin]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const handleShowKey = async () => {
    if (showKey) {
      setShowKey(false);
      setFullKey(null);
      return;
    }
    try {
      const res = await fetch("/api/key/reveal");
      if (res.ok) {
        const data = await res.json();
        setFullKey(data.apiKey);
        setShowKey(true);
      }
    } catch (error) {
      console.error("获取完整密钥失败:", error);
    }
  };

  const handleCopy = async () => {
    if (!fullKey && !keyInfo?.hasKey) return;

    let keyToCopy = fullKey;
    if (!keyToCopy) {
      const res = await fetch("/api/key/reveal");
      if (res.ok) {
        const data = await res.json();
        keyToCopy = data.apiKey;
      }
    }

    if (keyToCopy) {
      await navigator.clipboard.writeText(keyToCopy);
      markCopied();
    }
  };

  const handleGenerateKey = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFullKey(data.apiKey);
        setShowKey(false);
        await fetchKeyInfo();
      }
    } catch (error) {
      console.error("生成密钥失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetKey = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFullKey(data.apiKey);
        setShowKey(false);
        await fetchKeyInfo();
      }
    } catch (error) {
      console.error("重置密钥失败:", error);
    } finally {
      setLoading(false);
      setShowResetConfirm(false);
    }
  };

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  const handleClearIndex = async () => {
    setClearLoading(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/clear-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rootsOrg ? { org_id: rootsOrg.id } : {}),
      });
      const data = await res.json();
      if (res.ok) {
        setClearResult({ success: true, message: data.message || "索引和日志已清除" });
        setLogsData(null);
        await fetchTenantStats(false, rootsOrg);
      } else {
        setClearResult({ success: false, message: data.error || "清除失败" });
      }
    } catch {
      setClearResult({ success: false, message: "网络错误" });
    } finally {
      setClearLoading(false);
      setShowClearConfirm(false);
    }
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md px-4">
          <Skeleton className="h-8 w-32 bg-white/[0.06]" />
          <Skeleton className="h-32 w-full bg-white/[0.06]" />
          <Skeleton className="h-24 w-full bg-white/[0.06]" />
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-dvh md:h-dvh bg-[#0a0f1a] flex flex-col overflow-x-clip md:overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 w-screen max-w-[600px] h-[400px] -translate-x-1/2 bg-gradient-radial from-cyan-500/5 via-blue-500/3 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Noise texture */}
      <div className="fixed inset-0 opacity-[0.015] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />

      {/* Header */}
      <header className="relative border-b border-white/[0.06] flex-shrink-0 bg-[#0a0f1a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="text-lg sm:text-xl font-semibold whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400">
            LCE
          </Link>
          <nav className="order-3 grid w-full grid-cols-3 sm:order-none sm:flex sm:w-auto sm:items-center sm:gap-1">
            <Link
              href="/console"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-white border-b-2 border-cyan-400"
            >
              控制台
            </Link>
            <Link
              href="/leaderboard"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors"
            >
              排行榜
            </Link>
            <Link
              href="/status"
              className="px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors"
            >
              状态监控
            </Link>
          </nav>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogoutConfirm(true)}
            className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
            aria-label="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="relative flex-1 md:overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8 md:h-full flex flex-col">
          <Tabs value={effectiveTab} onValueChange={(v) => setActiveTab(v as Tab)} className="flex-1 flex flex-col min-h-0">
            <div className="relative mb-4 flex-shrink-0 md:hidden">
              {mobileMenuOpen && (
                <button
                  type="button"
                  aria-label="关闭控制台菜单"
                  className="fixed inset-0 z-40 cursor-default bg-black/20"
                  onClick={() => setMobileMenuOpen(false)}
                />
              )}
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="relative z-50 flex h-11 w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0d1424] px-3 pr-10 text-left text-sm text-white outline-none transition-colors hover:border-white/[0.14] focus-visible:border-cyan-400/60"
              >
                {activeMobileItem?.icon}
                <span>{activeMobileItem?.label}</span>
                <ChevronDown
                  className={cn(
                    "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform",
                    mobileMenuOpen && "rotate-180"
                  )}
                />
              </button>
              {mobileMenuOpen && (
                <div
                  role="menu"
                  aria-label="控制台页面"
                  className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(60dvh,28rem)] overflow-y-auto rounded-lg border border-white/[0.1] bg-[#111827] p-1.5 shadow-2xl shadow-black/50"
                >
                  {mobileItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={item.id === effectiveTab}
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm transition-colors",
                        item.id === effectiveTab
                          ? "bg-cyan-400/10 text-cyan-200"
                          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4 flex-1 min-h-0">
              {/* Sidebar - desktop only */}
              <aside className="hidden md:block flex-shrink-0 w-48 overflow-y-auto pr-1 scrollbar-thin">
                <nav className="flex flex-col gap-4">
                  {sections.map((section) => (
                    <div key={section.label} className="rounded-xl border border-white/[0.04] bg-white/[0.012] p-1.5">
                      <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">
                        {section.label}
                        {section.admin && <Shield className="w-3 h-3 inline ml-1 -mt-0.5 text-amber-500/60" />}
                      </p>
                      <TabsList className="flex flex-col gap-0.5 bg-transparent h-auto p-0">
                        {section.items.map((item) => (
                          <TabsTrigger
                            key={item.id}
                            value={item.id}
                            className="justify-start gap-2.5 px-3 py-2 text-sm rounded-lg data-[state=active]:bg-white/[0.06] data-[state=active]:text-white data-[state=inactive]:text-slate-500 data-[state=inactive]:hover:text-slate-300 border border-transparent data-[state=active]:border-white/[0.08] transition-colors"
                          >
                            {item.icon}
                            {item.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                  ))}
                </nav>
              </aside>

              {/* Content area */}
              <main className="flex-1 min-w-0 min-h-0">
                <div className="bg-[#0d1424]/60 md:backdrop-blur-xl border border-white/[0.06] rounded-xl sm:rounded-2xl p-4 sm:p-6 md:h-full flex flex-col">
                  {/* 密钥管理 */}
                  <TabsContent value="keys" className="animate-tab-fade-in m-0 flex-1">
                    <h2 className="text-lg font-medium text-white mb-6">密钥管理</h2>

                    {keyInfo === null ? (
                      <div className="text-center py-8">
                        <div className="animate-pulse space-y-4">
                          <div className="h-4 w-32 bg-slate-700/50 rounded mx-auto"></div>
                          <div className="h-10 w-24 bg-slate-700/50 rounded mx-auto"></div>
                        </div>
                      </div>
                    ) : keyInfo.hasKey ? (
                      <div className="space-y-4">
                        {/* Key display */}
                        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-slate-500 text-xs mb-1">
                                  API Key
                                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded border bg-white/[0.04] text-slate-400 border-white/[0.1] text-[10px]">
                                    个人
                                  </span>
                                </p>
                                <p className="text-white font-mono text-sm truncate">
                                  {showKey && fullKey ? fullKey : keyInfo.maskedKey}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 ml-4">
                                <Button
                                  variant="glass"
                                  size="sm"
                                  onClick={handleShowKey}
                                >
                                  {showKey ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                                  {showKey ? "隐藏" : "显示"}
                                </Button>
                                <Button
                                  variant="glass"
                                  size="sm"
                                  onClick={handleCopy}
                                >
                                  <Copy className="w-4 h-4 mr-1" />
                                  {copied ? "已复制" : "复制"}
                                </Button>
                              </div>
                            </div>
                            {keyInfo.createdAt && (
                              <p className="text-slate-600 text-xs mt-3">
                                创建于 {new Date(keyInfo.createdAt).toLocaleString("zh-CN")}
                              </p>
                            )}
                            <p className="text-slate-600 text-xs mt-1">
                              当前套餐：
                              <span className={keyInfo.tier === "pro" ? "text-cyan-400" : "text-slate-400"}>
                                {keyInfo.tier === "pro" ? "Pro" : "Free"}
                              </span>
                            </p>
                          </CardContent>
                        </Card>

                        {/* Reset button */}
                        <Button
                          variant="warning"
                          onClick={() => setShowResetConfirm(true)}
                          disabled={loading}
                        >
                          {loading ? "处理中..." : "重置密钥"}
                        </Button>
                        <p className="text-slate-600 text-xs">
                          重置后旧密钥将立即失效，请谨慎操作
                        </p>

                        {/* 组织密钥列表 */}
                        <OrgKeysCards />
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        {loading ? (
                          <div className="space-y-4">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
                            <p className="text-slate-400">正在生成密钥...</p>
                          </div>
                        ) : (
                          <>
                            <p className="text-slate-500 mb-4">您还没有 API Key</p>
                            <Button
                              variant="gradient"
                              onClick={handleGenerateKey}
                            >
                              生成密钥
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* 配置说明 */}
                  <TabsContent value="docs" className="flex flex-col flex-1 min-h-0 animate-tab-fade-in md:overflow-y-auto scrollbar-thin md:pr-2 m-0">
                    <h2 className="text-lg font-medium text-white mb-6">配置说明</h2>

                    <div className="space-y-6">
                      {/* Step 1: MCP Config */}
                      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                        <CardContent className="p-5">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium">
                              1
                            </span>
                            <h3 className="text-white font-medium">添加 MCP 服务器</h3>
                          </div>

                          {/* Mode toggle: cloud / remote */}
                          <div
                            role="tablist"
                            aria-label="MCP 接入模式"
                            className="mb-3 grid grid-cols-2 rounded-lg border border-white/[0.08] bg-[#0a0f1a] p-1"
                          >
                            {[
                              { value: "cloud" as const, label: "Cloud 模式（推荐）" },
                              { value: "remote" as const, label: "远程 HTTP 模式" },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                role="tab"
                                aria-selected={mcpConfigMode === option.value}
                                onClick={() => {
                                  setMcpConfigMode(option.value);
                                  resetConfigCopied();
                                  setConfigError("");
                                }}
                                className={cn(
                                  "min-h-9 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                                  mcpConfigMode === option.value
                                    ? "bg-white/[0.08] text-white"
                                    : "text-slate-500 hover:text-slate-300"
                                )}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>

                          <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                            {mcpConfigMode === "cloud"
                              ? "复制配置到 IDE 即可使用，客户端由 npx 自动获取并保持最新（需要 Node.js 20+）。选择格式后点击「一键复制」生成密钥："
                              : "Cursor、Claude Code 和 Codex 均可直接连接远程 MCP。选择格式后点击「一键复制」生成密钥："}
                          </p>
                          {mcpConfigMode === "cloud" && (
                            <div className="mb-4 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] p-3 text-sm text-slate-400">
                              <p className="text-slate-300">可选的全局安装方式：</p>
                              <code className="mt-2 block overflow-x-auto whitespace-pre font-mono text-xs text-cyan-300">
                                npm install -g @anmezing/lce-cloud@latest
                              </code>
                              <p className="mt-2 text-xs text-slate-500">
                                预装后可将配置中的 <code className="text-slate-300">npx</code> 改为{" "}
                                <code className="text-slate-300">lce-cloud</code>；默认 npx 配置无需额外安装。
                              </p>
                            </div>
                          )}

                          {/* Format toggle: JSON / TOML */}
                          <div
                            role="tablist"
                            aria-label="MCP 客户端配置格式"
                            className="mb-3 grid grid-cols-2 rounded-lg border border-white/[0.08] bg-[#0a0f1a] p-1"
                          >
                            {[
                              { value: "json" as const, label: "Cursor / Claude Code" },
                              { value: "toml" as const, label: "Codex" },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                role="tab"
                                aria-selected={mcpConfigFormat === option.value}
                                onClick={() => {
                                  setMcpConfigFormat(option.value);
                                  resetConfigCopied();
                                  setConfigError("");
                                }}
                                className={cn(
                                  "min-h-9 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                                  mcpConfigFormat === option.value
                                    ? "bg-white/[0.08] text-white"
                                    : "text-slate-500 hover:text-slate-300"
                                )}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div className="relative group">
                            <div className="bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-3 font-mono text-sm overflow-x-auto">
                              <pre className="text-slate-300 whitespace-pre-wrap break-all">
                                <code>{mcpConfig}</code>
                              </pre>
                            </div>
                            <Button
                              variant="glass"
                              size="sm"
                              onClick={generateAndCopyConfig}
                              disabled={loading}
                              className="absolute top-2 right-2"
                            >
                              {copiedConfig ? "已复制" : loading ? "生成中..." : "一键复制"}
                            </Button>
                          </div>
                          {configError && (
                            <p className="text-red-400 text-xs mt-2">{configError}</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Step 3: Available tools */}
                      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                        <CardContent className="p-5">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium">
                              2
                            </span>
                            <h3 className="text-white font-medium">可用工具</h3>
                          </div>
                          <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                            连接后，编码 Agent 会自动发现以下工具：
                          </p>
                          <div className="space-y-2">
                            {(mcpConfigMode === "cloud" ? CLOUD_TOOLS : REMOTE_TOOLS).map((tool) => (
                              <div key={tool.name} className="flex gap-3 p-3 bg-[#0a0f1a]/80 border border-white/[0.04] rounded-lg">
                                <code className="text-cyan-400 text-xs font-mono shrink-0">{tool.name}</code>
                                <p className="text-slate-400 text-xs">{tool.desc}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Step 3: Agent rules */}
                      <AgentRulesCard mode={mcpConfigMode} />

                      {/* Tips */}
                      <Card className="bg-gradient-to-br from-cyan-500/[0.06] to-blue-500/[0.06] border-cyan-500/20">
                        <CardContent className="p-4">
                          <h4 className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                            <Info className="w-4 h-4 text-cyan-400" />
                            说明
                          </h4>
                          <ul className="text-slate-400 text-xs space-y-2">
                            <li className="flex items-start gap-2">
                              <span className="text-cyan-400 mt-0.5">•</span>
                              <span>Cloud 模式（推荐）：复制配置到 IDE，索引和检索都在云端完成</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-cyan-400 mt-0.5">•</span>
                              <span>远程 HTTP 模式：无需安装任何组件，适合 CI/CD 等无法运行 Node.js 的场景</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-cyan-400 mt-0.5">•</span>
                              <span>每个 API Key 拥有独立的检索索引，互不影响</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="text-cyan-400 mt-0.5">•</span>
                              <span>请妥善保管 API 密钥，不要在公开场合分享</span>
                            </li>
                          </ul>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* 请求日志 */}
                  <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 animate-tab-fade-in m-0">
                    <div className="flex items-center justify-between mb-4 sm:mb-6 flex-shrink-0">
                      <h2 className="text-base sm:text-lg font-medium text-white">请求日志</h2>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="hidden sm:flex items-center gap-2">
                          <Checkbox
                            id="auto-refresh"
                            checked={autoRefresh}
                            onCheckedChange={(checked) => setAutoRefresh(checked === true)}
                            className="border-white/20 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                          />
                          <Label htmlFor="auto-refresh" className="text-sm text-slate-400 cursor-pointer">
                            自动刷新
                          </Label>
                        </div>
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => setAutoRefresh(!autoRefresh)}
                          className={cn(
                            "sm:hidden",
                            autoRefresh && "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                          )}
                        >
                          {autoRefresh ? "自动" : "手动"}
                        </Button>
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchLogs(1, true)}
                          disabled={logsLoading}
                        >
                          <RefreshCw className={cn("w-4 h-4", logsLoading && "animate-spin")} />
                          <span className="hidden sm:inline ml-1">刷新</span>
                        </Button>
                      </div>
                    </div>

                    {/* Statistics Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6 flex-shrink-0">
                      <Card className="bg-[#0a0f1a]/60 border-green-500/20">
                        <CardContent className="p-2 sm:p-4">
                          <p className="text-slate-500 text-[10px] sm:text-xs mb-0.5 sm:mb-1">成功</p>
                          <p className="text-lg sm:text-2xl font-medium text-green-400">
                            {logsData?.stats.successCount.toLocaleString() || 0}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-[#0a0f1a]/60 border-red-500/20">
                        <CardContent className="p-2 sm:p-4">
                          <p className="text-slate-500 text-[10px] sm:text-xs mb-0.5 sm:mb-1">失败</p>
                          <p className="text-lg sm:text-2xl font-medium text-red-400">
                            {logsData?.stats.failedCount.toLocaleString() || 0}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                        <CardContent className="p-2 sm:p-4">
                          <p className="text-slate-500 text-[10px] sm:text-xs mb-0.5 sm:mb-1">总计</p>
                          <p className="text-lg sm:text-2xl font-medium text-slate-300">
                            {logsData?.stats.totalCount.toLocaleString() || 0}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-[#0a0f1a]/60 border-cyan-500/20">
                        <CardContent className="p-2 sm:p-4">
                          <p className="text-slate-500 text-[10px] sm:text-xs mb-0.5 sm:mb-1">ContextEngine</p>
                          <p className="text-lg sm:text-2xl font-medium text-cyan-400">
                            {logsData?.stats.contextEngineCount.toLocaleString() || 0}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Log Entries */}
                    <div className="flex-1 min-h-0 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <div className="space-y-2">
                        {logsLoading && !logsData && (
                          <>
                            <Skeleton className="h-16 w-full bg-white/[0.06]" />
                            <Skeleton className="h-16 w-full bg-white/[0.06]" />
                            <Skeleton className="h-16 w-full bg-white/[0.06]" />
                          </>
                        )}
                        {logsData?.logs.length === 0 && (
                          <div className="text-center py-8 text-slate-500">
                            暂无请求日志
                          </div>
                        )}
                        {logsData?.logs.map((log) => (
                          <LogEntry key={log.id} log={log} onClick={() => fetchLogDetail(log.id)} />
                        ))}
                      </div>
                    </div>

                    {/* Pagination */}
                    {logsData && logsData.pagination.total > 20 && (
                      <div className="flex items-center justify-center gap-2 mt-6 flex-shrink-0">
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchLogs(logsPage - 1)}
                          disabled={logsPage <= 1 || logsLoading}
                        >
                          上一页
                        </Button>
                        <span className="text-slate-500 text-sm px-3">
                          {logsPage} / {Math.ceil(logsData.pagination.total / 20)}
                        </span>
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchLogs(logsPage + 1)}
                          disabled={logsPage >= Math.ceil(logsData.pagination.total / 20) || logsLoading}
                        >
                          下一页
                        </Button>
                      </div>
                    )}
                  </TabsContent>

                  {/* 用户信息 */}
                  <TabsContent value="profile" className="animate-tab-fade-in m-0">
                    <h2 className="text-lg font-medium text-white mb-6">用户信息</h2>

                    {userInfo ? (
                      (() => {
                        const provider = detectProvider(userInfo);
                        return (
                          <div className="space-y-6">
                            {/* Avatar and name */}
                            <div className="flex items-center gap-4">
                              <Avatar className="h-16 w-16 border border-white/10">
                                <AvatarImage src={userInfo.image} alt={userInfo.name || "avatar"} />
                                <AvatarFallback className="bg-slate-800 text-slate-300">
                                  {userInfo.name?.charAt(0)?.toUpperCase() || "U"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-white font-medium text-lg truncate">{userInfo.name}</p>
                                  <ProviderBadge provider={provider} />
                                </div>
                                {userInfo.username && (
                                  <p className="text-slate-500 text-sm">@{userInfo.username}</p>
                                )}
                              </div>
                            </div>

                            {/* Info grid */}
                            <div className="grid grid-cols-2 gap-4">
                              <InfoItem label="邮箱" value={userInfo.email || "-"} copyable />
                              <InfoItem label="用户 ID" value={userInfo.id} copyable />
                              {provider === "github" ? (
                                <InfoItem
                                  label="GitHub 账号年龄"
                                  value={userInfo.githubCreatedAt ? formatGithubAccountAge(userInfo.githubCreatedAt) : "-"}
                                />
                              ) : (
                                <InfoItem label="信任等级" value={`Level ${userInfo.trustLevel || 0}`} />
                              )}
                              <InfoItem
                                label="注册时间"
                                value={userInfo.createdAt ? new Date(userInfo.createdAt).toLocaleDateString("zh-CN") : "-"}
                              />
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <Skeleton className="h-16 w-16 rounded-full bg-white/[0.06]" />
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-32 bg-white/[0.06]" />
                            <Skeleton className="h-4 w-24 bg-white/[0.06]" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <Skeleton className="h-20 bg-white/[0.06]" />
                          <Skeleton className="h-20 bg-white/[0.06]" />
                          <Skeleton className="h-20 bg-white/[0.06]" />
                          <Skeleton className="h-20 bg-white/[0.06]" />
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* 索引管理 */}
                  <TabsContent value="index" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                    <h2 className="text-lg font-medium text-white mb-6">索引管理</h2>

                    {tenantStatsError && tenantStats && (
                      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-red-300">{tenantStatsError}</p>
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchTenantStats()}
                          disabled={tenantStatsLoading}
                          className="shrink-0"
                        >
                          <RefreshCw className={cn("mr-1 h-4 w-4", tenantStatsLoading && "animate-spin")} />
                          重试
                        </Button>
                      </div>
                    )}

                    {!tenantStats && tenantStatsError ? (
                      <Card className="border-red-500/20 bg-red-500/[0.04]">
                        <CardContent className="flex flex-col items-center px-4 py-8 text-center">
                          <Info className="mb-3 h-6 w-6 text-red-400" />
                          <p className="text-sm font-medium text-red-300">索引统计加载失败</p>
                          <p className="mt-1 max-w-md text-xs text-slate-500">{tenantStatsError}</p>
                          <Button
                            variant="glass"
                            size="sm"
                            onClick={() => fetchTenantStats()}
                            disabled={tenantStatsLoading}
                            className="mt-4"
                          >
                            <RefreshCw className={cn("mr-1 h-4 w-4", tenantStatsLoading && "animate-spin")} />
                            {tenantStatsLoading ? "重试中..." : "重新加载"}
                          </Button>
                        </CardContent>
                      </Card>
                    ) : tenantStats && tenantStats.exists ? (
                      <div className="space-y-4">
                        <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
                          <CardContent className="p-4">
                            <p className="text-slate-500 text-xs mb-3">索引统计</p>
                            {tenantStats.active_job && (
                              <IndexingProgress job={tenantStats.active_job} />
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <div>
                                <p className="text-2xl font-semibold text-white">{tenantStats.fileCount.toLocaleString()}</p>
                                <p className="text-slate-500 text-xs">已索引文件</p>
                              </div>
                              <div>
                                <p className="text-2xl font-semibold text-white">{tenantStats.chunkCount.toLocaleString()}</p>
                                <p className="text-slate-500 text-xs">代码分块</p>
                              </div>
                              <div>
                                <p className="text-2xl font-semibold text-cyan-400">{tenantStats.vectorIndexedCount.toLocaleString()}</p>
                                <p className="text-slate-500 text-xs">向量索引</p>
                              </div>
                              <div>
                                <p className="text-2xl font-semibold text-white">
                                  {tenantStats.totalSizeBytes >= 1048576
                                    ? `${(tenantStats.totalSizeBytes / 1048576).toFixed(1)} MB`
                                    : `${(tenantStats.totalSizeBytes / 1024).toFixed(0)} KB`}
                                </p>
                                <p className="text-slate-500 text-xs">索引大小</p>
                              </div>
                              {tenantStats.indexingCount != null && (
                                <div>
                                  <p className="text-2xl font-semibold text-white">{tenantStats.indexingCount.toLocaleString()}</p>
                                  <p className="text-slate-500 text-xs">已完成索引次数</p>
                                </div>
                              )}
                            </div>
                            {Object.keys(tenantStats.languages).length > 0 && (
                              <div className="mt-3 pt-3 border-t border-white/[0.04]">
                                <p className="text-slate-500 text-xs mb-2">语言分布</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(tenantStats.languages).slice(0, 10).map(([lang, count]) => (
                                    <span key={lang} className="text-[11px] px-2 py-0.5 rounded bg-white/[0.04] text-slate-400">
                                      {lang} <span className="text-slate-600">{count}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchTenantStats()}
                          disabled={tenantStatsLoading}
                        >
                          <RefreshCw className={cn("w-4 h-4 mr-1", tenantStatsLoading && "animate-spin")} />
                          {tenantStatsLoading ? "刷新中..." : "刷新统计"}
                        </Button>

                        {/* 我的索引 */}
                        <RootsSection
                          roots={roots}
                          loading={rootsLoading}
                          error={rootsError}
                          deleteResult={deleteRootResult}
                          orgOptions={(myOrgs ?? []).map((o) => ({ id: o.id, name: o.name }))}
                          activeOrg={rootsOrg}
                          onSelectOrg={(org) => {
                            setRootsOrg(org);
                            setRootsOrgRole(null);
                            setRoots(null);
                            setTenantStats(null);
                            setTenantStatsError(null);
                            setRootsError(null);
                            setDeleteRootResult(null);
                            void fetchTenantStats(false, org);
                          }}
                          canDelete={!rootsOrg || rootsOrgRole === "owner"}
                          onRefresh={() => fetchRoots()}
                          onDelete={(root) => {
                            setDeleteRootResult(null);
                            setRootPendingDelete(root);
                          }}
                        />

                        {/* Clear index */}
                        <div className="mt-6 pt-6 border-t border-white/[0.06]">
                          <h3 className="text-sm font-medium text-red-400 mb-3">危险操作</h3>
                          <Card className="bg-red-500/[0.04] border-red-500/20">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-white text-sm font-medium">清除远程索引</p>
                                  <p className="text-slate-500 text-xs mt-1">
                                    删除所有已索引的代码数据和请求日志，72 小时内只能操作一次
                                  </p>
                                </div>
                                <Button
                                  variant="warning"
                                  size="sm"
                                  onClick={() => setShowClearConfirm(true)}
                                  disabled={clearLoading || (!!rootsOrg && rootsOrgRole !== "owner")}
                                  className="shrink-0"
                                >
                                  <Trash2 className="w-4 h-4 mr-1" />
                                  {clearLoading ? "清除中..." : "清除索引"}
                                </Button>
                              </div>
                              {clearResult && (
                                <p className={cn(
                                  "text-xs mt-3",
                                  clearResult.success ? "text-green-400" : "text-red-400"
                                )}>
                                  {clearResult.message}
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    ) : tenantStats && !tenantStats.exists ? (
                      <div className="flex flex-col items-center py-8 text-center text-slate-500">
                        {tenantStats.active_job && (
                          <div className="mb-6 w-full max-w-md text-left">
                            <IndexingProgress job={tenantStats.active_job} />
                          </div>
                        )}
                        <p>尚未建立索引。{mcpConfigMode === "cloud" ? "配置完成后启动 IDE，首次连接会自动完成索引。" : "请让编码 Agent 调用 codebase_index 建立项目索引。"}</p>
                        <Button
                          variant="glass"
                          size="sm"
                          onClick={() => fetchTenantStats()}
                          disabled={tenantStatsLoading}
                          className="mt-4"
                        >
                          <RefreshCw className={cn("mr-1 h-4 w-4", tenantStatsLoading && "animate-spin")} />
                          {tenantStatsLoading ? "刷新中..." : "刷新统计"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Skeleton className="h-32 w-full bg-white/[0.06]" />
                        <Skeleton className="h-20 w-full bg-white/[0.06]" />
                      </div>
                    )}
                  </TabsContent>

                  {/* 我的 - 用户自定义 Rerank */}
                  <TabsContent value="model-config" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                    <h2 className="text-lg font-medium text-white mb-6">模型设置</h2>
                    <UserModelConfigTab />
                  </TabsContent>

                  {/* 我的 - 组织 */}
                  <TabsContent value="team" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                    <h2 className="text-lg font-medium text-white mb-6">组织</h2>
                    <OrgTab currentUserId={session.user.id} />
                  </TabsContent>

                  {/* 管理员 - 组织概览 */}
                  {isAdmin && (
                    <TabsContent value="org" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">组织概览</h2>
                      <AdminOverviewTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 用户管理 */}
                  {isAdmin && (
                    <TabsContent value="users" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">用户管理</h2>
                      <AdminUsersTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - Token 成本（调用统计） */}
                  {isAdmin && (
                    <TabsContent value="call-stats" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">调用统计</h2>
                      <AdminStatsTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 配额管理 */}
                  {isAdmin && (
                    <TabsContent value="quota" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">配额管理</h2>
                      <AdminQuotaTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 组织管理（org_quotas 分配） */}
                  {isAdmin && (
                    <TabsContent value="admin-orgs" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">组织管理</h2>
                      <AdminOrgsTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 模型管理 */}
                  {isAdmin && (
                    <TabsContent value="models" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">模型管理</h2>
                      <AdminModelsTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 系统设置 */}
                  {isAdmin && (
                    <TabsContent value="system-settings" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">系统设置</h2>
                      <AdminSettingsTab />
                    </TabsContent>
                  )}

                  {/* 管理员 - 系统日志 */}
                  {isAdmin && (
                    <TabsContent value="system-logs" className="animate-tab-fade-in m-0 flex-1 md:overflow-y-auto scrollbar-thin md:pr-2">
                      <h2 className="text-lg font-medium text-white mb-6">系统日志</h2>
                      <AdminLogsTab />
                    </TabsContent>
                  )}
                </div>
              </main>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Reset confirm dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认重置密钥</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              重置后旧密钥将立即失效，所有使用旧密钥的服务都需要更新。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetKey}
              disabled={loading}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-white"
            >
              {loading ? "处理中..." : "确认重置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logout confirm dialog */}
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认退出登录</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              确定要退出登录吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-white"
            >
              确认退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear index confirm dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认清除索引</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              此操作将删除所有已索引的代码数据和请求日志，且 72 小时内无法再次执行。清除后需要重新建立代码索引才能使用检索功能。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearIndex}
              disabled={clearLoading}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-white"
            >
              {clearLoading ? "清除中..." : "确认清除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete root confirm dialog */}
      <AlertDialog
        open={rootPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRootPendingDelete(null);
        }}
      >
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认删除该项目索引</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              即将删除{" "}
              <span className="font-mono text-cyan-300 break-all">
                {rootPendingDelete?.workspace_id}
              </span>
              {rootPendingDelete && rootBranchLabel(rootPendingDelete)
                ? `（分支 ${rootBranchLabel(rootPendingDelete)}）`
                : ""}
              {" "}的云端索引。删除后该项目需重新索引才能继续使用检索功能。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRoot}
              disabled={deleteRootLoading}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-white"
            >
              {deleteRootLoading ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Log detail dialog */}
      <AlertDialog open={showDetailDialog} onOpenChange={(open) => {
        setShowDetailDialog(open);
        if (!open) setLogDetail(null);
      }}>
        <AlertDialogContent className="bg-[#0d1424] border-white/[0.08] max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">请求详情</AlertDialogTitle>
          </AlertDialogHeader>

          {detailLoading ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-6 w-full bg-white/[0.06]" />
              <Skeleton className="h-32 w-full bg-white/[0.06]" />
            </div>
          ) : logDetail ? (
            <div className="space-y-4">
              {/* Request ID with copy */}
              <LogDetailItem
                label="请求 ID"
                value={logDetail.log.id}
                copyable
                mono
              />

              {/* Main info grid */}
              <div className="grid grid-cols-2 gap-3">
                <LogDetailItem label="请求方法" value={logDetail.log.requestMethod} />
                <LogDetailItem
                  label="状态码"
                  value={logDetail.log.statusCode?.toString() || logDetail.log.status}
                  statusCode={logDetail.log.statusCode}
                />
                <LogDetailItem
                  label="响应时间"
                  value={logDetail.log.responseDurationMs !== null ? `${logDetail.log.responseDurationMs} ms` : "-"}
                />
                <LogDetailItem label="客户端 IP" value={logDetail.log.clientIp} mono />
              </div>

              {/* Request path - full width */}
              <LogDetailItem
                label="请求路径"
                value={logDetail.log.requestPath}
                mono
              />

              {/* Timestamp */}
              <LogDetailItem
                label="请求时间"
                value={new Date(logDetail.log.requestTimestamp).toLocaleString("zh-CN")}
              />

              {/* Error section - only show if errors exist */}
              {logDetail.errors && logDetail.errors.length > 0 && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg space-y-3">
                  <p className="text-red-400 text-sm font-medium">错误信息</p>
                  {logDetail.errors.map((error) => (
                    <div key={error.id} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">来源:</span>
                        <span className="text-slate-300">{error.source}</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-500">
                          {new Date(error.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <p className="text-red-300 text-sm font-mono bg-red-500/5 p-2 rounded break-all">
                        {error.error}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              加载失败
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06]">
              关闭
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: AuthProvider }) {
  if (provider === "github") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-slate-200 text-[10px] font-medium">
        <Github className="w-3 h-3" />
        GitHub
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/[0.08] border border-amber-500/30 text-amber-300 text-[10px] font-medium">
      <span className="w-3 h-3 rounded-full overflow-hidden border border-white/20 flex flex-col">
        <span className="flex-[1] bg-[#2d2d2d]" />
        <span className="flex-[1.5] bg-[#f5f5f5]" />
        <span className="flex-[1] bg-[#f0a030]" />
      </span>
      LinuxDo
    </span>
  );
}

function InfoItem({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const { copied, trigger: markCopied } = useCopyFeedback();

  const handleCopy = async () => {
    if (!value || value === "-") return;
    await navigator.clipboard.writeText(value);
    markCopied();
  };

  return (
    <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
      <CardContent className="p-4">
        <p className="text-slate-500 text-xs mb-1">{label}</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-white text-sm truncate flex-1">{value}</p>
          {copyable && value && value !== "-" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-auto p-1 text-slate-400 hover:text-white"
            >
              {copied ? "已复制" : "复制"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogDetailItem({
  label,
  value,
  copyable = false,
  mono = false,
  statusCode,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
  statusCode?: number | null;
}) {
  const { copied, trigger: markCopied } = useCopyFeedback();

  const handleCopy = async () => {
    if (!value || value === "-") return;
    await navigator.clipboard.writeText(value);
    markCopied();
  };

  const getStatusColor = () => {
    if (!statusCode) return "text-slate-400";
    if (statusCode >= 200 && statusCode < 400) return "text-green-400";
    return "text-red-400";
  };

  return (
    <div className="bg-[#0a0f1a]/80 border border-white/[0.04] rounded-lg p-3">
      <p className="text-slate-500 text-xs mb-1">{label}</p>
      <div className="flex items-center justify-between gap-2">
        <p className={cn(
          "text-sm break-all flex-1",
          mono ? "font-mono text-cyan-300" : "text-white",
          statusCode !== undefined && getStatusColor()
        )}>
          {value}
        </p>
        {copyable && value && value !== "-" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="h-auto p-1 text-slate-400 hover:text-white shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span className="ml-1 text-xs">{copied ? "已复制" : "复制"}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function LogEntry({ log, onClick }: { log: RequestLog; onClick?: () => void }) {
  const methodColors: Record<string, string> = {
    GET: "bg-green-500/20 text-green-400 border-green-500/30",
    POST: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PUT: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
    PATCH: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };

  const getStatusBadge = (compact = false) => {
    if (log.status === "pending") {
      return (
        <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2 mr-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-yellow-500"></span>
          </span>
          {compact ? "..." : "处理中"}
        </Badge>
      );
    }

    const statusCode = log.statusCode || 0;
    if (statusCode >= 200 && statusCode < 400) {
      return (
        <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
          {statusCode}
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
        {statusCode}
      </Badge>
    );
  };

  const formatDateTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return { dateStr, timeStr };
  };

  return (
    <Card
      className={cn(
        "bg-[#0a0f1a]/60 border-white/[0.06]",
        onClick && "cursor-pointer hover:bg-white/[0.02] hover:border-white/[0.1] transition-colors"
      )}
      onClick={onClick}
    >
      <CardContent className="p-2.5 sm:p-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Badge variant="outline" className={cn("font-mono text-[10px] sm:text-xs shrink-0", methodColors[log.requestMethod] || "text-slate-400")}>
              {log.requestMethod}
            </Badge>
            <span className="text-white text-xs sm:text-sm font-mono truncate flex-1">
              {log.requestPath}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-xs text-slate-500 shrink-0">
            <span className="hidden sm:flex">{getStatusBadge()}</span>
            <span className="flex sm:hidden">{getStatusBadge(true)}</span>
            <span className="hidden sm:block w-16 text-right">{log.responseDurationMs !== null ? `${log.responseDurationMs}ms` : ''}</span>
            <span className="hidden md:block w-32 text-right text-slate-600">
              <span className="text-slate-700">{formatDateTime(log.requestTimestamp).dateStr}</span>
              {' '}
              {formatDateTime(log.requestTimestamp).timeStr}
            </span>
            <span className="hidden lg:block w-28 text-right text-slate-600 font-mono">{log.clientIp}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 索引统计卡片内的构建进度条：消费 tenant-stats 的 active_job 字段
function IndexingProgress({ job }: { job: ActiveIndexJob }) {
  const percent =
    job.total_files > 0
      ? Math.min(100, Math.round((job.indexed_files / job.total_files) * 100))
      : 0;
  return (
    <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="flex items-center gap-2 text-xs text-cyan-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          索引构建中 {job.indexed_files.toLocaleString()}/{job.total_files.toLocaleString()} 文件
        </p>
        <span className="text-xs text-slate-500">{job.phase}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// 我的索引：按 root 维度列出已索引项目，支持逐个删除。支持个人/组织租户
// 切换；组织租户下成员角色隐藏删除按钮（仅组织所有者可删除）。
function RootsSection({
  roots,
  loading,
  error,
  deleteResult,
  orgOptions,
  activeOrg,
  onSelectOrg,
  canDelete,
  onRefresh,
  onDelete,
}: {
  roots: RelayRoot[] | null;
  loading: boolean;
  error: string | null;
  deleteResult: { success: boolean; message: string } | null;
  orgOptions: { id: string; name: string }[];
  activeOrg: { id: string; name: string } | null;
  onSelectOrg: (org: { id: string; name: string } | null) => void;
  canDelete: boolean;
  onRefresh: () => void;
  onDelete: (root: RelayRoot) => void;
}) {
  return (
    <div className="mt-6 pt-6 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">我的索引</h3>
        <Button variant="glass" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
          {loading ? "刷新中..." : "刷新"}
        </Button>
      </div>
      <p className="-mt-1 mb-3 text-[11px] text-slate-600">
        同一项目的不同分支各自维护独立的索引视图，互不影响，可分别删除。
      </p>

      {orgOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => onSelectOrg(null)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs border transition-colors",
              !activeOrg
                ? "bg-cyan-400/10 text-cyan-200 border-cyan-500/30"
                : "text-slate-500 border-white/[0.08] hover:text-slate-300"
            )}
          >
            个人
          </button>
          {orgOptions.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => onSelectOrg(org)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs border transition-colors",
                activeOrg?.id === org.id
                  ? "bg-cyan-400/10 text-cyan-200 border-cyan-500/30"
                  : "text-slate-500 border-white/[0.08] hover:text-slate-300"
              )}
            >
              <Building2 className="w-3 h-3 inline mr-1 -mt-0.5" />
              {org.name}
            </button>
          ))}
        </div>
      )}

      {activeOrg && !canDelete && roots !== null && (
        <p className="text-xs text-slate-500 mb-3">仅组织所有者可删除组织索引</p>
      )}

      {deleteResult && (
        <p
          className={cn(
            "text-xs mb-3",
            deleteResult.success ? "text-green-400" : "text-red-400"
          )}
        >
          {deleteResult.message}
        </p>
      )}

      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-red-300">{error}</p>
          <Button variant="glass" size="sm" onClick={onRefresh} disabled={loading} className="shrink-0">
            <RefreshCw className={cn("mr-1 h-4 w-4", loading && "animate-spin")} />
            重试
          </Button>
        </div>
      ) : roots === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-white/[0.06]" />
          <Skeleton className="h-16 w-full bg-white/[0.06]" />
        </div>
      ) : roots.length === 0 ? (
        <div className="rounded-lg border border-white/[0.04] bg-[#0a0f1a]/60 px-4 py-6 text-center text-xs text-slate-500">
          暂无已索引的项目。在 IDE 中连接 MCP 并完成首次索引后，项目会出现在这里。
        </div>
      ) : (
        <div className="space-y-2">
          {groupRootsByBase(roots).map((group) =>
            group.entries.length === 1 ? (
              // 单分支：与原有单卡片展示一致，不额外分组
              <Card key={group.baseRootId} className="bg-[#0a0f1a]/60 border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-white text-sm font-mono truncate" title={group.entries[0].root.workspace_id}>
                          {group.entries[0].root.workspace_id}
                        </p>
                        {rootBranchLabel(group.entries[0].root) && (
                          <Badge variant="outline" className="shrink-0 bg-white/[0.04] text-slate-400 border-white/[0.1] text-[10px] font-mono">
                            {rootBranchLabel(group.entries[0].root)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.entries[0].root.file_count.toLocaleString()} 个文件
                        <span className="text-slate-700"> · </span>
                        {formatSizeBytes(group.entries[0].root.total_size_bytes)}
                        <span className="text-slate-700"> · </span>
                        最后索引 {new Date(group.entries[0].root.indexed_at).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(group.entries[0].root)}
                      className={cn(
                        "shrink-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10",
                        !canDelete && "hidden"
                      )}
                      aria-label={`删除 ${group.entries[0].root.workspace_id} 的索引`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              // 多分支：同一项目下列出各分支视图，逐视图统计与删除
              <Card key={group.baseRootId} className="bg-[#0a0f1a]/60 border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-white text-sm font-mono truncate" title={group.workspaceId}>
                      {group.workspaceId}
                    </p>
                    <span className="text-[10px] text-slate-600">
                      {group.entries.length} 个分支视图
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {group.entries.map(({ root, branch }) => (
                      <div
                        key={root.root_id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="shrink-0 bg-white/[0.04] text-slate-400 border-white/[0.1] text-[10px] font-mono">
                              {branch}
                            </Badge>
                            <p className="text-xs text-slate-500">
                              {root.file_count.toLocaleString()} 个文件
                              <span className="text-slate-700"> · </span>
                              {formatSizeBytes(root.total_size_bytes)}
                              <span className="text-slate-700"> · </span>
                              最后索引 {new Date(root.indexed_at).toLocaleString("zh-CN")}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(root)}
                          className={cn(
                            "shrink-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10",
                            !canDelete && "hidden"
                          )}
                          aria-label={`删除 ${group.workspaceId} 分支 ${branch} 的索引`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}

// 配置说明第 3 步：引导用户在 CLAUDE.md / AGENTS.md 中声明 LCE 使用规则
// （只加 MCP 配置不保证代理会用，需要项目规则显式要求）
function AgentRulesCard({ mode }: { mode: "cloud" | "remote" }) {
  const snippet = mode === "cloud" ? AGENT_RULES_CLOUD : AGENT_RULES_REMOTE;
  const { copied, trigger: markCopied } = useCopyFeedback();
  const copyRules = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      markCopied();
    } catch {}
  };
  return (
    <Card className="bg-[#0a0f1a]/60 border-white/[0.06]">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium">
            3
          </span>
          <h3 className="text-white font-medium">让 AI 代理优先使用 LCE</h3>
        </div>
        <p className="text-slate-400 text-sm mb-4 leading-relaxed">
          只添加 MCP 服务器并不保证代理会用它。把以下规则加入项目根目录的{" "}
          <code className="text-cyan-400 text-xs">CLAUDE.md</code> /{" "}
          <code className="text-cyan-400 text-xs">AGENTS.md</code>
          （Cursor 用户也可放入 <code className="text-cyan-400 text-xs">.cursor/rules</code>），
          要求代理查找代码时优先走 LCE 语义检索：
        </p>
        <div className="relative group">
          <div className="bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-3 font-mono text-xs overflow-x-auto">
            <pre className="text-slate-300 whitespace-pre-wrap break-words">
              <code>{snippet}</code>
            </pre>
          </div>
          <Button variant="glass" size="sm" onClick={copyRules} className="absolute top-2 right-2">
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
