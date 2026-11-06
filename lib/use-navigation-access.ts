"use client";

import { useEffect, useState } from "react";
import { DEFAULT_MENU_VISIBILITY, normalizeMenuVisibility, type ConsoleMenuId } from "@/lib/menu-config";

export interface NavigationAccess {
  userId: string;
  isAdmin: boolean;
  menuVisibility: Record<ConsoleMenuId, boolean>;
}

async function loadNavigationAccess(userId: string, signal: AbortSignal): Promise<NavigationAccess> {
  const [adminResult, menuResult] = await Promise.allSettled([
    fetch("/api/admin/check", { signal }).then(async (res) => {
      if (!res.ok) return false;
      const data = await res.json();
      return data.isAdmin === true;
    }),
    fetch("/api/menu-config", { signal }).then(async (res) => {
      if (!res.ok) return DEFAULT_MENU_VISIBILITY;
      const data = await res.json();
      return normalizeMenuVisibility(data.visibility);
    }),
  ]);
  return {
    userId,
    isAdmin: adminResult.status === "fulfilled" ? adminResult.value : false,
    // 菜单开关只控制展示，不是权限边界：读取失败时退回默认（全部可见），
    // 避免一次瞬时错误把导航整个藏掉。
    menuVisibility: menuResult.status === "fulfilled" ? menuResult.value : DEFAULT_MENU_VISIBILITY,
  };
}

/**
 * 控制台、排行榜、状态监控共用的导航权限（管理员身份 + 后台菜单开关）。
 * 返回 null 表示当前用户的数据尚未加载完成；切换用户时旧数据不会被复用。
 */
export function useNavigationAccess(userId: string | undefined): NavigationAccess | null {
  const [access, setAccess] = useState<NavigationAccess | null>(null);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void loadNavigationAccess(userId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setAccess(next);
    });
    return () => controller.abort();
  }, [userId]);

  return access?.userId === userId ? access : null;
}
