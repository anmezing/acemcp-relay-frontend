"use client";

import { useTranslations } from "next-intl";

export function I18nText({ id }: { id: string }) {
  const t = useTranslations("Home");
  return <>{t(id)}</>;
}
