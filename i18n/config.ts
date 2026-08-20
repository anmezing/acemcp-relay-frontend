export const locales = ["zh-CN", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "zh-CN";
export const localeCookieName = "lce_locale";

export function isAppLocale(value: string | undefined): value is AppLocale {
  return locales.includes(value as AppLocale);
}
