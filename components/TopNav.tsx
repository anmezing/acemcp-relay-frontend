"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ConsoleMenuId } from "@/lib/menu-config";
import type { NavigationAccess } from "@/lib/use-navigation-access";

const TOP_NAV_ITEMS = [
  { id: "top-console", href: "/console" },
  { id: "top-leaderboard", href: "/leaderboard" },
  { id: "top-status", href: "/status" },
] as const satisfies readonly { id: ConsoleMenuId; href: string }[];

export type TopNavId = (typeof TOP_NAV_ITEMS)[number]["id"];

interface TopNavProps {
  active: TopNavId;
  /** null = 尚未加载完成，显示占位骨架，避免先闪出被关闭的菜单。 */
  access: NavigationAccess | null;
}

export function TopNav({ active, access }: TopNavProps) {
  const t = useTranslations("Navigation");

  return (
    <nav className="order-3 flex w-full justify-center sm:order-none sm:w-auto sm:items-center sm:gap-1">
      {access === null ? (
        <div aria-hidden="true" className="flex h-8 items-center gap-3 px-2">
          <Skeleton className="h-3.5 w-12 bg-white/[0.06]" />
          <Skeleton className="h-3.5 w-12 bg-white/[0.06]" />
          <Skeleton className="h-3.5 w-12 bg-white/[0.06]" />
        </div>
      ) : (
        TOP_NAV_ITEMS.filter((item) => access.isAdmin || access.menuVisibility[item.id] !== false).map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === active ? "page" : undefined}
            className={cn(
              "px-2 sm:px-3 py-1.5 text-center text-xs sm:text-sm whitespace-nowrap border-b-2",
              item.id === active
                ? "text-white border-cyan-400"
                : "text-slate-400 hover:text-slate-200 border-transparent transition-colors"
            )}
          >
            {t(`menus.${item.id}`)}
          </Link>
        ))
      )}
    </nav>
  );
}
