const AUTH_PROVIDER_LABELS: Record<string, string> = {
  credential: "邮箱/密码",
  github: "GitHub",
  linuxdo: "LinuxDo",
};

export function authProviderLabel(provider: string): string {
  return AUTH_PROVIDER_LABELS[provider] || provider;
}

export function authProviderLabels(providers: string[]): string[] {
  return [...new Set(providers.filter(Boolean).map(authProviderLabel))];
}
