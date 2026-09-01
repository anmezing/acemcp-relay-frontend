const RELAY_NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

function errorCode(value: unknown): string {
  if (!value || typeof value !== "object" || !("code" in value)) return "";
  return typeof value.code === "string" ? value.code.toUpperCase() : "";
}

export function isRelayConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (RELAY_NETWORK_ERROR_CODES.has(errorCode(current))) return true;
    if (current instanceof DOMException && current.name === "TimeoutError") return true;
    if (current instanceof TypeError && current.message.toLowerCase().includes("fetch failed")) return true;
    current = typeof current === "object" && "cause" in current ? current.cause : null;
  }
  return false;
}

export const RELAY_UNAVAILABLE_RESPONSE = {
  code: "relay_unavailable",
  error: "索引服务暂时不可用，请稍后重试；如果持续失败，请联系管理员。",
} as const;
