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

export interface CredentialMessage {
  key:
    | "enterDisplayName"
    | "enterEmail"
    | "enterPassword"
    | "passwordMinimum"
    | "passwordMaximum"
    | "passwordsDoNotMatch"
    | "registrationClosed"
    | "registrationCapacityReached"
    | "emailAlreadyRegistered"
    | "incorrectEmailOrPassword"
    | "invalidEmail"
    | "githubAccountAgeUnknown"
    | "githubAccountTooYoung"
    | "registrationClosedExistingUsers"
    | "signUpFailed"
    | "loginFailed";
  values?: Record<string, string | number>;
}

export function validateCredentialFields(
  fields: CredentialFields
): CredentialMessage | null {
  if (fields.mode === "register" && !fields.name.trim()) {
    return { key: "enterDisplayName" };
  }
  if (!fields.email.trim()) {
    return { key: "enterEmail" };
  }
  if (!fields.password) {
    return { key: "enterPassword" };
  }
  if (fields.mode === "register") {
    if (fields.password.length < MIN_PASSWORD_LENGTH) {
      return { key: "passwordMinimum", values: { count: MIN_PASSWORD_LENGTH } };
    }
    if (fields.password.length > MAX_PASSWORD_LENGTH) {
      return { key: "passwordMaximum", values: { count: MAX_PASSWORD_LENGTH } };
    }
    if (fields.password !== fields.confirmPassword) {
      return { key: "passwordsDoNotMatch" };
    }
  }
  return null;
}

export function credentialAuthErrorMessage(
  error: CredentialAuthError | null | undefined,
  mode: CredentialMode
): CredentialMessage {
  const raw = [error?.code, error?.message, error?.statusText]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (raw.includes("REGISTRATION_DISABLED")) {
    return { key: "registrationClosed" };
  }
  if (raw.includes("REGISTRATION_LIMIT_REACHED")) {
    return { key: "registrationCapacityReached" };
  }
  if (raw.includes("USER_ALREADY_EXISTS")) {
    return { key: "emailAlreadyRegistered" };
  }
  if (raw.includes("INVALID_EMAIL_OR_PASSWORD")) {
    return { key: "incorrectEmailOrPassword" };
  }
  if (raw.includes("INVALID_EMAIL")) {
    return { key: "invalidEmail" };
  }
  if (raw.includes("PASSWORD_TOO_SHORT")) {
    return { key: "passwordMinimum", values: { count: MIN_PASSWORD_LENGTH } };
  }
  if (raw.includes("PASSWORD_TOO_LONG")) {
    return { key: "passwordMaximum", values: { count: MAX_PASSWORD_LENGTH } };
  }
  return mode === "register"
    ? { key: "signUpFailed" }
    : { key: "loginFailed" };
}
