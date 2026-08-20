"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { localeCookieName, type AppLocale } from "@/i18n/config";

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("LanguageSwitcher");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const label = nextLocale === "en" ? t("switchToEnglish") : t("switchToChinese");

  const switchLocale = () => {
    document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      onClick={switchLocale}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.025] px-2 text-xs text-slate-400 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:cursor-wait disabled:opacity-60",
        className
      )}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{locale === "zh-CN" ? "中" : "EN"}</span>
    </button>
  );
}
