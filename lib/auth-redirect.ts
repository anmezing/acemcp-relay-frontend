export function sanitizeCallbackUrl(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    return raw;
  }
  return "/";
}

export function loginUrl(callbackUrl: string): string {
  return `/login?callbackUrl=${encodeURIComponent(sanitizeCallbackUrl(callbackUrl))}`;
}
