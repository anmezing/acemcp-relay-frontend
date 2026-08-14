export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type CredentialMode = "login" | "register";

interface CredentialAuthError {
  code?: string;
  message?: string;
  statusText?: string;
}

export interface CredentialFields {
  mode: CredentialMode;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function validateCredentialFields(fields: CredentialFields): string | null {
  if (fields.mode === "register" && !fields.name.trim()) {
    return "请输入昵称";
  }
  if (!fields.email.trim()) {
    return "请输入邮箱";
  }
  if (!fields.password) {
    return "请输入密码";
  }
  if (fields.mode === "register") {
    if (fields.password.length < MIN_PASSWORD_LENGTH) {
      return `密码至少需要 ${MIN_PASSWORD_LENGTH} 位`;
    }
    if (fields.password.length > MAX_PASSWORD_LENGTH) {
      return `密码不能超过 ${MAX_PASSWORD_LENGTH} 位`;
    }
    if (fields.password !== fields.confirmPassword) {
      return "两次输入的密码不一致";
    }
  }
  return null;
}

export function credentialAuthErrorMessage(
  error: CredentialAuthError | null | undefined,
  mode: CredentialMode
): string {
  const raw = [error?.code, error?.message, error?.statusText]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (raw.includes("REGISTRATION_DISABLED")) {
    return "当前未开放新用户注册";
  }
  if (raw.includes("USER_ALREADY_EXISTS")) {
    return "该邮箱已注册，请直接登录或使用原登录方式";
  }
  if (raw.includes("INVALID_EMAIL_OR_PASSWORD")) {
    return "邮箱或密码错误";
  }
  if (raw.includes("INVALID_EMAIL")) {
    return "邮箱格式不正确";
  }
  if (raw.includes("PASSWORD_TOO_SHORT")) {
    return `密码至少需要 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (raw.includes("PASSWORD_TOO_LONG")) {
    return `密码不能超过 ${MAX_PASSWORD_LENGTH} 位`;
  }
  return mode === "register" ? "注册失败，请稍后重试" : "登录失败，请稍后重试";
}
