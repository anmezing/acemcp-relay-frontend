export type CredentialMode = "login" | "register";

export type RegistrationAvailability = "checking" | "open" | "closed" | "unavailable";

export interface CredentialPasswordPolicy {
  minLength: number;
  maxLength: number;
}

export function passwordPolicyFromResponse(
  responseOk: boolean,
  payload: unknown,
): CredentialPasswordPolicy | null {
  if (!responseOk || typeof payload !== "object" || payload === null) return null;
  const policy = (payload as { passwordPolicy?: unknown }).passwordPolicy;
  if (typeof policy !== "object" || policy === null) return null;
  const { minLength, maxLength } = policy as { minLength?: unknown; maxLength?: unknown };
  if (
    !Number.isSafeInteger(minLength) ||
    !Number.isSafeInteger(maxLength) ||
    (minLength as number) <= 0 ||
    (maxLength as number) < (minLength as number)
  ) {
    return null;
  }
  return { minLength: minLength as number, maxLength: maxLength as number };
}

export function registrationAvailabilityFromResponse(
  responseOk: boolean,
  payload: unknown,
): Exclude<RegistrationAvailability, "checking"> {
  if (
    !responseOk ||
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { enabled?: unknown }).enabled !== "boolean"
  ) {
    return "unavailable";
  }
  return (payload as { enabled: boolean }).enabled ? "open" : "closed";
}

export function emailRegistrationEnabledFromResponse(
  responseOk: boolean,
  payload: unknown,
): boolean {
  return Boolean(
    responseOk &&
    typeof payload === "object" &&
    payload !== null &&
    (payload as { emailRegistrationEnabled?: unknown }).emailRegistrationEnabled === true
  );
}

interface CredentialAuthError {
  code?: string;
  message?: string;
  statusText?: string;
}

export function oauthAuthErrorMessage(raw: string | null): CredentialMessage | null {
  if (!raw) return null;
  const normalized = raw.toUpperCase();
  if (normalized.startsWith("GITHUB_ACCOUNT_TOO_YOUNG:")) {
    const [, required, actual] = raw.split(":");
    if (actual === "unknown") {
      return { key: "githubAccountAgeUnknown" };
    }
    return { key: "githubAccountTooYoung", values: { required, actual } };
  }
  if (normalized.includes("REGISTRATION_DISABLED")) {
    return { key: "registrationClosedExistingUsers" };
  }
  if (normalized.includes("REGISTRATION_LIMIT_REACHED")) {
    return { key: "registrationCapacityReached" };
  }
  return { key: "loginFailed" };
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
    | "registrationStatusUnavailable"
    | "registrationCapacityReached"
    | "emailAlreadyRegistered"
    | "incorrectEmailOrPassword"
    | "invalidEmail"
    | "emailNotVerified"
    | "emailVerificationUnavailable"
    | "emailVerificationSent"
    | "githubAccountAgeUnknown"
    | "githubAccountTooYoung"
    | "registrationClosedExistingUsers"
    | "signUpFailed"
    | "loginFailed";
  values?: Record<string, string | number>;
}

export function validateCredentialFields(
  fields: CredentialFields,
  passwordPolicy: CredentialPasswordPolicy | null = null,
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
    if (!passwordPolicy) {
      return { key: "registrationStatusUnavailable" };
    }
    if (fields.password.length < passwordPolicy.minLength) {
      return { key: "passwordMinimum", values: { count: passwordPolicy.minLength } };
    }
    if (fields.password.length > passwordPolicy.maxLength) {
      return { key: "passwordMaximum", values: { count: passwordPolicy.maxLength } };
    }
    if (fields.password !== fields.confirmPassword) {
      return { key: "passwordsDoNotMatch" };
    }
  }
  return null;
}

export function credentialAuthErrorMessage(
  error: CredentialAuthError | null | undefined,
  mode: CredentialMode,
  passwordPolicy: CredentialPasswordPolicy | null = null,
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
  if (raw.includes("EMAIL_PASSWORD_SIGN_UP_DISABLED")) {
    return { key: "emailVerificationUnavailable" };
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
  if (raw.includes("EMAIL_NOT_VERIFIED")) {
    return { key: "emailNotVerified" };
  }
  if (raw.includes("VERIFICATION_EMAIL_NOT_ENABLED") || raw.includes("EMAIL_VERIFICATION_UNAVAILABLE")) {
    return { key: "emailVerificationUnavailable" };
  }
  if (raw.includes("PASSWORD_TOO_SHORT") && passwordPolicy) {
    return { key: "passwordMinimum", values: { count: passwordPolicy.minLength } };
  }
  if (raw.includes("PASSWORD_TOO_LONG") && passwordPolicy) {
    return { key: "passwordMaximum", values: { count: passwordPolicy.maxLength } };
  }
  return mode === "register"
    ? { key: "signUpFailed" }
    : { key: "loginFailed" };
}
